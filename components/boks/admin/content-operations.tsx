"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoksContentRow } from "@/components/boks/client-types";
import { loadBoksContent } from "@/components/boks/supabase-browser-data";

const pageSize = 50;

/**
 * Which boks are actually being read.
 *
 * Sorted by reading minutes rather than by views, because a boks that is opened
 * and abandoned is not working. Finish rate is shown only where enough readers
 * started the piece for the number to mean anything - below that it prints the
 * count instead of a percentage.
 */
export function ContentOperations() {
  const [rows, setRows] = useState<BoksContentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("minutes");
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("Loading...");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (search: string, order: string, pageIndex: number) => {
    setBusy(true);
    try {
      const payload = await loadBoksContent({
        query: search,
        sort: order,
        limit: pageSize,
        offset: pageIndex * pageSize,
      });
      setRows(payload.rows);
      setTotal(payload.total);
      setStatus(payload.rows.length ? "" : "No published boks match.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load content.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(query, sort, page).catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, sort, page, refresh]);

  const pageStart = total ? page * pageSize + 1 : 0;
  const pageEnd = Math.min((page + 1) * pageSize, total);

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">Content</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {pageStart}-{pageEnd} of {total} published boks · ranked by reading time {status && `· ${status}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              className="w-[220px] pl-9"
              placeholder="Search boks"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <select
            className="field-control w-[180px]"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(0);
            }}
          >
            <option value="minutes">Reading time</option>
            <option value="readers">Readers</option>
            <option value="finish">Finish rate</option>
            <option value="newest">Newest</option>
            <option value="title">Title</option>
          </select>
          <Button variant="outline" onClick={() => refresh(query, sort, page)} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      <div className="content-table">
        <div className="content-row content-head">
          <span>Boks</span>
          <span>Minutes</span>
          <span>Readers</span>
          <span>Finished</span>
          <span>Length</span>
          <span>Likes</span>
        </div>
        {rows.map((row) => (
          <div key={row.id} className="content-row">
            <span>
              <strong>{row.title}</strong>
              <small>
                {row.authorHandle ? `@${row.authorHandle.replace(/^@+/, "")}` : row.authorName} · {row.genre} · {row.mood}
              </small>
            </span>
            <span>{row.minutes}</span>
            <span>{row.readers}</span>
            <span>
              {row.starts >= 10 && row.finishRate !== null ? (
                `${row.finishRate}%`
              ) : (
                <>
                  {row.completes}
                  <small>of {row.starts} starts</small>
                </>
              )}
            </span>
            <span>
              {row.estimatedMinutes} min
              <small>{row.wordCount} words</small>
            </span>
            <span>{row.likes}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          Finish rate appears once at least ten readers have started a boks. Below that it shows the
          raw counts, because a percentage off three readers is not a rate.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>
            Previous
          </Button>
          <Button variant="outline" disabled={pageEnd >= total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}
