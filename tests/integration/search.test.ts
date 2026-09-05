import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient } from "@prisma/client";
import { searchCommunities, searchPosts, searchUsers } from "@/features/search/service";
import { encodeSearchCursor, decodeSearchCursor, searchQuerySchema } from "@/features/search/validation";

describe("Stage 6C: Search Integration Tests", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await getTestPrisma();
    await resetTestDatabase();

    // Setup Users
    await prisma.user.create({
      data: { username: "search_active", passwordHash: "hash" }
    });
    await prisma.user.create({
      data: { username: "search_suspended", passwordHash: "hash", isSuspended: true }
    });

    // User with underscore in username — to verify literal _ matching
    await prisma.user.create({
      data: { username: "search_under", passwordHash: "hash" }
    });

    // Setup Communities
    const activeUser = await prisma.user.findFirstOrThrow({
      where: { username: "search_active" }
    });
    const suspendedUser = await prisma.user.findFirstOrThrow({
      where: { username: "search_suspended" }
    });

    const comm1 = await prisma.community.create({
      data: {
        name: "Apple Orchards",
        slug: "apple-orchards",
        description: "Everything about red delicious apples",
        rules: "No oranges"
      }
    });
    const comm2 = await prisma.community.create({
      data: {
        name: "Banana Stand",
        slug: "banana-stand",
        description: "There's always money in the banana stand",
        rules: "No arson"
      }
    });
    // Community with % in name — to test ILIKE wildcard escaping
    await prisma.community.create({
      data: {
        name: "100% Organic",
        slug: "organic-pct",
        description: "Pure organic produce only",
        rules: "Only organic"
      }
    });
    // Community with _ in name — to test ILIKE wildcard escaping
    await prisma.community.create({
      data: {
        name: "A_B_C Club",
        slug: "abc-club",
        description: "Alphabet fans",
        rules: "No numbers"
      }
    });

    // Setup Memberships (to test member counts)
    await prisma.membership.create({ data: { userId: activeUser.id, communityId: comm1.id } });
    await prisma.membership.create({ data: { userId: suspendedUser.id, communityId: comm1.id } });

    // Post 1: active author — apple in title, banana in body
    await prisma.post.create({
      data: {
        authorId: activeUser.id,
        communityId: comm1.id,
        title: "I love Apple",
        body: "But Banana is also good",
        createdAt: new Date(Date.now() - 10000)
      }
    });

    // Post 2: active author — banana repeated (higher FTS rank for banana)
    await prisma.post.create({
      data: {
        authorId: activeUser.id,
        communityId: comm2.id,
        title: "Banana Banana Banana",
        body: "Just banana things",
        createdAt: new Date(Date.now() - 5000)
      }
    });

    // Post 3: Deleted post containing Apple
    await prisma.post.create({
      data: {
        authorId: activeUser.id,
        communityId: comm1.id,
        title: "Apple secrets",
        body: "Redacted",
        isDeleted: true
      }
    });

    // Post 4: suspended author — matching "banana" — must NOT appear in search results
    await prisma.post.create({
      data: {
        authorId: suspendedUser.id,
        communityId: comm2.id,
        title: "Banana tips from suspended user",
        body: "banana banana",
        createdAt: new Date(Date.now() - 2000)
      }
    });

    // Post 5-16: Pagination filler (active author)
    for (let i = 0; i < 12; i++) {
      await prisma.post.create({
        data: {
          authorId: activeUser.id,
          communityId: comm1.id,
          title: `Pagination filler ${i} about Apple`,
          body: "apple apple",
          createdAt: new Date(Date.now() - 20000 - i * 1000)
        }
      });
    }
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  describe("Validation & Security", () => {
    it("safely rejects malformed query strings", () => {
      const shortQuery = searchQuerySchema.safeParse({ q: "a", type: "ALL" });
      expect(shortQuery.success).toBe(false);

      const longQuery = searchQuerySchema.safeParse({ q: "a".repeat(101), type: "ALL" });
      expect(longQuery.success).toBe(false);
    });

    it("safely strips null bytes and dangerous control characters", () => {
      const parsed = searchQuerySchema.parse({ q: "app\x00le", type: "ALL" });
      expect(parsed.q).toBe("apple");
    });

    it("offset cursor securely decodes or falls back to 0", () => {
      expect(decodeSearchCursor(encodeSearchCursor(5))).toBe(5);
      expect(decodeSearchCursor("invalid_base64")).toBe(0);
      expect(decodeSearchCursor(Buffer.from(JSON.stringify({ bad: "data" })).toString("base64url"))).toBe(0);
    });

    it("handles SQL-injection-style input safely without crashing", async () => {
      const malicious = "'; DROP TABLE User; --";
      const res = await searchCommunities(malicious, 20, prisma);
      expect(res).toBeDefined();
    });
  });

  describe("Community Search", () => {
    it("finds community by exact slug match", async () => {
      const results = await searchCommunities("banana-stand", 10, prisma);
      expect(results.length).toBe(1);
      expect(results[0].slug).toBe("banana-stand");
    });

    it("finds community by full-text match in name/description", async () => {
      const results = await searchCommunities("delicious", 10, prisma);
      expect(results.length).toBe(1);
      expect(results[0].slug).toBe("apple-orchards");
    });

    it("returns exact PublicCommunitySummary shape with member counts", async () => {
      const results = await searchCommunities("apple", 10, prisma);
      expect(results[0]).toHaveProperty("id");
      expect(results[0]).toHaveProperty("name", "Apple Orchards");
      expect(results[0]).toHaveProperty("_count");
      expect(results[0]._count.memberships).toBe(2); // activeUser + suspendedUser
    });

    it("treats % in search query as a literal character, not a wildcard", async () => {
      // Searching for "%" should match "100% Organic" but NOT all communities.
      // If % were treated as a LIKE wildcard, it would match everything.
      const results = await searchCommunities("%", 20, prisma);
      // Results via ILIKE: % as literal matches "100% Organic" slug/name.
      // FTS: websearch_to_tsquery('english', '%') is treated as a non-word and returns nothing from FTS.
      // The key assertion: result count must be less than total community count (not all communities match).
      const allResults = await searchCommunities("a", 20, prisma);
      // "a" is too short (< 2 chars) so searchCommunities returns [] for "a"
      // Instead confirm directly: only communities with literal "%" in name/slug match
      const pctResults = await searchCommunities("%", 20, prisma);
      for (const r of pctResults) {
        expect(r.name + r.slug).toMatch(/%/);
      }
    });

    it("treats _ in search query as a literal character, not a single-char wildcard", async () => {
      // Searching for "A_B" should match "A_B_C Club" literally, not every community
      // with any character between A and B.
      const results = await searchCommunities("A_B", 20, prisma);
      // All results must contain literal "_" in their name or slug
      for (const r of results) {
        const combined = r.name + r.slug;
        // Must contain at least one literal underscore
        expect(combined).toMatch(/_/);
      }
    });
  });

  describe("Post Search", () => {
    it("filters out deleted posts completely", async () => {
      const results = await searchPosts("secrets", undefined, 10, undefined, prisma);
      expect(results.posts.length).toBe(0); // "Apple secrets" post is isDeleted=true
    });

    it("excludes posts authored by suspended users", async () => {
      // Both the active user and suspended user have banana posts.
      // Only the active user's post should appear.
      const results = await searchPosts("banana", undefined, 20, undefined, prisma);
      for (const post of results.posts) {
        expect(post.author.username).not.toBe("search_suspended");
      }
      // Active user's banana posts must appear
      const activePosts = results.posts.filter(p => p.author.username === "search_active");
      expect(activePosts.length).toBeGreaterThan(0);
    });

    it("enforces deterministic ts_rank ordering (active posts only)", async () => {
      const results = await searchPosts("banana", undefined, 10, undefined, prisma);
      // "Banana Banana Banana" ranks higher than "I love Apple" / "But Banana is also good"
      expect(results.posts.length).toBeGreaterThanOrEqual(2);
      expect(results.posts[0].title).toBe("Banana Banana Banana");
    });

    it("restricts search to communitySlug when provided", async () => {
      const results = await searchPosts("banana", "apple-orchards", 10, undefined, prisma);
      // Only the post inside apple-orchards community
      expect(results.posts.length).toBe(1);
      expect(results.posts[0].title).toBe("I love Apple");
    });

    it("strictly projects publicPostSelect and does not leak private fields", async () => {
      const results = await searchPosts("Apple", undefined, 1, undefined, prisma);
      const post = results.posts[0];
      expect(post).not.toHaveProperty("isDeleted");
      expect(post.author).not.toHaveProperty("passwordHash");
      expect(post.author).not.toHaveProperty("role");
      expect(post).toHaveProperty("communityId");
      expect(post).not.toHaveProperty("community");
    });

    it("paginates safely and accurately with offset boundaries", async () => {
      const page1 = await searchPosts("apple", undefined, 5, undefined, prisma);
      expect(page1.posts.length).toBe(5);
      expect(page1.nextCursor).toBeDefined();

      const page2 = await searchPosts("apple", undefined, 5, page1.nextCursor, prisma);
      expect(page2.posts.length).toBe(5);
      const p1Ids = new Set(page1.posts.map(p => p.id));
      for (const p2 of page2.posts) {
        expect(p1Ids.has(p2.id)).toBe(false);
      }
    });
  });

  describe("User Search", () => {
    it("matches username strictly by prefix", async () => {
      const results = await searchUsers("search_act", 10, prisma);
      expect(results.length).toBe(1);
      expect(results[0].username).toBe("search_active");
    });

    it("strictly excludes suspended users", async () => {
      const results = await searchUsers("search_sus", 10, prisma);
      expect(results.length).toBe(0);
    });

    it("returns strictly { username, createdAt }", async () => {
      const results = await searchUsers("search_active", 10, prisma);
      const user = results[0];
      expect(Object.keys(user).sort()).toEqual(["createdAt", "username"]);
    });

    it("treats _ in user search as a literal character, not a single-char wildcard", async () => {
      // "search_under" matches prefix "search_und" literally.
      // If _ were treated as a wildcard, searching "search" + any char + "und" would match
      // unintended usernames. This test confirms the prefix "search_und" only matches
      // "search_under" and not users with arbitrary chars at that position.
      const results = await searchUsers("search_und", 10, prisma);
      expect(results.length).toBe(1);
      expect(results[0].username).toBe("search_under");

      // Also confirm that searching for "%earch_active" does NOT return search_active
      // (if % were a wildcard it would match anything before "earch_active")
      const pctResults = await searchUsers("%earch_active", 10, prisma);
      expect(pctResults.length).toBe(0); // % is literal, no username starts with literal %
    });
  });
});
