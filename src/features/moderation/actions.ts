"use server";

import { requireUser } from "@/features/auth/session";
import { removePost, removeComment, dismissReport } from "./service";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function removePostAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const result = await removePost(input, user.id);
    return { success: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function removeCommentAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const result = await removeComment(input, user.id);
    return { success: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function dismissReportAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const result = await dismissReport(input, user.id);
    return { success: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}
