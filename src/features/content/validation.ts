import { z } from "zod";

function utf8ByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export const createPostSchema = z.object({
  communityId: z.string().min(1, "Community ID is required"),
  title: z
    .string()
    .min(1, "Title must not be empty")
    .max(300, "Title must be at most 300 characters")
    .refine((val) => val.trim().length > 0, {
      message: "Title cannot be only whitespace",
    }),
  body: z
    .string()
    .min(1, "Post body must not be empty")
    .refine((val) => val.trim().length > 0, {
      message: "Post body cannot be only whitespace",
    })
    .refine((val) => utf8ByteLength(val) <= 20000, {
      message: "Post body must be at most 20,000 UTF-8 bytes",
    }),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export const createCommentSchema = z.object({
  postId: z.string().min(1, "Post ID is required"),
  parentId: z.string().optional(),
  body: z
    .string()
    .min(1, "Comment body must not be empty")
    .refine((val) => val.trim().length > 0, {
      message: "Comment body cannot be only whitespace",
    })
    .refine((val) => utf8ByteLength(val) <= 5000, {
      message: "Comment body must be at most 5,000 UTF-8 bytes",
    }),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const feedLimitSchema = z
  .number()
  .int("Limit must be an integer")
  .finite("Limit must be a finite number")
  .min(1, "Limit must be at least 1")
  .max(100, "Limit must be at most 100")
  .catch(50)
  .default(50);

export type FeedLimitInput = z.infer<typeof feedLimitSchema>;

export const feedCursorSchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
});

export type FeedCursorInput = z.infer<typeof feedCursorSchema>;

