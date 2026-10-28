"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoksFeedbackPage, BoksFeedbackRow } from "@/components/boks/client-types";
import { loadBoksFeedback } from "@/components/boks/supabase-browser-data";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const pageSize = 100;

const words = defineMessages(
  {
    surfaces: {
      settings: "Settings",
      after_3: "After 3 boks",
      after_10: "After 10 boks",
      after_30: "After 30 boks",
      other: "Elsewhere",
    } as Record<string, string>,
    loading: "Loading…",
    empty: "Nothing yet. The box is in Settings and after the 3rd, 10th and 30th bok.",
    couldNotLoad: "Could not load feedback.",
    totals: (total: number, today: number) => `${total} note${total === 1 ? "" : "s"}, ${today} in the last 24 hours`,
    reading: "Reading the inbox…",
    refresh: "Refresh",
    noAccount: "a reader with no account",
    boksRead: (n: number) => `${n} bok${n === 1 ? "" : "s"} read`,
    loadMore: (n: number) => `Load ${n} more`,
  },
  {
    ru: {
      surfaces: {
        settings: "Настройки",
        after_3: "После 3 боков",
        after_10: "После 10 боков",
        after_30: "После 30 боков",
        other: "В другом месте",
      },
      loading: "Загрузка…",
      empty: "Пока ничего. Форма есть в настройках и после 3-го, 10-го и 30-го бока.",
      couldNotLoad: "Не удалось загрузить отзывы.",
      totals: (total: number, today: number) =>
        `${total} ${plural("ru", total, { one: "отзыв", few: "отзыва", many: "отзывов", other: "отзыва" })}, ${today} за последние 24 часа`,
      reading: "Читаем входящие…",
      refresh: "Обновить",
      noAccount: "читатель без аккаунта",
      boksRead: (n: number) => `прочитано ${n} ${plural("ru", n, { one: "бок", few: "бока", many: "боков", other: "бока" })}`,
      loadMore: (n: number) => `Загрузить ещё ${n}`,
    },
  }
);

/**
 * Everything readers have written, newest first.
 *
 * Deliberately plain: no triage, no statuses, no replies. At this size the
 * useful thing is to read all of it in one sitting, and a workflow nobody uses
 * would only hide notes behind a filter. What is shown beside each note is what
 * cannot be reconstructed later - where the box was opened, and how many boks
 * that reader had finished when they wrote.
 *
 * A note can come from a reader with no account, and then there is no name to
 * show. That is the feature working, not data missing.
 */
export function FeedbackInbox() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const surfaceLabels = t.surfaces;
  const [page, setPage] = useState<BoksFeedbackPage | null>(null);
  const [rows, setRows] = useState<BoksFeedbackRow[]>([]);
  const [status, setStatus] = useState(() => words[currentUiLanguage()].loading);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (offset: number) => {
    setBusy(true);
    try {
      const next = await loadBoksFeedback({ limit: pageSize, offset });
      setPage(next);
      setRows((current) => (offset === 0 ? next.rows : [...current, ...next.rows]));
      setStatus(next.total === 0 ? words[currentUiLanguage()].empty : "");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotLoad);
    } finally {
      setBusy(false);
    }
  }, []);

  // Off the render path, the way the other admin tables load: `refresh` sets
  // its busy flag straight away, and doing that inside an effect body makes
  // React re-render before the first paint.
  useEffect(() => {
    const handle = window.setTimeout(() => refresh(0).catch(() => undefined), 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  return (
    <section className="studio-feedback">
      <div className="studio-filter-line">
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {page
              ? t.totals(page.total, page.newToday)
              : t.reading}
          </p>
          {page && Object.keys(page.bySurface).length > 0 && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {Object.entries(page.bySurface)
                .map(([surface, count]) => `${surfaceLabels[surface] ?? surface}: ${count}`)
                .join(" · ")}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={() => void refresh(0)} disabled={busy}>
          <RefreshCw className="size-4" /> {t.refresh}
        </Button>
      </div>

      <div className="studio-feedback-list">
        {status && <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}

        {rows.map((row) => (
          <article key={row.id} className="studio-feedback-note">
            <p className="whitespace-pre-wrap text-sm leading-6">{row.message}</p>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {[
                row.handle ? `@${row.handle}` : t.noAccount,
                surfaceLabels[row.surface] ?? row.surface,
                t.boksRead(row.boksRead),
                new Date(row.createdAt).toLocaleString(language),
              ].join(" · ")}
            </p>
          </article>
        ))}

        {page && rows.length < page.total && (
          <Button variant="outline" onClick={() => void refresh(rows.length)} disabled={busy}>
            {busy ? t.loading : t.loadMore(Math.min(pageSize, page.total - rows.length))}
          </Button>
        )}
      </div>
    </section>
  );
}
