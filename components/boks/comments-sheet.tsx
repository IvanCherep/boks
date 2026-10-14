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
  deleteSupabaseComment,
  loadSupabaseComments,
  setSupabaseCommentLike,
} from "@/components/boks/supabase-browser-data";
import { haptic } from "@/components/boks/reader-haptics";
import { bareHandle } from "@/components/boks/reader/handles";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { localizeBoksMessage } from "@/lib/boks/errors";
import { defineMessages, plural } from "@/lib/i18n/messages";

/** Comments themselves are the readers' words and are never translated. */
const messages = defineMessages(
  {
    sendFailed: "Could not send comment.",
    likesNeedSupabase: "Comment likes need the Supabase reader.",
    likeFailed: "Could not update that like.",
    deletedWithReplies: "Comment and its replies deleted.",
    deleted: "Comment deleted.",
    deleteFailed: "Could not delete the comment.",
    author: "author",
    confirmDeleteGroup: "Confirm deleting this comment",
    confirmDelete: (replies: number) =>
      replies ? `Delete this comment and its ${replies === 1 ? "reply" : `${replies} replies`}?` : "Delete this comment?",
    deleting: "Deleting…",
    delete: "Delete",
    cancel: "Cancel",
    reply: "Reply",
    likeLabel: (liked: boolean, handle: string) => `${liked ? "Unlike" : "Like"} comment by @${handle}`,
    comments: "Comments",
    loading: "Loading comments…",
    viewReplies: (count: number) => `View ${count} ${count === 1 ? "reply" : "replies"}`,
    hideReplies: "Hide replies",
    loadFailed: "Could not load the comments",
    tryAgain: "Try again",
    empty: "No comments yet",
    emptyHint: "Start the conversation about this bok.",
    replyingTo: (handle: string) => `Replying to @${handle}`,
    cancelReply: "Cancel reply",
    replyTo: (handle: string) => `Reply to @${handle}`,
    addComment: "Add a comment",
    sendReply: "Send reply",
    sendComment: "Send comment",
    join: "Join the conversation",
    joinHint: "Free account required to comment or like",
  },
  {
    ru: {
      sendFailed: "Не удалось отправить комментарий.",
      likesNeedSupabase: "Лайки комментариев работают только в Supabase-ридере.",
      likeFailed: "Не удалось обновить лайк.",
      deletedWithReplies: "Комментарий и ответы на него удалены.",
      deleted: "Комментарий удалён.",
      deleteFailed: "Не удалось удалить комментарий.",
      author: "автор",
      confirmDeleteGroup: "Подтвердите удаление комментария",
      confirmDelete: (replies: number) =>
        replies
          ? `Удалить комментарий и ${
              replies === 1
                ? "ответ на него"
                : `${replies} ${plural("ru", replies, { one: "ответ", few: "ответа", many: "ответов", other: "ответа" })}`
            }?`
          : "Удалить комментарий?",
      deleting: "Удаляем…",
      delete: "Удалить",
      cancel: "Отмена",
      reply: "Ответить",
      likeLabel: (liked: boolean, handle: string) =>
        `${liked ? "Убрать лайк с комментария" : "Лайкнуть комментарий"} @${handle}`,
      comments: "Комментарии",
      loading: "Загружаем комментарии…",
      viewReplies: (count: number) =>
        `Показать ${count} ${plural("ru", count, { one: "ответ", few: "ответа", many: "ответов", other: "ответа" })}`,
      hideReplies: "Скрыть ответы",
      loadFailed: "Не удалось загрузить комментарии",
      tryAgain: "Попробовать ещё раз",
      empty: "Комментариев пока нет",
      emptyHint: "Начните обсуждение этого текста.",
      replyingTo: (handle: string) => `Ответ @${handle}`,
      cancelReply: "Отменить ответ",
      replyTo: (handle: string) => `Ответить @${handle}`,
      addComment: "Добавить комментарий",
      sendReply: "Отправить ответ",
      sendComment: "Отправить комментарий",
      join: "Присоединяйтесь к обсуждению",
      joinHint: "Чтобы комментировать и лайкать, нужен бесплатный аккаунт",
    },
  }
);

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
  canModerate = false,
  onDeleted,
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
  /** An admin, who may delete anyone's comment. Everyone may delete their own. */
  canModerate?: boolean;
  /** How many comments went, the comment and its replies, for the rail's count. */
  onDeleted?: (removed: number) => void;
}) {
  const [comments, setComments] = useState(() =>
    initialComments.filter((comment) => comment.storyId === storyId)
  );
  const [loading, setLoading] = useState(isSupabaseReader);
  // Not the same as no comments: a failed load used to say "No comments yet".
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Set<number>>(new Set());
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [likingIds, setLikingIds] = useState<Set<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const normalizedViewerHandle = bareHandle(viewerHandle).toLowerCase();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const t = useMessages(messages);
  const language = useUiLanguage();
  const errorText = (error: unknown, fallback: string) =>
    error instanceof Error ? localizeBoksMessage(error.message, language) : fallback;

  useEffect(() => {
    let active = true;
    if (!isSupabaseReader) {
      return;
    }

    loadSupabaseComments(storyId)
      .then((next) => {
        if (!active) return;
        setComments(next);
        setLoadFailed(false);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isSupabaseReader, loadAttempt, storyId]);

  const threads = useMemo(() => buildCommentThreads(comments), [comments]);
  const normalizedAuthorHandle = bareHandle(authorHandle).toLowerCase();

  function beginReply(comment: Comment) {
    if (!hasSignedInAccount) {
      onRequestAccount();
      return;
    }

    const handle = bareHandle(comment.visitorHandle || comment.visitorName || "reader");
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
      onStatus(errorText(error, t.sendFailed));
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
      onStatus(t.likesNeedSupabase);
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
      onStatus(errorText(error, t.likeFailed));
    } finally {
      setLikingIds((current) => {
        const next = new Set(current);
        next.delete(comment.id);
        return next;
      });
    }
  }

  async function deleteComment(comment: Comment) {
    setDeletingId(comment.id);
    try {
      const result = await deleteSupabaseComment(comment.id);
      setComments((current) => current.filter((entry) => entry.id !== comment.id && entry.parentCommentId !== comment.id));
      setConfirmingDelete(null);
      onDeleted?.(1 + (result.repliesRemoved ?? 0));
      onStatus(result.repliesRemoved ? t.deletedWithReplies : t.deleted);
    } catch (error) {
      onStatus(errorText(error, t.deleteFailed));
    } finally {
      setDeletingId(null);
    }
  }

  function renderComment(comment: Comment, isReply = false) {
    const handle = bareHandle(comment.visitorHandle || comment.visitorName || "reader");
    const isAuthor = Boolean(normalizedAuthorHandle) && handle.toLowerCase() === normalizedAuthorHandle;
    const isMine = Boolean(normalizedViewerHandle) && handle.toLowerCase() === normalizedViewerHandle;
    const canDelete = hasSignedInAccount && isSupabaseReader && (isMine || canModerate);
    const replyCount = isReply ? 0 : comments.filter((entry) => entry.parentCommentId === comment.id).length;

    return (
      <article className={`comment-row${isReply ? " comment-row--reply" : ""}`}>
        <div className="comment-avatar" aria-hidden="true">
          {handle[0]?.toUpperCase() || <UserRound className="size-4" />}
        </div>
        <div className="comment-row__body">
          <div className="comment-meta">
            <span className="comment-handle">@{handle}</span>
            {isAuthor && <span className="comment-author-tag">{t.author}</span>}
            <time dateTime={comment.createdAt}>{shortTimeAgo(comment.createdAt, undefined, language)}</time>
          </div>
          <p className="comment-copy">{comment.body}</p>
          {confirmingDelete === comment.id ? (
            <div className="comment-confirm" role="group" aria-label={t.confirmDeleteGroup}>
              <span>
                {t.confirmDelete(replyCount)}
              </span>
              <button
                type="button"
                className="comment-reply comment-reply--danger"
                onClick={() => void deleteComment(comment)}
                disabled={deletingId === comment.id}
              >
                {deletingId === comment.id ? t.deleting : t.delete}
              </button>
              <button type="button" className="comment-reply" onClick={() => setConfirmingDelete(null)}>
                {t.cancel}
              </button>
            </div>
          ) : (
            <div className="comment-actions">
              <button type="button" className="comment-reply" onClick={() => beginReply(comment)}>
                {t.reply}
              </button>
              {canDelete && (
                <button type="button" className="comment-reply" onClick={() => setConfirmingDelete(comment.id)}>
                  {t.delete}
                </button>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`comment-like${comment.likedByMe ? " comment-like--active" : ""}`}
          onClick={() => void toggleLike(comment)}
          disabled={likingIds.has(comment.id)}
          aria-label={t.likeLabel(comment.likedByMe, handle)}
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
      label={t.comments}
      onClose={onClose}
      expandable
      expanded={expanded}
      onExpandedChange={setExpanded}
      className="comments-sheet"
    >
      <ReaderSheetHeader
        label={t.comments}
        onClose={onClose}
        title={`${t.comments}${comments.length ? ` · ${comments.length}` : ""}`}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />

      <div className="comment-list" aria-busy={loading}>
        {loading ? (
          <div className="comment-empty" role="status">{t.loading}</div>
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
                      {t.viewReplies(replies.length)}
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
                      <span aria-hidden="true" /> {t.hideReplies}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        ) : loadFailed ? (
          <div className="comment-empty" role="status">
            <p>{t.loadFailed}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                setLoadFailed(false);
                setLoading(true);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              {t.tryAgain}
            </Button>
          </div>
        ) : (
          <div className="comment-empty">
            <p>{t.empty}</p>
            <span>{t.emptyHint}</span>
          </div>
        )}
      </div>

      <div className="comment-composer-shell">
        {replyTarget && hasSignedInAccount && (
          <div className="comment-replying">
            <span>{t.replyingTo(replyTarget.handle)}</span>
            <button type="button" onClick={() => setReplyTarget(null)} aria-label={t.cancelReply}>
              <X className="size-4" />
            </button>
          </div>
        )}
        {hasSignedInAccount ? (
          <div className="comment-composer">
            <div className="comment-avatar comment-avatar--viewer" aria-hidden="true">
              {bareHandle(viewerHandle)[0]?.toUpperCase() || <UserRound className="size-4" />}
            </div>
            <Textarea
              ref={composerRef}
              aria-label={replyTarget ? t.replyTo(replyTarget.handle) : t.addComment}
              placeholder={`${replyTarget ? t.replyTo(replyTarget.handle) : t.addComment}…`}
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
              aria-label={replyTarget ? t.sendReply : t.sendComment}
            >
              <Send className="size-4" />
            </Button>
          </div>
        ) : (
          <button type="button" className="comment-signup" onClick={onRequestAccount}>
            <span className="comment-avatar" aria-hidden="true"><UserRound className="size-4" /></span>
            <span><strong>{t.join}</strong><small>{t.joinHint}</small></span>
          </button>
        )}
      </div>
    </ReaderSheet>
  );
}
