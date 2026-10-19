"use client";

import { useState } from "react";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BoksPersonRow } from "@/components/boks/client-types";
import { deleteBoksUser, setBoksAdminRole, setBoksUserBan } from "@/components/boks/supabase-browser-data";

type PersonAction = "grant-admin" | "revoke-admin" | "ban" | "unban" | "delete";


const actionCopy: Record<PersonAction, { title: string; action: string }> = {
  "grant-admin": { title: "Grant admin access?", action: "Grant access" },
  "revoke-admin": { title: "Revoke admin access?", action: "Revoke access" },
  ban: { title: "Suspend this account?", action: "Suspend account" },
  unban: { title: "Restore this account?", action: "Restore account" },
  delete: { title: "Permanently delete this account?", action: "Delete account" },
};


type AccountTarget = Pick<BoksPersonRow, "userId" | "handle" | "role" | "bannedAt">;
export function PersonActions({ row, currentUserId, onChanged }: { row: AccountTarget; currentUserId: string | null; onChanged: () => void | Promise<void> }) {
  const [kind, setKind] = useState<PersonAction | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const self = row.userId === currentUserId;
  const typedHandle = confirmation.trim().replace(/^@+/, "");
  const expected = row.handle || row.userId;
  const ready = (kind !== "ban" || reason.trim().length > 0) && (kind !== "delete" || typedHandle === expected);
  function open(next: PersonAction) { setKind(next); setReason(""); setConfirmation(""); setError(""); setNotice(""); }
  async function apply() {
    if (!kind || !ready || busy) return;
    setBusy(true); setError("");
    try {
      if (kind === "grant-admin" || kind === "revoke-admin") await setBoksAdminRole(row.userId, kind === "grant-admin");
      else if (kind === "ban" || kind === "unban") await setBoksUserBan(row.userId, kind === "ban", reason.trim());
      else await deleteBoksUser(row.userId, typedHandle);
      setKind(null); setNotice(kind === "delete" ? "Account deleted; authored boks archived and anonymised." : "Account updated.");
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update this account."); }
    finally { setBusy(false); }
  }
  return <>
    <div className="studio-inline studio-person-actions">
      <Button variant="outline" disabled={busy || self || Boolean(row.bannedAt)} onClick={() => open(row.role === "admin" ? "revoke-admin" : "grant-admin")}>Role</Button>
      <Button variant="outline" disabled={busy || self || row.role === "admin"} onClick={() => open(row.bannedAt ? "unban" : "ban")}>{row.bannedAt ? "Restore" : "Suspend"}</Button>
      <Button variant="ghost" disabled={busy || self || row.role === "admin"} onClick={() => open("delete")}>Delete</Button>
    </div>
    {notice && <p className="studio-meta" role="status">{notice}</p>}
    <Dialog open={Boolean(kind)} onOpenChange={(open) => !open && !busy && setKind(null)}>
      <DialogContent className="studio-dialog" onInteractOutside={(event) => busy && event.preventDefault()} onEscapeKeyDown={(event) => busy && event.preventDefault()}>
        <div className="studio-dialog-brand"><BoksLogo /></div>
        <DialogHeader><p className="studio-eyebrow">Account / access</p><DialogTitle>{kind ? actionCopy[kind].title : "Account access"}</DialogTitle>
          <DialogDescription>{kind === "delete" ? "The account and its reactions are removed permanently. Authored boks are archived and anonymised." : kind === "ban" ? "Reading stays available. Social actions and publication are paused until this account is restored." : kind === "unban" ? "The account will regain social and publishing access." : "Admins can publish and remove boks, review reports, manage accounts and change experiments."}</DialogDescription>
        </DialogHeader>
        <div className="studio-paper-slip"><span className="studio-eyebrow">{row.role === "admin" ? "Admin" : "Reader"}</span><h2 className={(row.handle?.length ?? 0) > 18 ? "studio-long-handle" : undefined}>@{row.handle || "reader"}</h2></div>
        {(kind === "grant-admin" || kind === "revoke-admin") && <p className="studio-hint">You cannot remove your own access or the last active admin. The server checks this again.</p>}
        {kind === "ban" && <label className="studio-field">Reason shown to this person<Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} autoFocus /></label>}
        {kind === "delete" && <label className="studio-field">Type @{expected} to confirm<Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /></label>}
        {error && <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setKind(null)}>Cancel</Button><Button variant={kind === "delete" || kind === "ban" ? "destructive" : "default"} disabled={busy || !ready} onClick={() => void apply()}>{busy ? "Working…" : kind ? actionCopy[kind].action : "Confirm"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
