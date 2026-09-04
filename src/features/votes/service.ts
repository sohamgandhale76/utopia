import { Prisma, PrismaClient, VoteType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  castPostVoteSchema,
  castCommentVoteSchema,
  CastPostVoteInput,
  CastCommentVoteInput,
} from "./validation";
import { checkUserSanction } from "@/features/sanctions/guards";
import { executeWithRetry } from "@/lib/transaction";

export type VoteResult = {
  currentVote: VoteType | null;
  score: number;
};

export async function castPostVote(
  input: unknown,
  userId: string,
  prismaClient: PrismaClient = db
): Promise<VoteResult> {
  const data = castPostVoteSchema.parse(input);

  const result = await executeWithRetry(
    () =>
      prismaClient.$transaction(
      async (tx) => {
        // 1. Target post must exist and not be soft-deleted
        const post = await tx.post.findUnique({
          where: { id: data.postId, isDeleted: false },
          select: { id: true, communityId: true },
        });

        if (!post) {
          throw new Error("Post not found");
        }

        // 2. Voting requires community membership
        const membership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId,
              communityId: post.communityId,
            },
          },
        });

        if (!membership) {
          throw new Error("You must be a member of this community to vote");
        }

        // 3. User must not be muted or banned
        await checkUserSanction(post.communityId, userId, "VOTE", tx);

        // 4. Find existing vote
        const existingVote = await tx.postVote.findUnique({
          where: {
            userId_postId: {
              userId,
              postId: post.id,
            },
          },
        });

        let currentVote: VoteType | null = null;

        if (existingVote) {
          if (existingVote.type === data.type) {
            // Unvote / toggle off
            await tx.postVote.delete({
              where: { id: existingVote.id },
            });
            currentVote = null;
          } else {
            // Change vote direction (UP -> DOWN or DOWN -> UP)
            await tx.postVote.update({
              where: { id: existingVote.id },
              data: { type: data.type },
            });
            currentVote = data.type;
          }
        } else {
          // Create new vote
          await tx.postVote.create({
            data: {
              userId,
              postId: post.id,
              type: data.type,
            },
          });
          currentVote = data.type;
        }

        return {
          currentVote,
          postId: post.id,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    ),
    { maxRetries: 5, backoff: true }
  );

  const score = await getPostScore(result.postId, prismaClient);
  return {
    currentVote: result.currentVote,
    score,
  };
}

export async function castCommentVote(
  input: unknown,
  userId: string,
  prismaClient: PrismaClient = db
): Promise<VoteResult> {
  const data = castCommentVoteSchema.parse(input);

  const result = await executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // 1. Target comment must exist and not be soft-deleted
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
          throw new Error("Comment not found");
        }

        const communityId = comment.post.communityId;

        // 2. Voting requires community membership
        const membership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId,
              communityId,
            },
          },
        });

        if (!membership) {
          throw new Error("You must be a member of this community to vote");
        }

        // 3. User must not be muted or banned
        await checkUserSanction(communityId, userId, "VOTE", tx);

        // 4. Find existing vote
        const existingVote = await tx.commentVote.findUnique({
          where: {
            userId_commentId: {
              userId,
              commentId: comment.id,
            },
          },
        });

        let currentVote: VoteType | null = null;

        if (existingVote) {
          if (existingVote.type === data.type) {
            // Unvote / toggle off
            await tx.commentVote.delete({
              where: { id: existingVote.id },
            });
            currentVote = null;
          } else {
            // Change vote direction
            await tx.commentVote.update({
              where: { id: existingVote.id },
              data: { type: data.type },
            });
            currentVote = data.type;
          }
        } else {
          // Create new vote
          await tx.commentVote.create({
            data: {
              userId,
              commentId: comment.id,
              type: data.type,
            },
          });
          currentVote = data.type;
        }

        return {
          currentVote,
          commentId: comment.id,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    ),
    { maxRetries: 5, backoff: true }
  );

  const score = await getCommentScore(result.commentId, prismaClient);
  return {
    currentVote: result.currentVote,
    score,
  };
}

export async function getPostScore(
  postId: string,
  prisma: PrismaClient | Prisma.TransactionClient = db
): Promise<number> {
  const [upvotes, downvotes] = await Promise.all([
    prisma.postVote.count({ where: { postId, type: VoteType.UP } }),
    prisma.postVote.count({ where: { postId, type: VoteType.DOWN } }),
  ]);
  return upvotes - downvotes;
}

export async function getCommentScore(
  commentId: string,
  prisma: PrismaClient | Prisma.TransactionClient = db
): Promise<number> {
  const [upvotes, downvotes] = await Promise.all([
    prisma.commentVote.count({ where: { commentId, type: VoteType.UP } }),
    prisma.commentVote.count({ where: { commentId, type: VoteType.DOWN } }),
  ]);
  return upvotes - downvotes;
}

export async function getUserPostVote(
  postId: string,
  userId: string,
  prisma: PrismaClient | Prisma.TransactionClient = db
): Promise<VoteType | null> {
  const vote = await prisma.postVote.findUnique({
    where: { userId_postId: { userId, postId } },
    select: { type: true },
  });
  return vote?.type ?? null;
}

export async function getUserCommentVote(
  commentId: string,
  userId: string,
  prisma: PrismaClient | Prisma.TransactionClient = db
): Promise<VoteType | null> {
  const vote = await prisma.commentVote.findUnique({
    where: { userId_commentId: { userId, commentId } },
    select: { type: true },
  });
  return vote?.type ?? null;
}
