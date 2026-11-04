"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Clock3,
  Edit3,
  EyeOff,
  ExternalLink,
  Heart,
  MessageCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readableBoksError } from "@/lib/boks/errors";
import type {
  AuthorBokStats,
  AuthorBokStatusFilter,
  AuthorBokSubmission,
  AuthorBokSubmissionsPage,
  BokReviewStatus,
} from "@/components/boks/client-types";
import {
  deleteMyBok,
  loadMyBokStats,
  loadMyBokSubmissionsPage,
  restoreMyBok,
  withdrawMyBok,
} from "@/components/boks/supabase-browser-data";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

const ru = (n: number, one: string, few: string, many: string) => plural("ru", n, { one, few, many, other: few });

/**
 * The author's own works: every piece they ever sent, what readers did with
 * it, and the controls that are theirs - take it off review or off the feed,
 * return it, edit it, delete it for good. The database decides what each
 * status allows (`withdraw_my_bok`, `restore_my_bok`, `delete_my_bok`); the
 * buttons only offer what it will accept.
 */
const messages = defineMessages(
  {
    title: "My texts",
    intro: "Everything you have sent, with what readers did with it. You can take any text off the feed or out of review yourself, and bring it back.",
    filterAll: "All",
    published: "Published",
    inReview: "In review",
    needsWork: "Needs changes",
    withdrawn: "Withdrawn",
    archived: "Removed by boks",
    searchPlaceholder: "Search by title or name",
    statusPending: "Waiting for review",
    statusPublished: "Published",
    statusRejected: "Needs changes",
    statusWithdrawn: "Withdrawn by you",
    statusArchived: "Removed by boks",
    statusDraft: "Draft",
    min: "min",
    readers: (n: number) => (n === 1 ? "1 reader" : `${n} readers`),
    likes: (n: number) => (n === 1 ? "1 like" : `${n} likes`),
    comments: (n: number) => (n === 1 ? "1 comment" : `${n} comments`),
    sentOn: (date: string) => `sent ${date}`,
    publishedOn: (date: string) => `published ${date}`,
    open: "Open",
    stats: "Statistics and comments",
    hideStats: "Hide statistics",
    revise: "Revise",
    edit: "Edit and resubmit",
    withdrawReview: "Withdraw from review",
    withdrawPublished: "Take off the feed",
    withdrawRejected: "Withdraw",
    withdrawConfirmReview: "Withdraw it from review? The admin will not see it. You can send it back at any time.",
    withdrawConfirmPublished:
      "Take it off the feed? Readers will stop seeing it at once, on the feed and on your page. Likes and comments are kept, and you can return it at any time.",
    withdrawConfirmRejected: "Withdraw this text? You can then edit it or delete it for good.",
    confirmWithdraw: "Yes, withdraw",
    cancel: "Cancel",
    restorePublished: "Return to the feed",
    restoreReview: "Send back to review",
    restoreRejected: "Return",
    withdrawnNote: (date: string) => `Withdrawn by you on ${date} - readers do not see it.`,
    withdrawnFromPublished: "Returning it puts it back on the feed straight away, without a new review.",
    withdrawnEditNote: "Editing it sends it to review again.",
    archivedNote: "boks removed this text. Write to support if you think it is a mistake.",
    deleteForever: "Delete for good",
    deleteConfirm: (title: string) =>
      `This deletes “${title}” with its likes, comments and reading history. It cannot be undone. Type the title to confirm.`,
    deleteConfirmButton: "Delete for good",
    deleted: (title: string) => `“${title}” is deleted.`,
    withdrawnDone: (title: string) => `“${title}” is withdrawn.`,
    restoredPublished: (title: string) => `“${title}” is back on the feed.`,
    restoredReview: (title: string) => `“${title}” is back in review.`,
    restoredRejected: (title: string) => `“${title}” is back.`,
    actionFailed: "That did not work. Try again.",
    nothingYet: "Nothing sent yet. Write a text or upload files - they will appear here with their status, readers, likes and comments.",
    nothingMatches: "No texts match.",
    showMore: (left: number) => `Show more (${left} left)`,
    loading: "Loading…",
    loadFailed: "Could not load your texts. Try again.",
    retry: "Retry",
    // Statistics
    mReaders: "Readers",
    mReadersHint: "Different people who opened it. You are not counted.",
    mReadersWeek: (n: number) => `${n} in the last 7 days`,
    mImpressions: "Shown in the feed",
    mImpressionsHint: "How many times its cover appeared in someone's feed.",
    mStarts: "Opened",
    mCompletes: "Read to the end",
    mFinishRate: (n: number) => `${n}% of those who opened it`,
    mMinutes: "Reading time",
    mMinutesValue: (n: number) => `${n} min`,
    mShares: "Shared",
    mLikes: "Likes",
    mComments: "Comments",
    lastRead: (date: string) => `Last read: ${date}`,
    neverRead: "Nobody has read it yet",
    commentsTitle: "Comments",
    noComments: "No comments yet.",
    reply: "reply",
    commentLikes: (n: number) => (n === 1 ? "1 like" : `${n} likes`),
    newestComments: (n: number) => `The newest ${n}.`,
    statsFailed: "Could not load the statistics.",
  },
  {
    ru: {
      title: "Мои тексты",
      intro: "Всё, что вы отправили, и что с этим делали читатели. Любой текст можно самому снять с публикации или отозвать с проверки - и вернуть обратно.",
      filterAll: "Все",
      published: "Опубликованы",
      inReview: "На проверке",
      needsWork: "Нужны правки",
      withdrawn: "Сняты вами",
      archived: "Сняты boks",
      searchPlaceholder: "Поиск по названию или имени",
      statusPending: "Ждёт проверки",
      statusPublished: "Опубликован",
      statusRejected: "Нужны правки",
      statusWithdrawn: "Снят вами",
      statusArchived: "Снят boks",
      statusDraft: "Черновик",
      min: "мин",
      readers: (n: number) => `${n} ${ru(n, "читатель", "читателя", "читателей")}`,
      likes: (n: number) => `${n} ${ru(n, "лайк", "лайка", "лайков")}`,
      comments: (n: number) => `${n} ${ru(n, "комментарий", "комментария", "комментариев")}`,
      sentOn: (date: string) => `отправлен ${date}`,
      publishedOn: (date: string) => `опубликован ${date}`,
      open: "Открыть",
      stats: "Статистика и комментарии",
      hideStats: "Скрыть статистику",
      revise: "Исправить",
      edit: "Изменить и отправить снова",
      withdrawReview: "Отозвать с проверки",
      withdrawPublished: "Снять с публикации",
      withdrawRejected: "Убрать",
      withdrawConfirmReview: "Отозвать текст с проверки? Администратор его не увидит. Отправить снова можно в любой момент.",
      withdrawConfirmPublished:
        "Снять текст с публикации? Читатели сразу перестанут его видеть - в ленте и на вашей странице. Лайки и комментарии сохранятся, вернуть текст можно в любой момент.",
      withdrawConfirmRejected: "Убрать этот текст? Потом его можно изменить или удалить навсегда.",
      confirmWithdraw: "Да, снять",
      cancel: "Отмена",
      restorePublished: "Вернуть в публикацию",
      restoreReview: "Вернуть на проверку",
      restoreRejected: "Вернуть",
      withdrawnNote: (date: string) => `Снят вами ${date} - читатели его не видят.`,
      withdrawnFromPublished: "Если вернуть - он сразу снова появится в ленте, без новой проверки.",
      withdrawnEditNote: "Если изменить - текст снова уйдёт на проверку.",
      archivedNote: "Этот текст снят администрацией boks. Если считаете, что это ошибка, напишите в поддержку.",
      deleteForever: "Удалить навсегда",
      deleteConfirm: (title: string) =>
        `Текст «${title}» будет удалён вместе с лайками, комментариями и историей чтения. Отменить это нельзя. Введите название, чтобы подтвердить.`,
      deleteConfirmButton: "Удалить навсегда",
      deleted: (title: string) => `«${title}» удалён.`,
      withdrawnDone: (title: string) => `«${title}» снят.`,
      restoredPublished: (title: string) => `«${title}» снова в ленте.`,
      restoredReview: (title: string) => `«${title}» снова на проверке.`,
      restoredRejected: (title: string) => `«${title}» возвращён.`,
      actionFailed: "Не получилось. Попробуйте ещё раз.",
      nothingYet: "Пока ничего не отправлено. Напишите текст или загрузите файлы - они появятся здесь со статусом, читателями, лайками и комментариями.",
      nothingMatches: "Ничего не найдено.",
      showMore: (left: number) => `Показать ещё (осталось ${left})`,
      loading: "Загружаем…",
      loadFailed: "Не удалось загрузить ваши тексты. Попробуйте ещё раз.",
      retry: "Повторить",
      mReaders: "Читатели",
      mReadersHint: "Разные люди, открывшие текст. Вы сами не считаетесь.",
      mReadersWeek: (n: number) => `${n} за последние 7 дней`,
      mImpressions: "Показы в ленте",
      mImpressionsHint: "Сколько раз обложка появлялась у кого-то в ленте.",
      mStarts: "Открыли",
      mCompletes: "Дочитали",
      mFinishRate: (n: number) => `${n}% от открывших`,
      mMinutes: "Время чтения",
      mMinutesValue: (n: number) => `${n} мин`,
      mShares: "Поделились",
      mLikes: "Лайки",
      mComments: "Комментарии",
      lastRead: (date: string) => `Последний раз читали: ${date}`,
      neverRead: "Его ещё никто не читал",
      commentsTitle: "Комментарии",
      noComments: "Комментариев пока нет.",
      reply: "ответ",
      commentLikes: (n: number) => `${n} ${ru(n, "лайк", "лайка", "лайков")}`,
      newestComments: (n: number) => `Последние ${n}.`,
      statsFailed: "Не удалось загрузить статистику.",
    },
  }
);

type Words = (typeof messages)["en"];

const pageSize = 20;

const emptyPage: AuthorBokSubmissionsPage = {
  items: [],
  total: 0,
  counts: { all: 0, pending_review: 0, published: 0, rejected: 0, withdrawn: 0, archived: 0 },
};

function statusLabel(status: BokReviewStatus, w: Words) {
  if (status === "pending_review") return w.statusPending;
  if (status === "published") return w.statusPublished;
  if (status === "rejected") return w.statusRejected;
  if (status === "withdrawn") return w.statusWithdrawn;
  if (status === "archived") return w.statusArchived;
  return w.statusDraft;
}

function StatusIcon({ status }: { status: BokReviewStatus }) {
  if (status === "published") return <ShieldCheck className="size-4" />;
  if (status === "rejected" || status === "archived") return <XCircle className="size-4" />;
  if (status === "withdrawn") return <EyeOff className="size-4" />;
  return <Clock3 className="size-4" />;
}

function formatDate(value: string | null | undefined, language: UiLanguage) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(language === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function Metric({ label, value, note, hint }: { label: string; value: string | number; note?: string; hint?: string }) {
  return (
    <div className="author-metric" title={hint}>
      <span className="author-metric__label">{label}</span>
      <strong className="author-metric__value">{value}</strong>
      {note && <span className="author-metric__note">{note}</span>}
    </div>
  );
}

function StatsPanel({ bokId, words, language }: { bokId: string; words: Words; language: UiLanguage }) {
  const [stats, setStats] = useState<AuthorBokStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadMyBokStats(bokId)
      .then((result) => active && setStats(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [bokId]);

  if (failed) return <p className="mt-3 text-sm text-[var(--destructive)]">{words.statsFailed}</p>;
  if (!stats) return <p className="mt-3 text-sm text-[var(--muted-foreground)]">{words.loading}</p>;

  const m = stats.metrics;
  return (
    <div className="author-stats mt-3">
      <div className="author-metrics">
        <Metric label={words.mReaders} value={m.readers} note={words.mReadersWeek(m.readersWeek)} hint={words.mReadersHint} />
        <Metric label={words.mImpressions} value={m.impressions} hint={words.mImpressionsHint} />
        <Metric label={words.mStarts} value={m.starts} />
        <Metric
          label={words.mCompletes}
          value={m.completes}
          note={m.finishRate === null ? undefined : words.mFinishRate(m.finishRate)}
        />
        <Metric label={words.mMinutes} value={words.mMinutesValue(m.minutes)} />
        <Metric label={words.mLikes} value={m.likes} />
        <Metric label={words.mComments} value={m.comments} />
        <Metric label={words.mShares} value={m.shares} />
      </div>
      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        {m.lastReadAt ? words.lastRead(formatDate(m.lastReadAt, language)) : words.neverRead} · {words.mReadersHint}
      </p>
      <h4 className="mt-4 text-sm font-semibold">{words.commentsTitle}</h4>
      {stats.comments.length ? (
        <>
          <ul className="author-comments mt-2">
            {stats.comments.map((comment) => (
              <li key={comment.id}>
                <p className="text-xs text-[var(--muted-foreground)]">
                  <strong className="text-[var(--foreground)]">@{comment.handle || "reader"}</strong>
                  {comment.isReply ? ` · ${words.reply}` : ""} · {formatDate(comment.createdAt, language)}
                  {comment.likes ? ` · ${words.commentLikes(comment.likes)}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{comment.body}</p>
              </li>
            ))}
          </ul>
          {stats.comments.length >= 50 && (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">{words.newestComments(stats.comments.length)}</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{words.noComments}</p>
      )}
    </div>
  );
}

type Pending = { id: string; kind: "withdraw" | "delete" } | null;

export function AuthorWorks({
  signedIn,
  refreshKey,
  onEdit,
  onCounts,
}: {
  signedIn: boolean;
  /** Changes whenever something was sent, so the list reloads. */
  refreshKey: number;
  onEdit: (submission: AuthorBokSubmission) => void;
  onCounts?: (counts: AuthorBokSubmissionsPage["counts"]) => void;
}) {
  const words = useMessages(messages);
  const language = useUiLanguage();
  const [page, setPage] = useState<AuthorBokSubmissionsPage>(emptyPage);
  const [filter, setFilter] = useState<AuthorBokStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [openStats, setOpenStats] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string | null; text: (w: Words, l: UiLanguage) => string; error?: boolean } | null>(null);
  const request = useRef(0);
  const onCountsRef = useRef(onCounts);
  onCountsRef.current = onCounts;

  const load = useCallback(
    async (options: { filter: AuthorBokStatusFilter; query: string; append?: boolean; offset?: number }) => {
      const ticket = ++request.current;
      setLoading(true);
      setError(false);
      try {
        const next = await loadMyBokSubmissionsPage({
          status: options.filter,
          query: options.query,
          limit: pageSize,
          offset: options.offset ?? 0,
        });
        if (ticket !== request.current) return;
        setPage((current) => (options.append ? { ...next, items: [...current.items, ...next.items] } : next));
        onCountsRef.current?.(next.counts);
      } catch {
        if (ticket === request.current) setError(true);
      } finally {
        if (ticket === request.current) setLoading(false);
      }
    },
    []
  );

  const filterRef = useRef(filter);
  filterRef.current = filter;
  const queryRef = useRef(query);
  queryRef.current = query;

  // Reload when signed in, or when something new was sent.
  useEffect(() => {
    if (!signedIn) {
      setPage(emptyPage);
      return;
    }
    void load({ filter: filterRef.current, query: queryRef.current.trim() });
  }, [signedIn, refreshKey, load]);

  // Search waits for the author to stop typing.
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    if (!signedIn) return;
    const handle = window.setTimeout(() => void load({ filter: filterRef.current, query: query.trim() }), 300);
    return () => window.clearTimeout(handle);
  }, [query, signedIn, load]);

  function chooseFilter(next: AuthorBokStatusFilter) {
    setFilter(next);
    setOpenStats(null);
    void load({ filter: next, query: query.trim() });
  }

  function reload() {
    return load({ filter, query: query.trim() });
  }

  async function act(item: AuthorBokSubmission, action: () => Promise<unknown>, done: (w: Words, l: UiLanguage) => string) {
    setBusy(item.id);
    setNotice(null);
    try {
      await action();
      setPending(null);
      setConfirmTitle("");
      setNotice({ id: item.id, text: done });
      await reload();
    } catch (failure) {
      setNotice({
        id: item.id,
        error: true,
        text: (w: Words, l: UiLanguage) => readableBoksError(failure, w.actionFailed, l),
      });
    } finally {
      setBusy(null);
    }
  }

  const filters: { id: AuthorBokStatusFilter; label: string }[] = [
    { id: "all", label: words.filterAll },
    { id: "published", label: words.published },
    { id: "pending_review", label: words.inReview },
    { id: "rejected", label: words.needsWork },
    { id: "withdrawn", label: words.withdrawn },
    { id: "archived", label: words.archived },
  ];
  const left = Math.max(0, page.total - page.items.length);

  return (
    <section className="panel p-5 sm:p-7">
      <h2 className="text-2xl font-semibold tracking-normal">
        {words.title}
        {page.counts.all > 0 && <span className="ml-2 text-[var(--muted-foreground)]">{page.counts.all}</span>}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">{words.intro}</p>

      {signedIn && page.counts.all > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_minmax(220px,320px)] sm:items-center">
          <div className="author-filters" role="group" aria-label={words.title}>
            {filters
              .filter((option) => option.id === "all" || page.counts[option.id] > 0 || filter === option.id)
              .map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="author-filter"
                  aria-pressed={filter === option.id}
                  onClick={() => chooseFilter(option.id)}
                >
                  {option.label} <span>{page.counts[option.id]}</span>
                </button>
              ))}
          </div>
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden="true" />
            <Input
              className="pl-8"
              type="search"
              value={query}
              placeholder={words.searchPlaceholder}
              aria-label={words.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      )}

      {notice && !notice.error && !page.items.some((item) => item.id === notice.id) && (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]" role="status" aria-live="polite">
          {notice.text(words, language)}
        </p>
      )}

      <div className="mt-4 grid gap-3">
        {error && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--destructive)]">
            {words.loadFailed}
            <Button variant="outline" size="sm" onClick={() => void reload()}>{words.retry}</Button>
          </p>
        )}
        {page.items.length === 0 && !error ? (
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            {loading ? words.loading : page.counts.all ? words.nothingMatches : words.nothingYet}
          </p>
        ) : null}
        {page.items.map((item) => {
          const isBusy = busy === item.id;
          const wasPublished = item.status === "withdrawn" && item.withdrawnFromStatus === "published";
          const hasAudience = item.status === "published" || wasPublished || item.status === "archived";
          const confirmingWithdraw = pending?.id === item.id && pending.kind === "withdraw";
          const confirmingDelete = pending?.id === item.id && pending.kind === "delete";
          const date =
            item.status === "published" && item.publishedAt
              ? words.publishedOn(formatDate(item.publishedAt, language))
              : item.submittedAt
                ? words.sentOn(formatDate(item.submittedAt, language))
                : "";
          return (
            <article key={item.id} className="submission-card author-work">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-base font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {item.minutes} {words.min}
                    {item.authorName ? ` · ${item.authorName}` : ""}
                    {date ? ` · ${date}` : ""}
                  </p>
                </div>
                <span className={`review-badge review-badge--${item.status}`}>
                  <StatusIcon status={item.status} />
                  {statusLabel(item.status, words)}
                </span>
              </div>

              {hasAudience && (
                <p className="author-work__numbers mt-2">
                  <span><Users className="size-3.5" aria-hidden="true" /> {words.readers(item.readers ?? 0)}</span>
                  <span><Heart className="size-3.5" aria-hidden="true" /> {words.likes(item.likes)}</span>
                  <span><MessageCircle className="size-3.5" aria-hidden="true" /> {words.comments(item.comments)}</span>
                </p>
              )}

              {item.status === "rejected" && item.reviewNote && (
                <p className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm leading-6 text-[var(--muted-foreground)]">{item.reviewNote}</p>
              )}
              {item.status === "withdrawn" && (
                <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                  {item.withdrawnAt ? `${words.withdrawnNote(formatDate(item.withdrawnAt, language))} ` : ""}
                  {wasPublished ? `${words.withdrawnFromPublished} ` : ""}
                  {words.withdrawnEditNote}
                </p>
              )}
              {item.status === "archived" && (
                <p className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm leading-6 text-[var(--muted-foreground)]">
                  {item.reviewNote ? `${item.reviewNote} ` : ""}{words.archivedNote}
                </p>
              )}

              {confirmingWithdraw ? (
                <div className="author-confirm mt-3">
                  <p className="text-sm leading-6">
                    {item.status === "published"
                      ? words.withdrawConfirmPublished
                      : item.status === "pending_review"
                        ? words.withdrawConfirmReview
                        : words.withdrawConfirmRejected}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isBusy}
                      onClick={() => void act(item, () => withdrawMyBok(item.id), (w) => w.withdrawnDone(item.title))}
                    >
                      <EyeOff className="size-4" /> {words.confirmWithdraw}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPending(null)}>{words.cancel}</Button>
                  </div>
                </div>
              ) : confirmingDelete ? (
                <div className="author-confirm mt-3">
                  <p className="text-sm leading-6">{words.deleteConfirm(item.title)}</p>
                  <Input
                    className="mt-2"
                    value={confirmTitle}
                    placeholder={item.title}
                    aria-label={words.deleteConfirmButton}
                    onChange={(event) => setConfirmTitle(event.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isBusy || confirmTitle.trim() !== item.title.trim()}
                      onClick={() => void act(item, () => deleteMyBok(item.id, confirmTitle), (w) => w.deleted(item.title))}
                    >
                      <Trash2 className="size-4" /> {words.deleteConfirmButton}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setPending(null); setConfirmTitle(""); }}>{words.cancel}</Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.status === "published" && (
                    <Button asChild size="sm" variant="outline">
                      <a href={`/b/${item.id}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" /> {words.open}
                      </a>
                    </Button>
                  )}
                  {hasAudience && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-expanded={openStats === item.id}
                      onClick={() => setOpenStats(openStats === item.id ? null : item.id)}
                    >
                      <BarChart3 className="size-4" /> {openStats === item.id ? words.hideStats : words.stats}
                    </Button>
                  )}
                  {item.status === "rejected" && item.body && (
                    <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
                      <Edit3 className="size-4" /> {words.revise}
                    </Button>
                  )}
                  {item.status === "withdrawn" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isBusy}
                        onClick={() =>
                          void act(item, () => restoreMyBok(item.id), (w) =>
                            item.withdrawnFromStatus === "published"
                              ? w.restoredPublished(item.title)
                              : item.withdrawnFromStatus === "rejected"
                                ? w.restoredRejected(item.title)
                                : w.restoredReview(item.title)
                          )
                        }
                      >
                        <RotateCcw className="size-4" />{" "}
                        {item.withdrawnFromStatus === "published"
                          ? words.restorePublished
                          : item.withdrawnFromStatus === "rejected"
                            ? words.restoreRejected
                            : words.restoreReview}
                      </Button>
                      {item.body && (
                        <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
                          <Edit3 className="size-4" /> {words.edit}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setPending({ id: item.id, kind: "delete" }); setConfirmTitle(""); }}>
                        <Trash2 className="size-4" /> {words.deleteForever}
                      </Button>
                    </>
                  )}
                  {(item.status === "published" || item.status === "pending_review" || item.status === "rejected") && (
                    <Button size="sm" variant="ghost" onClick={() => setPending({ id: item.id, kind: "withdraw" })}>
                      <EyeOff className="size-4" />{" "}
                      {item.status === "published"
                        ? words.withdrawPublished
                        : item.status === "pending_review"
                          ? words.withdrawReview
                          : words.withdrawRejected}
                    </Button>
                  )}
                </div>
              )}

              {notice?.id === item.id && (
                <p
                  className={`mt-2 text-sm ${notice.error ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}`}
                  role="status"
                  aria-live="polite"
                >
                  {notice.text(words, language)}
                </p>
              )}
              {openStats === item.id && <StatsPanel bokId={item.id} words={words} language={language} />}
            </article>
          );
        })}
        {left > 0 && (
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void load({ filter, query: query.trim(), append: true, offset: page.items.length })}
          >
            {loading ? words.loading : words.showMore(left)}
          </Button>
        )}
      </div>
    </section>
  );
}
