"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createPostAction } from "@/features/content/actions";

export function CreatePostForm({ communityId, communitySlug }: { communityId: string, communitySlug: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await createPostAction({
      communityId,
      title: title.trim(),
      body: body.trim(),
    });

    if (!result.success) {
      setError(result.error ?? "Failed to create post");
      setLoading(false);
      return;
    }

    router.push(`/c/${communitySlug}/post/${result.data.id}`);
    router.refresh(); // Refresh to ensure feeds see the new post
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
        >
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="title"
          className="block text-sm font-medium text-slate-300 mb-1"
        >
          Post Title <span className="text-red-500">*</span>
        </label>
        <input
          id="title"
          type="text"
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="An interesting title"
        />
        <p className="mt-1 text-xs text-slate-400">
          Between 1 and 300 characters.
        </p>
      </div>

      <div>
        <label
          htmlFor="body"
          className="block text-sm font-medium text-slate-300 mb-1"
        >
          Post Body <span className="text-red-500">*</span>
        </label>
        <textarea
          id="body"
          required
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="What are your thoughts?"
        />
        <p className="mt-1 text-xs text-slate-400">
          Plain text only. Max 20,000 bytes.
        </p>
      </div>

      <div className="flex items-center justify-end gap-4 border-t border-slate-800 pt-6">
        <Link
          href={`/c/${communitySlug}`}
          className="text-sm font-medium text-slate-400 hover:text-slate-300"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={loading || !title.trim() || !body.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Posting..." : "Create Post"}
        </button>
      </div>
    </form>
  );
}
