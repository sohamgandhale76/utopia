import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, SanctionType, ReportStatus, CommunityRole, Prisma } from "@prisma/client";
import { createCommunity, joinCommunity } from "@/features/communities/service";
import { createPost, createComment } from "@/features/content/service";
import { submitReport, listCommunityReports } from "@/features/reports/service";
import { issueSanction } from "@/features/sanctions/service";
import { removePost } from "@/features/moderation/service";

describe("Reporting Integration Tests (Stage 5)", () => {
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

  it("should allow a member to submit a report for a post", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");

    const community = await createCommunity(
      { name: "ReportComm", slug: "report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Report Me", body: "Offensive text" },
      owner.id,
      prisma
    );

    const report = await submitReport(
      { postId: post.id, reason: "Inappropriate language" },
      reporter.id,
      prisma
    );

    expect(report.id).toBeDefined();
    expect(report.status).toBe(ReportStatus.PENDING);

    // Verify moderator can view report in mod queue
    const queue = await listCommunityReports(community.id, owner.id, ReportStatus.PENDING, prisma);
    expect(queue).toHaveLength(1);
    expect(queue[0].reason).toBe("Inappropriate language");
    expect(queue[0].postId).toBe(post.id);
  });

  it("should allow a member to submit a report for a comment", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");

    const community = await createCommunity(
      { name: "ReportCommentComm", slug: "report-comment-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );
    const comment = await createComment(
      { postId: post.id, body: "Spam comment" },
      owner.id,
      prisma
    );

    const report = await submitReport(
      { commentId: comment.id, reason: "Spam link" },
      reporter.id,
      prisma
    );

    expect(report.id).toBeDefined();
    expect(report.status).toBe(ReportStatus.PENDING);
  });

  it("should enforce the single-target check constraint (reject dual-target or zero-target)", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");

    const community = await createCommunity(
      { name: "CheckComm", slug: "check-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    // Dual-target rejected by Zod validation
    await expect(
      submitReport(
        { postId: post.id, commentId: "dummy-comment", reason: "Dual target" },
        reporter.id,
        prisma
      )
    ).rejects.toThrow();

    // Zero-target rejected by Zod validation
    await expect(
      submitReport(
        { reason: "No target" },
        reporter.id,
        prisma
      )
    ).rejects.toThrow();

    // Verify DB CHECK constraint directly by raw query
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Report" ("id", "reporterId", "postId", "commentId", "reason", "status", "createdAt", "updatedAt")
         VALUES ('r1', '${reporter.id}', '${post.id}', 'dummy-comment', 'Both targets', 'PENDING', NOW(), NOW());`
      )
    ).rejects.toThrow();
  });

  it("should reject duplicate pending reports for the same content by the same reporter", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");

    const community = await createCommunity(
      { name: "DedupComm", slug: "dedup-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    await submitReport({ postId: post.id, reason: "First report" }, reporter.id, prisma);

    // Second pending report must be rejected
    await expect(
      submitReport({ postId: post.id, reason: "Duplicate report" }, reporter.id, prisma)
    ).rejects.toThrow("You have already submitted a pending report for this content");
  });

  it("should allow a muted user to submit reports", async () => {
    const owner = await makeUser("owner");
    const mutedMember = await makeUser("mutedmember");

    const community = await createCommunity(
      { name: "MuteReportComm", slug: "mute-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, mutedMember.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    await issueSanction(
      {
        communityId: community.id,
        targetUserId: mutedMember.id,
        sanctionType: SanctionType.MUTE,
        reason: "Muted for arguing",
      },
      owner.id,
      prisma
    );

    // Muted user CAN submit reports per locked decision
    const report = await submitReport(
      { postId: post.id, reason: "Reporting rule violation" },
      mutedMember.id,
      prisma
    );

    expect(report.id).toBeDefined();
  });

  it("should reject report submission by banned users", async () => {
    const owner = await makeUser("owner");
    const bannedMember = await makeUser("bannedmember");

    const community = await createCommunity(
      { name: "BanReportComm", slug: "ban-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, bannedMember.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    await issueSanction(
      {
        communityId: community.id,
        targetUserId: bannedMember.id,
        sanctionType: SanctionType.BAN,
        reason: "Banned for spamming",
      },
      owner.id,
      prisma
    );

    await expect(
      submitReport({ postId: post.id, reason: "Banned user reporting" }, bannedMember.id, prisma)
    ).rejects.toThrow("User is banned from this community");
  });

  it("should reject reporting soft-deleted content", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");

    const community = await createCommunity(
      { name: "DeletedReportComm", slug: "deleted-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    await removePost({ postId: post.id, reason: "Mod deleted" }, owner.id, prisma);

    await expect(
      submitReport({ postId: post.id, reason: "Report deleted post" }, reporter.id, prisma)
    ).rejects.toThrow("Post not found or already deleted");
  });

  it("should reject non-moderators from accessing the community mod report queue", async () => {
    const owner = await makeUser("owner");
    const member = await makeUser("member");

    const community = await createCommunity(
      { name: "ModQueueComm", slug: "mod-queue-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, member.id, prisma);

    await expect(
      listCommunityReports(community.id, member.id, ReportStatus.PENDING, prisma)
    ).rejects.toThrow("User does not have the required role: MODERATOR");
  });

  it("should reject duplicate pending comment reports from the same reporter", async () => {
    const owner = await makeUser("comm_owner");
    const reporter = await makeUser("comm_reporter");

    const community = await createCommunity(
      { name: "CommentDedupComm", slug: "comment-dedup-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );
    const comment = await createComment(
      { postId: post.id, body: "Abusive comment" },
      owner.id,
      prisma
    );

    await submitReport({ commentId: comment.id, reason: "First comment report" }, reporter.id, prisma);

    // Second pending comment report by same reporter must be rejected
    await expect(
      submitReport({ commentId: comment.id, reason: "Duplicate comment report" }, reporter.id, prisma)
    ).rejects.toThrow("You have already submitted a pending report for this content");
  });

  it("should allow the same reporter to submit a new report after the earlier report is non-PENDING", async () => {
    const owner = await makeUser("resolve_owner");
    const reporter = await makeUser("resolve_reporter");

    const community = await createCommunity(
      { name: "ResolveReportComm", slug: "resolve-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    const firstReport = await submitReport(
      { postId: post.id, reason: "First report" },
      reporter.id,
      prisma
    );

    // Moderator resolves the report to ACTIONED
    await prisma.report.update({
      where: { id: firstReport.id },
      data: { status: ReportStatus.ACTIONED },
    });

    // Since the earlier report is no longer PENDING, the same reporter CAN submit a new report
    const secondReport = await submitReport(
      { postId: post.id, reason: "Subsequent report after resolution" },
      reporter.id,
      prisma
    );

    expect(secondReport.id).toBeDefined();
    expect(secondReport.id).not.toBe(firstReport.id);
    expect(secondReport.status).toBe(ReportStatus.PENDING);
  });

  it("should allow different reporters to independently report the same content", async () => {
    const owner = await makeUser("multi_owner");
    const reporter1 = await makeUser("reporter_one");
    const reporter2 = await makeUser("reporter_two");

    const community = await createCommunity(
      { name: "MultiReportComm", slug: "multi-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter1.id, prisma);
    await joinCommunity(community.id, reporter2.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    const report1 = await submitReport(
      { postId: post.id, reason: "Reporter 1 flag" },
      reporter1.id,
      prisma
    );
    const report2 = await submitReport(
      { postId: post.id, reason: "Reporter 2 flag" },
      reporter2.id,
      prisma
    );

    expect(report1.id).toBeDefined();
    expect(report2.id).toBeDefined();
    expect(report1.id).not.toBe(report2.id);

    // Both reports exist as PENDING
    const count = await prisma.report.count({
      where: { postId: post.id, status: ReportStatus.PENDING },
    });
    expect(count).toBe(2);
  });

  it("should enforce the database-level partial unique index via direct database insert (defense-in-depth)", async () => {
    const owner = await makeUser("db_owner");
    const reporter = await makeUser("db_reporter");

    const community = await createCommunity(
      { name: "DbUniqueComm", slug: "db-unique-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    // Direct database insert bypassing submitReport service logic
    await prisma.report.create({
      data: {
        reporterId: reporter.id,
        postId: post.id,
        reason: "Direct raw insert 1",
        status: ReportStatus.PENDING,
      },
    });

    // Second direct database insert must be rejected by PostgreSQL unique constraint (P2002)
    await expect(
      prisma.report.create({
        data: {
          reporterId: reporter.id,
          postId: post.id,
          reason: "Direct raw insert 2 (duplicate)",
          status: ReportStatus.PENDING,
        },
      })
    ).rejects.toThrow();

    // Verify error code is P2002
    try {
      await prisma.report.create({
        data: {
          reporterId: reporter.id,
          postId: post.id,
          reason: "Direct raw insert 3",
          status: ReportStatus.PENDING,
        },
      });
      expect.unreachable("Should have thrown P2002");
    } catch (error) {
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    }
  });
});
