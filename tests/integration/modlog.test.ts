import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, SanctionType, ModActionType } from "@prisma/client";
import { createCommunity, joinCommunity } from "@/features/communities/service";
import { createPost } from "@/features/content/service";
import { submitReport } from "@/features/reports/service";
import { removePost, getCommunityModLog, dismissReport } from "@/features/moderation/service";
import { issueSanction } from "@/features/sanctions/service";

describe("Community Moderation Transparency Log (Stage 5)", () => {
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

  it("should return public projection containing only allowed fields and strictly mask private data", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("secretreporter");
    const offender = await makeUser("offender");

    const community = await createCommunity(
      { name: "TranspComm", slug: "transp-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);
    await joinCommunity(community.id, offender.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Bad Spam Post", body: "Spam content" },
      offender.id,
      prisma
    );

    const report = await submitReport(
      { postId: post.id, reason: "SUPER_SECRET_REPORTER_REASON" },
      reporter.id,
      prisma
    );

    // Remove post with public reason and private internal note
    await removePost(
      {
        postId: post.id,
        reason: "PUBLIC_REMOVAL_REASON: Rule 1 Violation",
        internalNote: "HIGHLY_CONFIDENTIAL_MOD_NOTE",
        reportId: report.id,
      },
      owner.id,
      prisma
    );

    // Issue sanction with public reason and private internal note
    await issueSanction(
      {
        communityId: community.id,
        targetUserId: offender.id,
        sanctionType: SanctionType.MUTE,
        durationHours: 24,
        reason: "PUBLIC_SANCTION_REASON: 24h Mute for spam",
        internalNote: "INTERNAL_NOTE_USER_PROFILED",
      },
      owner.id,
      prisma
    );

    const log = await getCommunityModLog("transp-comm", 50, prisma);
    expect(log).toHaveLength(2);

    // 1. Sanction log check
    const sanctionEntry = log.find((e) => e.actionType === ModActionType.ISSUE_SANCTION);
    expect(sanctionEntry).toBeDefined();
    expect(sanctionEntry?.moderatorUsername).toBe("owner");
    expect(sanctionEntry?.reason).toBe("PUBLIC_SANCTION_REASON: 24h Mute for spam");
    expect(sanctionEntry?.targetDescription).toBe("Sanctioned a member (MUTE, temporary)");

    // Assert strictly private fields are NOT present in the returned projection
    expect((sanctionEntry as any).internalNote).toBeUndefined();
    expect((sanctionEntry as any).targetUserId).toBeUndefined();
    expect((sanctionEntry as any).reporterId).toBeUndefined();
    expect(JSON.stringify(sanctionEntry)).not.toContain("INTERNAL_NOTE_USER_PROFILED");
    expect(JSON.stringify(sanctionEntry)).not.toContain("offender"); // target pseudonym is masked!

    // 2. Removal log check
    const removalEntry = log.find((e) => e.actionType === ModActionType.REMOVE_POST);
    expect(removalEntry).toBeDefined();
    expect(removalEntry?.moderatorUsername).toBe("owner");
    expect(removalEntry?.reason).toBe("PUBLIC_REMOVAL_REASON: Rule 1 Violation");
    expect(removalEntry?.postTitle).toBe("Bad Spam Post");

    // Assert reporter privacy: reporter username and secret report reason NEVER leak!
    expect((removalEntry as any).internalNote).toBeUndefined();
    expect((removalEntry as any).reporterId).toBeUndefined();
    expect((removalEntry as any).reportReason).toBeUndefined();
    expect(JSON.stringify(removalEntry)).not.toContain("HIGHLY_CONFIDENTIAL_MOD_NOTE");
    expect(JSON.stringify(removalEntry)).not.toContain("SUPER_SECRET_REPORTER_REASON");
    expect(JSON.stringify(removalEntry)).not.toContain("secretreporter");
    expect(JSON.stringify(removalEntry)).not.toContain("offender");
  });

  it("should enforce community scoping for moderation logs", async () => {
    const owner1 = await makeUser("owner1");
    const owner2 = await makeUser("owner2");

    const commA = await createCommunity(
      { name: "CommunityA", slug: "comm-a", description: "Desc", rules: "Rules" },
      owner1.id,
      prisma
    );

    const commB = await createCommunity(
      { name: "CommunityB", slug: "comm-b", description: "Desc", rules: "Rules" },
      owner2.id,
      prisma
    );

    const postA = await createPost(
      { communityId: commA.id, title: "Post in A", body: "Body" },
      owner1.id,
      prisma
    );

    await removePost(
      { postId: postA.id, reason: "Removed in A" },
      owner1.id,
      prisma
    );

    // Mod log for Comm A contains the action
    const logA = await getCommunityModLog("comm-a", 50, prisma);
    expect(logA).toHaveLength(1);
    expect(logA[0].reason).toBe("Removed in A");

    // Mod log for Comm B is completely empty
    const logB = await getCommunityModLog("comm-b", 50, prisma);
    expect(logB).toHaveLength(0);
  });
});
