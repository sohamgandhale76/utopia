import { z } from "zod";

export const feedPaginationLimitSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      const num = parseInt(val, 10);
      return isNaN(num) ? 20 : num;
    }
    return val;
  },
  z
    .number()
    .int("Limit must be an integer")
    .finite("Limit must be a finite number")
    .min(1, "Limit must be at least 1")
    .max(50, "Limit must be at most 50")
    .catch(20)
    .default(20)
);

export type FeedPaginationLimitInput = z.infer<typeof feedPaginationLimitSchema>;

export const feedCursorSchema = z.object({
  id: z.string().min(1, "Cursor ID must not be empty"),
  createdAt: z.string().datetime("Cursor createdAt must be an ISO datetime string"),
});

export type FeedCursorPayload = z.infer<typeof feedCursorSchema>;

export function encodeCursor(id: string, createdAt: Date): string {
  const jsonStr = JSON.stringify({ id, createdAt: createdAt.toISOString() });
  return Buffer.from(jsonStr, "utf-8").toString("base64url");
}

export function decodeCursor(
  cursor?: string
): { id: string; createdAt: Date } | null {
  if (!cursor || typeof cursor !== "string") {
    return null;
  }

  try {
    const jsonStr = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsedJson = JSON.parse(jsonStr);
    const result = feedCursorSchema.safeParse(parsedJson);
    if (!result.success) {
      return null;
    }

    const date = new Date(result.data.createdAt);
    if (isNaN(date.getTime())) {
      return null;
    }

    return {
      id: result.data.id,
      createdAt: date,
    };
  } catch {
    return null;
  }
}

// Semantic aliases
export const encodeFeedCursor = encodeCursor;
export const decodeFeedCursor = decodeCursor;

export const feedQuerySchema = z.object({
  limit: feedPaginationLimitSchema,
  cursor: z.string().optional(),
});

export type FeedQueryInput = z.infer<typeof feedQuerySchema>;
