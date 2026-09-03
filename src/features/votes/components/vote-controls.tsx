"use client";

import { useState, useTransition } from "react";
import { VoteType } from "@prisma/client";
import { castPostVoteAction, castCommentVoteAction } from "../actions";

interface VoteControlsProps {
  targetType: "post" | "comment";
  targetId: string;
  initialScore: number;
  initialUserVote?: VoteType | null;
  isMember?: boolean;
  isLoggedIn?: boolean;
  orientation?: "vertical" | "horizontal";
}

export function VoteControls({
  targetType,
  targetId,
  initialScore,
  initialUserVote = null,
  isMember = false,
  isLoggedIn = false,
  orientation = "vertical",
}: VoteControlsProps) {
  const [currentVote, setCurrentVote] = useState<VoteType | null>(initialUserVote);
  const [score, setScore] = useState<number>(initialScore);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canVote = isLoggedIn && isMember;

  const handleVote = (type: VoteType) => {
    if (!isLoggedIn) {
      setErrorMessage("Sign in to vote");
      return;
    }
    if (!isMember) {
      setErrorMessage("Join community to vote");
      return;
    }

    setErrorMessage(null);

    // Optimistic calculation
    const previousVote = currentVote;
    const previousScore = score;

    let optimisticVote: VoteType | null = type;
    let delta = 0;

    if (previousVote === type) {
      // Toggle off
      optimisticVote = null;
      delta = type === VoteType.UP ? -1 : 1;
    } else if (previousVote === null) {
      // No vote to new vote
      delta = type === VoteType.UP ? 1 : -1;
    } else {
      // UP to DOWN or DOWN to UP
      delta = type === VoteType.UP ? 2 : -2;
    }

    setCurrentVote(optimisticVote);
    setScore(previousScore + delta);

    startTransition(async () => {
      const action =
        targetType === "post"
          ? castPostVoteAction({ postId: targetId, type })
          : castCommentVoteAction({ commentId: targetId, type });

      const res = await action;

      if (!res.success) {
        // Revert on failure
        setCurrentVote(previousVote);
        setScore(previousScore);
        setErrorMessage(res.error);
      } else {
        setCurrentVote(res.data.currentVote);
        setScore(res.data.score);
      }
    });
  };

  const isVertical = orientation === "vertical";

  return (
    <div
      className={`flex items-center ${
        isVertical ? "flex-col gap-1" : "flex-row gap-2"
      }`}
    >
      <button
        type="button"
        disabled={isPending}
        onClick={() => handleVote(VoteType.UP)}
        aria-label="Upvote"
        title={!canVote ? (isLoggedIn ? "Join community to vote" : "Sign in to vote") : "Upvote"}
        className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-semibold transition-all ${
          currentVote === VoteType.UP
            ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-400 font-bold"
            : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
        } ${!canVote ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        ▲
      </button>

      <span
        className={`font-mono text-xs font-semibold px-1 text-center min-w-[2rem] ${
          score > 0
            ? "text-emerald-400"
            : score < 0
            ? "text-rose-400"
            : "text-zinc-400"
        }`}
      >
        {score}
      </span>

      <button
        type="button"
        disabled={isPending}
        onClick={() => handleVote(VoteType.DOWN)}
        aria-label="Downvote"
        title={!canVote ? (isLoggedIn ? "Join community to vote" : "Sign in to vote") : "Downvote"}
        className={`flex h-8 w-8 items-center justify-center rounded-md border text-xs font-semibold transition-all ${
          currentVote === VoteType.DOWN
            ? "border-rose-500/50 bg-rose-500/20 text-rose-400 font-bold"
            : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
        } ${!canVote ? "opacity-60 cursor-not-allowed" : ""}`}
      >
        ▼
      </button>

      {errorMessage && (
        <span className="text-[10px] text-rose-400 max-w-[120px] text-center leading-tight">
          {errorMessage}
        </span>
      )}
    </div>
  );
}
