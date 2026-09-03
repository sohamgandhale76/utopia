import Link from "next/link";
import { PublicPost } from "@/features/content/service";
import { formatDistanceToNow } from "date-fns";

export function PostFeed({
  posts,
  communitySlug,
  nextCursor,
}: {
  posts: PublicPost[];
  communitySlug: string;
  nextCursor?: string;
}) {
  if (posts.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-400">
        No posts yet. Be the first to start a discussion!
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <article
          key={post.id}
          className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 transition-colors hover:bg-slate-900"
        >
          <Link href={`/c/${communitySlug}/post/${post.id}`} className="block">
            <h3 className="text-lg font-semibold text-slate-100 mb-2">
              {post.title}
            </h3>
            <div className="text-sm text-slate-400 mb-3 line-clamp-3">
              {post.body}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-300">
                u/{post.author.username}
              </span>
              <span>•</span>
              <time dateTime={post.createdAt.toISOString()}>
                {formatDistanceToNow(post.createdAt, { addSuffix: true })}
              </time>
            </div>
          </Link>
        </article>
      ))}

      {nextCursor && (
        <div className="pt-4 text-center">
          <Link
            href={`/c/${communitySlug}?cursor=${nextCursor}`}
            className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
          >
            Load More
          </Link>
        </div>
      )}
    </div>
  );
}
