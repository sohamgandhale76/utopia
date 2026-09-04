import { Prisma, PrismaClient, CommunityRole } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createCommunitySchema,
  CreateCommunityInput,
  joinCommunitySchema,
  leaveCommunitySchema,
  transferOwnershipSchema,
  changeMemberRoleSchema,
} from "./validation";
import { requireCommunityRole } from "./permissions";
import { checkUserSanction } from "@/features/sanctions/guards";
import { executeWithRetry } from "@/lib/transaction";

export async function createCommunity(
  input: unknown,
  creatorId: string,
  prisma: Prisma.TransactionClient | PrismaClient = db
) {
  const data = createCommunitySchema.parse(input);

  try {
    const community = await prisma.community.create({
      data: {
        ...data,
        memberships: {
          create: {
            userId: creatorId,
            role: CommunityRole.OWNER,
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        rules: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return community;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new Error("A community with this name or slug already exists");
      }
    }
    throw error;
  }
}

export async function joinCommunity(
  communityId: string,
  userId: string,
  prisma: Prisma.TransactionClient | PrismaClient = db
) {
  joinCommunitySchema.parse({ communityId, userId });

  await checkUserSanction(communityId, userId, "JOIN", prisma);

  try {
    const membership = await prisma.membership.upsert({
      where: {
        userId_communityId: {
          userId,
          communityId,
        },
      },
      update: {},
      create: {
        userId,
        communityId,
        role: CommunityRole.MEMBER,
      },
    });
    return membership;
  } catch (error) {
    throw error;
  }
}

export async function leaveCommunity(
  communityId: string,
  userId: string,
  prismaClient: PrismaClient = db
) {
  leaveCommunitySchema.parse({ communityId, userId });

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: {
            userId_communityId: { userId, communityId },
          },
        });

        if (!membership) {
          throw new Error("User is not a member of this community");
        }

        if (membership.role === CommunityRole.OWNER) {
          const ownerCount = await tx.membership.count({
            where: {
              communityId,
              role: CommunityRole.OWNER,
            },
          });

          if (ownerCount <= 1) {
            throw new Error("Cannot leave community as the sole owner");
          }
        }

        await tx.membership.delete({
          where: {
            userId_communityId: { userId, communityId },
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export async function transferOwnership(
  communityId: string,
  targetUserId: string,
  actorId: string,
  prismaClient: PrismaClient = db
) {
  transferOwnershipSchema.parse({ communityId, targetUserId, actorId });

  if (targetUserId === actorId) {
    throw new Error("Cannot transfer ownership to yourself");
  }

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // Verify actor is OWNER
        await requireCommunityRole(communityId, actorId, CommunityRole.OWNER, tx);

        // Verify target is a member
        const targetMembership = await tx.membership.findUnique({
          where: {
            userId_communityId: { userId: targetUserId, communityId },
          },
        });

        if (!targetMembership) {
          throw new Error("Target user is not a member of this community");
        }

        // Promote target to OWNER
        await tx.membership.update({
          where: {
            userId_communityId: { userId: targetUserId, communityId },
          },
          data: {
            role: CommunityRole.OWNER,
          },
        });

        // Demote actor to MODERATOR
        await tx.membership.update({
          where: {
            userId_communityId: { userId: actorId, communityId },
          },
          data: {
            role: CommunityRole.MODERATOR,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export async function changeMemberRole(
  communityId: string,
  targetUserId: string,
  newRole: CommunityRole,
  actorId: string,
  prismaClient: PrismaClient = db
) {
  changeMemberRoleSchema.parse({ communityId, targetUserId, newRole, actorId });

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // Verify actor is OWNER
        await requireCommunityRole(communityId, actorId, CommunityRole.OWNER, tx);

        // Target must be a member
        const targetMembership = await tx.membership.findUnique({
          where: {
            userId_communityId: { userId: targetUserId, communityId },
          },
        });

        if (!targetMembership) {
          throw new Error("Target user is not a member of this community");
        }

        if (targetMembership.role === CommunityRole.OWNER) {
          throw new Error("Cannot change role of an existing owner");
        }

        if (newRole === CommunityRole.OWNER) {
          throw new Error("Use transferOwnership to assign the OWNER role");
        }

        const updated = await tx.membership.update({
          where: {
            userId_communityId: { userId: targetUserId, communityId },
          },
          data: {
            role: newRole,
          },
        });

        return updated;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export type PublicCommunityDetail = {
  id: string;
  name: string;
  slug: string;
  description: string;
  rules: string;
  createdAt: Date;
  _count: {
    memberships: number;
  };
};

export async function getPublicCommunity(
  slug: string,
  prisma: Prisma.TransactionClient | PrismaClient = db
): Promise<PublicCommunityDetail> {
  const community = await prisma.community.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      rules: true,
      createdAt: true,
      _count: {
        select: { memberships: true },
      },
    },
  });

  if (!community) {
    throw new Error("Community not found");
  }

  return community;
}

export type PublicCommunitySummary = {
  id: string;
  name: string;
  slug: string;
  description: string;
  createdAt: Date;
  _count: {
    memberships: number;
  };
};

/**
 * List public communities for directory.
 * Orders by createdAt descending.
 * Strictly selects only public community fields and aggregate member count;
 * never exposes membership rosters or member usernames.
 */
export async function listPublicCommunities(
  prisma: Prisma.TransactionClient | PrismaClient = db
): Promise<PublicCommunitySummary[]> {
  return prisma.community.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      createdAt: true,
      _count: {
        select: { memberships: true },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export type ViewerMembership = {
  id: string;
  role: CommunityRole;
  joinedAt: Date;
  communityId: string;
} | null;

/**
 * Retrieve the current viewer's membership state for a given community.
 * Returns null if the viewer is not a member.
 * Strictly exposes only this single viewer's membership; never leaks other members.
 */
export async function getViewerMembership(
  communityId: string,
  userId: string,
  prisma: Prisma.TransactionClient | PrismaClient = db
): Promise<ViewerMembership> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_communityId: {
        userId,
        communityId,
      },
    },
    select: {
      id: true,
      role: true,
      joinedAt: true,
      communityId: true,
    },
  });

  return membership;
}

export type SafeCommunityRedirectData = {
  id: string;
  slug: string;
};

/**
 * Pure extraction helper ensuring only safe redirect properties are returned.
 */
export function toSafeRedirectData(community: { id: string; slug: string }): SafeCommunityRedirectData {
  return {
    id: community.id,
    slug: community.slug,
  };
}

