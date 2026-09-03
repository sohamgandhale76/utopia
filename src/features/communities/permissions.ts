import { Prisma, PrismaClient, CommunityRole } from "@prisma/client";

export async function requireMembership(
  communityId: string,
  userId: string,
  prisma: Prisma.TransactionClient | PrismaClient
) {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_communityId: {
        userId,
        communityId,
      },
    },
  });

  if (!membership) {
    throw new Error("User is not a member of this community");
  }

  return membership;
}

export async function requireCommunityRole(
  communityId: string,
  userId: string,
  role: CommunityRole,
  prisma: Prisma.TransactionClient | PrismaClient
) {
  const membership = await requireMembership(communityId, userId, prisma);

  const roleHierarchy = {
    [CommunityRole.MEMBER]: 0,
    [CommunityRole.MODERATOR]: 1,
    [CommunityRole.OWNER]: 2,
  };

  if (roleHierarchy[membership.role] < roleHierarchy[role]) {
    throw new Error(`User does not have the required role: ${role}`);
  }

  return membership;
}
