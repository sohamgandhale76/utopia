"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CommunityRole } from "@prisma/client";
import { joinCommunityAction, leaveCommunityAction } from "../actions";

interface MembershipButtonProps {
  communityId: string;
  initialRole: CommunityRole | null;
  isSignedIn: boolean;
}

export function MembershipButton({
  communityId,
  initialRole,
  isSignedIn,
}: MembershipButtonProps) {
  const router = useRouter();
  const [role, setRole] = useState<CommunityRole | null>(initialRole);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) {
    return (
      <Link
        href="/login"
        className="inline-flex items-center justify-center rounded-lg bg-indigo-600/20 px-4 py-2 text-sm font-medium text-indigo-400 border border-indigo-500/30 transition-colors hover:bg-indigo-600/30"
      >
        Sign in to Join
      </Link>
    );
  }

  async function handleJoin() {
    setLoading(true);
    setError(null);

    const result = await joinCommunityAction(communityId);
    if (result.success) {
      setRole(CommunityRole.MEMBER);
      router.refresh();
    } else {
      setError(result.error ?? "Failed to join community");
    }
    setLoading(false);
  }

  async function handleLeave() {
    setLoading(true);
    setError(null);

    const result = await leaveCommunityAction(communityId);
    if (result.success) {
      setRole(null);
      router.refresh();
    } else {
      setError(result.error ?? "Failed to leave community");
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        {role && (
          <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-indigo-300">
            {role}
          </span>
        )}

        {role ? (
          <button
            type="button"
            onClick={handleLeave}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            {loading ? "Leaving…" : "Leave Community"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleJoin}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? "Joining…" : "Join Community"}
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400"
        >
          {error}
        </div>
      )}
    </div>
  );
}
