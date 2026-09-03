"use server";

import { requireUser } from "@/features/auth/session";
import {
  createCommunity,
  joinCommunity,
  leaveCommunity,
  transferOwnership,
  changeMemberRole,
} from "./service";
import { CommunityRole } from "@prisma/client";

export type ActionResult<T = void> = {
  success: boolean;
  data?: T;
  error?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function createCommunityAction(
  input: unknown
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const user = await requireUser();
    const community = await createCommunity(input, user.id);
    return {
      success: true,
      data: {
        id: community.id,
        slug: community.slug,
      },
    };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function joinCommunityAction(
  communityId: string
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await joinCommunity(communityId, user.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function leaveCommunityAction(
  communityId: string
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await leaveCommunity(communityId, user.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function transferOwnershipAction(
  communityId: string,
  targetUserId: string
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await transferOwnership(communityId, targetUserId, user.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function changeMemberRoleAction(
  communityId: string,
  targetUserId: string,
  newRole: CommunityRole
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await changeMemberRole(communityId, targetUserId, newRole, user.id);
    return { success: true };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}
