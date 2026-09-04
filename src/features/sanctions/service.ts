import { Prisma, PrismaClient, CommunityRole, ModActionType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  issueSanctionSchema,
  revokeSanctionSchema,
  IssueSanctionInput,
  RevokeSanctionInput,
} from "./validation";
import { logModerationAction } from "@/features/moderation/audit";
import { executeWithRetry } from "@/lib/transaction";

export async function issueSanction(
  input: unknown,
  actorId: string,
  prismaClient: PrismaClient = db
) {
  const data = issueSanctionSchema.parse(input);

  // 1. Self-sanction prevention
  if (data.targetUserId === actorId) {
    throw new Error("You cannot sanction yourself");
  }

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // 2. Look up actor's membership in community
        const actorMembership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId: actorId,
              communityId: data.communityId,
            },
          },
        });

        if (
          !actorMembership ||
          (actorMembership.role !== CommunityRole.MODERATOR &&
            actorMembership.role !== CommunityRole.OWNER)
        ) {
          throw new Error(
            "You do not have permission to issue sanctions in this community"
          );
        }

        // 3. Look up target user's membership (if member)
        const targetMembership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId: data.targetUserId,
              communityId: data.communityId,
            },
          },
        });

        // 4. Hierarchy checks
        if (targetMembership) {
          if (targetMembership.role === CommunityRole.OWNER) {
            throw new Error("Community owners cannot be sanctioned");
          }

          if (
            targetMembership.role === CommunityRole.MODERATOR &&
            actorMembership.role !== CommunityRole.OWNER
          ) {
            throw new Error(
              "Moderators cannot sanction other moderators; owner authority required"
            );
          }
        }

        // 5. Expiry calculation
        const expiresAt = data.durationHours
          ? new Date(Date.now() + data.durationHours * 60 * 60 * 1000)
          : null;

        // 6. Create CommunitySanction
        const sanction = await tx.communitySanction.create({
          data: {
            communityId: data.communityId,
            userId: data.targetUserId,
            sanctionType: data.sanctionType,
            reason: data.reason,
            issuedById: actorId,
            expiresAt,
          },
        });

        // 7. Log append-only ModerationAction
        await logModerationAction(tx, {
          communityId: data.communityId,
          moderatorId: actorId,
          targetUserId: data.targetUserId,
          sanctionId: sanction.id,
          actionType: ModActionType.ISSUE_SANCTION,
          reason: data.reason,
          internalNote: data.internalNote,
        });

        return sanction;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}

export async function revokeSanction(
  input: unknown,
  actorId: string,
  prismaClient: PrismaClient = db
) {
  const data = revokeSanctionSchema.parse(input);

  return executeWithRetry(() =>
    prismaClient.$transaction(
      async (tx) => {
        // 1. Fetch sanction
        const sanction = await tx.communitySanction.findUnique({
          where: { id: data.sanctionId },
        });

        if (!sanction) {
          throw new Error("Sanction not found");
        }

        if (sanction.revokedAt) {
          throw new Error("Sanction is already revoked");
        }

        // 2. Prevent self-revocation
        if (sanction.userId === actorId) {
          throw new Error("You cannot revoke your own sanction");
        }

        // 3. Authorize actor
        const actorMembership = await tx.membership.findUnique({
          where: {
            userId_communityId: {
              userId: actorId,
              communityId: sanction.communityId,
            },
          },
        });

        if (
          !actorMembership ||
          (actorMembership.role !== CommunityRole.MODERATOR &&
            actorMembership.role !== CommunityRole.OWNER)
        ) {
          throw new Error(
            "You do not have permission to revoke sanctions in this community"
          );
        }

        // 4. Hierarchy: Moderator cannot revoke sanction issued by the Owner
        if (actorMembership.role === CommunityRole.MODERATOR) {
          const issuerMembership = await tx.membership.findUnique({
            where: {
              userId_communityId: {
                userId: sanction.issuedById,
                communityId: sanction.communityId,
              },
            },
          });

          if (issuerMembership?.role === CommunityRole.OWNER) {
            throw new Error(
              "Moderators cannot revoke sanctions issued by the community owner"
            );
          }

          // Moderator cannot revoke sanction on another moderator
          const targetMembership = await tx.membership.findUnique({
            where: {
              userId_communityId: {
                userId: sanction.userId,
                communityId: sanction.communityId,
              },
            },
          });

          if (targetMembership?.role === CommunityRole.MODERATOR) {
            throw new Error(
              "Moderators cannot revoke sanctions on other moderators"
            );
          }
        }

        // 5. Revoke sanction (record preserved for audit history)
        const updatedSanction = await tx.communitySanction.update({
          where: { id: sanction.id },
          data: { revokedAt: new Date() },
        });

        // 6. Append compensating ModerationAction
        await logModerationAction(tx, {
          communityId: sanction.communityId,
          moderatorId: actorId,
          targetUserId: sanction.userId,
          sanctionId: sanction.id,
          actionType: ModActionType.REVOKE_SANCTION,
          reason: data.reason,
          internalNote: data.internalNote,
        });

        return updatedSanction;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }
    )
  );
}
