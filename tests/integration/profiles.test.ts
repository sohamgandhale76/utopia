import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, SanctionType, VoteType, ReportStatus } from "@prisma/client";
import {
  getPublicProfile,
  getUserPublicPosts,
  getUserPublicComments,
} from "../../src/features/profiles/service";
import {
  encodeCursor,
  decodeCursor,
  profilePaginationLimitSchema,
  profileTabSchema,
} from "../../src/features/profiles/validation";

describe("Stage 6B: Pseudonymous Public Profiles", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await getTestPrisma();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  // Helper to create a user with full relations
  async function makeUser(username: string, isSuspended = false) {
    return await prisma.user.create({
      data: {
        username,
        passwordHash: "$2b$12$e8k8y4M1W.d7O5WpE9iU7.1K3Xq6L4M5N6O7P8Q9R0S1T2U3V4W5X",
        isSuspended,
      },
    });
  }

  // Helper to create a community
  async function makeCommunity(name = "Technology", slug = "technology") {
    return await prisma.community.create({
      data: {
        name,
        slug,
        description: "A community about tech",
        rules: "Be nice",
      },
    });
  }

  // ===========================================================================
  // 1. Identity & Suspended User Invariants
  // ===========================================================================
  describe("Identity & Suspended User Invariants", () => {
    it("1. Active user's profile returns username and createdAt", async () => {
      const user = await makeUser("alice");
      const profile = await getPublicProfile("alice", prisma);

      expect(profile).not.toBeNull();
      expect(profile?.username).toBe("alice");
      expect(profile?.createdAt).toBeInstanceOf(Date);
    });

    it("2. Nonexistent username returns null / not-found behavior", async () => {
      const profile = await getPublicProfile("nonexistent_user", prisma);
      expect(profile).toBeNull();
    });

    it("3. Suspended username returns null / not-found behavior", async () => {
      await makeUser("suspended_alice", true);
      const profile = await getPublicProfile("suspended_alice", prisma);
      expect(profile).toBeNull();
    });

    it("4. Suspended and nonexistent users are indistinguishable through the public profile API", async () => {
      await makeUser("suspended_bob", true);

      // getPublicProfile
      const nonexistentProfile = await getPublicProfile("ghost_user", prisma);
      const suspendedProfile = await getPublicProfile("suspended_bob", prisma);
      expect(nonexistentProfile).toBeNull();
      expect(suspendedProfile).toBeNull();
      expect(nonexistentProfile).toEqual(suspendedProfile);

      // getUserPublicPosts
      const nonexistentPosts = await getUserPublicPosts("ghost_user", 20, undefined, prisma);
      const suspendedPosts = await getUserPublicPosts("suspended_bob", 20, undefined, prisma);
      expect(nonexistentPosts).toBeNull();
      expect(suspendedPosts).toBeNull();
      expect(nonexistentPosts).toEqual(suspendedPosts);

      // getUserPublicComments
      const nonexistentComments = await getUserPublicComments("ghost_user", 20, undefined, prisma);
      const suspendedComments = await getUserPublicComments("suspended_bob", 20, undefined, prisma);
      expect(nonexistentComments).toBeNull();
      expect(suspendedComments).toBeNull();
      expect(nonexistentComments).toEqual(suspendedComments);
    });
  });

  // ===========================================================================
  // 2. Public Posts & Visibility
  // ===========================================================================
  describe("Public Posts & Visibility", () => {
    it("5. Active user's public posts are returned with community context", async () => {
      const user = await makeUser("charlie");
      const community = await makeCommunity();

      await prisma.post.create({
        data: {
          title: "Public Post 1",
          body: "Content of post 1",
          authorId: user.id,
          communityId: community.id,
          isDeleted: false,
        },
      });

      const result = await getUserPublicPosts("charlie", 20, undefined, prisma);
      expect(result).not.toBeNull();
      expect(result?.posts).toHaveLength(1);
      expect(result?.posts[0].title).toBe("Public Post 1");
      expect(result?.posts[0].body).toBe("Content of post 1");
      expect(result?.posts[0].community.name).toBe("Technology");
      expect(result?.posts[0].community.slug).toBe("technology");
    });

    it("6. Deleted posts are strictly excluded from post history", async () => {
      const user = await makeUser("david");
      const community = await makeCommunity();

      // Create 1 active post and 1 deleted post
      await prisma.post.create({
        data: {
          title: "Visible Post",
          body: "I am visible",
          authorId: user.id,
          communityId: community.id,
          isDeleted: false,
        },
      });

      await prisma.post.create({
        data: {
          title: "Deleted Post",
          body: "I am deleted",
          authorId: user.id,
          communityId: community.id,
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      const result = await getUserPublicPosts("david", 20, undefined, prisma);
      expect(result).not.toBeNull();
      expect(result?.posts).toHaveLength(1);
      expect(result?.posts[0].title).toBe("Visible Post");
    });

    it("7, 8, 9. Keyset pagination works with no duplicates and no skipped rows across pages", async () => {
      const user = await makeUser("emma");
      const community = await makeCommunity();

      // Create 25 posts with incremental timestamps
      const baseTime = Date.now();
      for (let i = 0; i < 25; i++) {
        await prisma.post.create({
          data: {
            title: `Post ${i.toString().padStart(2, "0")}`,
            body: `Body ${i}`,
            authorId: user.id,
            communityId: community.id,
            createdAt: new Date(baseTime + i * 1000),
          },
        });
      }

      // Page 1: default limit 20
      const page1 = await getUserPublicPosts("emma", 20, undefined, prisma);
      expect(page1).not.toBeNull();
      expect(page1?.posts).toHaveLength(20);
      expect(page1?.nextCursor).toBeDefined();

      // Page 2: with cursor
      const page2 = await getUserPublicPosts("emma", 20, page1?.nextCursor, prisma);
      expect(page2).not.toBeNull();
      expect(page2?.posts).toHaveLength(5);
      expect(page2?.nextCursor).toBeUndefined();

      // Verify ordering (DESC): Post 24 down to Post 05 on page 1, Post 04 to Post 00 on page 2
      expect(page1?.posts[0].title).toBe("Post 24");
      expect(page1?.posts[19].title).toBe("Post 05");
      expect(page2?.posts[0].title).toBe("Post 04");
      expect(page2?.posts[4].title).toBe("Post 00");

      // Verify no duplicates and no skipped rows
      const allIds = [
        ...(page1?.posts.map((p) => p.id) ?? []),
        ...(page2?.posts.map((p) => p.id) ?? []),
      ];
      expect(allIds).toHaveLength(25);
      expect(new Set(allIds).size).toBe(25);
    });

    it("10. Identical createdAt timestamps are correctly ordered using id tie-breaker without skips", async () => {
      const user = await makeUser("frank");
      const community = await makeCommunity();

      const sameDate = new Date("2026-09-01T12:00:00.000Z");
      for (let i = 0; i < 5; i++) {
        await prisma.post.create({
          data: {
            title: `SameDate Post ${i}`,
            body: `Body ${i}`,
            authorId: user.id,
            communityId: community.id,
            createdAt: sameDate,
          },
        });
      }

      // Paginate with page size 2
      const page1 = await getUserPublicPosts("frank", 2, undefined, prisma);
      expect(page1?.posts).toHaveLength(2);
      expect(page1?.nextCursor).toBeDefined();

      const page2 = await getUserPublicPosts("frank", 2, page1?.nextCursor, prisma);
      expect(page2?.posts).toHaveLength(2);
      expect(page2?.nextCursor).toBeDefined();

      const page3 = await getUserPublicPosts("frank", 2, page2?.nextCursor, prisma);
      expect(page3?.posts).toHaveLength(1);
      expect(page3?.nextCursor).toBeUndefined();

      const allIds = [
        ...(page1?.posts.map((p) => p.id) ?? []),
        ...(page2?.posts.map((p) => p.id) ?? []),
        ...(page3?.posts.map((p) => p.id) ?? []),
      ];
      expect(allIds).toHaveLength(5);
      expect(new Set(allIds).size).toBe(5);
    });

    it("Exact-limit pagination boundary: exactly 20 posts returns nextCursor undefined", async () => {
      const user = await makeUser("exact_limit_user");
      const community = await makeCommunity();

      const baseTime = Date.now();
      for (let i = 0; i < 20; i++) {
        await prisma.post.create({
          data: {
            title: `Exact Post ${i.toString().padStart(2, "0")}`,
            body: `Body ${i}`,
            authorId: user.id,
            communityId: community.id,
            createdAt: new Date(baseTime + i * 1000),
          },
        });
      }

      const result = await getUserPublicPosts("exact_limit_user", 20, undefined, prisma);
      expect(result).not.toBeNull();
      expect(result?.posts).toHaveLength(20);
      expect(result?.nextCursor).toBeUndefined();
    });

    it("Cross-user cursor behavior: cursor from User A does not leak User A posts into User B profile", async () => {
      const userA = await makeUser("user_alpha");
      const userB = await makeUser("user_beta");
      const community = await makeCommunity();

      const baseTime = Date.now();
      // User A posts
      const postA1 = await prisma.post.create({
        data: {
          title: "User A Post 1",
          body: "Post 1 from User A",
          authorId: userA.id,
          communityId: community.id,
          createdAt: new Date(baseTime + 3000),
        },
      });
      const postA2 = await prisma.post.create({
        data: {
          title: "User A Post 2",
          body: "Post 2 from User A",
          authorId: userA.id,
          communityId: community.id,
          createdAt: new Date(baseTime + 2000),
        },
      });
      const postA3 = await prisma.post.create({
        data: {
          title: "User A Post 3",
          body: "Post 3 from User A",
          authorId: userA.id,
          communityId: community.id,
          createdAt: new Date(baseTime + 1000),
        },
      });

      // User B posts
      const postB1 = await prisma.post.create({
        data: {
          title: "User B Post 1",
          body: "Post 1 from User B",
          authorId: userB.id,
          communityId: community.id,
          createdAt: new Date(baseTime + 2500),
        },
      });
      const postB2 = await prisma.post.create({
        data: {
          title: "User B Post 2",
          body: "Post 2 from User B",
          authorId: userB.id,
          communityId: community.id,
          createdAt: new Date(baseTime + 1500),
        },
      });

      // Obtain a valid nextCursor from User A's paginated query (limit=1)
      const pageUserA = await getUserPublicPosts("user_alpha", 1, undefined, prisma);
      expect(pageUserA).not.toBeNull();
      expect(pageUserA?.posts).toHaveLength(1);
      expect(pageUserA?.posts[0].id).toBe(postA1.id);
      expect(pageUserA?.nextCursor).toBeDefined();

      const cursorA = pageUserA?.nextCursor;

      // Pass User A's cursor into User B's query
      const pageUserB = await getUserPublicPosts("user_beta", 20, cursorA, prisma);
      expect(pageUserB).not.toBeNull();

      // Verify returned posts belong only to User B
      const userAPostIds = new Set([postA1.id, postA2.id, postA3.id]);
      const userBPostIds = new Set([postB1.id, postB2.id]);

      expect((pageUserB?.posts ?? []).length).toBeGreaterThan(0);
      for (const post of pageUserB?.posts ?? []) {
        expect(userAPostIds.has(post.id)).toBe(false);
        expect(userBPostIds.has(post.id)).toBe(true);
      }

      // Verify no User A post titles appear
      const titles = (pageUserB?.posts ?? []).map((p) => p.title);
      expect(titles.some((t) => t.includes("User A"))).toBe(false);
    });

    it("Cross-user post isolation: getUserPublicPosts strictly returns only posts authored by requested user", async () => {
      const userA = await makeUser("author_alice");
      const userB = await makeUser("author_bob");
      const community = await makeCommunity();

      // Create posts for User A
      const postA1 = await prisma.post.create({
        data: {
          title: "Alice Post 1",
          body: "Content by Alice 1",
          authorId: userA.id,
          communityId: community.id,
        },
      });
      const postA2 = await prisma.post.create({
        data: {
          title: "Alice Post 2",
          body: "Content by Alice 2",
          authorId: userA.id,
          communityId: community.id,
        },
      });

      // Create posts for User B in the same community
      const postB1 = await prisma.post.create({
        data: {
          title: "Bob Post 1",
          body: "Content by Bob 1",
          authorId: userB.id,
          communityId: community.id,
        },
      });
      const postB2 = await prisma.post.create({
        data: {
          title: "Bob Post 2",
          body: "Content by Bob 2",
          authorId: userB.id,
          communityId: community.id,
        },
      });

      // Query User B's public posts
      const result = await getUserPublicPosts("author_bob", 20, undefined, prisma);
      expect(result).not.toBeNull();

      const returnedPosts = result?.posts ?? [];
      expect(returnedPosts).toHaveLength(2);

      const returnedIds = returnedPosts.map((p) => p.id);
      expect(returnedIds).toContain(postB1.id);
      expect(returnedIds).toContain(postB2.id);

      // Verify none of User A's posts appear
      expect(returnedIds).not.toContain(postA1.id);
      expect(returnedIds).not.toContain(postA2.id);

      // Verify every returned post belongs exclusively to User B
      const userBIds = new Set([postB1.id, postB2.id]);
      for (const p of returnedPosts) {
        expect(userBIds.has(p.id)).toBe(true);
        expect(p.title.startsWith("Bob")).toBe(true);
      }
    });
  });

  // ===========================================================================
  // 3. Public Comments & Parent Post Invariant
  // ===========================================================================
  describe("Public Comments & Visibility", () => {
    it("11. Public comments are returned with post context", async () => {
      const user = await makeUser("grace");
      const community = await makeCommunity();

      const post = await prisma.post.create({
        data: {
          title: "Discussion Topic",
          body: "Let's talk",
          authorId: user.id,
          communityId: community.id,
        },
      });

      await prisma.comment.create({
        data: {
          body: "My great comment",
          postId: post.id,
          authorId: user.id,
        },
      });

      const result = await getUserPublicComments("grace", 20, undefined, prisma);
      expect(result).not.toBeNull();
      expect(result?.comments).toHaveLength(1);
      expect(result?.comments[0].body).toBe("My great comment");
      expect(result?.comments[0].post.title).toBe("Discussion Topic");
      expect(result?.comments[0].post.community.name).toBe("Technology");
      expect(result?.comments[0].post.community.slug).toBe("technology");
    });

    it("12. Deleted comments are excluded from comment history", async () => {
      const user = await makeUser("heidi");
      const community = await makeCommunity();

      const post = await prisma.post.create({
        data: {
          title: "Discussion Topic",
          body: "Let's talk",
          authorId: user.id,
          communityId: community.id,
        },
      });

      await prisma.comment.create({
        data: {
          body: "Deleted comment",
          postId: post.id,
          authorId: user.id,
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      const result = await getUserPublicComments("heidi", 20, undefined, prisma);
      expect(result).not.toBeNull();
      expect(result?.comments).toHaveLength(0);
    });

    it("13. Comments belonging to deleted posts are excluded even when the comment itself is not deleted", async () => {
      const user = await makeUser("ivan");
      const community = await makeCommunity();

      // Create a deleted post
      const deletedPost = await prisma.post.create({
        data: {
          title: "Deleted Post Title",
          body: "I am deleted post",
          authorId: user.id,
          communityId: community.id,
          isDeleted: true,
          deletedAt: new Date(),
        },
      });

      // Create a non-deleted comment on the deleted post
      await prisma.comment.create({
        data: {
          body: "I am an active comment on a deleted post",
          postId: deletedPost.id,
          authorId: user.id,
          isDeleted: false,
        },
      });

      const result = await getUserPublicComments("ivan", 20, undefined, prisma);
      expect(result).not.toBeNull();
      expect(result?.comments).toHaveLength(0); // MUST be excluded
    });

    it("14. Identical createdAt timestamps for comments paginate correctly without skips", async () => {
      const user = await makeUser("judy");
      const community = await makeCommunity();

      const post = await prisma.post.create({
        data: {
          title: "Active Post",
          body: "Content",
          authorId: user.id,
          communityId: community.id,
        },
      });

      const sameDate = new Date("2026-09-02T10:00:00.000Z");
      for (let i = 0; i < 5; i++) {
        await prisma.comment.create({
          data: {
            body: `Comment ${i}`,
            postId: post.id,
            authorId: user.id,
            createdAt: sameDate,
          },
        });
      }

      const page1 = await getUserPublicComments("judy", 2, undefined, prisma);
      expect(page1?.comments).toHaveLength(2);
      expect(page1?.nextCursor).toBeDefined();

      const page2 = await getUserPublicComments("judy", 2, page1?.nextCursor, prisma);
      expect(page2?.comments).toHaveLength(2);
      expect(page2?.nextCursor).toBeDefined();

      const page3 = await getUserPublicComments("judy", 2, page2?.nextCursor, prisma);
      expect(page3?.comments).toHaveLength(1);
      expect(page3?.nextCursor).toBeUndefined();

      const allIds = [
        ...(page1?.comments.map((c) => c.id) ?? []),
        ...(page2?.comments.map((c) => c.id) ?? []),
        ...(page3?.comments.map((c) => c.id) ?? []),
      ];
      expect(allIds).toHaveLength(5);
      expect(new Set(allIds).size).toBe(5);
    });

    it("Cross-user comment isolation: getUserPublicComments strictly returns only comments authored by requested user", async () => {
      const userA = await makeUser("commenter_alice");
      const userB = await makeUser("commenter_bob");
      const community = await makeCommunity();

      // Create an active, eligible post
      const post = await prisma.post.create({
        data: {
          title: "Shared Discussion Post",
          body: "General topic for discussion",
          authorId: userA.id,
          communityId: community.id,
        },
      });

      // Create comments authored by User A
      const commentA1 = await prisma.comment.create({
        data: {
          body: "Alice comment 1",
          postId: post.id,
          authorId: userA.id,
        },
      });
      const commentA2 = await prisma.comment.create({
        data: {
          body: "Alice comment 2",
          postId: post.id,
          authorId: userA.id,
        },
      });

      // Create comments authored by User B
      const commentB1 = await prisma.comment.create({
        data: {
          body: "Bob comment 1",
          postId: post.id,
          authorId: userB.id,
        },
      });
      const commentB2 = await prisma.comment.create({
        data: {
          body: "Bob comment 2",
          postId: post.id,
          authorId: userB.id,
        },
      });

      // Query User B's public comments
      const result = await getUserPublicComments("commenter_bob", 20, undefined, prisma);
      expect(result).not.toBeNull();

      const returnedComments = result?.comments ?? [];
      expect(returnedComments).toHaveLength(2);

      const returnedIds = returnedComments.map((c) => c.id);
      expect(returnedIds).toContain(commentB1.id);
      expect(returnedIds).toContain(commentB2.id);

      // Verify none of User A's comments appear
      expect(returnedIds).not.toContain(commentA1.id);
      expect(returnedIds).not.toContain(commentA2.id);

      // Verify returned comment IDs correspond exclusively to User B
      const userBCommentIds = new Set([commentB1.id, commentB2.id]);
      for (const c of returnedComments) {
        expect(userBCommentIds.has(c.id)).toBe(true);
        expect(c.body.startsWith("Bob")).toBe(true);
      }
    });
  });

  // ===========================================================================
  // 4. Privacy Invariants (NON-NEGOTIABLE)
  // ===========================================================================
  describe("Privacy Boundaries & Non-Exposure", () => {
    it("15-23. Public profile results do not expose any sensitive or private user fields", async () => {
      const user = await makeUser("mallory");
      const moderator = await makeUser("moderator_user");
      const community = await makeCommunity();

      // Seed session
      await prisma.session.create({
        data: {
          userId: user.id,
          sessionTokenHash: "dummytokenhash123",
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Seed membership
      await prisma.membership.create({
        data: {
          userId: user.id,
          communityId: community.id,
        },
      });

      // Seed post
      const post = await prisma.post.create({
        data: {
          title: "Mallory Post",
          body: "Post body",
          authorId: user.id,
          communityId: community.id,
        },
      });

      // Seed vote
      await prisma.postVote.create({
        data: {
          postId: post.id,
          userId: user.id,
          type: VoteType.UP,
        },
      });

      // Seed report
      await prisma.report.create({
        data: {
          reporterId: user.id,
          postId: post.id,
          reason: "Confidential report reason",
          status: ReportStatus.PENDING,
        },
      });

      // Seed sanction
      await prisma.communitySanction.create({
        data: {
          communityId: community.id,
          userId: user.id,
          sanctionType: SanctionType.MUTE,
          reason: "Confidential sanction note",
          issuedById: moderator.id,
        },
      });

      // 1. Check getPublicProfile
      const profile = await getPublicProfile("mallory", prisma);
      expect(profile).not.toBeNull();
      const profileRecord = profile as unknown as Record<string, unknown>;

      // Strictly allowed: only username and createdAt
      expect(Object.keys(profileRecord).sort()).toEqual(["createdAt", "username"].sort());

      // NEVER expose:
      expect(profileRecord).not.toHaveProperty("id");
      expect(profileRecord).not.toHaveProperty("passwordHash");
      expect(profileRecord).not.toHaveProperty("role");
      expect(profileRecord).not.toHaveProperty("sessions");
      expect(profileRecord).not.toHaveProperty("reports");
      expect(profileRecord).not.toHaveProperty("reportsFiled");
      expect(profileRecord).not.toHaveProperty("sanctions");
      expect(profileRecord).not.toHaveProperty("sanctionsReceived");
      expect(profileRecord).not.toHaveProperty("sanctionsIssued");
      expect(profileRecord).not.toHaveProperty("votes");
      expect(profileRecord).not.toHaveProperty("postVotes");
      expect(profileRecord).not.toHaveProperty("commentVotes");
      expect(profileRecord).not.toHaveProperty("memberships");
      expect(profileRecord).not.toHaveProperty("joinedCommunities");

      // 2. Check getUserPublicPosts
      const postsResult = await getUserPublicPosts("mallory", 20, undefined, prisma);
      expect(postsResult?.posts).toHaveLength(1);
      const postItem = postsResult?.posts[0] as unknown as Record<string, unknown>;

      expect(postItem).not.toHaveProperty("authorId");
      expect(postItem).not.toHaveProperty("author");
      expect(postItem).not.toHaveProperty("reports");
      expect(postItem).not.toHaveProperty("votes");
      expect(postItem).not.toHaveProperty("modActions");

      // 3. Check getUserPublicComments
      const comment = await prisma.comment.create({
        data: {
          body: "Mallory comment",
          postId: post.id,
          authorId: user.id,
        },
      });

      const commentsResult = await getUserPublicComments("mallory", 20, undefined, prisma);
      expect(commentsResult?.comments).toHaveLength(1);
      const commentItem = commentsResult?.comments[0] as unknown as Record<string, unknown>;

      expect(commentItem).not.toHaveProperty("authorId");
      expect(commentItem).not.toHaveProperty("author");
      expect(commentItem).not.toHaveProperty("reports");
      expect(commentItem).not.toHaveProperty("votes");
      expect(commentItem).not.toHaveProperty("modActions");
    });
  });

  // ===========================================================================
  // 5. Validation & Edge Cases
  // ===========================================================================
  describe("Validation & Edge Cases", () => {
    it("24. Limits cannot exceed 50 and are clamped", () => {
      expect(profilePaginationLimitSchema.parse(100)).toBe(20); // caught to default 20
      expect(profilePaginationLimitSchema.parse(50)).toBe(50);
      expect(profilePaginationLimitSchema.parse(51)).toBe(20); // caught to default 20
    });

    it("25. Default limit is 20", () => {
      expect(profilePaginationLimitSchema.parse(undefined)).toBe(20);
      expect(profilePaginationLimitSchema.parse(null)).toBe(20);
    });

    it("26. Malformed cursors do not crash the service and fail safely", async () => {
      const user = await makeUser("oscar");

      expect(decodeCursor("not-a-valid-base64-string!@#$")).toBeNull();
      expect(decodeCursor("")).toBeNull();
      expect(decodeCursor(null as unknown as string)).toBeNull();

      // Invalid JSON in base64url
      const invalidJson = Buffer.from("{ bad json", "utf-8").toString("base64url");
      expect(decodeCursor(invalidJson)).toBeNull();

      // Missing fields
      const missingFields = Buffer.from(JSON.stringify({ id: "123" }), "utf-8").toString("base64url");
      expect(decodeCursor(missingFields)).toBeNull();

      // Passing malformed cursor to service returns first page rather than throwing
      const posts = await getUserPublicPosts("oscar", 20, "corrupt_cursor_string", prisma);
      expect(posts).not.toBeNull();
      expect(posts?.posts).toEqual([]);
    });

    it("27. Invalid cursor dates are rejected safely", () => {
      const invalidDateCursor = Buffer.from(
        JSON.stringify({ id: "post_123", createdAt: "not-a-real-date" }),
        "utf-8"
      ).toString("base64url");
      expect(decodeCursor(invalidDateCursor)).toBeNull();
    });

    it("28. Invalid tab values safely fall back to posts", () => {
      expect(profileTabSchema.parse("posts")).toBe("posts");
      expect(profileTabSchema.parse("comments")).toBe("comments");
      expect(profileTabSchema.parse("arbitrary_tab")).toBe("posts");
      expect(profileTabSchema.parse(undefined)).toBe("posts");
    });

    it("Username validation: invalid usernames safely return null from all profile services", async () => {
      const invalidUsernames = [
        "",
        "Alice",
        "ab",
        "invalid user",
        "user@domain",
        "user#tag!",
      ];

      for (const username of invalidUsernames) {
        const profile = await getPublicProfile(username, prisma);
        expect(profile).toBeNull();

        const posts = await getUserPublicPosts(username, 20, undefined, prisma);
        expect(posts).toBeNull();

        const comments = await getUserPublicComments(username, 20, undefined, prisma);
        expect(comments).toBeNull();
      }
    });

    it("Extra-field cursor handling: cursor with unexpected extra fields is safely handled and paginates correctly", async () => {
      const user = await makeUser("extra_field_user");
      const community = await makeCommunity();

      const baseTime = Date.now();
      const post1 = await prisma.post.create({
        data: {
          title: "First Post",
          body: "Body 1",
          authorId: user.id,
          communityId: community.id,
          createdAt: new Date(baseTime + 2000),
        },
      });

      const post2 = await prisma.post.create({
        data: {
          title: "Second Post",
          body: "Body 2",
          authorId: user.id,
          communityId: community.id,
          createdAt: new Date(baseTime + 1000),
        },
      });

      // Construct a cursor with valid id and createdAt plus unexpected extra properties
      const cursorPayloadWithExtra = {
        id: post1.id,
        createdAt: post1.createdAt.toISOString(),
        extra: "unexpected_property",
        maliciousRole: "ADMIN",
      };

      const encodedCursorWithExtra = Buffer.from(
        JSON.stringify(cursorPayloadWithExtra),
        "utf-8"
      ).toString("base64url");

      // Verify decodeCursor parses it safely according to Zod default schema behavior (strips extra fields)
      const decoded = decodeCursor(encodedCursorWithExtra);
      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe(post1.id);
      expect(decoded?.createdAt).toEqual(post1.createdAt);
      expect(decoded).not.toHaveProperty("extra");
      expect(decoded).not.toHaveProperty("maliciousRole");

      // Pass the extra-field cursor into getUserPublicPosts
      const result = await getUserPublicPosts("extra_field_user", 20, encodedCursorWithExtra, prisma);
      expect(result).not.toBeNull();
      // Since cursor was post1, result should return post2 (which was created before post1)
      expect(result?.posts).toHaveLength(1);
      expect(result?.posts[0].id).toBe(post2.id);
      expect(result?.posts[0].title).toBe("Second Post");
      expect(result?.nextCursor).toBeUndefined();
    });
  });
});
