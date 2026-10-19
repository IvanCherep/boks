"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoksPersonRow } from "@/components/boks/client-types";
import { PersonActions } from "@/components/boks/admin/person-actions";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import {
  loadBoksPeople,
} from "@/components/boks/supabase-browser-data";

const pageSize = 100;

/** Account governance. Every mutation is enforced again by an admin-only RPC. */
export function AdminPeople({ currentUserId }: { currentUserId: string | null }) {
  const [rows, setRows] = useState<BoksPersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [busy, setBusy] = useState(false);
  const { openPerson, changes } = useAdminInspector();
  const [page, setPage] = useState(0);
  // Only the newest search may write: typing "iv" then "ivan" otherwise lets
  // the slower "iv" answer land last and replace the list.
  const latestRequest = useRef(0);

  const refresh = useCallback(async (search: string, pageIndex: number) => {
    const request = ++latestRequest.current;
    setBusy(true);
    try {
      const payload = await loadBoksPeople({ query: search, limit: pageSize, offset: pageIndex * pageSize });
      if (request !== latestRequest.current) return;
      setRows(payload.rows);
      setTotal(payload.total);
      setStatus(payload.rows.length ? "" : "No permanent reader accounts match.");
    } catch (error) {
      if (request !== latestRequest.current) return;
      setStatus(error instanceof Error ? error.message : "Could not load people.");
    } finally {
      if (request === latestRequest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => refresh(query, page).catch(() => undefined), 200);
    return () => window.clearTimeout(handle);
  }, [query, page, refresh, changes]);

  const pageStart = total ? page * pageSize + 1 : 0;
  const pageEnd = Math.min((page + 1) * pageSize, total);

  return (
    <section className="studio-people">
      <label className="studio-search"><span>Search email or @handle</span><span><Search aria-hidden="true" />
        <Input placeholder="Find an account…" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
      </span></label>
      <div className="studio-filter-line"><p>{total > pageSize ? `${pageStart}–${pageEnd} of ` : ""}{total} accounts</p>
        <Button variant="ghost" onClick={() => refresh(query, page)} disabled={busy}><RefreshCw className="size-4" /> Refresh</Button>
      </div>
      {status && <p className="studio-notice" aria-live="polite">{status}</p>}
      <div className="studio-person-list">
        {rows.map((row) => {
          const isBanned = Boolean(row.bannedAt);
          return <article key={row.userId} className="studio-person-row">
            <div className="studio-person-summary">
              <button type="button" onClick={() => openPerson(row.userId)}>
                <strong>@{row.handle || "reader"}</strong><small>{isBanned ? "Suspended" : "Active"} · {row.minutes} min · {row.boksFinished} boks read</small>
              </button>
              <span className={`studio-role ${isBanned ? "is-suspended" : row.role === "admin" ? "is-admin" : ""}`}>{isBanned ? "Paused" : row.role === "admin" ? "Admin" : "Reader"}</span>
            </div>
            <details className="studio-row-details"><summary>Account & access</summary><div>
              <dl className="studio-facts"><dt>Email</dt><dd>{row.email}</dd><dt>Reading</dt><dd>{row.boksFinished} of {row.boksOpened} opened · {row.sessions} sessions</dd><dt>Algorithm</dt><dd>{row.algorithmId ?? "Unassigned"}</dd><dt>Last read</dt><dd>{row.lastReadAt ? new Date(row.lastReadAt).toLocaleDateString() : "Never"}</dd>{isBanned && <><dt>Suspension</dt><dd>{row.banReason}</dd></>}</dl>
              <PersonActions row={row} currentUserId={currentUserId} onChanged={() => refresh(query, page)} />
            </div></details>
          </article>;
        })}
      </div>
      {total > pageSize && <div className="studio-pagination"><span>{pageStart}–{pageEnd} of {total}</span><div>
        <Button variant="outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Previous</Button>
        <Button variant="outline" disabled={pageEnd >= total} onClick={() => setPage(page + 1)}>Next</Button>
      </div></div>}

    </section>
  );
}
