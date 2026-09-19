"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, Send, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { buildCommentThreads } from "@/components/boks/comment-threads";
import type { Comment } from "@/components/boks/client-types";
import { shortTimeAgo } from "@/components/boks/client-format";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import {
  loadSupabaseComments,
  setSupabaseCommentLike,
} from "@/components/boks/supabase-browser-data";
import { haptic } from "@/components/boks/reader-haptics";

type ReplyTarget = {
  rootId: number;
  handle: string;
};

export function CommentsSheet({
  storyId,
  authorHandle,
  initialComments,
  hasSignedInAccount,
  viewerHandle,
  isSupabaseReader,
  onClose,
  onRequestAccount,
  onSubmit,
  onStatus,
}: {
  storyId: string;
  authorHandle: string;
  initialComments: Comment[];
  hasSignedInAccount: boolean;
  viewerHandle: string | null;
  isSupabaseReader: boolean;
  onClose: () => void;
  onRequestAccount: () => void;
  onSubmit: (body: string, parentCommentId: number | null) => Promise<Comment>;
  onStatus: (message: string) => void;
}) {
  const [comments, setComments] = useState(() =>
    initialComments.filter((comment) => comment.storyId === storyId)
  );
  const [loading, setLoading] = useState(isSupabaseReader);
  const [expanded, setExpanded] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [likingIds, setLikingIds] = useState<Set<number>>(new Set());
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let active = true;
    if (!isSupabaseReader) {
      return;
    }

    loadSupabaseComments(storyId)
      .then((next) => {
        if (active) setComments(next);
      })
      .catch((error) => {
        if (active) onStatus(error instanceof Error ? error.message : "Could not load comments.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isSupabaseReader, onStatus, storyId]);

  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const normalizedAuthorHandle = authorHandle.replace(/^@+/, "").toLowerCase();

  function beginReply(comment: Comment) {
    if (!hasSignedInAccount) {
      onRequestAccount();
      return;
    }

    const handle = (comment.visitorHandle || comment.visitorName || "reader").replace(/^@+/, "");
    const rootId = comment.parentCommentId ?? comment.id;
    setReplyTarget({ rootId, handle });
    setExpandedThreads((current) => new Set(current).add(rootId));
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function submit() {
    const body = commentText.trim();
    if (!body || submitting) return;
    if (!hasSignedInAccount) {
      onRequestAccount();
      return;
    }

    setSubmitting(true);
    try {
      const created = await onSubmit(body, replyTarget?.rootId ?? null);
      setComments((current) => [...current, created]);
      if (created.parentCommentId != null) {
        setExpandedThreads((current) => new Set(current).add(created.parentCommentId!));
      }
      setCommentText("");
      setReplyTarget(null);
      haptic("confirm");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Could not send comment.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleLike(comment: Comment) {
    if (!hasSignedInAccount) {
      onRequestAccount();
      return;
    }
    if (likingIds.has(comment.id)) return;
    if (!isSupabaseReader) {
      onStatus("Comment likes need the Supabase reader.");
      return;
    }

    const nextLiked = !comment.likedByMe;
    setLikingIds((current) => new Set(current).add(comment.id));
    setComments((current) =>
      current.map((item) =>
        item.id === comment.id
          ? {
              ...item,
              likedByMe: nextLiked,
              likesCount: Math.max(0, item.likesCount + (nextLiked ? 1 : -1)),
            }
          : item
      )
    );

    try {
      const saved = await setSupabaseCommentLike(comment.id, nextLiked);
      setComments((current) =>
        current.map((item) =>
          item.id === comment.id
            ? { ...item, likedByMe: saved.likedByMe, likesCount: saved.likesCount }
            : item
        )
      );
      if (saved.likedByMe) haptic("confirm");
    } catch (error) {
      setComments((current) =>
        current.map((item) => (item.id === comment.id ? comment : item))
      );
      onStatus(error instanceof Error ? error.message : "Could not update that like.");
    } finally {
      setLikingIds((current) => {
        const next = new Set(current);
        next.delete(comment.id);
        return next;
      });
    }
  }

  function renderComment(comment: Comment, isReply = false) {
    const handle = (comment.visitorHandle || comment.visitorName || "reader").replace(/^@+/, "");
    const isAuthor = Boolean(normalizedAuthorHandle) && handle.toLowerCase() === normalizedAuthorHandle;

    return (
      <article className={`comment-row${isReply ? " comment-row--reply" : ""}`}>
        <div className="comment-avatar" aria-hidden="true">
          {handle[0]?.toUpperCase() || <UserRound className="size-4" />}
        </div>
        <div className="comment-row__body">
          <div className="comment-meta">
            <span className="comment-handle">@{handle}</span>
            {isAuthor && <span className="comment-author-tag">author</span>}
            <time dateTime={comment.createdAt}>{shortTimeAgo(comment.createdAt)}</time>
          </div>
          <p className="comment-copy">{comment.body}</p>
          <button type="button" className="comment-reply" onClick={() => beginReply(comment)}>
            Reply
          </button>
        </div>
        <button
          type="button"
          className={`comment-like${comment.likedByMe ? " comment-like--active" : ""}`}
          onClick={() => void toggleLike(comment)}
          disabled={likingIds.has(comment.id)}
          aria-label={`${comment.likedByMe ? "Unlike" : "Like"} comment by @${handle}`}
          aria-pressed={comment.likedByMe}
        >
          <Heart className="size-5" fill={comment.likedByMe ? "currentColor" : "none"} />
          {comment.likesCount > 0 && <span>{comment.likesCount}</span>}
        </button>
      </article>
    );
  }

  return (
    <ReaderSheet
      label="Comments"
      onClose={onClose}
      expandable
      expanded={expanded}
      onExpandedChange={setExpanded}
      className="comments-sheet"
    >
      <ReaderSheetHeader
        label="Comments"
        onClose={onClose}
        title={`Comments${comments.length ? ` · ${comments.length}` : ""}`}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />

      <div className="comment-list" aria-busy={loading}>
        {loading ? (
          <div className="comment-empty" role="status">Loading comments…</div>
        ) : threads.length ? (
          <ol className="comment-threads">
            {threads.map(({ root, replies }) => {
              const showReplies = expandedThreads.has(root.id);
              return (
                <li key={root.id} className="comment-thread">
                  {renderComment(root)}
                  {replies.length > 0 && !showReplies && (
                    <button
                      type="button"
                      className="comment-replies-toggle"
                      onClick={() => setExpandedThreads((current) => new Set(current).add(root.id))}
                    >
                      <span aria-hidden="true" />
                      View {replies.length} {replies.length === 1 ? "reply" : "replies"}
                    </button>
                  )}
                  {showReplies && replies.map((reply) => <div key={reply.id}>{renderComment(reply, true)}</div>)}
                  {showReplies && replies.length > 0 && (
                    <button
                      type="button"
                      className="comment-replies-toggle comment-replies-toggle--hide"
                      onClick={() => setExpandedThreads((current) => {
                        const next = new Set(current);
                        next.delete(root.id);
                        return next;
                      })}
                    >
                      <span aria-hidden="true" /> Hide replies
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="comment-empty">
            <p>No comments yet</p>
            <span>Start the conversation about this boks.</span>
          </div>
        )}
      </div>

      <div className="comment-composer-shell">
        {replyTarget && hasSignedInAccount && (
          <div className="comment-replying">
            <span>Replying to @{replyTarget.handle}</span>
            <button type="button" onClick={() => setReplyTarget(null)} aria-label="Cancel reply">
              <X className="size-4" />
            </button>
          </div>
        )}
        {hasSignedInAccount ? (
          <div className="comment-composer">
            <div className="comment-avatar comment-avatar--viewer" aria-hidden="true">
              {viewerHandle?.replace(/^@+/, "")[0]?.toUpperCase() || <UserRound className="size-4" />}
            </div>
            <Textarea
              ref={composerRef}
              aria-label={replyTarget ? `Reply to @${replyTarget.handle}` : "Add a comment"}
              placeholder={replyTarget ? `Reply to @${replyTarget.handle}…` : "Add a comment…"}
              rows={1}
              maxLength={1200}
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <Button
              size="icon"
              onClick={() => void submit()}
              disabled={submitting || !commentText.trim()}
              aria-label={replyTarget ? "Send reply" : "Send comment"}
            >
              <Send className="size-4" />
            </Button>
          </div>
        ) : (
          <button type="button" className="comment-signup" onClick={onRequestAccount}>
            <span className="comment-avatar" aria-hidden="true"><UserRound className="size-4" /></span>
            <span><strong>Join the conversation</strong><small>Free account required to comment or like</small></span>
          </button>
        )}
      </div>
    </ReaderSheet>
  );
}
