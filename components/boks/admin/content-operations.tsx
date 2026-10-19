"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
      setStatus(payload.rows.length ? "" : `No ${nextScope === "published" ? "published" : "deleted"} boks match.`);
    } catch (error) {
      if (request !== latestRequest.current) return;
      setStatus(error instanceof Error ? error.message : "Could not load content.");
    } finally {
      if (request === latestRequest.current) setBusy(false);
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
          ? `“${bok.title}” restored to its previous state.`
          : `“${bok.title}” permanently deleted.`
    );
    await refresh(query, sort, page, scope);
  }

  const pageStart = total ? page * pageSize + 1 : 0;
  const pageEnd = Math.min((page + 1) * pageSize, total);

  return (
    <section className="studio-content-list">
      <div className="admin-segmented studio-tabs" aria-label="Content status">
        <button type="button" aria-pressed={scope === "published"} onClick={() => changeScope("published")}>Published</button>
        <button type="button" aria-pressed={scope === "archived"} onClick={() => changeScope("archived")}>Deleted</button>
      </div>
      <label className="studio-search">
        <span>Search title or author</span>
        <span><Search aria-hidden="true" /><Input placeholder="Start typing…" value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></span>
      </label>
      <div className="studio-filter-line">
        <p>{total > pageSize ? `${pageStart}–${pageEnd} of ` : ""}{total} {scope === "published" ? "published" : "deleted"} boks</p>
        <select aria-label="Sort boks" className="field-control" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }}>
          <option value="minutes">Reading time</option><option value="readers">Readers</option><option value="finish">Finish rate</option><option value="newest">Newest</option><option value="title">Title</option>
        </select>
      </div>
      {(status || notice) && <p className="studio-notice" aria-live="polite">{status || notice}</p>}
      <div className="studio-catalogue-list">
        {rows.map((row) => (
          <article key={row.id} className="studio-catalogue-row">
            <button type="button" className="studio-catalogue-open" onClick={() => openBok(row.id)}>
              <h2>{row.title}</h2>
              <p>{row.authorName}{row.authorHandle ? ` · @${row.authorHandle.replace(/^@+/, "")}` : ""} · {row.genre}</p>
              <span className="studio-book-metrics"><span><strong>{row.minutes}</strong> min</span><span><strong>{row.readers}</strong> readers</span><span><strong>{row.starts >= 10 && row.finishRate !== null ? `${row.finishRate}%` : `${row.completes}/${row.starts}`}</strong> {row.starts >= 10 && row.finishRate !== null ? "finished" : "read / started"}</span></span>
            </button>
            <details className="studio-row-details"><summary>Manage bok</summary><div>
              <p className="studio-meta">{row.estimatedMinutes} min long · {row.wordCount} words · {row.likes} likes · {row.mood}</p>
              {scope === "archived" && <p className="studio-meta">Removed {row.archivedAt ? new Date(row.archivedAt).toLocaleDateString() : "on an unknown date"} · {row.archiveReason || "No reason recorded"}</p>}
              <div className="studio-inline">
                {scope === "published" ? <Button variant="outline" onClick={() => openAction("archive", row)} disabled={busy}><Archive /> Hide bok</Button> : <>
                  <Button variant="outline" onClick={() => openAction("restore", row)} disabled={busy}><RotateCcw /> Restore bok</Button>
                  <Button variant="ghost" onClick={() => openAction("delete", row)} disabled={busy}><Trash2 /> Delete permanently</Button>
                </>}
              </div>
            </div></details>
          </article>
        ))}
      </div>
      {total > pageSize && <div className="studio-pagination"><span>{pageStart}–{pageEnd} of {total}</span><div>
        <Button variant="outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Previous</Button>
        <Button variant="outline" disabled={pageEnd >= total} onClick={() => setPage(page + 1)}>Next</Button>
      </div></div>}
      <div className="studio-list-footer">
        <Button variant="ghost" onClick={() => refresh(query, sort, page, scope)} disabled={busy}><RefreshCw className="size-4" /> Refresh</Button>
        <p className="studio-meta">{scope === "published" ? "Hide keeps the bok and its history in Deleted." : "Restore returns a bok to its previous state. Permanent deletion cannot be undone."}</p>
      </div>
      {coverage && <details className="studio-details"><summary>Embedding coverage <span aria-hidden="true">+</span></summary><p className="studio-meta">{coverage.publishedEmbedded} of {coverage.publishedTotal} embedded · {coverage.publishedMissing} waiting · {coverage.model}</p></details>}

      <BokLifecycleDialog target={pending} onClose={() => setPending(null)} onDone={afterAction} />
    </section>
  );
}
