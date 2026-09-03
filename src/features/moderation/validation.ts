import { z } from "zod";
import { ModActionType } from "@prisma/client";

export const modActionTypeSchema = z.nativeEnum(ModActionType);

export const removePostSchema = z.object({
  postId: z.string().min(1, "Post ID is required"),
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
  reportId: z.string().min(1).optional(),
});

export const removeCommentSchema = z.object({
  commentId: z.string().min(1, "Comment ID is required"),
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
  reportId: z.string().min(1).optional(),
});

export const dismissReportSchema = z.object({
  reportId: z.string().min(1, "Report ID is required"),
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

export type RemovePostInput = z.infer<typeof removePostSchema>;
export type RemoveCommentInput = z.infer<typeof removeCommentSchema>;
export type DismissReportInput = z.infer<typeof dismissReportSchema>;
