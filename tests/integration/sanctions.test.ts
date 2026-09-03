import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, SanctionType, CommunityRole } from "@prisma/client";
import {
  createCommunity,
  joinCommunity,
  leaveCommunity,
  changeMemberRole,
} from "@/features/communities/service";
import { createPost, createComment } from "@/features/content/service";
import { castPostVote } from "@/features/votes/service";
import { issueSanction, revokeSanction } from "@/features/sanctions/service";

describe("Sanctions Integration Tests (Stage 5)", () => {
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

  it("should enforce role hierarchy: Moderator can sanction Member, but CANNOT sanction Moderator or Owner", async () => {
    const owner = await makeUser("owner");
    const mod1 = await makeUser("mod1");
    const mod2 = await makeUser("mod2");
    const member = await makeUser("member");

    const community = await createCommunity(
      { name: "HierComm", slug: "hier-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );

    await joinCommunity(community.id, mod1.id, prisma);
    await joinCommunity(community.id, mod2.id, prisma);
    await joinCommunity(community.id, member.id, prisma);

    await changeMemberRole(community.id, mod1.id, CommunityRole.MODERATOR, owner.id, prisma);
    await changeMemberRole(community.id, mod2.id, CommunityRole.MODERATOR, owner.id, prisma);

    // 1. Moderator can sanction ordinary Member
    const s1 = await issueSanction(
      {
        communityId: community.id,
        targetUserId: member.id,
        sanctionType: SanctionType.MUTE,
        reason: "Disruptive behavior",
      },
      mod1.id,
      prisma
    );
    expect(s1.id).toBeDefined();

    // 2. Moderator CANNOT sanction another Moderator (peer protection)
    await expect(
      issueSanction(
        {
          communityId: community.id,
          targetUserId: mod2.id,
          sanctionType: SanctionType.MUTE,
          reason: "Peer sanction attempt",
        },
        mod1.id,
        prisma
      )
    ).rejects.toThrow("Moderators cannot sanction other moderators; owner authority required");

    // 3. Moderator CANNOT sanction the Owner
    await expect(
      issueSanction(
        {
          communityId: community.id,
          targetUserId: owner.id,
          sanctionType: SanctionType.MUTE,
          reason: "Owner sanction attempt",
        },
        mod1.id,
        prisma
      )
    ).rejects.toThrow("Community owners cannot be sanctioned");

    // 4. Owner CAN sanction a Moderator
    const s2 = await issueSanction(
      {
        communityId: community.id,
        targetUserId: mod1.id,
        sanctionType: SanctionType.MUTE,
        reason: "Owner sanctioning moderator",
      },
      owner.id,
      prisma
    );
    expect(s2.id).toBeDefined();

    // 5. Owner cannot be sanctioned by anyone
    await expect(
      issueSanction(
        {
          communityId: community.id,
          targetUserId: owner.id,
          sanctionType: SanctionType.BAN,
          reason: "Self ban",
        },
        owner.id,
        prisma
      )
    ).rejects.toThrow("You cannot sanction yourself");
  });

  it("should reject self-sanctioning and self-revocation", async () => {
    const owner = await makeUser("owner");
    const mod = await makeUser("mod");

    const community = await createCommunity(
      { name: "SelfComm", slug: "self-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, mod.id, prisma);
    await changeMemberRole(community.id, mod.id, CommunityRole.MODERATOR, owner.id, prisma);

    // Self-sanction rejected
    await expect(
      issueSanction(
        {
          communityId: community.id,
          targetUserId: mod.id,
          sanctionType: SanctionType.MUTE,
          reason: "Self sanction",
        },
        mod.id,
        prisma
      )
    ).rejects.toThrow("You cannot sanction yourself");

    // Owner sanctions mod
    const sanction = await issueSanction(
      {
        communityId: community.id,
        targetUserId: mod.id,
        sanctionType: SanctionType.MUTE,
        reason: "Mod muted",
      },
      owner.id,
      prisma
    );

    // Mod cannot revoke own sanction
    await expect(
      revokeSanction(
        { sanctionId: sanction.id, reason: "Revoking my own" },
        mod.id,
        prisma
      )
    ).rejects.toThrow("You cannot revoke your own sanction");
  });

  it("should prevent moderator from revoking an Owner-issued sanction", async () => {
    const owner = await makeUser("owner");
    const mod = await makeUser("mod");
    const member = await makeUser("member");

    const community = await createCommunity(
      { name: "RevokeComm", slug: "revoke-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, mod.id, prisma);
    await joinCommunity(community.id, member.id, prisma);
    await changeMemberRole(community.id, mod.id, CommunityRole.MODERATOR, owner.id, prisma);

    // Owner issues sanction to member
    const sanction = await issueSanction(
      {
        communityId: community.id,
        targetUserId: member.id,
        sanctionType: SanctionType.BAN,
        reason: "Banned by owner",
      },
      owner.id,
      prisma
    );

    // Moderator attempts to revoke owner's sanction -> rejected
    await expect(
      revokeSanction(
        { sanctionId: sanction.id, reason: "Mod trying to undo owner ban" },
        mod.id,
        prisma
      )
    ).rejects.toThrow("Moderators cannot revoke sanctions issued by the community owner");

    // Owner can revoke
    const revoked = await revokeSanction(
      { sanctionId: sanction.id, reason: "Owner lifting ban" },
      owner.id,
      prisma
    );
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("should prevent banned user from rejoining or bypassing ban by leaving and joining", async () => {
    const owner = await makeUser("owner");
    const member = await makeUser("badactor");

    const community = await createCommunity(
      { name: "BypassComm", slug: "bypass-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, member.id, prisma);

    // Ban member
    await issueSanction(
      {
        communityId: community.id,
        targetUserId: member.id,
        sanctionType: SanctionType.BAN,
        reason: "Permanent ban for harassment",
      },
      owner.id,
      prisma
    );

    // Banned member attempts to leave
    await leaveCommunity(community.id, member.id, prisma);

    // Attempt to rejoin must be blocked by joinCommunity
    await expect(
      joinCommunity(community.id, member.id, prisma)
    ).rejects.toThrow("User is banned from this community");
  });

  it("should dynamically allow actions once a sanction has expired", async () => {
    const owner = await makeUser("owner");
    const member = await makeUser("tempmember");

    const community = await createCommunity(
      { name: "ExpireComm", slug: "expire-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, member.id, prisma);

    // Manually create an already-expired MUTE sanction
    const past = new Date(Date.now() - 1000 * 60); // 1 minute ago
    await prisma.communitySanction.create({
      data: {
        communityId: community.id,
        userId: member.id,
        sanctionType: SanctionType.MUTE,
        reason: "10 minute mute",
        issuedById: owner.id,
        expiresAt: past,
      },
    });

    // Posting should SUCCEED because the sanction is expired
    const post = await createPost(
      { communityId: community.id, title: "After Expiry", body: "I am back" },
      member.id,
      prisma
    );
    expect(post.id).toBeDefined();
  });

  it("should immediately strip moderation and sanction rights when a moderator is demoted", async () => {
    const owner = await makeUser("owner");
    const mod = await makeUser("demotedmod");
    const member = await makeUser("member");

    const community = await createCommunity(
      { name: "DemoteComm", slug: "demote-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, mod.id, prisma);
    await joinCommunity(community.id, member.id, prisma);
    await changeMemberRole(community.id, mod.id, CommunityRole.MODERATOR, owner.id, prisma);

    // Demote moderator to member
    await changeMemberRole(community.id, mod.id, CommunityRole.MEMBER, owner.id, prisma);

    // Demoted user cannot issue sanctions
    await expect(
      issueSanction(
        {
          communityId: community.id,
          targetUserId: member.id,
          sanctionType: SanctionType.MUTE,
          reason: "Demoted trying to sanction",
        },
        mod.id,
        prisma
      )
    ).rejects.toThrow("You do not have permission to issue sanctions in this community");
  });
});
