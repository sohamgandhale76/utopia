"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logout } from "../actions";

export function SignOutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await logout();
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isPending}
      className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors disabled:opacity-50"
    >
      {isPending ? "Signing out…" : "Sign Out"}
    </button>
  );
}
