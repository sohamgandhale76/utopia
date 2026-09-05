import { z } from "zod";

export const searchTypeSchema = z.enum(["ALL", "COMMUNITIES", "POSTS", "USERS"]).catch("ALL").default("ALL");

export const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(2, "Query must be at least 2 characters")
    .max(100, "Query cannot exceed 100 characters")
    // Strip null bytes and non-printable control characters
    .transform((val) => val.replace(/[\x00-\x1F\x7F-\x9F]/g, "")),
  type: searchTypeSchema,
  limit: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        const num = parseInt(val, 10);
        return isNaN(num) ? 20 : num;
      }
      return val;
    },
    z
      .number()
      .int()
      .min(1)
      .max(50)
      .catch(20)
      .default(20)
  ),
  cursor: z.string().optional(),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
export type SearchType = z.infer<typeof searchTypeSchema>;

export const searchCursorSchema = z.object({
  offset: z.number().int().min(0),
});

export function encodeSearchCursor(offset: number): string {
  const jsonStr = JSON.stringify({ offset });
  return Buffer.from(jsonStr, "utf-8").toString("base64url");
}

export function decodeSearchCursor(cursor?: string): number {
  if (!cursor || typeof cursor !== "string") {
    return 0;
  }

  try {
    const jsonStr = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsedJson = JSON.parse(jsonStr);
    const result = searchCursorSchema.safeParse(parsedJson);
    
    if (!result.success) {
      return 0;
    }

    return result.data.offset;
  } catch {
    return 0;
  }
}
