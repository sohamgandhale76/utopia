import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, ModActionType, ReportStatus, CommunityRole } from "@prisma/client";
import { createCommunity, joinCommunity, changeMemberRole } from "@/features/communities/service";
import { createPost, createComment, getPostDetails } from "@/features/content/service";
import { submitReport } from "@/features/reports/service";
import { removePost, removeComment, dismissReport } from "@/features/moderation/service";

describe("Moderation Actions & Removal Workflows (Stage 5)", () => {
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

  it("should allow a moderator to remove a post, soft-deleting it and logging a ModerationAction", async () => {
    const owner = await makeUser("owner");
    const mod = await makeUser("mod");
    const author = await makeUser("author");

    const community = await createCommunity(
      { name: "ModPostComm", slug: "mod-post-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, mod.id, prisma);
    await joinCommunity(community.id, author.id, prisma);
    await changeMemberRole(community.id, mod.id, CommunityRole.MODERATOR, owner.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Bad Post", body: "Spam text" },
      author.id,
      prisma
    );

    const action = await removePost(
      {
        postId: post.id,
        reason: "Violates Rule 1: No Spam",
        internalNote: "Repeated spam offender",
      },
      mod.id,
      prisma
    );

    expect(action.id).toBeDefined();
    expect(action.actionType).toBe(ModActionType.REMOVE_POST);

    // Verify post is soft-deleted
    const dbPost = await prisma.post.findUnique({ where: { id: post.id } });
    expect(dbPost?.isDeleted).toBe(true);
    expect(dbPost?.deletedByRole).toBe("MODERATOR");
    expect(dbPost?.deletedReason).toBe("Violates Rule 1: No Spam");

    // Verify post details query respects soft deletion
    const details = await getPostDetails(post.id, prisma);
    expect(details).toBeNull();

    // Verify ModerationAction record
    const modAction = await prisma.moderationAction.findUnique({
      where: { id: action.id },
    });
    expect(modAction?.communityId).toBe(community.id);
    expect(modAction?.moderatorId).toBe(mod.id);
    expect(modAction?.targetUserId).toBe(author.id);
    expect(modAction?.reason).toBe("Violates Rule 1: No Spam");
    expect(modAction?.internalNote).toBe("Repeated spam offender");
  });

  it("should allow peer moderator to remove content authored by another moderator", async () => {
    const owner = await makeUser("owner");
    const mod1 = await makeUser("mod1");
    const mod2 = await makeUser("mod2");

    const community = await createCommunity(
      { name: "PeerModComm", slug: "peer-mod-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, mod1.id, prisma);
    await joinCommunity(community.id, mod2.id, prisma);
    await changeMemberRole(community.id, mod1.id, CommunityRole.MODERATOR, owner.id, prisma);
    await changeMemberRole(community.id, mod2.id, CommunityRole.MODERATOR, owner.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Inappropriate by Mod", body: "Mod mistake" },
      mod1.id,
      prisma
    );

    // Mod2 removes Mod1's post per approved Decision 4
    const action = await removePost(
      { postId: post.id, reason: "Inappropriate mod post" },
      mod2.id,
      prisma
    );
    expect(action.id).toBeDefined();

    const dbPost = await prisma.post.findUnique({ where: { id: post.id } });
    expect(dbPost?.isDeleted).toBe(true);
  });

  it("should soft-delete comments while preserving reply tree integrity", async () => {
    const owner = await makeUser("owner");
    const author = await makeUser("author");
    const replier = await makeUser("replier");

    const community = await createCommunity(
      { name: "CommentTreeMod", slug: "comment-tree-mod", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, author.id, prisma);
    await joinCommunity(community.id, replier.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    const parentComment = await createComment(
      { postId: post.id, body: "Parent comment" },
      author.id,
      prisma
    );

    const childComment = await createComment(
      { postId: post.id, parentId: parentComment.id, body: "Child reply" },
      replier.id,
      prisma
    );

    // Remove parent comment
    await removeComment(
      { commentId: parentComment.id, reason: "Inappropriate parent" },
      owner.id,
      prisma
    );

    // Parent is soft-deleted
    const parentInDb = await prisma.comment.findUnique({ where: { id: parentComment.id } });
    expect(parentInDb?.isDeleted).toBe(true);

    // Child comment still exists and points to parentId
    const childInDb = await prisma.comment.findUnique({ where: { id: childComment.id } });
    expect(childInDb?.isDeleted).toBe(false);
    expect(childInDb?.parentId).toBe(parentComment.id);
  });

  it("should update report status to ACTIONED when removing content with reportId", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");
    const author = await makeUser("author");

    const community = await createCommunity(
      { name: "ActionReportComm", slug: "action-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);
    await joinCommunity(community.id, author.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Reported Post", body: "Spam" },
      author.id,
      prisma
    );

    const report = await submitReport(
      { postId: post.id, reason: "Spam violation" },
      reporter.id,
      prisma
    );

    // Remove post with reportId
    await removePost(
      { postId: post.id, reason: "Confirmed spam", reportId: report.id },
      owner.id,
      prisma
    );

    const updatedReport = await prisma.report.findUnique({ where: { id: report.id } });
    expect(updatedReport?.status).toBe(ReportStatus.ACTIONED);
  });

  it("should update report status to ACTIONED when removing a comment with reportId", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");
    const author = await makeUser("author");

    const community = await createCommunity(
      { name: "ActionCommentReportComm", slug: "action-comment-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);
    await joinCommunity(community.id, author.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      author.id,
      prisma
    );
    const comment = await createComment(
      { postId: post.id, body: "Spam comment" },
      author.id,
      prisma
    );

    const report = await submitReport(
      { commentId: comment.id, reason: "Spam violation" },
      reporter.id,
      prisma
    );

    await removeComment(
      { commentId: comment.id, reason: "Confirmed spam", reportId: report.id },
      owner.id,
      prisma
    );

    const updatedReport = await prisma.report.findUnique({ where: { id: report.id } });
    expect(updatedReport?.status).toBe(ReportStatus.ACTIONED);
  });

  it("should update report status to DISMISSED and log ModerationAction when dismissed", async () => {
    const owner = await makeUser("owner");
    const reporter = await makeUser("reporter");
    const author = await makeUser("author");

    const community = await createCommunity(
      { name: "DismissReportComm", slug: "dismiss-report-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, reporter.id, prisma);
    await joinCommunity(community.id, author.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Good Post", body: "Normal text" },
      author.id,
      prisma
    );

    const report = await submitReport(
      { postId: post.id, reason: "Frivolous report" },
      reporter.id,
      prisma
    );

    const action = await dismissReport(
      { reportId: report.id, reason: "No violation found", internalNote: "Reporter seems confused" },
      owner.id,
      prisma
    );

    expect(action.actionType).toBe(ModActionType.DISMISS_REPORT);

    const updatedReport = await prisma.report.findUnique({ where: { id: report.id } });
    expect(updatedReport?.status).toBe(ReportStatus.DISMISSED);
  });

  it("should reject non-moderators from performing moderation removals", async () => {
    const owner = await makeUser("owner");
    const nonMod = await makeUser("nonmod");

    const community = await createCommunity(
      { name: "RejectModComm", slug: "reject-mod-comm", description: "Desc", rules: "Rules" },
      owner.id,
      prisma
    );
    await joinCommunity(community.id, nonMod.id, prisma);

    const post = await createPost(
      { communityId: community.id, title: "Post", body: "Body" },
      owner.id,
      prisma
    );

    await expect(
      removePost({ postId: post.id, reason: "Trying to remove" }, nonMod.id, prisma)
    ).rejects.toThrow("User does not have the required role: MODERATOR");
  });
});
