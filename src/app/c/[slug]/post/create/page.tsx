import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getPublicCommunity, getViewerMembership } from "@/features/communities/service";
import { getCurrentUser } from "@/features/auth/session";
import { CreatePostForm } from "@/features/content/components/create-post-form";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  try {
    const community = await getPublicCommunity(slug);
    return {
      title: `Create Post in ${community.name} | Insta-pro`,
    };
  } catch {
    return {
      title: "Community Not Found | Insta-pro",
    };
  }
}

export default async function CreatePostPage({ params }: PageProps) {
  const { slug } = await params;
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  let community;
  try {
    community = await getPublicCommunity(slug);
  } catch {
    notFound();
  }

  const membership = await getViewerMembership(community.id, user.id);
  if (!membership) {
    return (
      <main className="min-h-screen px-4 py-8 md:px-8 max-w-2xl mx-auto">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center shadow-sm">
          <h2 className="text-lg font-bold text-red-400 mb-2">Access Denied</h2>
          <p className="text-sm text-red-300 mb-4">
            You must be a member of this community to create posts.
          </p>
          <Link
            href={`/c/${community.slug}`}
            className="text-sm font-medium text-indigo-400 hover:text-indigo-300"
          >
            Return to c/{community.slug}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 max-w-2xl mx-auto">
      <nav className="flex items-center gap-2 text-xs text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-300 transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href={`/c/${community.slug}`} className="hover:text-zinc-300 transition-colors font-mono">
          c/{community.slug}
        </Link>
        <span>/</span>
        <span className="text-zinc-300">Create Post</span>
      </nav>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl backdrop-blur-sm">
        <h1 className="text-2xl font-bold tracking-tight text-white mb-6">
          Create a post in c/{community.slug}
        </h1>
        <CreatePostForm communityId={community.id} communitySlug={community.slug} />
      </div>
    </main>
  );
}
