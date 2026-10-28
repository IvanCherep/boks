"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Heart, MessageCircle, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { buildCommentThreads } from "@/components/boks/comment-threads";
import type { Comment } from "@/components/boks/client-types";
import { formatCompactCount, shortTimeAgo } from "@/components/boks/client-format";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import {
  deleteSupabaseComment,
  loadSupabaseComments,
  setSupabaseCommentLike,
} from "@/components/boks/supabase-browser-data";
import { haptic } from "@/components/boks/reader-haptics";
import { bareHandle } from "@/components/boks/reader/handles";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { readableBoksError } from "@/lib/boks/errors";

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
  const { preferences, t } = useReaderPreferences();
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
  const [sendError, setSendError] = useState("");
  const [likingIds, setLikingIds] = useState<Set<number>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const normalizedViewerHandle = bareHandle(viewerHandle).toLowerCase();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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
    setSendError("");
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
      const message = readableBoksError(error, t("Could not send comment.", "Не удалось отправить комментарий."));
      setSendError(message);
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
      onStatus(t("Comment likes need the Supabase reader.", "Лайки комментариев работают только с сервером Supabase."));
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
      onStatus(readableBoksError(error, t("Could not update that like.", "Не удалось обновить лайк.")));
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
      onStatus(result.repliesRemoved ? t("Comment and its replies deleted.", "Комментарий и ответы на него удалены.") : t("Comment deleted.", "Комментарий удалён."));
    } catch (error) {
      onStatus(readableBoksError(error, t("Could not delete the comment.", "Не удалось удалить комментарий.")));
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
            {isAuthor && <span className="comment-author-tag">{t("author", "автор")}</span>}
            <time dateTime={comment.createdAt}>{shortTimeAgo(comment.createdAt, undefined, preferences.locale)}</time>
          </div>
          <p className="comment-copy">{comment.body}</p>
          {confirmingDelete === comment.id ? (
            <div className="comment-confirm" role="group" aria-label={t("Confirm deleting this comment", "Подтвердите удаление комментария")}>
              <span>
                {replyCount
                  ? t(`Delete this comment and its ${replyCount === 1 ? "reply" : `${replyCount} replies`}?`, `Удалить комментарий и ответы (${replyCount})?`)
                  : t("Delete this comment?", "Удалить комментарий?")}
              </span>
              <button
                type="button"
                className="comment-reply comment-reply--danger"
                onClick={() => void deleteComment(comment)}
                disabled={deletingId === comment.id}
              >
                {deletingId === comment.id ? t("Deleting…", "Удаляем…") : t("Delete", "Удалить")}
              </button>
              <button type="button" className="comment-reply" onClick={() => setConfirmingDelete(null)}>
                {t("Cancel", "Отмена")}
              </button>
            </div>
          ) : (
            <div className="comment-actions">
              <button type="button" className="comment-reply" onClick={() => beginReply(comment)}>
                {t("Reply", "Ответить")}
              </button>
              {canDelete && (
                <button type="button" className="comment-reply" onClick={() => setConfirmingDelete(comment.id)}>
                  {t("Delete", "Удалить")}
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
          aria-label={`${comment.likedByMe ? t(`Unlike comment by @${handle}`, `Убрать лайк комментария @${handle}`) : t(`Like comment by @${handle}`, `Лайк комментарию @${handle}`)}, ${comment.likesCount}`}
          aria-pressed={comment.likedByMe}
        >
          <Heart className="size-5" fill={comment.likedByMe ? "currentColor" : "none"} />
          <span aria-hidden="true">{formatCompactCount(comment.likesCount)}</span>
        </button>
      </article>
    );
  }

  return (
    <ReaderSheet
      label={t("Comments", "Комментарии")}
      onClose={onClose}
      expandable
      expanded={expanded}
      onExpandedChange={setExpanded}
      className="comments-sheet"
    >
      <ReaderSheetHeader
        label={t("Comments", "Комментарии")}
        onClose={onClose}
        title={<>{t("Comments", "Комментарии")} <small>{comments.length}</small></>}
      />

      <div className="comment-list" aria-busy={loading}>
        {loading ? (
          <div className="comment-empty" role="status">{t("Loading comments…", "Загружаем комментарии…")}</div>
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
                      {t(`View ${replies.length} ${replies.length === 1 ? "reply" : "replies"}`, `Показать ответы · ${replies.length}`)}
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
                      <span aria-hidden="true" /> {t("Hide replies", "Скрыть ответы")}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        ) : loadFailed ? (
          <div className="comment-empty" role="status">
            <p>{t("Could not load the comments", "Не удалось загрузить комментарии")}</p>
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
              {t("Try again", "Попробовать снова")}
            </Button>
          </div>
        ) : (
          <div className="comment-empty">
            <MessageCircle aria-hidden="true" />
            <p>{t("No comments yet", "Комментариев пока нет")}</p>
            <span>{t("Be the first to comment.", "Оставьте первый комментарий.")}</span>
          </div>
        )}
      </div>

      <div className="comment-composer-shell">
        {sendError && <div className="comment-send-error" role="alert"><p>{sendError}</p><button type="button" onClick={() => void submit()} disabled={submitting}>{t("Retry", "Повторить")}</button></div>}
        {replyTarget && hasSignedInAccount && (
          <div className="comment-replying">
            <span>{t(`Replying to @${replyTarget.handle}`, `Ответ для @${replyTarget.handle}`)}</span>
            <button type="button" onClick={() => setReplyTarget(null)} aria-label={t("Cancel reply", "Отменить ответ")}>
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
              aria-label={replyTarget ? t(`Reply to @${replyTarget.handle}`, `Ответ для @${replyTarget.handle}`) : t("Add a comment", "Добавить комментарий")}
              placeholder={replyTarget ? t(`Reply to @${replyTarget.handle}…`, `Ответ для @${replyTarget.handle}…`) : t("Add a comment…", "Добавить комментарий…")}
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
              aria-label={replyTarget ? t("Send reply", "Отправить ответ") : t("Send comment", "Отправить комментарий")}
            >
              <ArrowUp className="size-4" />
            </Button>
          </div>
        ) : (
          <button type="button" className="comment-signup" onClick={onRequestAccount}>
            <span className="comment-avatar" aria-hidden="true"><UserRound className="size-4" /></span>
            <span>{t("Sign in to comment…", "Войдите, чтобы комментировать…")}</span>
            <i className="comment-guest-send" aria-hidden="true"><ArrowUp /></i>
          </button>
        )}
      </div>
    </ReaderSheet>
  );
}
