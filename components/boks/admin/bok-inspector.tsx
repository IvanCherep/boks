"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Archive, ExternalLink, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBokDetail, AdminBokStatus } from "@/components/boks/client-types";
import { deleteSupabaseComment, loadAdminBok } from "@/components/boks/supabase-browser-data";
import { readableBoksError } from "@/lib/boks/errors";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import {
  BokLifecycleDialog,
  type BokLifecycleTarget,
} from "@/components/boks/admin/bok-lifecycle-dialog";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

export const bokStatusLabels = defineMessages<Record<AdminBokStatus, string>>({
  draft: "Draft",
  pending_review: "Waiting for review",
  published: "Published",
  rejected: "Refused",
  archived: "Deleted",
}, { ru: {
  draft: "Черновик",
  pending_review: "Ждёт проверки",
  published: "Опубликован",
  rejected: "Отклонён",
  archived: "Удалён",
} });

export function BokStatusBadge({ status }: { status: AdminBokStatus }) {
  return <span className={`review-badge review-badge--${status}`}>{useMessages(bokStatusLabels)[status]}</span>;
}

export function formatAdminDate(value: string | null | undefined, language: UiLanguage = currentUiLanguage()) {
  return value ? new Date(value).toLocaleString(language) : "—";
}

const words = defineMessages({
  commentDeletedWithReplies: "Comment and its replies deleted.",
  commentDeleted: "Comment deleted.",
  deleteCommentFailed: "Could not delete the comment.",
  openFailed: "Could not open this bok.",
  hidden: "Hidden from readers. It is listed under Content → Deleted.",
  restored: "Restored to the reader feed.",
  loading: "Loading…",
  eyebrow: "Bok / inspector",
  readingMetrics: "Reading metrics",
  readingMinutes: "reading minutes",
  readers: "readers",
  readStarted: "read / started",
  comments: "comments",
  record: "Record",
  currentRecord: "Current record",
  length: "Length",
  lengthValue: (minutes: number, words: number) => `${minutes} min · ${words} words`,
  created: "Created",
  submitted: "Submitted",
  reviewed: "Reviewed",
  by: (handle: string) => ` by @${handle}`,
  reviewNote: "Review note",
  hiddenFact: "Hidden",
  rights: "Rights",
  confirmed: "Confirmed",
  notConfirmed: "Not confirmed",
  noRecord: "No record",
  text: "Text",
  readComplete: "Read the complete bok",
  backToRecord: "← Back to record",
  commentsHeading: "Comments",
  reader: "reader",
  reply: "reply · ",
  confirmDeleteReply: "Delete this comment?",
  confirmDeleteThread: "Delete this comment and any replies?",
  deleting: "Deleting…",
  delete: "Delete",
  cancel: "Cancel",
  noComments: "No comments.",
  likedBy: "Liked by",
  noLikes: "No likes.",
  openInReader: "Open in reader",
  hide: "Hide",
  restore: "Restore",
  deletePermanently: "Delete permanently",
  refresh: "Refresh",
  measurementDetails: "Measurement details",
  impressions: "impressions",
  skips: "skips",
  likes: "likes",
  shares: "shares",
  reports: "reports",
  openReports: (n: number) => `${n} open`,
  lastRead: "Last read",
  imported: " · imported",
  seed: " · seed",
}, { ru: {
  commentDeletedWithReplies: "Комментарий и ответы на него удалены.",
  commentDeleted: "Комментарий удалён.",
  deleteCommentFailed: "Не удалось удалить комментарий.",
  openFailed: "Не удалось открыть бок.",
  hidden: "Скрыт от читателей. Он в разделе Контент → Удалённые.",
  restored: "Возвращён в ленту читателей.",
  loading: "Загрузка…",
  eyebrow: "Бок / карточка",
  readingMetrics: "Метрики чтения",
  readingMinutes: "минут чтения",
  readers: "читатели",
  readStarted: "дочитали / начали",
  comments: "комментарии",
  record: "Карточка",
  currentRecord: "Текущая карточка",
  length: "Объём",
  lengthValue: (minutes: number, words: number) => `${minutes} мин · ${words} ${plural("ru", words, { one: "слово", few: "слова", many: "слов", other: "слова" })}`,
  created: "Создан",
  submitted: "Отправлен",
  reviewed: "Проверен",
  by: (handle: string) => `, @${handle}`,
  reviewNote: "Записка при проверке",
  hiddenFact: "Скрыт",
  rights: "Права",
  confirmed: "Подтверждены",
  notConfirmed: "Не подтверждены",
  noRecord: "Нет сведений",
  text: "Текст",
  readComplete: "Прочитать бок целиком",
  backToRecord: "← К карточке",
  commentsHeading: "Комментарии",
  reader: "читатель",
  reply: "ответ · ",
  confirmDeleteReply: "Удалить этот комментарий?",
  confirmDeleteThread: "Удалить этот комментарий и ответы на него?",
  deleting: "Удаляем…",
  delete: "Удалить",
  cancel: "Отмена",
  noComments: "Комментариев нет.",
  likedBy: "Лайкнули",
  noLikes: "Лайков нет.",
  openInReader: "Открыть в читалке",
  hide: "Скрыть",
  restore: "Восстановить",
  deletePermanently: "Удалить навсегда",
  refresh: "Обновить",
  measurementDetails: "Подробности измерений",
  impressions: "показы",
  skips: "пропуски",
  likes: "лайки",
  shares: "репосты",
  reports: "жалобы",
  openReports: (n: number) => `${n} ${plural("ru", n, { one: "открыта", few: "открыты", many: "открыто", other: "открыто" })}`,
  lastRead: "Последнее чтение",
  imported: " · импортирован",
  seed: " · стартовый",
} });

/**
 * One boks, in any status, for an admin: what it says, who wrote it, how it
 * was reviewed or removed, how it is read, and what readers said about it.
 * Every list in the console that shows a boks opens this.
 */
export function BokInspector({
  id,
  onChanged,
  onErased,
}: {
  id: string;
  /** Something about this boks changed; lists showing it should reload. */
  onChanged: () => void;
  /** The boks no longer exists. */
  onErased: () => void;
}) {
  const { openPerson } = useAdminInspector();
  const t = useMessages(words);
  const language = useUiLanguage();
  const [bok, setBok] = useState<AdminBokDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reading, setReading] = useState(false);
  const [action, setAction] = useState<BokLifecycleTarget | null>(null);
  const [confirmingComment, setConfirmingComment] = useState<number | null>(null);
  const [deletingComment, setDeletingComment] = useState<number | null>(null);

  async function deleteComment(commentId: number) {
    setDeletingComment(commentId);
    try {
      const result = await deleteSupabaseComment(commentId);
      setNotice(result.repliesRemoved ? t.commentDeletedWithReplies : t.commentDeleted);
      setConfirmingComment(null);
      onChanged();
      await refresh();
    } catch (caught) {
      setError(readableBoksError(caught, t.deleteCommentFailed));
    } finally {
      setDeletingComment(null);
    }
  }

  const refresh = useCallback(async () => {
    try {
      setBok(await loadAdminBok(id));
      setError("");
    } catch (caught) {
      setError(readableBoksError(caught, words[currentUiLanguage()].openFailed));
    }
  }, [id]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  async function afterAction(done: BokLifecycleTarget) {
    setAction(null);
    onChanged();
    if (done.kind === "delete") {
      onErased();
      return;
    }
    setNotice(done.kind === "archive" ? t.hidden : t.restored);
    await refresh();
  }

  if (error && !bok) return <p className="p-6 text-sm text-[var(--destructive)]">{error}</p>;
  if (!bok) return <p className="p-6 text-sm text-[var(--muted-foreground)]">{t.loading}</p>;

  const m = bok.metrics;
  const target = { id: bok.id, title: bok.title };
  const handle = bok.authorHandle.replace(/^@+/, "");

  return (
    <div className="inspector-body">
      <header className="studio-inspector-heading">
        <p className="studio-eyebrow">{t.eyebrow}</p><BokStatusBadge status={bok.status} />
        <h2>{bok.title}</h2>
        {bok.authorUserId ? <button className="studio-author-link" type="button" onClick={() => openPerson(bok.authorUserId!)}>{bok.authorName}{handle ? ` · @${handle}` : ""}<span>↗</span></button> : <p className="studio-meta">{bok.authorName}</p>}
      </header>
      {(notice || error) && <p className="studio-meta" aria-live="polite">{error || notice}</p>}
      <section className="inspector-metrics" aria-label={t.readingMetrics}>
        <Metric label={t.readingMinutes} value={m.minutes} /><Metric label={t.readers} value={m.readers} />
        <Metric label={t.readStarted} value={`${m.completes} / ${m.starts}`} detail={m.starts < 10 || m.finishRate === null ? undefined : `${m.finishRate}%`} />
        <Metric label={t.comments} value={m.comments} />
      </section>
      <h3 className="inspector-heading">{t.record}</h3>
      <dl className="inspector-facts" aria-label={t.currentRecord}>
        <Fact label={t.length}>{t.lengthValue(bok.estimatedMinutes, bok.wordCount)}</Fact>
        <Fact label={t.created}>{formatAdminDate(bok.createdAt, language)}</Fact>
        {bok.submittedAt && <Fact label={t.submitted}>{formatAdminDate(bok.submittedAt, language)}</Fact>}
        {bok.reviewedAt && (
          <Fact label={t.reviewed}>
            {formatAdminDate(bok.reviewedAt, language)}
            {bok.reviewedBy ? t.by(bok.reviewedBy) : ""}
          </Fact>
        )}
        {bok.reviewNote && bok.status !== "archived" && <Fact label={t.reviewNote}>{bok.reviewNote}</Fact>}
        {bok.archivedAt && (
          <Fact label={t.hiddenFact}>
            {formatAdminDate(bok.archivedAt, language)}
            {bok.archivedBy ? t.by(bok.archivedBy) : ""}
            {bok.archiveReason ? ` — ${bok.archiveReason}` : ""}
          </Fact>
        )}
        <Fact label={t.rights}>
          {bok.rights ? (bok.rights.confirmed ? t.confirmed : t.notConfirmed) : t.noRecord}
          {bok.rights?.note ? ` — ${bok.rights.note}` : ""}
        </Fact>
      </dl>

      <section className="grid gap-2" aria-label={t.text}>
        <h3 className="inspector-heading">{t.text}</h3>
        {!reading ? <><p className="studio-inspector-quote">{bok.body.split("\n").find((paragraph) => paragraph.trim())}</p><button className="studio-author-link" type="button" onClick={() => setReading(true)}>{t.readComplete} <span>↗</span></button></> : <><button type="button" className="studio-text-link" onClick={() => setReading(false)}>{t.backToRecord}</button><div className="inspector-text" lang={bok.language || undefined}>{bok.body.split("\n").map((paragraph, index) => <p key={index}>{paragraph || " "}</p>)}<div className="studio-endmark">b.</div></div></>}
      </section>

      <section className="grid gap-2" aria-label={t.commentsHeading}>
        <h3 className="inspector-heading">
          {t.commentsHeading} <span>{m.comments}</span>
        </h3>
        {bok.comments.length ? (
          <ul className="inspector-list">
            {bok.comments.map((comment) => (
              <li key={comment.id}>
                <div className="inspector-list__meta">
                  <button type="button" className="inspector-link" onClick={() => openPerson(comment.userId)}>
                    @{comment.handle || t.reader}
                  </button>
                  <span>{comment.parentCommentId ? t.reply : ""}{formatAdminDate(comment.createdAt, language)}</span>
                  {comment.likes > 0 && <span>♥ {comment.likes}</span>}
                </div>
                <p>{comment.body}</p>
                <div className="mt-1 flex items-center gap-3 text-xs">
                  {confirmingComment === comment.id ? (
                    <>
                      <span>{comment.parentCommentId ? t.confirmDeleteReply : t.confirmDeleteThread}</span>
                      <button
                        type="button"
                        className="inspector-link text-[var(--destructive)]"
                        onClick={() => void deleteComment(comment.id)}
                        disabled={deletingComment === comment.id}
                      >
                        {deletingComment === comment.id ? t.deleting : t.delete}
                      </button>
                      <button type="button" className="inspector-link" onClick={() => setConfirmingComment(null)}>
                        {t.cancel}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="inspector-link" onClick={() => setConfirmingComment(comment.id)}>
                      {t.delete}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{t.noComments}</p>
        )}
      </section>

      <section className="grid gap-2" aria-label={t.likedBy}>
        <h3 className="inspector-heading">
          {t.likedBy} <span>{m.likes}</span>
        </h3>
        {bok.likers.length ? (
          <div className="flex flex-wrap gap-2">
            {bok.likers.map((liker) => (
              <button
                key={liker.userId}
                type="button"
                className="inspector-chip inspector-chip--link"
                onClick={() => openPerson(liker.userId)}
                title={formatAdminDate(liker.likedAt, language)}
              >
                @{liker.handle || t.reader}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{t.noLikes}</p>
        )}
      </section>

        <div className="flex flex-wrap gap-2 pt-1">
          {bok.status === "published" && (
            <Button asChild size="sm" variant="outline">
              <a href={`/b/${bok.id}`} target="_blank" rel="noreferrer">
                <ExternalLink /> {t.openInReader}
              </a>
            </Button>
          )}
          {bok.status !== "archived" ? (
            <Button size="sm" variant="outline" onClick={() => setAction({ kind: "archive", bok: target })}>
              <Archive /> {t.hide}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setAction({ kind: "restore", bok: target })}>
                <RotateCcw /> {t.restore}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "delete", bok: target })}>
                <Trash2 /> {t.deletePermanently}
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => refresh()}>
            <RefreshCw /> {t.refresh}
          </Button>
        </div>
      <details className="studio-details"><summary>{t.measurementDetails} <span>＋</span></summary><div className="studio-details-body">
        <section className="inspector-metrics"><Metric label={t.impressions} value={m.impressions} /><Metric label={t.skips} value={m.skips} /><Metric label={t.likes} value={m.likes} /><Metric label={t.shares} value={m.shares} /><Metric label={t.reports} value={m.reports} detail={t.openReports(m.openReports)} /></section>
        <p className="studio-meta">{t.lastRead} {formatAdminDate(m.lastReadAt, language)} · {bok.language} · {bok.genre} · {bok.mood}{bok.imported ? t.imported : ""}{bok.isSeed ? t.seed : ""}</p>
      </div></details>
      <BokLifecycleDialog target={action} onClose={() => setAction(null)} onDone={afterAction} />
    </div>
  );
}

export function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <div className="inspector-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inspector-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
