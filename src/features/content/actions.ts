"use server";

import { requireUser } from "@/features/auth/session";
import { createPost, createComment } from "./service";
import { revalidatePath } from "next/cache";

export type ActionResult<T = void> = 
  | { success: true; data: T }
  | { success: false; error: string };

export async function createPostAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    
    // Attempt creation, service validates input and membership
    const post = await createPost(input, user.id);
    
    // Revalidation happens at the route level usually, but we don't have the slug here easily.
    // We can just rely on router.refresh() on the client, or pass slug in input if needed for revalidatePath.
    return { success: true, data: { id: post.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function createCommentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    
    // Attempt creation, service validates input, depth, and membership
    const comment = await createComment(input, user.id);
    
    return { success: true, data: { id: comment.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}
