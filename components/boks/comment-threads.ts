import type { Comment } from "@/components/boks/client-types";

export type CommentThread = {
  root: Comment;
  replies: Comment[];
};

/**
 * Shapes the flat database result for the reader.
 *
 * New conversations lead the list, while replies read in conversational
 * order. An orphan is promoted to a root instead of disappearing if its
 * parent was removed between requests.
 */
export function buildCommentThreads(comments: readonly Comment[]): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const roots = comments.filter(
    (comment) => comment.parentCommentId == null || !byId.has(comment.parentCommentId)
  );

  return roots
    .sort(newestFirst)
    .map((root) => ({
      root,
      replies: comments
        .filter((comment) => comment.parentCommentId === root.id)
        .sort(oldestFirst),
    }));
}

function newestFirst(left: Comment, right: Comment) {
  return timestamp(right) - timestamp(left) || right.id - left.id;
}

function oldestFirst(left: Comment, right: Comment) {
  return timestamp(left) - timestamp(right) || left.id - right.id;
}

function timestamp(comment: Comment) {
  const value = Date.parse(comment.createdAt);
  return Number.isFinite(value) ? value : 0;
}

