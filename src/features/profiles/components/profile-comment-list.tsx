import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { PublicProfileComment } from "../service";

interface ProfileCommentListProps {
  comments: PublicProfileComment[];
  username: string;
  nextCursor?: string;
  currentCursor?: string;
}

export function ProfileCommentList({
  comments,
  username,
  nextCursor,
  currentCursor,
}: ProfileCommentListProps) {
  if (comments.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 mb-3 text-lg">
          💬
        </div>
        <h3 className="text-sm font-semibold text-zinc-300">
          No public comments yet
        </h3>
        <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto">
          When u/{username} replies in discussions, public comments will appear here.
        </p>
        {currentCursor && (
          <div className="mt-4">
            <Link
              href={`/u/${username}?tab=comments`}
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
      {comments.map((comment) => {
        const commentDate = new Date(comment.createdAt);
        const timeAgo = formatDistanceToNow(commentDate, { addSuffix: true });

        return (
          <article
            key={comment.id}
            className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-zinc-700/80 hover:bg-zinc-900/60"
          >
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-400 mb-3">
              <span>Commented on</span>
              <Link
                href={`/c/${comment.post.community.slug}/post/${comment.postId}`}
                className="font-medium text-zinc-200 hover:text-indigo-400 transition-colors underline-offset-2 hover:underline line-clamp-1 max-w-md"
              >
                &ldquo;{comment.post.title}&rdquo;
              </Link>
              <span>in</span>
              <Link
                href={`/c/${comment.post.community.slug}`}
                className="font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                c/{comment.post.community.name}
              </Link>
              <span className="text-zinc-600">•</span>
              <span title={commentDate.toISOString()}>{timeAgo}</span>
            </div>

            <div className="border-l-2 border-zinc-700/60 pl-3 py-0.5 text-sm text-zinc-300/90 whitespace-pre-wrap leading-relaxed">
              {comment.body}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3">
              <Link
                href={`/c/${comment.post.community.slug}/post/${comment.postId}`}
                className="text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                View in Post Context →
              </Link>
            </div>
          </article>
        );
      })}

      {/* Pagination Controls */}
      <div className="flex items-center justify-between pt-4 border-t border-zinc-800/80">
        {currentCursor ? (
          <Link
            href={`/u/${username}?tab=comments`}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            ← First Page
          </Link>
        ) : (
          <div />
        )}

        {nextCursor && (
          <Link
            href={`/u/${username}?tab=comments&cursor=${nextCursor}`}
            className="inline-flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/60 px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors ml-auto"
          >
            Next Page →
          </Link>
        )}
      </div>
    </div>
  );
}
