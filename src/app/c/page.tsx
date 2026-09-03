import Link from "next/link";
import { listPublicCommunities } from "@/features/communities/service";
import { getCurrentUser } from "@/features/auth/session";

export const metadata = {
  title: "Communities | Insta-pro",
  description: "Explore open, pseudonymous communities on Insta-pro.",
};

export default async function CommunitiesDirectoryPage() {
  const [communities, user] = await Promise.all([
    listPublicCommunities(),
    getCurrentUser(),
  ]);

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-6 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href="/"
              className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ← Home
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              Directory
            </span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Communities
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Discover public, community-governed spaces. All content is deterministic and transparent.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-400 hidden sm:inline">
                Signed in as{" "}
                <span className="font-mono text-zinc-200">{user.username}</span>
              </span>
              <Link
                href="/c/create"
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                + Create Community
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                href="/login"
                className="text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/c/create"
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                + Create Community
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Community Grid */}
      {communities.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 mb-4">
            🏛️
          </div>
          <h2 className="text-lg font-semibold text-zinc-200">
            No communities yet
          </h2>
          <p className="mt-1 text-sm text-zinc-400 max-w-sm mx-auto">
            Be the pioneer. Start the very first pseudonymous community on Insta-pro.
          </p>
          <div className="mt-6">
            <Link
              href="/c/create"
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
            >
              Create the first community
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {communities.map((community) => (
            <Link
              key={community.id}
              href={`/c/${community.slug}`}
              className="group flex flex-col justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition-all duration-150 hover:border-zinc-700 hover:bg-zinc-800/40 hover:shadow-lg"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-zinc-100 group-hover:text-indigo-300 transition-colors">
                    {community.name}
                  </h2>
                  <span className="shrink-0 rounded-full border border-zinc-700/60 bg-zinc-800/80 px-2.5 py-0.5 text-xs font-medium text-zinc-300">
                    {community._count.memberships}{" "}
                    {community._count.memberships === 1 ? "member" : "members"}
                  </span>
                </div>

                <p className="mt-1 font-mono text-xs text-indigo-400/80">
                  /c/{community.slug}
                </p>

                <p className="mt-3 text-sm text-zinc-400 line-clamp-3 leading-relaxed">
                  {community.description}
                </p>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-zinc-800/60 pt-4 text-xs text-zinc-500">
                <span>
                  Created{" "}
                  {new Date(community.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <span className="font-medium text-indigo-400 group-hover:translate-x-0.5 transition-transform">
                  View →
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
