import { PrismaClient, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createPostSchema,
  CreatePostInput,
  createCommentSchema,
  CreateCommentInput,
  feedLimitSchema,
  feedCursorSchema,
} from "./validation";
import { checkUserSanction } from "@/features/sanctions/guards";
import { executeWithRetry } from "@/lib/transaction";

export function encodeCursor(id: string, createdAt: Date): string {
  const jsonStr = JSON.stringify({ id, createdAt: createdAt.toISOString() });
  return Buffer.from(jsonStr, "utf-8").toString("base64url");
}

export function decodeCursor(cursor: string): { id: string; createdAt: Date } | null {
  try {
    const jsonStr = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = feedCursorSchema.parse(JSON.parse(jsonStr));
    return { id: parsed.id, createdAt: new Date(parsed.createdAt) };
  } catch {
    return null;
  }
}

export const publicUserSelect = {
  id: true,
  username: true,
} satisfies Prisma.UserSelect;

export const publicPostSelect = {
  id: true,
  communityId: true,
  authorId: true,
  title: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: publicUserSelect,
  },
} satisfies Prisma.PostSelect;

export const publicCommentSelect = {
  id: true,
  postId: true,
  authorId: true,
  parentId: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: publicUserSelect,
  },
} satisfies Prisma.CommentSelect;

export type PublicPost = Prisma.PostGetPayload<{ select: typeof publicPostSelect }>;
export type PublicComment = Prisma.CommentGetPayload<{ select: typeof publicCommentSelect }>;

export async function createPost(
  input: unknown,
  authorId: string,
  prismaClient: PrismaClient = db
) {
  const data = createPostSchema.parse(input);

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // Verify membership exists
        const membership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId: authorId,
              communityId: data.communityId,
            },
          },
        });

        if (!membership) {
          throw new Error("You must be a member of this community to post");
        }

        await checkUserSanction(data.communityId, authorId, "POST", tx);

        const post = await tx.post.create({
          data: {
            communityId: data.communityId,
            authorId,
            title: data.title,
            body: data.body,
          },
          select: {
            id: true,
          },
        });

        return post;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

async function getCommentDepth(
  parentId: string,
  prisma: Prisma.TransactionClient | PrismaClient
): Promise<number> {
  let depth = 1;
  let currentParentId: string | null = parentId;

  while (currentParentId && depth <= 5) {
    const parentComment: { parentId: string | null } | null = await prisma.comment.findUnique({
      where: { id: currentParentId },
      select: { parentId: true },
    });

    if (!parentComment) break;

    currentParentId = parentComment.parentId;
    if (currentParentId) {
      depth++;
    }
  }

  return depth;
}

export async function createComment(
  input: unknown,
  authorId: string,
  prismaClient: PrismaClient = db
) {
  const data = createCommentSchema.parse(input);

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // 1. Verify post exists and is not deleted, get communityId
        const post = await tx.post.findUnique({
          where: { id: data.postId, isDeleted: false },
          select: { communityId: true },
        });

        if (!post) {
          throw new Error("Post not found");
        }

        // 2. Verify membership
        const membership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId: authorId,
              communityId: post.communityId,
            },
          },
        });

        if (!membership) {
          throw new Error("You must be a member of this community to comment");
        }

        await checkUserSanction(post.communityId, authorId, "COMMENT", tx);

        // 3. If parentId provided, verify depth
        if (data.parentId) {
          const parent = await tx.comment.findUnique({
            where: { id: data.parentId },
            select: { postId: true },
          });
          
          if (!parent) {
            throw new Error("Parent comment not found");
          }
          
          if (parent.postId !== data.postId) {
            throw new Error("Parent comment does not belong to this post");
          }

          const depth = await getCommentDepth(data.parentId, tx);
          if (depth >= 5) {
            throw new Error("Maximum reply depth exceeded");
          }
        }

        const comment = await tx.comment.create({
          data: {
            postId: data.postId,
            authorId,
            parentId: data.parentId,
            body: data.body,
          },
          select: {
            id: true,
          },
        });

        return comment;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export async function getCommunityFeed(
  communitySlug: string,
  limit: number = 50,
  cursorStr?: string,
  prisma: PrismaClient = db
) {
  const validatedLimit = feedLimitSchema.parse(limit);

  // First, look up the community ID securely (and optionally ensure it exists)
  const community = await prisma.community.findUnique({
    where: { slug: communitySlug },
    select: { id: true },
  });

  if (!community) {
    return null; // or throw a 404
  }

  const cursor = cursorStr ? decodeCursor(cursorStr) : null;
  const whereClause: Prisma.PostWhereInput = {
    communityId: community.id,
    isDeleted: false,
  };

  if (cursor) {
    whereClause.OR = [
      { createdAt: { lt: cursor.createdAt } },
      {
        createdAt: cursor.createdAt,
        id: { lt: cursor.id },
      },
    ];
  }

  const posts = await prisma.post.findMany({
    where: whereClause,
    take: validatedLimit + 1,
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: publicPostSelect,
  });

  let nextCursor: string | undefined = undefined;
  if (posts.length > validatedLimit) {
    posts.pop();
    const lastReturnedItem = posts[posts.length - 1];
    nextCursor = encodeCursor(lastReturnedItem.id, lastReturnedItem.createdAt);
  }

  return {
    posts,
    nextCursor,
  };
}

export type PostWithComments = PublicPost & {
  comments: PublicComment[];
};

export async function getPostDetails(
  postId: string,
  prisma: PrismaClient = db
): Promise<PostWithComments | null> {
  const post = await prisma.post.findUnique({
    where: {
      id: postId,
      isDeleted: false,
    },
    select: {
      ...publicPostSelect,
      comments: {
        where: {
          isDeleted: false,
        },
        orderBy: {
          createdAt: "asc",
        },
        select: publicCommentSelect,
      },
    },
  });

  return post;
}
