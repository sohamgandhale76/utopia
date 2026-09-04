import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { PublicProfilePost } from "../service";

interface ProfilePostListProps {
  posts: PublicProfilePost[];
  username: string;
  nextCursor?: string;
  currentCursor?: string;
}

export function ProfilePostList({
  posts,
  username,
  nextCursor,
  currentCursor,
}: ProfilePostListProps) {
  if (posts.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 mb-3 text-lg">
          📝
        </div>
        <h3 className="text-sm font-semibold text-zinc-300">
          No public posts yet
        </h3>
        <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
          When u/{username} publishes public posts, they will appear here.
        </p>
        {currentCursor && (
          <div className="mt-4">
            <Link
              href={`/u/${username}?tab=posts`}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              ← Back to first page
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => {
        const postDate = new Date(post.createdAt);
        const timeAgo = formatDistanceToNow(postDate, { addSuffix: true });

        return (
          <article
            key={post.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-zinc-700/80 hover:bg-zinc-900/60"
          >
            <div className="flex items-center gap-2 text-xs text-zinc-400 mb-2">
              <Link
                href={`/c/${post.community.slug}`}
                className="font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                c/{post.community.name}
              </Link>
              <span className="text-zinc-600">•</span>
              <span title={postDate.toISOString()}>{timeAgo}</span>
            </div>

            <h2 className="text-lg font-semibold text-zinc-100 hover:text-white transition-colors">
              <Link href={`/c/${post.community.slug}/post/${post.id}`}>
                {post.title}
              </Link>
            </h2>

            <p className="mt-2 text-sm text-zinc-300/90 line-clamp-3 leading-relaxed whitespace-pre-wrap">
              {post.body}
            </p>

            <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
              <Link
                href={`/c/${post.community.slug}/post/${post.id}`}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                View Discussion →
              </Link>
            </div>
          </article>
        );
      })}

      {/* Pagination Controls */}
      <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80">
        {currentCursor ? (
          <Link
            href={`/u/${username}?tab=posts`}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ← First Page
          </Link>
        ) : (
          <div />
        )}

        {nextCursor && (
          <Link
            href={`/u/${username}?tab=posts&cursor=${nextCursor}`}
            className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors ml-auto"
          >
            Next Page →
          </Link>
        )}
      </div>
    </div>
  );
}
