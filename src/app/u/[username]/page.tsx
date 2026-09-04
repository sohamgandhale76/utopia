import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getPublicProfile,
  getUserPublicPosts,
  getUserPublicComments,
} from "@/features/profiles/service";
import { profileTabSchema } from "@/features/profiles/validation";
import { ProfileHeader } from "@/features/profiles/components/profile-header";
import { ProfilePostList } from "@/features/profiles/components/profile-post-list";
import { ProfileCommentList } from "@/features/profiles/components/profile-comment-list";

interface PageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { username } = await params;
  try {
    const profile = await getPublicProfile(username);
    if (!profile) {
      return {
        title: "User Not Found | Utopia",
      };
    }

    return {
      title: `u/${profile.username} | Utopia`,
      description: `Pseudonymous profile of u/${profile.username} on Utopia.`,
    };
  } catch {
    return {
      title: "User Not Found | Utopia",
    };
  }
}

export default async function UserProfilePage({
  params,
  searchParams,
}: PageProps) {
  const { username } = await params;
  const resolvedSearchParams = await searchParams;

  const rawTab = typeof resolvedSearchParams.tab === "string" ? resolvedSearchParams.tab : undefined;
  const rawCursor = typeof resolvedSearchParams.cursor === "string" ? resolvedSearchParams.cursor : undefined;

  const activeTab = profileTabSchema.parse(rawTab);

  // 1. Fetch public profile (strictly { username, createdAt }).
  // Suspended users return null, matching nonexistent profiles identically.
  const profile = await getPublicProfile(username);
  if (!profile) {
    notFound();
  }

  // 2. Fetch public history based on active tab
  let postsResult = null;
  let commentsResult = null;

  if (activeTab === "posts") {
    postsResult = await getUserPublicPosts(username, 20, rawCursor);
  } else {
    commentsResult = await getUserPublicComments(username, 20, rawCursor);
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 max-w-4xl mx-auto">
      {/* Breadcrumb Navigation */}
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/"
          className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← Home
        </Link>
        <span className="text-zinc-600">/</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
          Profile
        </span>
      </div>

      {/* Header */}
      <ProfileHeader
        username={profile.username}
        createdAt={profile.createdAt}
        activeTab={activeTab}
      />

      {/* Content based on tab */}
      {activeTab === "posts" ? (
        <ProfilePostList
          posts={postsResult?.posts ?? []}
          username={profile.username}
          nextCursor={postsResult?.nextCursor}
          currentCursor={rawCursor}
        />
      ) : (
        <ProfileCommentList
          comments={commentsResult?.comments ?? []}
          username={profile.username}
          nextCursor={commentsResult?.nextCursor}
          currentCursor={rawCursor}
        />
      )}
    </main>
  );
}
