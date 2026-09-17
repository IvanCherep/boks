"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoksPersonRow } from "@/components/boks/client-types";
import { loadBoksPeople, setBoksAdminRole } from "@/components/boks/supabase-browser-data";

/**
 * Readers, ranked by how much they actually read.
 *
 * Reading minutes come from attributed events, like every other number in the
 * console. The old version counted rows in the `views` table, which meant this
 * page and the rest of the console could disagree about the same reader.
 */
export function AdminPeople({ currentUserId }: { currentUserId: string | null }) {
  const [rows, setRows] = useState<BoksPersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (search: string) => {
    setBusy(true);
    try {
      const payload = await loadBoksPeople({ query: search, limit: 200 });
      setRows(payload.rows);
      setTotal(payload.total);
      setStatus(payload.rows.length ? "" : "No permanent reader accounts match.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load people.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(query).catch(() => undefined);
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query, refresh]);

  async function toggleAdmin(userId: string, isAdmin: boolean) {
    setBusy(true);
    try {
      await setBoksAdminRole(userId, isAdmin);
      await refresh(query);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update admin role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">People</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {total} account{total === 1 ? "" : "s"} · sorted by reading time · admin access is granted from here only
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              className="w-[220px] pl-9"
              placeholder="Search email or @nickname"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Button variant="outline" onClick={() => refresh(query)} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {status && <p className="p-4 text-sm text-[var(--muted-foreground)]">{status}</p>}

      <div className="people-table">
        <div className="people-row people-head">
          <span>Reader</span>
          <span>Role</span>
          <span>Minutes</span>
          <span>Finished</span>
          <span>Sessions</span>
          <span>Arm</span>
          <span>Last read</span>
          <span>Action</span>
        </div>
        {rows.map((row) => (
          <div key={row.userId} className="people-row">
            <span>
              <strong>@{row.handle || "reader"}</strong>
              <small>{row.email}</small>
            </span>
            <span>{row.role}</span>
            <span>{row.minutes}</span>
            <span>
              {row.boksFinished}
              <small>of {row.boksOpened} opened</small>
            </span>
            <span>{row.sessions}</span>
            <span>{row.algorithmId ?? "—"}</span>
            <span>{row.lastReadAt ? new Date(row.lastReadAt).toLocaleDateString() : "never"}</span>
            <span>
              <Button
                variant={row.role === "admin" ? "outline" : "default"}
                disabled={busy || row.userId === currentUserId}
                onClick={() => toggleAdmin(row.userId, row.role !== "admin")}
              >
                {row.role === "admin" ? "Remove" : "Make admin"}
              </Button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
