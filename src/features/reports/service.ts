import { Prisma, PrismaClient, ReportStatus, CommunityRole } from "@prisma/client";
import { db } from "@/lib/db";
import { submitReportSchema, SubmitReportInput } from "./validation";
import { checkUserSanction } from "@/features/sanctions/guards";
import { requireCommunityRole } from "@/features/communities/permissions";

async function executeWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      attempt++;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < maxRetries
      ) {
        continue;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new Error("You have already submitted a pending report for this content");
      }
      throw error;
    }
  }
}

export async function submitReport(
  input: unknown,
  reporterId: string,
  prismaClient: PrismaClient = db
) {
  const data = submitReportSchema.parse(input);

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        let communityId: string;

        if (data.postId) {
          const post = await tx.post.findUnique({
            where: { id: data.postId, isDeleted: false },
            select: { id: true, communityId: true },
          });

          if (!post) {
            throw new Error("Post not found or already deleted");
          }
          communityId = post.communityId;
        } else if (data.commentId) {
          const comment = await tx.comment.findUnique({
            where: { id: data.commentId, isDeleted: false },
            select: {
              id: true,
              postId: true,
              post: {
                select: { communityId: true },
              },
            },
          });

          if (!comment) {
            throw new Error("Comment not found or already deleted");
          }
          communityId = comment.post.communityId;
        } else {
          throw new Error("Report must target either a post or a comment");
        }

        // 1. Reporter must be a member of the community
        const membership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId: reporterId,
              communityId,
            },
          },
        });

        if (!membership) {
          throw new Error("You must be a member of this community to report content");
        }

        // 2. Check sanction (BAN blocks REPORT; MUTE is permitted)
        await checkUserSanction(communityId, reporterId, "REPORT", tx);

        // 3. Deduplication check: reject if a PENDING report already exists by this reporter for this target
        const existingReport = await tx.report.findFirst({
          where: {
            reporterId,
            status: ReportStatus.PENDING,
            ...(data.postId ? { postId: data.postId } : { commentId: data.commentId }),
          },
        });

        if (existingReport) {
          throw new Error("You have already submitted a pending report for this content");
        }

        // 4. Create report record
        const report = await tx.report.create({
          data: {
            reporterId,
            postId: data.postId,
            commentId: data.commentId,
            reason: data.reason,
            status: ReportStatus.PENDING,
          },
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
        });

        return report;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export async function listCommunityReports(
  communityId: string,
  moderatorId: string,
  status: ReportStatus = ReportStatus.PENDING,
  prisma: PrismaClient | Prisma.TransactionClient = db
) {
  // Authorization: Moderator or Owner role required
  await requireCommunityRole(communityId, moderatorId, CommunityRole.MODERATOR, prisma);

  const reports = await prisma.report.findMany({
    where: {
      status,
      OR: [
        { post: { communityId } },
        { comment: { post: { communityId } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      reason: true,
      status: true,
      createdAt: true,
      postId: true,
      commentId: true,
      post: {
        select: {
          id: true,
          title: true,
          body: true,
          isDeleted: true,
          author: {
            select: { id: true, username: true },
          },
        },
      },
      comment: {
        select: {
          id: true,
          body: true,
          isDeleted: true,
          author: {
            select: { id: true, username: true },
          },
        },
      },
    },
  });

  return reports;
}
