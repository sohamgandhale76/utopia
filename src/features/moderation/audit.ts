import { Prisma, ModActionType } from "@prisma/client";

export interface LogModerationActionParams {
  communityId: string;
  moderatorId: string;
  actionType: ModActionType;
  reason: string;
  targetUserId?: string | null;
  reportId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  sanctionId?: string | null;
  internalNote?: string | null;
}

/**
 * Appends an immutable audit record to the ModerationAction table within an active transaction.
 * The application layer exposes NO update or delete operations for ModerationAction.
 */
export async function logModerationAction(
  tx: Prisma.TransactionClient,
  params: LogModerationActionParams
) {
  return await tx.moderationAction.create({
    data: {
      communityId: params.communityId,
      moderatorId: params.moderatorId,
      actionType: params.actionType,
      reason: params.reason,
      targetUserId: params.targetUserId ?? null,
      reportId: params.reportId ?? null,
      postId: params.postId ?? null,
      commentId: params.commentId ?? null,
      sanctionId: params.sanctionId ?? null,
      internalNote: params.internalNote ?? null,
    },
    select: {
      id: true,
      actionType: true,
      createdAt: true,
    },
  });
}
