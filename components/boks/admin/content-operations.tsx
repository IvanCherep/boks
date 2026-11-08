"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoksContentRow } from "@/components/boks/client-types";
import { loadBoksContent } from "@/components/boks/supabase-browser-data";
import { BackgroundJobs } from "@/components/boks/admin/background-jobs";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import {
  BokLifecycleDialog,
  type BokLifecycleAction,
  type BokLifecycleTarget,
} from "@/components/boks/admin/bok-lifecycle-dialog";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const pageSize = 50;
type ContentScope = "published" | "archived";

// The status line starts as "loading" in whichever language is showing.
const loading = Symbol("loading");

const words = defineMessages({
  loading: "Loading...",
  noneMatch: (scope: ContentScope) => `No ${scope === "published" ? "published" : "deleted"} boks match.`,
  loadFailed: "Could not load content.",
  movedToDeleted: (title: string) => `“${title}” moved to Deleted.`,
  restored: (title: string) => `“${title}” restored to its previous state.`,
  erased: (title: string) => `“${title}” permanently deleted.`,
  contentStatus: "Content status",
  published: "Published",
  deleted: "Deleted",
  searchLabel: "Search title or author",
  searchPlaceholder: "Start typing…",
  range: (start: number, end: number) => `${start}–${end} of `,
  count: (n: number, scope: ContentScope) => `${n} ${scope === "published" ? "published" : "deleted"} boks`,
  sortBoks: "Sort boks",
  sortMinutes: "Reading time",
  sortReaders: "Readers",
  sortFinish: "Finish rate",
  sortNewest: "Newest",
  sortTitle: "Title",
  min: "min",
  readers: "readers",
  finished: "finished",
  readStarted: "read / started",
  manage: "Manage bok",
  details: (minutes: number, words: number, likes: number) => `${minutes} min long · ${words} words · ${likes} likes`,
  removed: "Removed",
  unknownDate: "on an unknown date",
  noReason: "No reason recorded",
  hide: "Hide bok",
  restore: "Restore bok",
  deletePermanently: "Delete permanently",
  pageOf: (start: number, end: number, total: number) => `${start}–${end} of ${total}`,
  previous: "Previous",
  next: "Next",
  refresh: "Refresh",
  publishedHint: "Hide keeps the bok and its history in Deleted.",
  archivedHint: "Restore returns a bok to its previous state. Permanent deletion cannot be undone.",
}, { ru: {
  loading: "Загрузка...",
  noneMatch: (scope: ContentScope) => `Нет ${scope === "published" ? "опубликованных" : "удалённых"} боков по запросу.`,
  loadFailed: "Не удалось загрузить контент.",
  movedToDeleted: (title: string) => `«${title}» перемещён в Удалённые.`,
  restored: (title: string) => `«${title}» возвращён в прежнее состояние.`,
  erased: (title: string) => `«${title}» удалён навсегда.`,
  contentStatus: "Статус контента",
  published: "Опубликованные",
  deleted: "Удалённые",
  searchLabel: "Поиск по названию или автору",
  searchPlaceholder: "Начните вводить…",
  range: (start: number, end: number) => `${start}–${end} из `,
  count: (n: number, scope: ContentScope) => `${n} ${scope === "published"
    ? plural("ru", n, { one: "опубликованный бок", few: "опубликованных бока", many: "опубликованных боков", other: "опубликованного бока" })
    : plural("ru", n, { one: "удалённый бок", few: "удалённых бока", many: "удалённых боков", other: "удалённого бока" })}`,
  sortBoks: "Сортировка боков",
  sortMinutes: "Время чтения",
  sortReaders: "Читатели",
  sortFinish: "Доля дочитываний",
  sortNewest: "Сначала новые",
  sortTitle: "Название",
  min: "мин",
  readers: "читателей",
  finished: "дочитали",
  readStarted: "дочитали / начали",
  manage: "Управление боком",
  details: (minutes: number, words: number, likes: number) => `${minutes} мин · ${words} ${plural("ru", words, { one: "слово", few: "слова", many: "слов", other: "слова" })} · ${likes} ${plural("ru", likes, { one: "лайк", few: "лайка", many: "лайков", other: "лайка" })}`,
  removed: "Удалён",
  unknownDate: "в неизвестную дату",
  noReason: "Причина не указана",
  hide: "Скрыть бок",
  restore: "Восстановить бок",
  deletePermanently: "Удалить навсегда",
  pageOf: (start: number, end: number, total: number) => `${start}–${end} из ${total}`,
  previous: "Назад",
  next: "Далее",
  refresh: "Обновить",
  publishedHint: "Скрытый бок вместе с историей остаётся в Удалённых.",
  archivedHint: "Восстановление возвращает бок в прежнее состояние. Удаление навсегда нельзя отменить.",
} });

/** Published and soft-deleted boks, with irreversible deletion as a separate step. */
export function ContentOperations() {
  const [rows, setRows] = useState<BoksContentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("minutes");
  const [scope, setScope] = useState<ContentScope>("published");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<string | typeof loading>(loading);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BokLifecycleTarget | null>(null);
  const { openBok, changes } = useAdminInspector();
  const t = useMessages(words);
  const language = useUiLanguage();

  // Only the newest request may write; a slow page-1 answer otherwise lands
  // after page 2 and replaces it.
  const latestRequest = useRef(0);

  const refresh = useCallback(async (search: string, order: string, pageIndex: number, nextScope: ContentScope) => {
    const request = ++latestRequest.current;
    setBusy(true);
    try {
      const payload = await loadBoksContent({
        query: search,
        sort: order,
        status: nextScope,
        limit: pageSize,
        offset: pageIndex * pageSize,
      });
      if (request !== latestRequest.current) return;
      setRows(payload.rows);
      setTotal(payload.total);
      setStatus(payload.rows.length ? "" : words[currentUiLanguage()].noneMatch(nextScope));
    } catch (error) {
      if (request !== latestRequest.current) return;
      setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].loadFailed);
    } finally {
      if (request === latestRequest.current) setBusy(false);
    }
  }, []);

  // `changes` moves when the boks view hides, restores or erases a boks.
  useEffect(() => {
    const handle = window.setTimeout(() => refresh(query, sort, page, scope).catch(() => undefined), 200);
    return () => window.clearTimeout(handle);
  }, [query, sort, page, scope, refresh, changes]);

  function changeScope(nextScope: ContentScope) {
    if (nextScope === scope) return;
    setRows([]);
    setTotal(0);
    setStatus(loading);
    setScope(nextScope);
    setPage(0);
    setNotice("");
  }

  function openAction(kind: BokLifecycleAction, row: BoksContentRow) {
    setPending({ kind, bok: { id: row.id, title: row.title } });
    setNotice("");
  }

  async function afterAction({ kind, bok }: BokLifecycleTarget) {
    setPending(null);
    setNotice(
      kind === "archive"
        ? t.movedToDeleted(bok.title)
        : kind === "restore"
          ? t.restored(bok.title)
          : t.erased(bok.title)
    );
    await refresh(query, sort, page, scope);
  }

  const pageStart = total ? page * pageSize + 1 : 0;
  const pageEnd = Math.min((page + 1) * pageSize, total);

  return (
    <section className="studio-content-list">
      <div className="admin-segmented studio-tabs" aria-label={t.contentStatus}>
        <button type="button" aria-pressed={scope === "published"} onClick={() => changeScope("published")}>{t.published}</button>
        <button type="button" aria-pressed={scope === "archived"} onClick={() => changeScope("archived")}>{t.deleted}</button>
      </div>
      <label className="studio-search">
        <span>{t.searchLabel}</span>
        <span><Search aria-hidden="true" /><Input placeholder={t.searchPlaceholder} value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></span>
      </label>
      <div className="studio-filter-line">
        <p>{total > pageSize ? t.range(pageStart, pageEnd) : ""}{t.count(total, scope)}</p>
        <select aria-label={t.sortBoks} className="field-control" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}>
          <option value="minutes">{t.sortMinutes}</option><option value="readers">{t.sortReaders}</option><option value="finish">{t.sortFinish}</option><option value="newest">{t.sortNewest}</option><option value="title">{t.sortTitle}</option>
        </select>
      </div>
      {(status || notice) && <p className="studio-notice" aria-live="polite">{(status === loading ? t.loading : status) || notice}</p>}
      <div className="studio-catalogue-list">
        {rows.map((row) => (
          <article key={row.id} className="studio-catalogue-row">
            <button type="button" className="studio-catalogue-open" onClick={() => openBok(row.id)}>
              <h2>{row.title}</h2>
              <p>{row.authorName}{row.authorHandle ? ` · @${row.authorHandle.replace(/^@+/, "")}` : ""} · {row.genre}</p>
              <span className="studio-book-metrics"><span><strong>{row.minutes}</strong> {t.min}</span><span><strong>{row.readers}</strong> {t.readers}</span><span><strong>{row.starts >= 10 && row.finishRate !== null ? `${row.finishRate}%` : `${row.completes}/${row.starts}`}</strong> {row.starts >= 10 && row.finishRate !== null ? t.finished : t.readStarted}</span></span>
            </button>
            <details className="studio-row-details"><summary>{t.manage}</summary><div>
              <p className="studio-meta">{t.details(row.estimatedMinutes, row.wordCount, row.likes)} · {row.mood}</p>
              {scope === "archived" && <p className="studio-meta">{t.removed} {row.archivedAt ? new Date(row.archivedAt).toLocaleDateString(language) : t.unknownDate} · {row.archiveReason || t.noReason}</p>}
              <div className="studio-inline">
                {scope === "published" ? <Button variant="outline" onClick={() => openAction("archive", row)} disabled={busy}><Archive /> {t.hide}</Button> : <>
                  <Button variant="outline" onClick={() => openAction("restore", row)} disabled={busy}><RotateCcw /> {t.restore}</Button>
                  <Button variant="ghost" onClick={() => openAction("delete", row)} disabled={busy}><Trash2 /> {t.deletePermanently}</Button>
                </>}
              </div>
            </div></details>
          </article>
        ))}
      </div>
      {total > pageSize && <div className="studio-pagination"><span>{t.pageOf(pageStart, pageEnd, total)}</span><div>
        <Button variant="outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>{t.previous}</Button>
        <Button variant="outline" disabled={pageEnd >= total} onClick={() => setPage(page + 1)}>{t.next}</Button>
      </div></div>}
      <div className="studio-list-footer">
        <Button variant="ghost" onClick={() => refresh(query, sort, page, scope)} disabled={busy}><RefreshCw className="size-4" /> {t.refresh}</Button>
        <p className="studio-meta">{scope === "published" ? t.publishedHint : t.archivedHint}</p>
      </div>
      <BackgroundJobs refreshKey={changes} />

      <BokLifecycleDialog target={pending} onClose={() => setPending(null)} onDone={afterAction} />
    </section>
  );
}
