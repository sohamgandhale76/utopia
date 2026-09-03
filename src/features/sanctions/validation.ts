import { z } from "zod";
import { SanctionType } from "@prisma/client";

export const sanctionTypeSchema = z.nativeEnum(SanctionType);

export const issueSanctionSchema = z.object({
  communityId: z.string().min(1, "Community ID is required"),
  targetUserId: z.string().min(1, "Target user ID is required"),
  sanctionType: sanctionTypeSchema,
  reason: z
    .string()
    .trim()
    .min(1, "Reason is required")
    .max(500, "Reason must not exceed 500 characters"),
  durationHours: z
    .number()
    .int("Duration must be an integer")
    .positive("Duration must be positive")
    .max(87600, "Duration must not exceed 10 years")
    .optional(),
  internalNote: z
    .string()
    .trim()
    .max(500, "Internal note must not exceed 500 characters")
    .optional(),
});

export const revokeSanctionSchema = z.object({
  sanctionId: z.string().min(1, "Sanction ID is required"),
  reason: z
    .string()
    .trim()
    .min(1, "Public reason is required")
    .max(500, "Reason must not exceed 500 characters"),
  internalNote: z
    .string()
    .trim()
    .max(500, "Internal note must not exceed 500 characters")
    .optional(),
});

export type IssueSanctionInput = z.infer<typeof issueSanctionSchema>;
export type RevokeSanctionInput = z.infer<typeof revokeSanctionSchema>;
