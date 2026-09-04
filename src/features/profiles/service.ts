import { PrismaClient, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  usernameSchema,
  profilePaginationLimitSchema,
  encodeCursor,
  decodeCursor,
} from "./validation";

export interface PublicProfile {
  username: string;
  createdAt: Date;
}

export interface PublicProfilePost {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
  community: {
    name: string;
    slug: string;
  };
}

export interface PublicProfilePostsResult {
  posts: PublicProfilePost[];
  nextCursor?: string;
}

export interface PublicProfileComment {
  id: string;
  body: string;
  createdAt: Date;
  postId: string;
  post: {
    id: string;
    title: string;
    community: {
      name: string;
      slug: string;
    };
  };
}

export interface PublicProfileCommentsResult {
  comments: PublicProfileComment[];
  nextCursor?: string;
}

/**
 * Retrieves the public profile of a user.
 * Suspended users return null, matching nonexistent users identically.
 * Strictly exposes only { username, createdAt }.
 */
export async function getPublicProfile(
  username: string,
  prisma: PrismaClient = db
): Promise<PublicProfile | null> {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) {
    return null;
  }

  const user = await prisma.user.findFirst({
    where: {
      username: parsed.data,
      isSuspended: false,
    },
    select: {
      username: true,
      createdAt: true,
    },
  });

  return user;
}

/**
 * Retrieves an active user's public non-deleted posts using keyset pagination.
 * If user does not exist or is suspended, returns null.
 * Never exposes private fields (authorId, role, votes, reports, etc.).
 */
export async function getUserPublicPosts(
  username: string,
  limit?: number,
  cursor?: string,
  prisma: PrismaClient = db
): Promise<PublicProfilePostsResult | null> {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) {
    return null;
  }

  const user = await prisma.user.findFirst({
    where: {
      username: parsed.data,
      isSuspended: false,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    return null;
  }

  const validatedLimit = profilePaginationLimitSchema.parse(limit);
  const decodedCursor = cursor ? decodeCursor(cursor) : null;

  const whereClause: Prisma.PostWhereInput = {
    authorId: user.id,
    isDeleted: false,
  };

  if (decodedCursor) {
    whereClause.OR = [
      {
        createdAt: { lt: decodedCursor.createdAt },
      },
      {
        createdAt: decodedCursor.createdAt,
        id: { lt: decodedCursor.id },
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
    select: {
      id: true,
      title: true,
      body: true,
      createdAt: true,
      community: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
  });

  let nextCursor: string | undefined = undefined;
  if (posts.length > validatedLimit) {
    posts.pop();
    const lastItem = posts[posts.length - 1];
    if (lastItem) {
      nextCursor = encodeCursor(lastItem.id, lastItem.createdAt);
    }
  }

  return {
    posts,
    nextCursor,
  };
}

/**
 * Retrieves an active user's public non-deleted comments using keyset pagination.
 * Excludes comments on soft-deleted posts, even if comment itself is not deleted.
 * If user does not exist or is suspended, returns null.
 * Never exposes private fields (authorId, role, votes, reports, etc.).
 */
export async function getUserPublicComments(
  username: string,
  limit?: number,
  cursor?: string,
  prisma: PrismaClient = db
): Promise<PublicProfileCommentsResult | null> {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) {
    return null;
  }

  const user = await prisma.user.findFirst({
    where: {
      username: parsed.data,
      isSuspended: false,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    return null;
  }

  const validatedLimit = profilePaginationLimitSchema.parse(limit);
  const decodedCursor = cursor ? decodeCursor(cursor) : null;

  const whereClause: Prisma.CommentWhereInput = {
    authorId: user.id,
    isDeleted: false,
    post: {
      isDeleted: false,
    },
  };

  if (decodedCursor) {
    whereClause.OR = [
      {
        createdAt: { lt: decodedCursor.createdAt },
      },
      {
        createdAt: decodedCursor.createdAt,
        id: { lt: decodedCursor.id },
      },
    ];
  }

  const comments = await prisma.comment.findMany({
    where: whereClause,
    take: validatedLimit + 1,
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      body: true,
      createdAt: true,
      postId: true,
      post: {
        select: {
          id: true,
          title: true,
          community: {
            select: {
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  let nextCursor: string | undefined = undefined;
  if (comments.length > validatedLimit) {
    comments.pop();
    const lastItem = comments[comments.length - 1];
    if (lastItem) {
      nextCursor = encodeCursor(lastItem.id, lastItem.createdAt);
    }
  }

  return {
    comments,
    nextCursor,
  };
}
