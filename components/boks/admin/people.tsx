"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, RefreshCw, Search, Shield, ShieldOff, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BoksPersonRow } from "@/components/boks/client-types";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import {
  deleteBoksUser,
  loadBoksPeople,
  setBoksAdminRole,
  setBoksUserBan,
} from "@/components/boks/supabase-browser-data";

type PersonAction = "grant-admin" | "revoke-admin" | "ban" | "unban" | "delete";
type PendingAction = { kind: PersonAction; row: BoksPersonRow };

const actionCopy: Record<PersonAction, { title: string; action: string }> = {
  "grant-admin": { title: "Grant admin access?", action: "Grant access" },
  "revoke-admin": { title: "Revoke admin access?", action: "Revoke access" },
  ban: { title: "Suspend this account?", action: "Suspend account" },
  unban: { title: "Restore this account?", action: "Restore account" },
  delete: { title: "Permanently delete this account?", action: "Delete account" },
};

/** Account governance. Every mutation is enforced again by an admin-only RPC. */
export function AdminPeople({ currentUserId }: { currentUserId: string | null }) {
  const [rows, setRows] = useState<BoksPersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const { openPerson } = useAdminInspector();

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
    const handle = window.setTimeout(() => refresh(query).catch(() => undefined), 200);
    return () => window.clearTimeout(handle);
  }, [query, refresh]);

  const expectedConfirmation = useMemo(
    () => pending?.row.handle || pending?.row.userId || "",
    [pending],
  );

  function openAction(kind: PersonAction, row: BoksPersonRow) {
    setPending({ kind, row });
    setReason("");
    setConfirmation("");
    setNotice("");
  }

  async function applyAction() {
    if (!pending) return;
    setBusy(true);
    setStatus("");
    try {
      const { kind, row } = pending;
      if (kind === "grant-admin" || kind === "revoke-admin") {
        await setBoksAdminRole(row.userId, kind === "grant-admin");
        setNotice(kind === "grant-admin" ? `@${row.handle} is now an admin.` : `Admin access removed from @${row.handle}.`);
      } else if (kind === "ban" || kind === "unban") {
        await setBoksUserBan(row.userId, kind === "ban", reason);
        setNotice(kind === "ban" ? `@${row.handle} is suspended.` : `@${row.handle} can use boks again.`);
      } else {
        const result = await deleteBoksUser(row.userId, confirmation);
        setNotice(`Account deleted. ${result.archivedBoks} authored boks moved to Deleted.`);
      }
      setPending(null);
      await refresh(query);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update this account.");
    } finally {
      setBusy(false);
    }
  }

  const actionReady =
    !pending ||
    ((pending.kind !== "ban" || reason.trim().length > 0) &&
      (pending.kind !== "delete" || confirmation === expectedConfirmation));

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">People</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {total} account{total === 1 ? "" : "s"} · admin access and account safety
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

      {(status || notice) && (
        <p className="border-b border-[var(--border)] p-4 text-sm text-[var(--muted-foreground)]" aria-live="polite">
          {status || notice}
        </p>
      )}

      <div className="people-table">
        <div className="people-row people-head">
          <span>Reader</span><span>Status</span><span>Minutes</span><span>Finished</span>
          <span>Sessions</span><span>Arm</span><span>Last read</span><span>Actions</span>
        </div>
        {rows.map((row) => {
          const isSelf = row.userId === currentUserId;
          const isBanned = Boolean(row.bannedAt);
          return (
            <div key={row.userId} className="people-row">
              <span>
                <button
                  type="button"
                  className="inspector-link inspector-link--title"
                  onClick={() => openPerson(row.userId)}
                  title="Open this account: boks written, liked, commented, and metrics"
                >
                  @{row.handle || "reader"}
                </button>
                <small>{row.email}</small>
              </span>
              <span>
                {isBanned ? "Suspended" : row.role === "admin" ? "Admin" : "Active"}
                {isBanned && <small title={row.banReason ?? undefined}>{row.banReason}</small>}
              </span>
              <span>{row.minutes}</span>
              <span>{row.boksFinished}<small>of {row.boksOpened} opened</small></span>
              <span>{row.sessions}</span>
              <span>{row.algorithmId ?? "—"}</span>
              <span>{row.lastReadAt ? new Date(row.lastReadAt).toLocaleDateString() : "never"}</span>
              <span className="admin-row-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || isSelf || isBanned}
                  onClick={() => openAction(row.role === "admin" ? "revoke-admin" : "grant-admin", row)}
                  title={row.role === "admin" ? "Revoke admin access" : "Grant admin access"}
                >
                  {row.role === "admin" ? <ShieldOff /> : <Shield />}
                  {row.role === "admin" ? "Revoke" : "Admin"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || isSelf || row.role === "admin"}
                  onClick={() => openAction(isBanned ? "unban" : "ban", row)}
                  title={isBanned ? "Restore account" : "Suspend account"}
                >
                  {isBanned ? <Undo2 /> : <Ban />}
                  {isBanned ? "Restore" : "Suspend"}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy || isSelf || row.role === "admin"}
                  onClick={() => openAction("delete", row)}
                  title="Delete account"
                  aria-label={`Delete @${row.handle || "reader"}`}
                >
                  <Trash2 />
                </Button>
              </span>
            </div>
          );
        })}
      </div>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && !busy && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending ? actionCopy[pending.kind].title : "Confirm action"}</DialogTitle>
            <DialogDescription>
              {pending?.kind === "delete"
                ? "This removes the account and its reactions permanently. Authored boks are anonymised and moved to Deleted; they are not erased."
                : pending?.kind === "ban"
                  ? "The person can keep reading, but cannot like, comment, follow, report, or publish until restored."
                  : pending?.kind === "unban"
                    ? "The account will regain interaction and publishing access."
                    : "Admin access changes immediately and is enforced by the database."}
            </DialogDescription>
          </DialogHeader>
          {pending?.kind === "ban" && (
            <label className="grid gap-2 text-sm font-medium">
              Reason shown to the user
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} autoFocus />
            </label>
          )}
          {pending?.kind === "delete" && (
            <label className="grid gap-2 text-sm font-medium">
              Type <strong>@{expectedConfirmation}</strong> to confirm
              <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus />
            </label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>Cancel</Button>
            <Button
              variant={pending?.kind === "delete" || pending?.kind === "ban" ? "destructive" : "default"}
              onClick={applyAction}
              disabled={busy || !actionReady}
            >
              {pending ? actionCopy[pending.kind].action : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
