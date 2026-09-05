import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, SanctionType } from "@prisma/client";
import { registerUser } from "@/features/auth/service";
import { createCommunity, joinCommunity, leaveCommunity } from "@/features/communities/service";
import { createPost, createComment, getCommunityFeed, getPostDetails } from "@/features/content/service";
import { issueSanction } from "@/features/sanctions/service";

describe("Content Foundation (Stage 4)", () => {
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

  async function makeUser(username: string) {
    return await prisma.user.create({
      data: { username, passwordHash: "dummyhash" },
    });
  }

  it("should allow a member to create a post and a comment", async () => {
    const creator = await makeUser("creator");
    const member = await makeUser("member");

    const community = await createCommunity({
      name: "Test Community",
      slug: "test-community",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    await joinCommunity(community.id, member.id, prisma);

    // Create Post
    const post = await createPost({
      communityId: community.id,
      title: "My first post",
      body: "Hello world!",
    }, member.id, prisma);

    expect(post.id).toBeDefined();

    // Create Comment
    const comment = await createComment({
      postId: post.id,
      body: "Nice post!",
    }, creator.id, prisma); // creator is owner, so they are a member

    expect(comment.id).toBeDefined();

    // Fetch details
    const details = await getPostDetails(post.id, prisma);
    expect(details).toBeDefined();
    expect(details?.title).toBe("My first post");
    expect(details?.comments).toHaveLength(1);
    expect(details?.comments[0].body).toBe("Nice post!");
  });

  it("should reject post creation by non-members", async () => {
    const creator = await makeUser("creator");
    const nonMember = await makeUser("nonmember");

    const community = await createCommunity({
      name: "Privateish",
      slug: "privateish",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    await expect(
      createPost({ communityId: community.id, title: "Test", body: "Test" }, nonMember.id, prisma)
    ).rejects.toThrow("You must be a member of this community to post");
  });

  it("should reject comment creation by non-members", async () => {
    const creator = await makeUser("creator");
    const nonMember = await makeUser("nonmember");

    const community = await createCommunity({
      name: "Test",
      slug: "test",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    const post = await createPost({ communityId: community.id, title: "Test", body: "Test" }, creator.id, prisma);

    await expect(
      createComment({ postId: post.id, body: "Test" }, nonMember.id, prisma)
    ).rejects.toThrow("You must be a member of this community to comment");
  });

  it("should reject post and comment creation by muted and banned users", async () => {
    const owner = await makeUser("owner");
    const mutedMember = await makeUser("mutedmember");
    const bannedMember = await makeUser("bannedmember");

    const community = await createCommunity({
      name: "Sanctioned Content",
      slug: "sanctioned-content",
      description: "A test community",
      rules: "No rules",
    }, owner.id, prisma);

    await joinCommunity(community.id, mutedMember.id, prisma);
    await joinCommunity(community.id, bannedMember.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    // MUTE blocks POST and COMMENT
    await issueSanction(
      {
        communityId: community.id,
        targetUserId: mutedMember.id,
        sanctionType: SanctionType.MUTE,
        reason: "Muted for spamming",
      },
      owner.id,
      prisma
    );

    await expect(
      createPost({ communityId: community.id, title: "Muted post", body: "Body" }, mutedMember.id, prisma)
    ).rejects.toThrow("User is muted in this community");

    await expect(
      createComment({ postId: post.id, body: "Muted comment" }, mutedMember.id, prisma)
    ).rejects.toThrow("User is muted in this community");

    // BAN blocks POST and COMMENT
    await issueSanction(
      {
        communityId: community.id,
        targetUserId: bannedMember.id,
        sanctionType: SanctionType.BAN,
        reason: "Banned for abuse",
      },
      owner.id,
      prisma
    );

    await expect(
      createPost({ communityId: community.id, title: "Banned post", body: "Body" }, bannedMember.id, prisma)
    ).rejects.toThrow("User is banned from this community");

    await expect(
      createComment({ postId: post.id, body: "Banned comment" }, bannedMember.id, prisma)
    ).rejects.toThrow("User is banned from this community");
  });

  it("should reject comments exceeding max depth of 5", async () => {
    const creator = await makeUser("creator");
    const community = await createCommunity({
      name: "Deep",
      slug: "deep",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    const post = await createPost({ communityId: community.id, title: "Test", body: "Test" }, creator.id, prisma);

    // Depth 1
    const c1 = await createComment({ postId: post.id, body: "D1" }, creator.id, prisma);
    // Depth 2
    const c2 = await createComment({ postId: post.id, parentId: c1.id, body: "D2" }, creator.id, prisma);
    // Depth 3
    const c3 = await createComment({ postId: post.id, parentId: c2.id, body: "D3" }, creator.id, prisma);
    // Depth 4
    const c4 = await createComment({ postId: post.id, parentId: c3.id, body: "D4" }, creator.id, prisma);
    // Depth 5
    const c5 = await createComment({ postId: post.id, parentId: c4.id, body: "D5" }, creator.id, prisma);
    
    // Depth 6 (Should fail)
    await expect(
      createComment({ postId: post.id, parentId: c5.id, body: "D6" }, creator.id, prisma)
    ).rejects.toThrow("Maximum reply depth exceeded");
  });

  it("should filter out deleted content and not leak sensitive data in feeds", async () => {
    const creator = await makeUser("creator");
    const community = await createCommunity({
      name: "Public Feed",
      slug: "public-feed",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    const p1 = await createPost({ communityId: community.id, title: "Post 1", body: "Body 1" }, creator.id, prisma);
    const p2 = await createPost({ communityId: community.id, title: "Post 2", body: "Body 2" }, creator.id, prisma);

    // Soft delete p2
    await prisma.post.update({ where: { id: p2.id }, data: { isDeleted: true } });

    const feed = await getCommunityFeed("public-feed", 50, undefined, prisma);
    expect(feed?.posts).toHaveLength(1);
    expect(feed?.posts[0].id).toBe(p1.id);

    // Verify safe types
    const authorInfo = feed?.posts[0].author as any;
    expect(authorInfo.id).toBeDefined();
    expect(authorInfo.username).toBeDefined();
    expect(authorInfo.role).toBeUndefined(); // Role must not leak
    expect(authorInfo.passwordHash).toBeUndefined();
    expect(authorInfo.sessions).toBeUndefined();
  });

  it("should order the feed chronologically newest first with pagination", async () => {
    const creator = await makeUser("creator");
    const community = await createCommunity({
      name: "Chronological",
      slug: "chronological",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    // Create 3 posts
    const p1 = await createPost({ communityId: community.id, title: "P1", body: "1" }, creator.id, prisma);
    // small delay to ensure different timestamps if possible, though CUID and explicit index order handles it
    await new Promise(r => setTimeout(r, 10));
    const p2 = await createPost({ communityId: community.id, title: "P2", body: "2" }, creator.id, prisma);
    await new Promise(r => setTimeout(r, 10));
    const p3 = await createPost({ communityId: community.id, title: "P3", body: "3" }, creator.id, prisma);

    // Get 1st page of size 2
    const page1 = await getCommunityFeed("chronological", 2, undefined, prisma);
    expect(page1?.posts).toHaveLength(2);
    expect(page1?.posts[0].id).toBe(p3.id);
    expect(page1?.posts[1].id).toBe(p2.id);
    expect(page1?.nextCursor).toBeDefined();

    // Get 2nd page using cursor
    const page2 = await getCommunityFeed("chronological", 2, page1!.nextCursor, prisma);
    expect(page2?.posts).toHaveLength(1);
    expect(page2?.posts[0].id).toBe(p1.id);
    expect(page2?.nextCursor).toBeUndefined();
  });

  it("should paginate same-createdAt posts deterministically without duplicates or gaps", async () => {
    const creator = await makeUser("creator2");
    const community = await createCommunity({
      name: "Same Time",
      slug: "same-time",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    // Force 3 posts to have the exact same createdAt timestamp by creating them concurrently
    // or by forcing a timestamp update. Since we can't easily force timestamp in createPost,
    // we'll create them then update their createdAt directly in Prisma.
    const p1 = await createPost({ communityId: community.id, title: "P1", body: "1" }, creator.id, prisma);
    const p2 = await createPost({ communityId: community.id, title: "P2", body: "2" }, creator.id, prisma);
    const p3 = await createPost({ communityId: community.id, title: "P3", body: "3" }, creator.id, prisma);

    const sameTime = new Date();
    await prisma.post.updateMany({
      where: { id: { in: [p1.id, p2.id, p3.id] } },
      data: { createdAt: sameTime }
    });

    const page1 = await getCommunityFeed("same-time", 2, undefined, prisma);
    expect(page1?.posts).toHaveLength(2);
    expect(page1?.nextCursor).toBeDefined();

    const page2 = await getCommunityFeed("same-time", 2, page1!.nextCursor, prisma);
    expect(page2?.posts).toHaveLength(1);
    
    // Combine all seen posts
    const seenIds = [...page1!.posts.map(p => p.id), ...page2!.posts.map(p => p.id)];
    expect(seenIds.length).toBe(3);
    expect(new Set(seenIds).size).toBe(3); // No duplicates
    expect(seenIds).toContain(p1.id);
    expect(seenIds).toContain(p2.id);
    expect(seenIds).toContain(p3.id);
  });

  it("should reject comment creation on a deleted post with no write", async () => {
    const creator = await makeUser("creator3");
    const community = await createCommunity({
      name: "Deleted Post",
      slug: "deleted-post",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    const post = await createPost({ communityId: community.id, title: "P1", body: "1" }, creator.id, prisma);
    await prisma.post.update({ where: { id: post.id }, data: { isDeleted: true } });

    await expect(
      createComment({ postId: post.id, body: "Comment" }, creator.id, prisma)
    ).rejects.toThrow("Post not found");
  });

  it("should safely handle concurrent post creation and leaving community", async () => {
    const creator = await makeUser("creator4");
    const member = await makeUser("member4");
    const community = await createCommunity({
      name: "Concurrency Test",
      slug: "concurrency-test",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    await joinCommunity(community.id, member.id, prisma);

    // Race creating a post vs leaving the community
    const race = await Promise.allSettled([
      createPost({ communityId: community.id, title: "Race Post", body: "123" }, member.id, prisma),
      leaveCommunity(community.id, member.id, prisma)
    ]);

    // Either post creation succeeds before leave, or leave succeeds before post creation.
    // If post failed, it must be because of membership validation.
    const postResult = race[0];
    if (postResult.status === "rejected") {
      expect(postResult.reason.message).toContain("You must be a member of this community to post");
    } else {
      // If it succeeded, it means post was created before leave took effect
      expect(postResult.value.id).toBeDefined();
    }

    // Leave should always succeed in this scenario
    expect(race[1].status).toBe("fulfilled");
  });

  it("should handle malformed cursors and unknown communities gracefully", async () => {
    const creator = await makeUser("cursor-owner");
    const community = await createCommunity({
      name: "Cursor Comm",
      slug: "cursor-comm",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Only Post", body: "Body" },
      creator.id,
      prisma
    );

    // Garbage cursor must fall back to the first page, not throw
    const garbageFeed = await getCommunityFeed("cursor-comm", 50, "!!!not-base64url!!!", prisma);
    expect(garbageFeed?.posts).toHaveLength(1);
    expect(garbageFeed?.posts[0].id).toBe(post.id);

    // A cursor that decodes but fails the schema (missing createdAt) also falls back
    const invalidShape = Buffer.from(JSON.stringify({ id: post.id }), "utf-8").toString("base64url");
    const invalidFeed = await getCommunityFeed("cursor-comm", 50, invalidShape, prisma);
    expect(invalidFeed?.posts).toHaveLength(1);
    expect(invalidFeed?.posts[0].id).toBe(post.id);

    // Unknown community returns null instead of throwing
    expect(await getCommunityFeed("no-such-community", 50, undefined, prisma)).toBeNull();
  });

  it("should exclude soft-deleted comments from post details and return null for deleted posts", async () => {
    const creator = await makeUser("details-owner");
    const community = await createCommunity({
      name: "Details Comm",
      slug: "details-comm",
      description: "A test community",
      rules: "No rules",
    }, creator.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Details", body: "Body" },
      creator.id,
      prisma
    );

    const keep = await createComment({ postId: post.id, body: "Keep me" }, creator.id, prisma);
    const remove = await createComment({ postId: post.id, body: "Remove me" }, creator.id, prisma);

    // Soft-delete one comment; details must exclude it
    await prisma.comment.update({ where: { id: remove.id }, data: { isDeleted: true } });

    const details = await getPostDetails(post.id, prisma);
    expect(details?.comments).toHaveLength(1);
    expect(details?.comments[0].id).toBe(keep.id);

    // Soft-deleted post is not visible via details
    await prisma.post.update({ where: { id: post.id }, data: { isDeleted: true } });
    expect(await getPostDetails(post.id, prisma)).toBeNull();
  });

  it("should validate feed limits and fall back to default of 50 for invalid or out-of-range values", async () => {
    const creator = await makeUser("creator-limit");
    const community = await createCommunity(
      {
        name: "Limit Test",
        slug: "limit-test",
        description: "A test community",
        rules: "No rules",
      },
      creator.id,
      prisma
    );

    // Create 52 posts using prisma.post.createMany for batch setup
    const now = new Date();
    const postData = Array.from({ length: 52 }, (_, i) => ({
      communityId: community.id,
      authorId: creator.id,
      title: `Batch Post ${i + 1}`,
      body: `Content for post ${i + 1}`,
      createdAt: new Date(now.getTime() + i * 1000),
    }));
    await prisma.post.createMany({ data: postData });

    // 1. Valid limit (2) returns exactly 2 posts with nextCursor
    const feed2 = await getCommunityFeed(community.slug, 2, undefined, prisma);
    expect(feed2?.posts).toHaveLength(2);
    expect(feed2?.nextCursor).toBeDefined();

    // 2. Out-of-range: zero (0) falls back to default 50 (returns 50 posts with nextCursor)
    const feedZero = await getCommunityFeed(community.slug, 0, undefined, prisma);
    expect(feedZero?.posts).toHaveLength(50);
    expect(feedZero?.nextCursor).toBeDefined();

    // 3. Out-of-range: negative (-1) falls back to default 50
    const feedNeg = await getCommunityFeed(community.slug, -1, undefined, prisma);
    expect(feedNeg?.posts).toHaveLength(50);
    expect(feedNeg?.nextCursor).toBeDefined();

    // 4. Out-of-range: >100 (101) falls back to default 50
    const feedOver = await getCommunityFeed(community.slug, 101, undefined, prisma);
    expect(feedOver?.posts).toHaveLength(50);
    expect(feedOver?.nextCursor).toBeDefined();

    // 5. Invalid: decimal / non-integer (1.5) falls back to default 50
    const feedDecimal = await getCommunityFeed(community.slug, 1.5, undefined, prisma);
    expect(feedDecimal?.posts).toHaveLength(50);
    expect(feedDecimal?.nextCursor).toBeDefined();

    // 6. Invalid: non-finite (Infinity, NaN) fall back to default 50
    const feedInf = await getCommunityFeed(community.slug, Infinity, undefined, prisma);
    expect(feedInf?.posts).toHaveLength(50);
    expect(feedInf?.nextCursor).toBeDefined();

    const feedNaN = await getCommunityFeed(community.slug, NaN, undefined, prisma);
    expect(feedNaN?.posts).toHaveLength(50);
    expect(feedNaN?.nextCursor).toBeDefined();

    // 7. Missing / undefined falls back to default 50
    const feedDefault = await getCommunityFeed(community.slug, undefined, undefined, prisma);
    expect(feedDefault?.posts).toHaveLength(50);
    expect(feedDefault?.nextCursor).toBeDefined();
  });
});

