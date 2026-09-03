"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createCommunityAction } from "@/features/communities/actions";

export function CreateCommunityForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");

  // Auto-slug generation helper if user hasn't typed a custom slug yet
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  function handleNameChange(val: string) {
    setName(val);
    if (!slugManuallyEdited) {
      const generated = val
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
      setSlug(generated);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await createCommunityAction({
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      description: description.trim(),
      rules: rules.trim(),
    });

    if (result.success && result.data) {
      router.push(`/c/${result.data.slug}`);
    } else {
      setError(result.error ?? "Failed to create community");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300"
        >
          <p className="font-semibold">Creation Error</p>
          <p className="mt-0.5 text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Name */}
      <div>
        <label
          htmlFor="community-name"
          className="block text-sm font-medium text-zinc-200"
        >
          Community Name
        </label>
        <p className="mt-0.5 text-xs text-zinc-500">
          3 to 80 characters. Public display title.
        </p>
        <input
          id="community-name"
          name="name"
          type="text"
          required
          minLength={3}
          maxLength={80}
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="e.g. Technology & Ethics"
          className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Slug */}
      <div>
        <label
          htmlFor="community-slug"
          className="block text-sm font-medium text-zinc-200"
        >
          URL Slug
        </label>
        <p className="mt-0.5 text-xs text-zinc-500">
          3 to 48 lowercase characters, digits, and hyphens. Cannot start or end with a hyphen.
        </p>
        <div className="mt-1.5 flex rounded-lg border border-zinc-700 bg-zinc-900/80 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
          <span className="flex items-center pl-3.5 pr-1 text-xs font-mono text-zinc-500 select-none">
            /c/
          </span>
          <input
            id="community-slug"
            name="slug"
            type="text"
            required
            minLength={3}
            maxLength={48}
            value={slug}
            onChange={(e) => {
              setSlugManuallyEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
            placeholder="tech-ethics"
            className="w-full bg-transparent px-2 py-2.5 text-sm font-mono text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </div>
      </div>

      {/* Description */}
      <div>
        <label
          htmlFor="community-description"
          className="block text-sm font-medium text-zinc-200"
        >
          Description
        </label>
        <p className="mt-0.5 text-xs text-zinc-500">
          1 to 500 characters. A concise summary shown in directory and headers.
        </p>
        <textarea
          id="community-description"
          name="description"
          required
          minLength={1}
          maxLength={500}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is this community about? What topics belong here?"
          className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <div className="mt-1 text-right text-xs text-zinc-600">
          {description.length}/500
        </div>
      </div>

      {/* Rules */}
      <div>
        <label
          htmlFor="community-rules"
          className="block text-sm font-medium text-zinc-200"
        >
          Community Rules
        </label>
        <p className="mt-0.5 text-xs text-zinc-500">
          1 to 5000 plain-text characters. Enforced deterministically by community moderators.
        </p>
        <textarea
          id="community-rules"
          name="rules"
          required
          minLength={1}
          maxLength={5000}
          rows={6}
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          placeholder={"1. Be respectful and substantiate claims.\n2. No spam or commercial solicitation.\n3. Stay on topic."}
          className="mt-1.5 w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3.5 py-2.5 text-sm font-mono text-zinc-100 placeholder-zinc-500 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <div className="mt-1 text-right text-xs text-zinc-600">
          {rules.length}/5000
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
        <Link
          href="/c"
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? "Creating Community…" : "Create Community"}
        </button>
      </div>
    </form>
  );
}
