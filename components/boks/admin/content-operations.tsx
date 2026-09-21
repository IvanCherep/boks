"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoksContentRow } from "@/components/boks/client-types";
import { loadBoksContent, loadEmbeddingCoverage } from "@/components/boks/supabase-browser-data";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import {
  BokLifecycleDialog,
  type BokLifecycleAction,
  type BokLifecycleTarget,
} from "@/components/boks/admin/bok-lifecycle-dialog";

const pageSize = 50;
type ContentScope = "published" | "archived";

/** Published and soft-deleted boks, with irreversible deletion as a separate step. */
export function ContentOperations() {
  const [rows, setRows] = useState<BoksContentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("minutes");
  const [scope, setScope] = useState<ContentScope>("published");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("Loading...");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<BokLifecycleTarget | null>(null);
  const [coverage, setCoverage] = useState<{ model: string; publishedTotal: number; publishedEmbedded: number; publishedMissing: number } | null>(null);
  const { openBok, changes } = useAdminInspector();

  const refresh = useCallback(async (search: string, order: string, pageIndex: number, nextScope: ContentScope) => {
    setBusy(true);
    try {
      const payload = await loadBoksContent({
        query: search,
        sort: order,
        status: nextScope,
        limit: pageSize,
        offset: pageIndex * pageSize,
      });
      setRows(payload.rows);
      setTotal(payload.total);
      setStatus(payload.rows.length ? "" : `No ${nextScope === "published" ? "published" : "deleted"} boks match.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load content.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadEmbeddingCoverage()
      .then(setCoverage)
      // A missing coverage line is not worth an error in a moderation screen.
      .catch(() => setCoverage(null));
  }, [changes]);

  // `changes` moves when the boks view hides, restores or erases a boks.
  useEffect(() => {
    const handle = window.setTimeout(() => refresh(query, sort, page, scope).catch(() => undefined), 200);
    return () => window.clearTimeout(handle);
  }, [query, sort, page, scope, refresh, changes]);

  function changeScope(nextScope: ContentScope) {
    if (nextScope === scope) return;
    setRows([]);
    setTotal(0);
    setStatus("Loading...");
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
        ? `“${bok.title}” moved to Deleted.`
        : kind === "restore"
          ? `“${bok.title}” restored to the reader feed.`
          : `“${bok.title}” permanently deleted.`
    );
    await refresh(query, sort, page, scope);
  }

  const pageStart = total ? page * pageSize + 1 : 0;
  const pageEnd = Math.min((page + 1) * pageSize, total);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Content</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {pageStart}-{pageEnd} of {total} {scope === "published" ? "published" : "deleted"} boks
          </p>
          {coverage && (
            <p className="text-sm text-[var(--muted-foreground)]">
              {coverage.publishedMissing === 0
                ? `All ${coverage.publishedEmbedded} published boks are embedded (${coverage.model}).`
                : `${coverage.publishedEmbedded} of ${coverage.publishedTotal} embedded — ${coverage.publishedMissing} waiting. Run scripts/embed-catalogue.mjs.`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="admin-segmented" aria-label="Content status">
            <button type="button" aria-pressed={scope === "published"} onClick={() => changeScope("published")}>Published</button>
            <button type="button" aria-pressed={scope === "archived"} onClick={() => changeScope("archived")}>Deleted</button>
          </div>
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              className="w-[220px] pl-9"
              placeholder={`Search ${scope === "published" ? "boks" : "deleted boks"}`}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(0); }}
            />
          </label>
          <select
            className="field-control w-[180px]"
            value={sort}
            onChange={(event) => { setSort(event.target.value); setPage(0); }}
          >
            <option value="minutes">Reading time</option>
            <option value="readers">Readers</option>
            <option value="finish">Finish rate</option>
            <option value="newest">Newest</option>
            <option value="title">Title</option>
          </select>
          <Button variant="outline" onClick={() => refresh(query, sort, page, scope)} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {(status || notice) && (
        <p className="border-b border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]" aria-live="polite">
          {status || notice}
        </p>
      )}

      <div className="content-table">
        <div className="content-row content-head">
          <span>Boks</span><span>Minutes</span><span>Readers</span><span>Finished</span>
          <span>Length</span><span>{scope === "archived" ? "Removed" : "Likes"}</span><span>Actions</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="content-row">
            <span>
              <button
                type="button"
                className="inspector-link inspector-link--title"
                onClick={() => openBok(row.id)}
                title="Open this bok"
              >
                {row.title}
              </button>
              <small>
                {row.authorHandle ? `@${row.authorHandle.replace(/^@+/, "")}` : row.authorName} · {row.genre} · {row.mood}
              </small>
            </span>
            <span>{row.minutes}</span>
            <span>{row.readers}</span>
            <span>
              {row.starts >= 10 && row.finishRate !== null ? `${row.finishRate}%` : <>{row.completes}<small>of {row.starts} starts</small></>}
            </span>
            <span>{row.estimatedMinutes} min<small>{row.wordCount} words</small></span>
            <span>
              {scope === "archived" ? (
                <>{row.archivedAt ? new Date(row.archivedAt).toLocaleDateString() : "Unknown"}<small title={row.archiveReason ?? undefined}>{row.archiveReason || "No reason recorded"}</small></>
              ) : row.likes}
            </span>
            <span className="admin-row-actions">
              {scope === "published" ? (
                <Button size="sm" variant="outline" onClick={() => openAction("archive", row)} disabled={busy}>
                  <Archive /> Hide
                </Button>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => openAction("restore", row)} disabled={busy}>
                    <RotateCcw /> Restore
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => openAction("delete", row)}
                    disabled={busy}
                    title="Delete permanently"
                    aria-label={`Permanently delete ${row.title}`}
                  >
                    <Trash2 />
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          {scope === "published"
            ? "Hide moves a bok out of the reader feed without erasing anything. Hidden boks are listed under Deleted."
            : "Restore puts a bok back where it was before it was hidden. Only this view offers permanent deletion."}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Previous</Button>
          <Button variant="outline" disabled={pageEnd >= total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      </div>

      <BokLifecycleDialog target={pending} onClose={() => setPending(null)} onDone={afterAction} />
    </section>
  );
}
