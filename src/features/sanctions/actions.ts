"use server";

import { requireUser } from "@/features/auth/session";
import { issueSanction, revokeSanction } from "./service";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function issueSanctionAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const result = await issueSanction(input, user.id);
    return { success: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}

export async function revokeSanctionAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const result = await revokeSanction(input, user.id);
    return { success: true, data: { id: result.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}
