import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, VoteType, SanctionType } from "@prisma/client";
import { createCommunity, joinCommunity } from "@/features/communities/service";
import { createPost, createComment } from "@/features/content/service";
import {
  castPostVote,
  castCommentVote,
  getPostScore,
  getCommentScore,
  getUserPostVote,
} from "@/features/votes/service";
import { issueSanction } from "@/features/sanctions/service";
import { removePost, removeComment } from "@/features/moderation/service";

describe("Voting Integration Tests (Stage 5)", () => {
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

  it("should handle post voting state transitions: None -> UP -> UP (toggle) -> DOWN -> UP", async () => {
    const owner = await makeUser("owner");
    const voter = await makeUser("voter");

    const community = await createCommunity(
      { name: "VoteComm", slug: "vote-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, voter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Vote Test", body: "Hello" },
      owner.id,
      prisma
    );

    // 1. None -> UP (+1)
    let res = await castPostVote({ postId: post.id, type: VoteType.UP }, voter.id, prisma);
    expect(res.currentVote).toBe(VoteType.UP);
    expect(res.score).toBe(1);
    expect(await getPostScore(post.id, prisma)).toBe(1);
    expect(await getUserPostVote(post.id, voter.id, prisma)).toBe(VoteType.UP);

    // 2. UP -> UP (toggle unvote -> None, score drops by 1)
    res = await castPostVote({ postId: post.id, type: VoteType.UP }, voter.id, prisma);
    expect(res.currentVote).toBeNull();
    expect(res.score).toBe(0);
    expect(await getPostScore(post.id, prisma)).toBe(0);
    expect(await getUserPostVote(post.id, voter.id, prisma)).toBeNull();

    // 3. None -> DOWN (-1)
    res = await castPostVote({ postId: post.id, type: VoteType.DOWN }, voter.id, prisma);
    expect(res.currentVote).toBe(VoteType.DOWN);
    expect(res.score).toBe(-1);
    expect(await getPostScore(post.id, prisma)).toBe(-1);

    // 4. DOWN -> UP (+2 delta, score goes from -1 to +1)
    res = await castPostVote({ postId: post.id, type: VoteType.UP }, voter.id, prisma);
    expect(res.currentVote).toBe(VoteType.UP);
    expect(res.score).toBe(1);

    // 5. UP -> DOWN (-2 delta, score goes from +1 to -1)
    res = await castPostVote({ postId: post.id, type: VoteType.DOWN }, voter.id, prisma);
    expect(res.currentVote).toBe(VoteType.DOWN);
    expect(res.score).toBe(-1);

    // 6. DOWN -> DOWN (toggle unvote -> None, score goes from -1 to 0)
    res = await castPostVote({ postId: post.id, type: VoteType.DOWN }, voter.id, prisma);
    expect(res.currentVote).toBeNull();
    expect(res.score).toBe(0);
  });

  it("should handle comment voting state transitions and score calculations", async () => {
    const owner = await makeUser("owner");
    const voter = await makeUser("voter");

    const community = await createCommunity(
      { name: "CommentVoteComm", slug: "cvote-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, voter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );
    const comment = await createComment(
      { postId: post.id, body: "First comment" },
      owner.id,
      prisma
    );

    // Vote UP
    let res = await castCommentVote({ commentId: comment.id, type: VoteType.UP }, voter.id, prisma);
    expect(res.currentVote).toBe(VoteType.UP);
    expect(res.score).toBe(1);
    expect(await getCommentScore(comment.id, prisma)).toBe(1);

    // Toggle unvote
    res = await castCommentVote({ commentId: comment.id, type: VoteType.UP }, voter.id, prisma);
    expect(res.currentVote).toBeNull();
    expect(res.score).toBe(0);

    // Vote DOWN
    res = await castCommentVote({ commentId: comment.id, type: VoteType.DOWN }, voter.id, prisma);
    expect(res.currentVote).toBe(VoteType.DOWN);
    expect(res.score).toBe(-1);
  });

  it("should enforce the duplicate vote invariant via database unique constraints", async () => {
    const owner = await makeUser("owner");
    const voter = await makeUser("voter");

    const community = await createCommunity(
      { name: "UniqueVote", slug: "unique-vote", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, voter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Unique", body: "Unique" },
      owner.id,
      prisma
    );

    await castPostVote({ postId: post.id, type: VoteType.UP }, voter.id, prisma);

    // Verify exactly one record exists in PostVote table for this user & post
    const count = await prisma.postVote.count({
      where: { userId: voter.id, postId: post.id },
    });
    expect(count).toBe(1);
  });

  it("should reject voting by non-members", async () => {
    const owner = await makeUser("owner");
    const nonMember = await makeUser("nonmember");

    const community = await createCommunity(
      { name: "NoMemberVote", slug: "no-member-vote", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    await expect(
      castPostVote({ postId: post.id, type: VoteType.UP }, nonMember.id, prisma)
    ).rejects.toThrow("You must be a member of this community to vote");
  });

  it("should reject voting by muted users", async () => {
    const owner = await makeUser("owner");
    const mutedMember = await makeUser("mutedmember");

    const community = await createCommunity(
      { name: "MuteVote", slug: "mute-vote", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, mutedMember.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    // Issue MUTE sanction
    await issueSanction(
      {
        communityId: community.id,
        targetUserId: mutedMember.id,
        sanctionType: SanctionType.MUTE,
        reason: "Violated civility rules",
      },
      owner.id,
      prisma
    );

    await expect(
      castPostVote({ postId: post.id, type: VoteType.UP }, mutedMember.id, prisma)
    ).rejects.toThrow("User is muted in this community");
  });

  it("should reject voting by banned users", async () => {
    const owner = await makeUser("owner");
    const bannedMember = await makeUser("bannedmember");

    const community = await createCommunity(
      { name: "BanVote", slug: "ban-vote", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, bannedMember.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    // Issue BAN sanction
    await issueSanction(
      {
        communityId: community.id,
        targetUserId: bannedMember.id,
        sanctionType: SanctionType.BAN,
        reason: "Spam bot",
      },
      owner.id,
      prisma
    );

    await expect(
      castPostVote({ postId: post.id, type: VoteType.UP }, bannedMember.id, prisma)
    ).rejects.toThrow("User is banned from this community");
  });

  it("should reject voting on soft-deleted content", async () => {
    const owner = await makeUser("owner");
    const voter = await makeUser("voter");

    const community = await createCommunity(
      { name: "DelVote", slug: "del-vote", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, voter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "To Delete", body: "Body" },
      owner.id,
      prisma
    );

    // Remove post
    await removePost(
      { postId: post.id, reason: "Spam removal" },
      owner.id,
      prisma
    );

    await expect(
      castPostVote({ postId: post.id, type: VoteType.UP }, voter.id, prisma)
    ).rejects.toThrow("Post not found");
  });

  it("should reject comment voting on soft-deleted comments", async () => {
    const owner = await makeUser("owner");
    const voter = await makeUser("voter");

    const community = await createCommunity(
      { name: "DelCommentVote", slug: "del-comment-vote", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, voter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );
    const comment = await createComment(
      { postId: post.id, body: "To remove" },
      owner.id,
      prisma
    );

    // Remove the comment directly
    await removeComment(
      { commentId: comment.id, reason: "Spam removal" },
      owner.id,
      prisma
    );

    await expect(
      castCommentVote({ commentId: comment.id, type: VoteType.UP }, voter.id, prisma)
    ).rejects.toThrow("Comment not found");
  });

  it("should handle concurrent voting from multiple users without lost updates", async () => {
    const owner = await makeUser("owner");
    const community = await createCommunity(
      { name: "ConcurVote", slug: "concur-vote", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );

    const post = await createPost(
      { communityId: community.id, title: "Popular", body: "Vote me" },
      owner.id,
      prisma
    );

    const voters = await Promise.all([
      makeUser("voter1"),
      makeUser("voter2"),
      makeUser("voter3"),
      makeUser("voter4"),
    ]);

    for (const v of voters) {
      await joinCommunity(community.id, v.id, prisma);
    }

    // 3 upvotes, 1 downvote in parallel
    await Promise.all([
      castPostVote({ postId: post.id, type: VoteType.UP }, voters[0].id, prisma),
      castPostVote({ postId: post.id, type: VoteType.UP }, voters[1].id, prisma),
      castPostVote({ postId: post.id, type: VoteType.UP }, voters[2].id, prisma),
      castPostVote({ postId: post.id, type: VoteType.DOWN }, voters[3].id, prisma),
    ]);

    const finalScore = await getPostScore(post.id, prisma);
    expect(finalScore).toBe(2); // 3 - 1 = 2
  });
});
