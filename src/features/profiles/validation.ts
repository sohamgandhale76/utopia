import { z } from "zod";
import { usernameSchema } from "@/features/auth/validation";

export { usernameSchema };

export const profilePaginationLimitSchema = z.preprocess(
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

export type ProfilePaginationLimitInput = z.infer<
  typeof profilePaginationLimitSchema
>;

export const profileCursorSchema = z.object({
  id: z.string().min(1, "Cursor ID must not be empty"),
  createdAt: z.string().datetime("Cursor createdAt must be an ISO datetime string"),
});

export type ProfileCursorPayload = z.infer<typeof profileCursorSchema>;

export function encodeCursor(id: string, createdAt: Date): string {
  const jsonStr = JSON.stringify({ id, createdAt: createdAt.toISOString() });
  return Buffer.from(jsonStr, "utf-8").toString("base64url");
}

export function decodeCursor(
  cursor: string
): { id: string; createdAt: Date } | null {
  if (!cursor || typeof cursor !== "string") {
    return null;
  }

  try {
    const jsonStr = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsedJson = JSON.parse(jsonStr);
    const result = profileCursorSchema.safeParse(parsedJson);
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

export const profileTabSchema = z
  .enum(["posts", "comments"])
  .catch("posts")
  .default("posts");

export type ProfileTab = z.infer<typeof profileTabSchema>;
