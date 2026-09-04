import { Prisma, PrismaClient, ModActionType, CommunityRole, ReportStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  removePostSchema,
  removeCommentSchema,
  dismissReportSchema,
  RemovePostInput,
  RemoveCommentInput,
  DismissReportInput,
} from "./validation";
import { requireCommunityRole } from "@/features/communities/permissions";
import { logModerationAction } from "./audit";
import { executeWithRetry } from "@/lib/transaction";

export async function removePost(
  input: unknown,
  moderatorId: string,
  prismaClient: PrismaClient = db
) {
  const data = removePostSchema.parse(input);

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // 1. Fetch post
        const post = await tx.post.findUnique({
          where: { id: data.postId },
          select: {
            id: true,
            communityId: true,
            authorId: true,
            isDeleted: true,
          },
        });

        if (!post) {
          throw new Error("Post not found");
        }

        if (post.isDeleted) {
          throw new Error("Post is already deleted");
        }

        // 2. Authorize moderator in community
        await requireCommunityRole(
          post.communityId,
          moderatorId,
          CommunityRole.MODERATOR,
          tx
        );

        const now = new Date();

        // 3. Soft-delete post
        await tx.post.update({
          where: { id: post.id },
          data: {
            isDeleted: true,
            deletedAt: now,
            deletedByRole: "MODERATOR",
            deletedReason: data.reason,
          },
        });

        // 4. Update linked report if provided
        if (data.reportId) {
          await tx.report.updateMany({
            where: { id: data.reportId },
            data: { status: ReportStatus.ACTIONED },
          });
        }

        // 5. Append-only ModerationAction log
        const action = await logModerationAction(tx, {
          communityId: post.communityId,
          moderatorId,
          targetUserId: post.authorId,
          postId: post.id,
          reportId: data.reportId,
          actionType: ModActionType.REMOVE_POST,
          reason: data.reason,
          internalNote: data.internalNote,
        });

        return action;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export async function removeComment(
  input: unknown,
  moderatorId: string,
  prismaClient: PrismaClient = db
) {
  const data = removeCommentSchema.parse(input);

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // 1. Fetch comment with post context
        const comment = await tx.comment.findUnique({
          where: { id: data.commentId },
          select: {
            id: true,
            authorId: true,
            isDeleted: true,
            post: {
              select: { communityId: true },
            },
          },
        });

        if (!comment) {
          throw new Error("Comment not found");
        }

        if (comment.isDeleted) {
          throw new Error("Comment is already deleted");
        }

        const communityId = comment.post.communityId;

        // 2. Authorize moderator in community
        await requireCommunityRole(
          communityId,
          moderatorId,
          CommunityRole.MODERATOR,
          tx
        );

        const now = new Date();

        // 3. Soft-delete comment
        await tx.comment.update({
          where: { id: comment.id },
          data: {
            isDeleted: true,
            deletedAt: now,
            deletedByRole: "MODERATOR",
            deletedReason: data.reason,
          },
        });

        // 4. Update linked report if provided
        if (data.reportId) {
          await tx.report.updateMany({
            where: { id: data.reportId },
            data: { status: ReportStatus.ACTIONED },
          });
        }

        // 5. Append-only ModerationAction log
        const action = await logModerationAction(tx, {
          communityId,
          moderatorId,
          targetUserId: comment.authorId,
          commentId: comment.id,
          reportId: data.reportId,
          actionType: ModActionType.REMOVE_COMMENT,
          reason: data.reason,
          internalNote: data.internalNote,
        });

        return action;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export async function dismissReport(
  input: unknown,
  moderatorId: string,
  prismaClient: PrismaClient = db
) {
  const data = dismissReportSchema.parse(input);

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // 1. Fetch report to derive community
        const report = await tx.report.findUnique({
          where: { id: data.reportId },
          select: {
            id: true,
            status: true,
            postId: true,
            commentId: true,
            post: { select: { communityId: true } },
            comment: { select: { post: { select: { communityId: true } } } },
          },
        });

        if (!report) {
          throw new Error("Report not found");
        }

        const communityId =
          report.post?.communityId ?? report.comment?.post.communityId;

        if (!communityId) {
          throw new Error("Unable to resolve community for this report");
        }

        // 2. Authorize moderator in community
        await requireCommunityRole(
          communityId,
          moderatorId,
          CommunityRole.MODERATOR,
          tx
        );

        // 3. Update report status
        await tx.report.update({
          where: { id: report.id },
          data: { status: ReportStatus.DISMISSED },
        });

        // 4. Append-only ModerationAction log
        const action = await logModerationAction(tx, {
          communityId,
          moderatorId,
          reportId: report.id,
          postId: report.postId,
          commentId: report.commentId,
          actionType: ModActionType.DISMISS_REPORT,
          reason: data.reason,
          internalNote: data.internalNote,
        });

        return action;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export type PublicModLogEntry = {
  id: string;
  actionType: ModActionType;
  moderatorUsername: string;
  reason: string;
  createdAt: Date;
  targetDescription: string | null;
  postTitle?: string | null;
  sanctionType?: string | null;
  sanctionExpiresAt?: Date | null;
};

/**
 * Community-Scoped Public Moderation Transparency Log (/c/[slug]/modlog).
 * Strictly projects only public-safe fields:
 * - Omits internalNote
 * - Omits reporterId and Report.reason
 * - Masks target pseudonym on sanctions ("Sanctioned a member")
 * - Omits target pseudonym on content removals
 */
export async function getCommunityModLog(
  communitySlug: string,
  limit = 50,
  prisma: PrismaClient | Prisma.TransactionClient = db
): Promise<PublicModLogEntry[]> {
  const community = await prisma.community.findUnique({
    where: { slug: communitySlug },
    select: { id: true },
  });

  if (!community) {
    throw new Error("Community not found");
  }

  const safeLimit = Math.min(Math.max(1, limit), 100);

  const actions = await prisma.moderationAction.findMany({
    where: { communityId: community.id },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
    select: {
      id: true,
      actionType: true,
      reason: true,
      createdAt: true,
      moderator: {
        select: { username: true },
      },
      post: {
        select: { id: true, title: true },
      },
      comment: {
        select: { id: true },
      },
      sanction: {
        select: { sanctionType: true, expiresAt: true },
      },
    },
  });

  return actions.map((act) => {
    let targetDescription: string | null = null;

    if (act.actionType === ModActionType.ISSUE_SANCTION) {
      targetDescription = act.sanction?.expiresAt
        ? `Sanctioned a member (${act.sanction.sanctionType}, temporary)`
        : `Sanctioned a member (${act.sanction?.sanctionType ?? "MUTE"}, permanent)`;
    } else if (act.actionType === ModActionType.REVOKE_SANCTION) {
      targetDescription = "Sanction revoked for a member";
    } else if (act.actionType === ModActionType.REMOVE_POST) {
      targetDescription = act.post?.title ? `Post: "${act.post.title}"` : "Post removed";
    } else if (act.actionType === ModActionType.REMOVE_COMMENT) {
      targetDescription = "Comment removed";
    } else if (act.actionType === ModActionType.DISMISS_REPORT) {
      targetDescription = "Report dismissed";
    }

    return {
      id: act.id,
      actionType: act.actionType,
      moderatorUsername: act.moderator.username,
      reason: act.reason,
      createdAt: act.createdAt,
      targetDescription,
      postTitle: act.post?.title ?? null,
      sanctionType: act.sanction?.sanctionType ?? null,
      sanctionExpiresAt: act.sanction?.expiresAt ?? null,
    };
  });
}
