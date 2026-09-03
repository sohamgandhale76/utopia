"use server";

import { requireUser } from "@/features/auth/session";
import { castPostVote, castCommentVote, VoteResult } from "./service";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function castPostVoteAction(
  input: unknown
): Promise<ActionResult<VoteResult>> {
  try {
    const user = await requireUser();
    const result = await castPostVote(input, user.id);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function castCommentVoteAction(
  input: unknown
): Promise<ActionResult<VoteResult>> {
  try {
    const user = await requireUser();
    const result = await castCommentVote(input, user.id);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}
