import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getTestPrisma, resetTestDatabase, closeTestDatabase } from "../helpers/test-db";
import { PrismaClient, CommunityRole } from "@prisma/client";
import { hashPassword } from "../../src/features/auth/password";
import {
  createCommunity,
  joinCommunity,
  leaveCommunity,
  transferOwnership,
  changeMemberRole,
  getPublicCommunity,
  listPublicCommunities,
  getViewerMembership,
  toSafeRedirectData,
} from "../../src/features/communities/service";

describe("Stage 3A: Community & Membership Tests", () => {
  let prisma: PrismaClient;
  let testUser1: any;
  let testUser2: any;
  let testUser3: any;

  beforeAll(async () => {
    prisma = await getTestPrisma();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    const passwordHash = await hashPassword("testpassword");
    testUser1 = await prisma.user.create({
      data: { username: "user1", passwordHash },
    });
    testUser2 = await prisma.user.create({
      data: { username: "user2", passwordHash },
    });
    testUser3 = await prisma.user.create({
      data: { username: "user3", passwordHash },
    });
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  // ===========================================================================
  // Creation Tests
  // ===========================================================================
  describe("Community Creation", () => {
    it("atomically creates community and OWNER membership", async () => {
      const community = await createCommunity(
        {
          name: "Test Community",
          slug: "test-comm",
          description: "Test desc",
          rules: "Test rules",
        },
        testUser1.id,
        prisma
      );

      expect(community).toBeDefined();
      expect(community.slug).toBe("test-comm");

      const memberships = await prisma.membership.findMany({
        where: { communityId: community.id },
      });

      expect(memberships).toHaveLength(1);
      expect(memberships[0].userId).toBe(testUser1.id);
      expect(memberships[0].role).toBe(CommunityRole.OWNER);
    });

    it("rejects invalid community data (Zod validation)", async () => {
      await expect(
        createCommunity(
          {
            name: "ab", // Too short
            slug: "test-comm",
            description: "Test desc",
            rules: "Test rules",
          },
          testUser1.id,
          prisma
        )
      ).rejects.toThrow();

      await expect(
        createCommunity(
          {
            name: "Test Comm",
            slug: "-invalid-slug", // Leading hyphen
            description: "Test desc",
            rules: "Test rules",
          },
          testUser1.id,
          prisma
        )
      ).rejects.toThrow();
    });

    it("rejects duplicate name or slug (Prisma P2002)", async () => {
      await createCommunity(
        {
          name: "Unique Name",
          slug: "unique-slug",
          description: "Desc",
          rules: "Rules",
        },
        testUser1.id,
        prisma
      );

      await expect(
        createCommunity(
          {
            name: "Unique Name",
            slug: "other-slug",
            description: "Desc",
            rules: "Rules",
          },
          testUser2.id,
          prisma
        )
      ).rejects.toThrow("A community with this name or slug already exists");

      await expect(
        createCommunity(
          {
            name: "Other Name",
            slug: "unique-slug",
            description: "Desc",
            rules: "Rules",
          },
          testUser2.id,
          prisma
        )
      ).rejects.toThrow("A community with this name or slug already exists");
    });
  });

  // ===========================================================================
  // Membership (Join)
  // ===========================================================================
  describe("Join Community", () => {
    it("adds a user as MEMBER idempotently", async () => {
      const comm = await createCommunity(
        { name: "Join Test", slug: "join-test", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );

      const mem1 = await joinCommunity(comm.id, testUser2.id, prisma);
      expect(mem1.role).toBe(CommunityRole.MEMBER);

      // Idempotent join
      const mem2 = await joinCommunity(comm.id, testUser2.id, prisma);
      expect(mem2.id).toBe(mem1.id);

      const count = await prisma.membership.count({
        where: { communityId: comm.id, userId: testUser2.id },
      });
      expect(count).toBe(1);
    });

    it("fails cleanly if community does not exist", async () => {
      await expect(joinCommunity("non-existent", testUser2.id, prisma)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Leave Community & Transfer Ownership Concurrency
  // ===========================================================================
  describe("Leave Community & Concurrency", () => {
    it("allows non-owner to leave", async () => {
      const comm = await createCommunity(
        { name: "Leave Test", slug: "leave-test", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      await joinCommunity(comm.id, testUser2.id, prisma);

      await leaveCommunity(comm.id, testUser2.id, prisma);

      const count = await prisma.membership.count({
        where: { communityId: comm.id, userId: testUser2.id },
      });
      expect(count).toBe(0);
    });

    it("prevents sole owner from leaving", async () => {
      const comm = await createCommunity(
        { name: "Sole Owner", slug: "sole-owner", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );

      await expect(leaveCommunity(comm.id, testUser1.id, prisma)).rejects.toThrow(
        "Cannot leave community as the sole owner"
      );
    });

    it("handles two concurrent owner-leave requests preserving at least one OWNER", async () => {
      const comm = await createCommunity(
        { name: "Concurrent Leave", slug: "concurrent-leave", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );

      // Make User 2 an owner manually for this test setup
      await prisma.membership.create({
        data: {
          communityId: comm.id,
          userId: testUser2.id,
          role: CommunityRole.OWNER,
        },
      });

      // Both try to leave simultaneously
      const results = await Promise.allSettled([
        leaveCommunity(comm.id, testUser1.id, prisma),
        leaveCommunity(comm.id, testUser2.id, prisma),
      ]);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      // Only one should succeed because leaving the second time would make ownerCount 0
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect((failures[0] as PromiseRejectedResult).reason.message).toContain(
        "Cannot leave community as the sole owner"
      );

      const remainingOwners = await prisma.membership.count({
        where: { communityId: comm.id, role: CommunityRole.OWNER },
      });
      expect(remainingOwners).toBe(1);
    });

    it("handles concurrent ownership-transfer preserving at least one OWNER", async () => {
      const comm = await createCommunity(
        { name: "Concurrent Transfer", slug: "concurrent-transfer", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      await joinCommunity(comm.id, testUser2.id, prisma);
      await joinCommunity(comm.id, testUser3.id, prisma);

      // User 1 tries to transfer to User 2 and User 3 simultaneously
      const results = await Promise.allSettled([
        transferOwnership(comm.id, testUser2.id, testUser1.id, prisma),
        transferOwnership(comm.id, testUser3.id, testUser1.id, prisma),
      ]);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      // Only one should succeed because the first transfer demotes the actor (User 1).
      // The second transfer will fail because User 1 is no longer an OWNER.
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      expect((failures[0] as PromiseRejectedResult).reason.message).toContain(
        "User does not have the required role: OWNER"
      );

      const remainingOwners = await prisma.membership.count({
        where: { communityId: comm.id, role: CommunityRole.OWNER },
      });
      expect(remainingOwners).toBe(1); // the target of the successful transfer
    });
  });

  // ===========================================================================
  // Role Hierarchy & Role Changes
  // ===========================================================================
  describe("Role Management", () => {
    let comm: any;

    beforeEach(async () => {
      comm = await createCommunity(
        { name: "Roles", slug: "roles-test", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      await joinCommunity(comm.id, testUser2.id, prisma);
      await joinCommunity(comm.id, testUser3.id, prisma);
    });

    it("allows OWNER to promote MEMBER to MODERATOR", async () => {
      await changeMemberRole(comm.id, testUser2.id, CommunityRole.MODERATOR, testUser1.id, prisma);
      
      const mem = await prisma.membership.findUnique({
        where: { userId_communityId: { userId: testUser2.id, communityId: comm.id } }
      });
      expect(mem!.role).toBe(CommunityRole.MODERATOR);
    });

    it("allows OWNER to demote MODERATOR to MEMBER", async () => {
      await changeMemberRole(comm.id, testUser2.id, CommunityRole.MODERATOR, testUser1.id, prisma);
      await changeMemberRole(comm.id, testUser2.id, CommunityRole.MEMBER, testUser1.id, prisma);
      
      const mem = await prisma.membership.findUnique({
        where: { userId_communityId: { userId: testUser2.id, communityId: comm.id } }
      });
      expect(mem!.role).toBe(CommunityRole.MEMBER);
    });

    it("rejects MODERATOR trying to change roles", async () => {
      // User 2 becomes MODERATOR
      await changeMemberRole(comm.id, testUser2.id, CommunityRole.MODERATOR, testUser1.id, prisma);
      
      // User 2 tries to promote User 3
      await expect(
        changeMemberRole(comm.id, testUser3.id, CommunityRole.MODERATOR, testUser2.id, prisma)
      ).rejects.toThrow("User does not have the required role: OWNER");
    });

    it("rejects targeting an existing OWNER", async () => {
      await expect(
        changeMemberRole(comm.id, testUser1.id, CommunityRole.MEMBER, testUser1.id, prisma)
      ).rejects.toThrow("Cannot change role of an existing owner");
    });

    it("rejects changing a user's role to OWNER (must use transferOwnership)", async () => {
      await expect(
        changeMemberRole(comm.id, testUser2.id, CommunityRole.OWNER, testUser1.id, prisma)
      ).rejects.toThrow();
    });

    it("allows ownership transfer (atomic promotion and demotion)", async () => {
      await transferOwnership(comm.id, testUser2.id, testUser1.id, prisma);

      const mem2 = await prisma.membership.findUnique({
        where: { userId_communityId: { userId: testUser2.id, communityId: comm.id } }
      });
      expect(mem2!.role).toBe(CommunityRole.OWNER);

      const mem1 = await prisma.membership.findUnique({
        where: { userId_communityId: { userId: testUser1.id, communityId: comm.id } }
      });
      expect(mem1!.role).toBe(CommunityRole.MODERATOR);
    });

    it("handles concurrent transferOwnership and changeMemberRole safely", async () => {
      // User 1 (OWNER) tries to transfer ownership to User 2 (MEMBER)
      // At the exact same time, User 1 tries to change User 2's role to MODERATOR
      const results = await Promise.allSettled([
        transferOwnership(comm.id, testUser2.id, testUser1.id, prisma),
        changeMemberRole(comm.id, testUser2.id, CommunityRole.MODERATOR, testUser1.id, prisma),
      ]);

      // Exactly one must succeed, or both could succeed sequentially?
      // With Serializable, one transaction wins and locks/commits first. 
      // If transferOwnership wins: target becomes OWNER. The changeMemberRole transaction will be retried or fail because target is now OWNER ("Cannot change role of an existing owner").
      // If changeMemberRole wins: target becomes MODERATOR. The transferOwnership will promote them to OWNER and demote actor to MODERATOR.
      // In either case, there MUST be exactly one OWNER left at the end.
      const remainingOwners = await prisma.membership.count({
        where: { communityId: comm.id, role: CommunityRole.OWNER },
      });
      expect(remainingOwners).toBe(1);

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        const errorMsg = (failures[0] as PromiseRejectedResult).reason.message;
        const isValidError = 
          errorMsg.includes("Cannot change role of an existing owner") || 
          errorMsg.includes("User does not have the required role: OWNER");
        expect(isValidError).toBe(true);
      }
    });

    it("rejects transferOwnership to a non-member", async () => {
      // User 3 leaves
      await leaveCommunity(comm.id, testUser3.id, prisma);

      await expect(
        transferOwnership(comm.id, testUser3.id, testUser1.id, prisma)
      ).rejects.toThrow("Target user is not a member of this community");
    });
  });

  // ===========================================================================
  // Public Queries
  // ===========================================================================
  describe("Public Community Queries", () => {
    it("returns community details and member count without exposing members", async () => {
      const comm = await createCommunity(
        { name: "Public Test", slug: "public-test", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      await joinCommunity(comm.id, testUser2.id, prisma);

      const fetched = await getPublicCommunity("public-test", prisma);

      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe("Public Test");
      expect(fetched!._count.memberships).toBe(2);
      
      // Ensure memberships are not exposed in the result
      expect((fetched as any).memberships).toBeUndefined();
    });

    it("throws if community not found", async () => {
      await expect(getPublicCommunity("does-not-exist", prisma)).rejects.toThrow("Community not found");
    });
  });

  // ===========================================================================
  // Stage 3B: Safe Read Helpers & UI Data Contracts
  // ===========================================================================
  describe("Stage 3B: Community UI & Safe Read Helpers", () => {
    it("listPublicCommunities excludes member rosters and usernames, and orders by createdAt desc", async () => {
      // Create first community
      const comm1 = await createCommunity(
        { name: "Alpha Community", slug: "alpha-comm", description: "Alpha desc", rules: "Alpha rules" },
        testUser1.id,
        prisma
      );

      // Create second community slightly later
      const comm2 = await createCommunity(
        { name: "Beta Community", slug: "beta-comm", description: "Beta desc", rules: "Beta rules" },
        testUser2.id,
        prisma
      );

      // Add members to both
      await joinCommunity(comm1.id, testUser2.id, prisma);
      await joinCommunity(comm1.id, testUser3.id, prisma);
      await joinCommunity(comm2.id, testUser3.id, prisma);

      const directory = await listPublicCommunities(prisma);

      expect(directory.length).toBeGreaterThanOrEqual(2);

      // Verify ordering: createdAt descending (comm2 was created after comm1)
      const index1 = directory.findIndex((c) => c.id === comm1.id);
      const index2 = directory.findIndex((c) => c.id === comm2.id);
      expect(index2).toBeLessThan(index1);

      // Find our test communities
      const alpha = directory.find((c) => c.id === comm1.id)!;
      expect(alpha).toBeDefined();
      expect(alpha.name).toBe("Alpha Community");
      expect(alpha.slug).toBe("alpha-comm");
      expect(alpha.description).toBe("Alpha desc");
      expect(alpha._count.memberships).toBe(3); // testUser1 (OWNER) + testUser2 + testUser3

      const beta = directory.find((c) => c.id === comm2.id)!;
      expect(beta._count.memberships).toBe(2); // testUser2 (OWNER) + testUser3

      // Security assertion: Never expose membership rosters, users, or secrets
      for (const item of directory) {
        expect((item as any).memberships).toBeUndefined();
        expect((item as any).members).toBeUndefined();
        expect((item as any).users).toBeUndefined();
        expect((item as any).rules).toBeUndefined(); // Rules are detail-page only
        expect(JSON.stringify(item)).not.toContain("user1");
        expect(JSON.stringify(item)).not.toContain("user2");
        expect(JSON.stringify(item)).not.toContain("passwordHash");
      }
    });

    it("listPublicCommunities supports members, alphabetical, and newest sort modes with safe normalization", async () => {
      // Controlled dataset: distinct member counts (1, 3, 2) and names in
      // non-alphabetical creation order (Zebra, Mango, Apple)
      const zebra = await createCommunity(
        { name: "Zebra Community", slug: "zebra-comm", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      const mango = await createCommunity(
        { name: "Mango Community", slug: "mango-comm", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      await joinCommunity(mango.id, testUser2.id, prisma);
      await joinCommunity(mango.id, testUser3.id, prisma);
      const apple = await createCommunity(
        { name: "Apple Community", slug: "apple-comm", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      await joinCommunity(apple.id, testUser2.id, prisma);

      // members: member count descending
      const byMembers = await listPublicCommunities("members", prisma);
      expect(byMembers.map((c) => c.name)).toEqual([
        "Mango Community",
        "Apple Community",
        "Zebra Community",
      ]);

      // alphabetical: name ascending
      const byAlpha = await listPublicCommunities("alphabetical", prisma);
      expect(byAlpha.map((c) => c.name)).toEqual([
        "Apple Community",
        "Mango Community",
        "Zebra Community",
      ]);

      // newest: createdAt descending (reverse creation order)
      const byNewest = await listPublicCommunities("newest", prisma);
      expect(byNewest.map((c) => c.name)).toEqual([
        "Apple Community",
        "Mango Community",
        "Zebra Community",
      ]);

      // Whitespace and mixed-case sort input is normalized safely
      const normalized = await listPublicCommunities("  MEMBERS  ", prisma);
      expect(normalized.map((c) => c.id)).toEqual(byMembers.map((c) => c.id));

      // Invalid sort values fall back to newest instead of throwing
      const fallback = await listPublicCommunities("bogus-sort", prisma);
      expect(fallback.map((c) => c.id)).toEqual(byNewest.map((c) => c.id));

      // Options-object form behaves identically to the positional form
      const viaOptions = await listPublicCommunities({ sort: "members", prisma });
      expect(viaOptions.map((c) => c.id)).toEqual(byMembers.map((c) => c.id));

      // Privacy invariant holds in every sort mode
      for (const item of [...byMembers, ...byAlpha, ...byNewest]) {
        expect((item as any).memberships).toBeUndefined();
        expect((item as any).members).toBeUndefined();
        expect(JSON.stringify(item)).not.toContain("passwordHash");
      }
    });

    it("getViewerMembership exposes only that viewer's membership record", async () => {
      const comm = await createCommunity(
        { name: "Membership Test", slug: "membership-test", description: "D", rules: "R" },
        testUser1.id,
        prisma
      );
      await joinCommunity(comm.id, testUser2.id, prisma);
      // testUser3 does NOT join

      // Viewer 1 (Owner)
      const mem1 = await getViewerMembership(comm.id, testUser1.id, prisma);
      expect(mem1).not.toBeNull();
      expect(mem1!.role).toBe(CommunityRole.OWNER);
      expect(mem1!.communityId).toBe(comm.id);
      expect((mem1 as any).user).toBeUndefined();
      expect((mem1 as any).passwordHash).toBeUndefined();

      // Viewer 2 (Member)
      const mem2 = await getViewerMembership(comm.id, testUser2.id, prisma);
      expect(mem2).not.toBeNull();
      expect(mem2!.role).toBe(CommunityRole.MEMBER);
      expect(mem2!.communityId).toBe(comm.id);

      // Viewer 3 (Not a member)
      const mem3 = await getViewerMembership(comm.id, testUser3.id, prisma);
      expect(mem3).toBeNull();

      // Non-existent community
      const memNonexistent = await getViewerMembership("nonexistent-comm", testUser1.id, prisma);
      expect(memNonexistent).toBeNull();
    });

    it("toSafeRedirectData extracts strictly id and slug for safe redirect", async () => {
      const comm = await createCommunity(
        { name: "Redirect Test", slug: "redirect-test", description: "D", rules: "Sensitive Rules Text" },
        testUser1.id,
        prisma
      );

      const redirectData = toSafeRedirectData(comm);

      // Must contain only id and slug
      expect(Object.keys(redirectData).sort()).toEqual(["id", "slug"]);
      expect(redirectData.id).toBe(comm.id);
      expect(redirectData.slug).toBe("redirect-test");

      // Must never contain sensitive or extraneous data
      expect((redirectData as any).rules).toBeUndefined();
      expect((redirectData as any).description).toBeUndefined();
      expect((redirectData as any).memberships).toBeUndefined();
      expect((redirectData as any).creatorId).toBeUndefined();
    });
  });
});
