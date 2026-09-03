import { z } from "zod";
import { VoteType } from "@prisma/client";

export const voteTypeSchema = z.nativeEnum(VoteType);

export const castPostVoteSchema = z.object({
  postId: z.string().min(1, "Post ID is required"),
  type: voteTypeSchema,
});

export const castCommentVoteSchema = z.object({
  commentId: z.string().min(1, "Comment ID is required"),
  type: voteTypeSchema,
});

export type CastPostVoteInput = z.infer<typeof castPostVoteSchema>;
export type CastCommentVoteInput = z.infer<typeof castCommentVoteSchema>;
