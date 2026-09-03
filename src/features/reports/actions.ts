"use server";

import { requireUser } from "@/features/auth/session";
import { submitReport } from "./service";

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function submitReportAction(
  input: unknown
): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireUser();
    const report = await submitReport(input, user.id);
    return { success: true, data: { id: report.id } };
  } catch (error) {
    if (error instanceof Error) {
      return { success: false, error: error.message };
    }
    return { success: false, error: "An unexpected error occurred" };
  }
}
