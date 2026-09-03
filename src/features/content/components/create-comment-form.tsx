"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCommentAction } from "@/features/content/actions";

export function CreateCommentForm({ postId, parentId, onSuccess }: { postId: string, parentId?: string, onSuccess?: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await createCommentAction({
      postId,
      parentId,
      body: body.trim(),
    });

    if (!result.success) {
      setError(result.error ?? "Failed to create comment");
      setLoading(false);
      return;
    }

    setBody("");
    router.refresh();
    if (onSuccess) {
      onSuccess();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      <div>
        <label htmlFor={`comment-body-${parentId ?? 'root'}`} className="sr-only">
          Comment Body
        </label>
        <textarea
          id={`comment-body-${parentId ?? 'root'}`}
          required
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="What are your thoughts?"
        />
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={loading || !body.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Posting..." : (parentId ? "Reply" : "Comment")}
        </button>
      </div>
    </form>
  );
}
