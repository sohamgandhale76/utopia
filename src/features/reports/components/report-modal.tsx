"use client";

import { useState, useTransition } from "react";
import { submitReportAction } from "../actions";

interface ReportModalProps {
  targetType: "post" | "comment";
  targetId: string;
  isLoggedIn?: boolean;
  isMember?: boolean;
}

export function ReportModal({
  targetType,
  targetId,
  isLoggedIn = false,
  isMember = false,
}: ReportModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const canReport = isLoggedIn && isMember;

  const handleOpen = () => {
    if (!canReport) return;
    setError(null);
    setIsSuccess(false);
    setReason("");
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please provide a reason for the report");
      return;
    }

    setError(null);
    startTransition(async () => {
      const payload =
        targetType === "post"
          ? { postId: targetId, reason: reason.trim() }
          : { commentId: targetId, reason: reason.trim() };

      const res = await submitReportAction(payload);
      if (!res.success) {
        setError(res.error);
      } else {
        setIsSuccess(true);
        setTimeout(() => {
          setIsOpen(false);
        }, 1500);
      }
    });
  };

  if (!canReport) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-rose-400 transition-colors"
        title="Report to community moderators"
      >
        <span>🚩</span>
        <span>Report</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-white">
              Report {targetType === "post" ? "Post" : "Comment"}
            </h3>
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
              Your report reason is private and visible only to community moderators. It will never be publicly exposed.
            </p>

            {isSuccess ? (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-medium text-emerald-400">
                ✓ Report submitted to community moderators. Thank you.
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <div>
                  <label htmlFor="report-reason" className="block text-xs font-medium text-zinc-300">
                    Reason for report
                  </label>
                  <textarea
                    id="report-reason"
                    rows={4}
                    maxLength={500}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Describe how this violates community rules..."
                    className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    disabled={isPending}
                    required
                  />
                  <div className="mt-1 text-right text-[10px] text-zinc-500">
                    {reason.length}/500
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
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
                    className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    {isPending ? "Submitting..." : "Submit Report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
