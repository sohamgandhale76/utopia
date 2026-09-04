import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicCommunity, getViewerMembership } from "@/features/communities/service";
import { getPostDetails } from "@/features/content/service";
import { getPostScore, getUserPostVote } from "@/features/votes/service";
import { getCurrentUser } from "@/features/auth/session";
import { formatDistanceToNow } from "date-fns";
import { CommentTree } from "@/features/content/components/comment-tree";
import { CreateCommentForm } from "@/features/content/components/create-comment-form";
import { VoteControls } from "@/features/votes/components/vote-controls";
import { ReportModal } from "@/features/reports/components/report-modal";
import { ModeratorControls } from "@/features/moderation/components/moderator-controls";

interface PageProps {
  params: Promise<{ slug: string; postId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug, postId } = await params;
  try {
    const post = await getPostDetails(postId);
    if (!post) throw new Error("Not found");
    const community = await getPublicCommunity(slug);
    
    return {
      title: `${post.title} - ${community.name} | Utopia`,
      description: post.body.slice(0, 150),
    };
  } catch {
    return {
      title: "Post Not Found | Utopia",
    };
  }
}

export default async function PostDetailPage({ params }: PageProps) {
  const { slug, postId } = await params;

  let community;
  let post;
  try {
    community = await getPublicCommunity(slug);
    post = await getPostDetails(postId);
    if (!post || post.communityId !== community.id) {
      notFound();
    }
  } catch {
    notFound();
  }

  const user = await getCurrentUser();
  const viewerMembership = user
    ? await getViewerMembership(community.id, user.id)
    : null;
  const canComment = !!viewerMembership;
  const isMember = !!viewerMembership;
  const isModeratorOrOwner =
    viewerMembership?.role === "MODERATOR" || viewerMembership?.role === "OWNER";

  const [postScore, userVote] = await Promise.all([
    getPostScore(post.id),
    user ? getUserPostVote(post.id, user.id) : Promise.resolve(null),
  ]);

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 max-w-4xl mx-auto">
      {/* Navigation Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-300 transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href={`/c/${community.slug}`} className="hover:text-zinc-300 transition-colors font-mono">
          c/{community.slug}
        </Link>
        <span>/</span>
        <span className="text-zinc-300 truncate max-w-[200px]">
          {post.title}
        </span>
      </nav>

      {/* Post Content with Voting & Mod Controls */}
      <article className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 md:p-8 shadow-xl backdrop-blur-sm mb-8">
        <div className="flex gap-4 items-start">
          {/* Vertical Vote Controls */}
          <div className="pt-1">
            <VoteControls
              targetType="post"
              targetId={post.id}
              initialScore={postScore}
              initialUserVote={userVote}
              isMember={isMember}
              isLoggedIn={!!user}
              orientation="vertical"
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">
                  u/{post.author.username}
                </span>
                <span>•</span>
                <time dateTime={post.createdAt.toISOString()}>
                  {formatDistanceToNow(post.createdAt, { addSuffix: true })}
                </time>
              </div>

              {/* Action Controls: Report & Moderator Tools */}
              <div className="flex items-center gap-3">
                <ReportModal
                  targetType="post"
                  targetId={post.id}
                  isLoggedIn={!!user}
                  isMember={isMember}
                />
                <ModeratorControls
                  communityId={community.id}
                  targetType="post"
                  targetId={post.id}
                  authorId={post.authorId}
                  authorUsername={post.author.username}
                  isModeratorOrOwner={isModeratorOrOwner}
                />
              </div>
            </div>
            
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-6">
              {post.title}
            </h1>
            
            <div className="whitespace-pre-wrap font-sans text-base leading-relaxed text-zinc-200">
              {post.body}
            </div>
          </div>
        </div>
      </article>

      {/* Comments Section */}
      <section className="space-y-8">
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-4">
          <h2 className="text-xl font-bold text-zinc-100">Comments</h2>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
            {post.comments.length}
          </span>
        </div>

        {/* Root Comment Form */}
        {canComment ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 shadow-sm">
            <h3 className="text-sm font-medium text-zinc-300 mb-4">Add a comment</h3>
            <CreateCommentForm postId={post.id} />
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/20 p-4 text-center text-sm text-zinc-500">
            {user ? (
              <p>You must join <Link href={`/c/${community.slug}`} className="text-indigo-400 hover:underline">c/{community.slug}</Link> to comment.</p>
            ) : (
              <p>Please <Link href="/login" className="text-indigo-400 hover:underline">sign in</Link> and join to participate.</p>
            )}
          </div>
        )}

        {/* Comment Tree */}
        <div className="pt-4">
          <CommentTree 
            comments={post.comments} 
            postId={post.id} 
            canComment={canComment}
            communityId={community.id}
            isLoggedIn={!!user}
            isMember={isMember}
            isModeratorOrOwner={isModeratorOrOwner}
          />
        </div>
      </section>
    </main>
  );
}
