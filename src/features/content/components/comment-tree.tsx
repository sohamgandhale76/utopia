"use client";

import { useState } from "react";
import { PublicComment } from "@/features/content/service";
import { formatDistanceToNow } from "date-fns";
import { CreateCommentForm } from "./create-comment-form";
import { VoteControls } from "@/features/votes/components/vote-controls";
import { ReportModal } from "@/features/reports/components/report-modal";
import { ModeratorControls } from "@/features/moderation/components/moderator-controls";

// Helper to build a tree from flat comments
export function buildCommentTree(comments: PublicComment[]): CommentNode[] {
  const commentMap = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];

  comments.forEach((c) => {
    commentMap.set(c.id, { ...c, children: [] });
  });

  comments.forEach((c) => {
    const node = commentMap.get(c.id)!;
    if (c.parentId) {
      const parent = commentMap.get(c.parentId);
      if (parent) {
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return roots;
}

export type CommentNode = PublicComment & {
  children: CommentNode[];
};

export function CommentTree({
  comments,
  postId,
  canComment,
  communityId,
  isLoggedIn = false,
  isMember = false,
  isModeratorOrOwner = false,
}: {
  comments: PublicComment[];
  postId: string;
  canComment: boolean;
  communityId?: string;
  isLoggedIn?: boolean;
  isMember?: boolean;
  isModeratorOrOwner?: boolean;
}) {
  const tree = buildCommentTree(comments);

  if (comments.length === 0) {
    return <div className="text-slate-400">No comments yet.</div>;
  }

  return (
    <div className="space-y-6">
      {tree.map((node) => (
        <CommentItem
          key={node.id}
          node={node}
          postId={postId}
          canComment={canComment}
          depth={1}
          communityId={communityId}
          isLoggedIn={isLoggedIn}
          isMember={isMember}
          isModeratorOrOwner={isModeratorOrOwner}
        />
      ))}
    </div>
  );
}

function CommentItem({
  node,
  postId,
  canComment,
  depth,
  communityId,
  isLoggedIn = false,
  isMember = false,
  isModeratorOrOwner = false,
}: {
  node: CommentNode;
  postId: string;
  canComment: boolean;
  depth: number;
  communityId?: string;
  isLoggedIn?: boolean;
  isMember?: boolean;
  isModeratorOrOwner?: boolean;
}) {
  const [showReplyForm, setShowReplyForm] = useState(false);
  const maxDepthReached = depth >= 5;

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg border border-slate-800 bg-slate-900/30 p-4">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
          <span className="font-medium text-slate-300">
            u/{node.author.username}
          </span>
          <span>•</span>
          <time dateTime={node.createdAt.toISOString()}>
            {formatDistanceToNow(node.createdAt, { addSuffix: true })}
          </time>
        </div>
        <div className="text-sm text-slate-200 whitespace-pre-wrap mb-3">
          {node.body}
        </div>

        <div className="flex flex-wrap items-center gap-4 mt-3 pt-2 border-t border-slate-800/60">
          <VoteControls
            targetType="comment"
            targetId={node.id}
            initialScore={0}
            isMember={isMember}
            isLoggedIn={isLoggedIn}
            orientation="horizontal"
          />

          {canComment && !maxDepthReached && (
            <button
              onClick={() => setShowReplyForm(!showReplyForm)}
              className="text-xs font-medium text-slate-400 hover:text-slate-200"
            >
              {showReplyForm ? "Cancel" : "Reply"}
            </button>
          )}

          <ReportModal
            targetType="comment"
            targetId={node.id}
            isLoggedIn={isLoggedIn}
            isMember={isMember}
          />

          {communityId && (
            <ModeratorControls
              communityId={communityId}
              targetType="comment"
              targetId={node.id}
              authorId={node.authorId}
              authorUsername={node.author.username}
              isModeratorOrOwner={isModeratorOrOwner}
            />
          )}
        </div>

        {showReplyForm && (
          <div className="mt-3">
            <CreateCommentForm
              postId={postId}
              parentId={node.id}
              onSuccess={() => setShowReplyForm(false)}
            />
          </div>
        )}
      </div>

      {node.children.length > 0 && (
        <div className="ml-4 md:ml-8 pl-4 border-l border-slate-800 space-y-4 mt-2">
          {node.children.map((child) => (
            <CommentItem
              key={child.id}
              node={child}
              postId={postId}
              canComment={canComment}
              depth={depth + 1}
              communityId={communityId}
              isLoggedIn={isLoggedIn}
              isMember={isMember}
              isModeratorOrOwner={isModeratorOrOwner}
            />
          ))}
        </div>
      )}
    </div>
  );
}
