import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { PublicCommunitySummary } from "@/features/communities/service";
import { PublicPost } from "@/features/content/service";
import { decodeSearchCursor, encodeSearchCursor } from "./validation";

/**
 * Escapes PostgreSQL LIKE/ILIKE metacharacters in a user-supplied string so that
 * `%` and `_` are treated as literal characters rather than wildcard operators.
 *
 * Safe to call on already-trimmed strings.
 * Must be paired with an explicit ESCAPE '#' clause in the SQL query.
 */
function escapeLikePattern(value: string): string {
  // Escape the escape character first, then % and _
  return value.replace(/#/g, "##").replace(/%/g, "#%").replace(/_/g, "#_");
}

export async function searchCommunities(
  query: string,
  limit: number,
  prisma: PrismaClient = db
): Promise<PublicCommunitySummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  // Escape LIKE metacharacters before wrapping in wildcards so that
  // user-supplied `%` and `_` are matched literally, not as SQL wildcards.
  const escaped = escapeLikePattern(q);
  const wildcardQ = `%${escaped}%`;

  const results = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      slug: string;
      description: string;
      createdAt: Date;
      memberCount: bigint;
    }>
  >`
    SELECT 
      c.id, 
      c.name, 
      c.slug, 
      c.description, 
      c."createdAt", 
      COUNT(m.id) as "memberCount"
    FROM "Community" c
    LEFT JOIN "Membership" m ON c.id = m."communityId"
    WHERE 
      c.name ILIKE ${wildcardQ} ESCAPE '#' OR 
      c.slug ILIKE ${wildcardQ} ESCAPE '#' OR 
      to_tsvector('english', c.name || ' ' || c.description) @@ websearch_to_tsquery('english', ${q})
    GROUP BY c.id
    ORDER BY 
      ts_rank(to_tsvector('english', c.name || ' ' || c.description), websearch_to_tsquery('english', ${q})) DESC,
      c."createdAt" DESC
    LIMIT ${limit}
  `;

  return results.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.createdAt,
    _count: {
      memberships: Number(row.memberCount),
    },
  }));
}

export async function searchPosts(
  query: string,
  communitySlug: string | undefined,
  limit: number,
  cursor: string | undefined,
  prisma: PrismaClient = db
): Promise<{ posts: PublicPost[]; nextCursor?: string }> {
  const q = query.trim();
  if (q.length < 2) return { posts: [] };

  const offset = decodeSearchCursor(cursor);

  let results: Array<{
    id: string;
    communityId: string;
    authorId: string;
    title: string;
    body: string;
    createdAt: Date;
    updatedAt: Date;
    authorUsername: string;
  }>;

  if (communitySlug) {
    results = await prisma.$queryRaw`
      SELECT 
        p.id, 
        p."communityId", 
        p."authorId", 
        p.title, 
        p.body, 
        p."createdAt", 
        p."updatedAt",
        u.username as "authorUsername"
      FROM "Post" p
      JOIN "User" u ON p."authorId" = u.id
      JOIN "Community" c ON p."communityId" = c.id
      WHERE 
        p."isDeleted" = false AND 
        u."isSuspended" = false AND
        c.slug = ${communitySlug} AND
        to_tsvector('english', p.title || ' ' || p.body) @@ websearch_to_tsquery('english', ${q})
      ORDER BY 
        ts_rank(to_tsvector('english', p.title || ' ' || p.body), websearch_to_tsquery('english', ${q})) DESC,
        p."createdAt" DESC,
        p.id DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `;
  } else {
    results = await prisma.$queryRaw`
      SELECT 
        p.id, 
        p."communityId", 
        p."authorId", 
        p.title, 
        p.body, 
        p."createdAt", 
        p."updatedAt",
        u.username as "authorUsername"
      FROM "Post" p
      JOIN "User" u ON p."authorId" = u.id
      WHERE 
        p."isDeleted" = false AND 
        u."isSuspended" = false AND
        to_tsvector('english', p.title || ' ' || p.body) @@ websearch_to_tsquery('english', ${q})
      ORDER BY 
        ts_rank(to_tsvector('english', p.title || ' ' || p.body), websearch_to_tsquery('english', ${q})) DESC,
        p."createdAt" DESC,
        p.id DESC
      LIMIT ${limit + 1} OFFSET ${offset}
    `;
  }

  let nextCursor: string | undefined = undefined;
  if (results.length > limit) {
    results.pop();
    nextCursor = encodeSearchCursor(offset + limit);
  }

  const posts: PublicPost[] = results.map((row) => ({
    id: row.id,
    communityId: row.communityId,
    authorId: row.authorId,
    title: row.title,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: {
      id: row.authorId,
      username: row.authorUsername,
    },
  }));

  return { posts, nextCursor };
}

export async function searchUsers(
  query: string,
  limit: number,
  prisma: PrismaClient = db
): Promise<Array<{ username: string; createdAt: Date }>> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  // Escape LIKE metacharacters so user-supplied `%` and `_` match literally.
  const escaped = escapeLikePattern(q);
  const prefixQ = `${escaped}%`;

  const results = await prisma.$queryRaw<
    Array<{ username: string; createdAt: Date }>
  >`
    SELECT 
      username, 
      "createdAt"
    FROM "User"
    WHERE 
      "isSuspended" = false AND 
      username LIKE ${prefixQ} ESCAPE '#'
    ORDER BY username ASC
    LIMIT ${limit}
  `;

  return results;
}
