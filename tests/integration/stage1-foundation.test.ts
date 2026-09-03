import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, ModActionType, SanctionType } from "@prisma/client";

describe("Stage 1 Foundation & Database Verification", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await getTestPrisma();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  describe("Database Isolation Verification", () => {
    it("strictly connects to 'instapro_test' and never the development database", async () => {
      const result = await prisma.$queryRawUnsafe<Array<{ current_database: string }>>(
        "SELECT current_database();"
      );
      expect(result[0]?.current_database).toBe("instapro_test");
      expect(result[0]?.current_database).not.toBe("instapro");
    });
  });

  it("should have all expected tables created and accessible", async () => {
    const userCount = await prisma.user.count();
    const communityCount = await prisma.community.count();
    const postCount = await prisma.post.count();
    const commentCount = await prisma.comment.count();
    const reportCount = await prisma.report.count();
    const postVoteCount = await prisma.postVote.count();
    const commentVoteCount = await prisma.commentVote.count();
    const modActionCount = await prisma.moderationAction.count();

    expect(userCount).toBe(0);
    expect(communityCount).toBe(0);
    expect(postCount).toBe(0);
    expect(commentCount).toBe(0);
    expect(reportCount).toBe(0);
    expect(postVoteCount).toBe(0);
    expect(commentVoteCount).toBe(0);
    expect(modActionCount).toBe(0);
  });

  describe("Custom PostgreSQL CHECK Constraint: check_report_target_exactly_one", () => {
    let reporterId: string;
    let authorId: string;
    let communityId: string;
    let postId: string;
    let commentId: string;

    beforeEach(async () => {
      // Create test reporter and author
      const reporter = await prisma.user.create({
        data: {
          username: "reporter_user",
          passwordHash: "hash123456789012",
        },
      });
      reporterId = reporter.id;

      const author = await prisma.user.create({
        data: {
          username: "author_user",
          passwordHash: "hash123456789012",
        },
      });
      authorId = author.id;

      // Create test community
      const community = await prisma.community.create({
        data: {
          name: "Test Community",
          slug: "test-community",
          description: "A community for integration tests",
          rules: "Rule 1: Be civil",
        },
      });
      communityId = community.id;

      // Create test post
      const post = await prisma.post.create({
        data: {
          communityId,
          authorId,
          title: "Test Post Title",
          body: "Test post body content plain text",
        },
      });
      postId = post.id;

      // Create test comment
      const comment = await prisma.comment.create({
        data: {
          postId,
          authorId,
          body: "Test comment content plain text",
        },
      });
      commentId = comment.id;
    });

    it("allows creating a Report targeting a Post only", async () => {
      const report = await prisma.report.create({
        data: {
          reporterId,
          postId,
          commentId: null,
          reason: "Spam content",
        },
      });

      expect(report.id).toBeDefined();
      expect(report.postId).toBe(postId);
      expect(report.commentId).toBeNull();
      expect(report.reason).toBe("Spam content");
    });

    it("allows creating a Report targeting a Comment only", async () => {
      const report = await prisma.report.create({
        data: {
          reporterId,
          postId: null,
          commentId,
          reason: "Harassment",
        },
      });

      expect(report.id).toBeDefined();
      expect(report.postId).toBeNull();
      expect(report.commentId).toBe(commentId);
      expect(report.reason).toBe("Harassment");
    });

    it("rejects creating a Report targeting BOTH a Post and a Comment (PostgreSQL CHECK constraint)", async () => {
      await expect(
        prisma.report.create({
          data: {
            reporterId,
            postId,
            commentId,
            reason: "Invalid dual target",
          },
        })
      ).rejects.toThrow(/check_report_target_exactly_one/);
    });

    it("rejects creating a Report targeting NEITHER a Post nor a Comment (PostgreSQL CHECK constraint)", async () => {
      await expect(
        prisma.report.create({
          data: {
            reporterId,
            postId: null,
            commentId: null,
            reason: "Invalid zero target",
          },
        })
      ).rejects.toThrow(/check_report_target_exactly_one/);
    });
  });

  describe("Moderation Audit Non-Unique reportId Verification", () => {
    it("allows associating one valid Report with two separate ModerationAction records (REMOVE_POST and ISSUE_SANCTION)", async () => {
      // Setup users
      const reporter = await prisma.user.create({
        data: { username: "reporter_audit", passwordHash: "hash123456789012" },
      });
      const offender = await prisma.user.create({
        data: { username: "offender_audit", passwordHash: "hash123456789012" },
      });
      const moderator = await prisma.user.create({
        data: { username: "mod_audit", passwordHash: "hash123456789012" },
      });

      // Setup community
      const community = await prisma.community.create({
        data: {
          name: "Audit Test Community",
          slug: "audit-test-community",
          description: "Audit test",
          rules: "Rules",
        },
      });

      // Setup post
      const post = await prisma.post.create({
        data: {
          communityId: community.id,
          authorId: offender.id,
          title: "Offensive Post",
          body: "Offensive content plain text",
        },
      });

      // Report filed against the post
      const report = await prisma.report.create({
        data: {
          reporterId: reporter.id,
          postId: post.id,
          reason: "Severe rule violation",
        },
      });

      // Sanction issued to the offender
      const sanction = await prisma.communitySanction.create({
        data: {
          communityId: community.id,
          userId: offender.id,
          sanctionType: SanctionType.MUTE,
          reason: "24h mute for severe rule violation",
          issuedById: moderator.id,
        },
      });

      // Moderation Action 1: REMOVE_POST linked to reportId
      const action1 = await prisma.moderationAction.create({
        data: {
          communityId: community.id,
          moderatorId: moderator.id,
          targetUserId: offender.id,
          reportId: report.id,
          postId: post.id,
          actionType: ModActionType.REMOVE_POST,
          reason: "Removed for severe rule violation",
          internalNote: "First warning and post removal",
        },
      });

      // Moderation Action 2: ISSUE_SANCTION linked to the SAME reportId
      const action2 = await prisma.moderationAction.create({
        data: {
          communityId: community.id,
          moderatorId: moderator.id,
          targetUserId: offender.id,
          reportId: report.id,
          sanctionId: sanction.id,
          actionType: ModActionType.ISSUE_SANCTION,
          reason: "Muted 24h for severe rule violation",
          internalNote: "Issued mute concurrently with post removal",
        },
      });

      expect(action1.id).toBeDefined();
      expect(action2.id).toBeDefined();
      expect(action1.reportId).toBe(report.id);
      expect(action2.reportId).toBe(report.id);
      expect(action1.actionType).toBe(ModActionType.REMOVE_POST);
      expect(action2.actionType).toBe(ModActionType.ISSUE_SANCTION);

      // Verify querying actions by reportId returns both records
      const actionsForReport = await prisma.moderationAction.findMany({
        where: { reportId: report.id },
        orderBy: { actionType: "asc" },
      });

      expect(actionsForReport.length).toBe(2);
      const actionTypes = actionsForReport.map((a) => a.actionType);
      expect(actionTypes).toContain(ModActionType.REMOVE_POST);
      expect(actionTypes).toContain(ModActionType.ISSUE_SANCTION);
    });
  });
});
