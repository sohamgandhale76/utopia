import { z } from "zod";
import { ReportStatus } from "@prisma/client";

export const submitReportSchema = z
  .object({
    postId: z.string().min(1).optional(),
    commentId: z.string().min(1).optional(),
    reason: z
      .string()
      .trim()
      .min(1, "Reason is required")
      .max(500, "Reason must not exceed 500 characters"),
  })
  .refine(
    (data) => (data.postId ? !data.commentId : !!data.commentId),
    {
      message: "Report must target either a post or a comment, but not both",
      path: ["postId"],
    }
  );

export type SubmitReportInput = z.infer<typeof submitReportSchema>;
