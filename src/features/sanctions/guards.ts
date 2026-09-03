import { PrismaClient, Prisma, SanctionType } from "@prisma/client";

export type SanctionableAction = "POST" | "COMMENT" | "VOTE" | "REPORT" | "JOIN";

/**
 * Returns active sanctions for a user in a given community, if any.
 * A sanction is active if:
 * 1. revokedAt is null
 * 2. expiresAt is null (permanent) OR expiresAt > now (temporary unexpired)
 */
export async function getActiveSanctions(
  communityId: string,
  userId: string,
  prisma: PrismaClient | Prisma.TransactionClient
) {
  const now = new Date();

  const activeSanctions = await prisma.communitySanction.findMany({
    where: {
      communityId,
      userId,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } },
      ],
    },
    orderBy: {
      issuedAt: "desc",
    },
  });

  return activeSanctions;
}

/**
 * Evaluates whether a user is sanctioned from performing a specific action in a community.
 * Throws an Error if the action is restricted:
 * - MUTE blocks: POST, COMMENT, VOTE
 * - BAN blocks: POST, COMMENT, VOTE, REPORT, JOIN
 */
export async function checkUserSanction(
  communityId: string,
  userId: string,
  action: SanctionableAction,
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<void> {
  const activeSanctions = await getActiveSanctions(communityId, userId, prisma);

  if (activeSanctions.length === 0) {
    return;
  }

  // Check for BAN first as it is the most restrictive
  const banSanction = activeSanctions.find(
    (s) => s.sanctionType === SanctionType.BAN
  );
  if (banSanction) {
    // BAN blocks POST, COMMENT, VOTE, REPORT, JOIN
    throw new Error("User is banned from this community");
  }

  // Check for MUTE
  const muteSanction = activeSanctions.find(
    (s) => s.sanctionType === SanctionType.MUTE
  );
  if (muteSanction) {
    // MUTE blocks POST, COMMENT, VOTE; REPORT and JOIN are allowed
    if (action === "POST" || action === "COMMENT" || action === "VOTE") {
      throw new Error("User is muted in this community");
    }
  }
}
