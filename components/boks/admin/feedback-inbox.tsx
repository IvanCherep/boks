"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoksFeedbackPage, BoksFeedbackRow } from "@/components/boks/client-types";
import { loadBoksFeedback } from "@/components/boks/supabase-browser-data";

const pageSize = 100;

const surfaceLabels: Record<string, string> = {
  settings: "Settings",
  after_3: "After 3 boks",
  after_10: "After 10 boks",
  after_30: "After 30 boks",
  other: "Elsewhere",
};

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
  const [page, setPage] = useState<BoksFeedbackPage | null>(null);
  const [rows, setRows] = useState<BoksFeedbackRow[]>([]);
  const [status, setStatus] = useState("Loading…");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (offset: number) => {
    setBusy(true);
    try {
      const next = await loadBoksFeedback({ limit: pageSize, offset });
      setPage(next);
      setRows((current) => (offset === 0 ? next.rows : [...current, ...next.rows]));
      setStatus(next.total === 0 ? "Nothing yet. The box is in Settings and after the 3rd, 10th and 30th bok." : "");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load feedback.");
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
              ? `${page.total} note${page.total === 1 ? "" : "s"}, ${page.newToday} in the last 24 hours`
              : "Reading the inbox…"}
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
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>

      <div className="studio-feedback-list">
        {status && <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}

        {rows.map((row) => (
          <article key={row.id} className="studio-feedback-note">
            <p className="whitespace-pre-wrap text-sm leading-6">{row.message}</p>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {[
                row.handle ? `@${row.handle}` : "a reader with no account",
                surfaceLabels[row.surface] ?? row.surface,
                `${row.boksRead} bok${row.boksRead === 1 ? "" : "s"} read`,
                new Date(row.createdAt).toLocaleString(),
              ].join(" · ")}
            </p>
          </article>
        ))}

        {page && rows.length < page.total && (
          <Button variant="outline" onClick={() => void refresh(rows.length)} disabled={busy}>
            {busy ? "Loading…" : `Load ${Math.min(pageSize, page.total - rows.length)} more`}
          </Button>
        )}
      </div>
    </section>
  );
}
