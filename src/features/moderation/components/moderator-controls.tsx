"use client";

import { useState, useTransition } from "react";
import { SanctionType } from "@prisma/client";
import { removePostAction, removeCommentAction } from "../actions";
import { issueSanctionAction } from "@/features/sanctions/actions";
import { useRouter } from "next/navigation";

interface ModeratorControlsProps {
  communityId: string;
  targetType: "post" | "comment";
  targetId: string;
  authorId?: string;
  authorUsername?: string;
  isModeratorOrOwner: boolean;
}

export function ModeratorControls({
  communityId,
  targetType,
  targetId,
  authorId,
  authorUsername,
  isModeratorOrOwner,
}: ModeratorControlsProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"remove" | "sanction">("remove");
  const [reason, setReason] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [sanctionType, setSanctionType] = useState<SanctionType>(SanctionType.MUTE);
  const [durationHours, setDurationHours] = useState<string>("24");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isModeratorOrOwner) {
    return null;
  }

  const handleOpen = () => {
    setError(null);
    setReason("");
    setInternalNote("");
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setError(null);
  };

  const handleAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Public explanation is required");
      return;
    }

    setError(null);

    startTransition(async () => {
      if (mode === "remove") {
        const payload =
          targetType === "post"
            ? { postId: targetId, reason: reason.trim(), internalNote: internalNote.trim() || undefined }
            : { commentId: targetId, reason: reason.trim(), internalNote: internalNote.trim() || undefined };

        const res =
          targetType === "post"
            ? await removePostAction(payload)
            : await removeCommentAction(payload);

        if (!res.success) {
          setError(res.error);
        } else {
          setIsOpen(false);
          router.refresh();
        }
      } else {
        if (!authorId) {
          setError("Author ID is missing");
          return;
        }

        const duration = durationHours === "perm" ? undefined : parseInt(durationHours, 10);

        const res = await issueSanctionAction({
          communityId,
          targetUserId: authorId,
          sanctionType,
          durationHours: duration,
          reason: reason.trim(),
          internalNote: internalNote.trim() || undefined,
        });

        if (!res.success) {
          setError(res.error);
        } else {
          setIsOpen(false);
          router.refresh();
        }
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
        title="Moderator tools"
      >
        <span>🛡️</span>
        <span>Moderate</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-white">
                Community Moderation Action
              </h3>
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setMode("remove")}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    mode === "remove"
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  Remove Content
                </button>
                {authorId && (
                  <button
                    type="button"
                    onClick={() => setMode("sanction")}
                    className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                      mode === "sanction"
                        ? "bg-zinc-800 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Sanction Author
                  </button>
                )}
              </div>
            </div>

            <form onSubmit={handleAction} className="mt-4 space-y-4">
              {mode === "remove" ? (
                <p className="text-xs text-zinc-400">
                  Soft-delete this {targetType}. The removal will be audited and logged to the community transparency log.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-zinc-400">
                    Issue a sanction against user <span className="font-mono text-indigo-300">@{authorUsername ?? authorId}</span>.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400">
                        Sanction Type
                      </label>
                      <select
                        value={sanctionType}
                        onChange={(e) => setSanctionType(e.target.value as SanctionType)}
                        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-200"
                      >
                        <option value={SanctionType.MUTE}>Mute (No post/comment/vote)</option>
                        <option value={SanctionType.BAN}>Ban (Complete community exclusion)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400">
                        Duration
                      </label>
                      <select
                        value={durationHours}
                        onChange={(e) => setDurationHours(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-xs text-zinc-200"
                      >
                        <option value="24">24 Hours</option>
                        <option value="72">3 Days</option>
                        <option value="168">7 Days</option>
                        <option value="720">30 Days</option>
                        <option value="perm">Permanent</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-300">
                  Public Explanation <span className="text-zinc-500">(Visible in /modlog)</span>
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Explain why this action was taken (e.g. Violates Rule 1: Spam)..."
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  required
                  disabled={isPending}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300">
                  Internal Note <span className="text-zinc-500">(Private to moderators only)</span>
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                  placeholder="Optional notes for other moderators..."
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-2.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  disabled={isPending}
                />
              </div>

              {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isPending}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:border-zinc-700 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || !reason.trim()}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {isPending
                    ? "Applying..."
                    : mode === "remove"
                    ? `Remove ${targetType}`
                    : `Issue ${sanctionType}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
