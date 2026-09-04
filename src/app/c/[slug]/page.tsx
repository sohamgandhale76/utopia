import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicCommunity, getViewerMembership } from "@/features/communities/service";
import { getCommunityFeed } from "@/features/content/service";
import { getCurrentUser } from "@/features/auth/session";
import { MembershipButton } from "@/features/communities/components/membership-button";
import { PostFeed } from "@/features/content/components/post-feed";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  try {
    const community = await getPublicCommunity(slug);
    return {
      title: `${community.name} (/c/${community.slug}) | Utopia`,
      description: community.description,
    };
  } catch {
    return {
      title: "Community Not Found | Utopia",
    };
  }
}

export default async function CommunityDetailPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const resolvedSearchParams = await searchParams;

  let community;
  try {
    community = await getPublicCommunity(slug);
  } catch {
    notFound();
  }

  const user = await getCurrentUser();
  const viewerMembership = user
    ? await getViewerMembership(community.id, user.id)
    : null;

  const cursorStr = typeof resolvedSearchParams.cursor === "string" ? resolvedSearchParams.cursor : undefined;

  const feedData = await getCommunityFeed(slug, 50, cursorStr);

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 max-w-4xl mx-auto">
      {/* Navigation Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-300 transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href="/c" className="hover:text-zinc-300 transition-colors">
          Communities
        </Link>
        <span>/</span>
        <span className="font-mono text-indigo-400">c/{community.slug}</span>
      </nav>

      {/* Community Header Banner */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 md:p-8 shadow-xl backdrop-blur-sm mb-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">
                {community.name}
              </h1>
              <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-xs font-medium text-indigo-300">
                /c/{community.slug}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-4 text-xs text-zinc-400">
              <span className="inline-flex items-center gap-1 font-medium text-zinc-300">
                <span>👥</span>
                <span>
                  {community._count.memberships}{" "}
                  {community._count.memberships === 1 ? "member" : "members"}
                </span>
              </span>
              <span>•</span>
              <span>
                Created{" "}
                {new Date(community.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-zinc-300 max-w-2xl">
              {community.description}
            </p>
          </div>

          <div className="shrink-0 sm:self-start">
            <MembershipButton
              communityId={community.id}
              initialRole={viewerMembership?.role ?? null}
              isSignedIn={!!user}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content Area: Feed */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-zinc-100">Posts</h2>
            {viewerMembership && (
              <Link
                href={`/c/${community.slug}/post/create`}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
              >
                Create Post
              </Link>
            )}
          </div>
          
          {feedData && (
            <PostFeed
              posts={feedData.posts}
              communitySlug={community.slug}
              nextCursor={feedData.nextCursor}
            />
          )}
        </div>

        {/* Sidebar: Rules */}
        <div className="lg:col-span-1">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-sm sticky top-8">
            <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 mb-4">
              <span className="text-base">📜</span>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-200">
                Community Rules
              </h2>
            </div>
            <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-zinc-300">
              {community.rules}
            </div>

            {/* Moderation Transparency Log */}
            <div className="mt-6 pt-4 border-t border-zinc-800">
              <Link
                href={`/c/${community.slug}/modlog`}
                className="flex items-center justify-between text-xs text-zinc-400 hover:text-indigo-400 font-medium transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <span>🛡️</span>
                  <span>Moderation Transparency Log</span>
                </span>
                <span>→</span>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
