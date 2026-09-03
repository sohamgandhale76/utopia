import { z } from "zod";
import { CommunityRole } from "@prisma/client";

export const createCommunitySchema = z.object({
  name: z.string().min(3).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]([a-z0-9-]{1,46}[a-z0-9])?$/, {
      message: "Slug must be 3-48 lowercase letters, digits, or hyphens without leading/trailing hyphens",
    }),
  description: z.string().min(1).max(500),
  rules: z.string().min(1).max(5000),
});

export type CreateCommunityInput = z.infer<typeof createCommunitySchema>;

export const joinCommunitySchema = z.object({
  communityId: z.string().min(1),
  userId: z.string().min(1),
});

export const leaveCommunitySchema = z.object({
  communityId: z.string().min(1),
  userId: z.string().min(1),
});

export const transferOwnershipSchema = z.object({
  communityId: z.string().min(1),
  targetUserId: z.string().min(1),
  actorId: z.string().min(1),
});

export const changeMemberRoleSchema = z.object({
  communityId: z.string().min(1),
  targetUserId: z.string().min(1),
  newRole: z.enum([CommunityRole.MEMBER, CommunityRole.MODERATOR]),
  actorId: z.string().min(1),
});
