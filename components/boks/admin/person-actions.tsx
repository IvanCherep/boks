"use client";

import { useState } from "react";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BoksPersonRow } from "@/components/boks/client-types";
import { deleteBoksUser, setBoksAdminRole, setBoksUserBan } from "@/components/boks/supabase-browser-data";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

type PersonAction = "grant-admin" | "revoke-admin" | "ban" | "unban" | "delete";


const words = defineMessages(
  {
    actions: {
      "grant-admin": { title: "Grant admin access?", action: "Grant access" },
      "revoke-admin": { title: "Revoke admin access?", action: "Revoke access" },
      ban: { title: "Suspend this account?", action: "Suspend account" },
      unban: { title: "Restore this account?", action: "Restore account" },
      delete: { title: "Permanently delete this account?", action: "Delete account" },
    } as Record<PersonAction, { title: string; action: string }>,
    deleted: "Account deleted; authored boks archived and anonymised.",
    updated: "Account updated.",
    couldNotUpdate: "Could not update this account.",
    role: "Role",
    restore: "Restore",
    suspend: "Suspend",
    delete: "Delete",
    eyebrow: "Account / access",
    accountAccess: "Account access",
    deleteText: "The account and its reactions are removed permanently. Authored boks are archived and anonymised.",
    banText: "Reading stays available. Social actions and publication are paused until this account is restored.",
    unbanText: "The account will regain social and publishing access.",
    adminText: "Admins can publish and remove boks, review reports, manage accounts and change experiments.",
    admin: "Admin",
    reader: "Reader",
    lastAdmin: "You cannot remove your own access or the last active admin. The server checks this again.",
    reason: "Reason shown to this person",
    typeToConfirm: (handle: string) => `Type @${handle} to confirm`,
    cancel: "Cancel",
    working: "Working…",
    confirm: "Confirm",
  },
  {
    ru: {
      actions: {
        "grant-admin": { title: "Дать доступ администратора?", action: "Дать доступ" },
        "revoke-admin": { title: "Забрать доступ администратора?", action: "Забрать доступ" },
        ban: { title: "Заблокировать этот аккаунт?", action: "Заблокировать" },
        unban: { title: "Восстановить этот аккаунт?", action: "Восстановить" },
        delete: { title: "Удалить этот аккаунт навсегда?", action: "Удалить аккаунт" },
      },
      deleted: "Аккаунт удалён; его боки в архиве и обезличены.",
      updated: "Аккаунт обновлён.",
      couldNotUpdate: "Не удалось обновить аккаунт.",
      role: "Роль",
      restore: "Восстановить",
      suspend: "Заблокировать",
      delete: "Удалить",
      eyebrow: "Аккаунт / доступ",
      accountAccess: "Доступ аккаунта",
      deleteText: "Аккаунт и его реакции удаляются навсегда. Написанные им боки уходят в архив и обезличиваются.",
      banText: "Чтение остаётся доступным. Общение и публикация приостановлены, пока аккаунт не восстановят.",
      unbanText: "Аккаунт снова сможет общаться и публиковать.",
      adminText: "Администраторы могут публиковать и снимать боки, разбирать жалобы, управлять аккаунтами и менять эксперименты.",
      admin: "Админ",
      reader: "Читатель",
      lastAdmin: "Нельзя снять доступ с себя или с последнего действующего администратора. Сервер проверит это ещё раз.",
      reason: "Причина, которую увидит человек",
      typeToConfirm: (handle: string) => `Введите @${handle} для подтверждения`,
      cancel: "Отмена",
      working: "Выполняем…",
      confirm: "Подтвердить",
    },
  }
);


type AccountTarget = Pick<BoksPersonRow, "userId" | "handle" | "role" | "bannedAt">;
export function PersonActions({ row, currentUserId, onChanged }: { row: AccountTarget; currentUserId: string | null; onChanged: () => void | Promise<void> }) {
  const t = useMessages(words);
  const actionCopy = t.actions;
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
      setKind(null); setNotice(kind === "delete" ? t.deleted : t.updated);
      await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.couldNotUpdate); }
    finally { setBusy(false); }
  }
  return <>
    <div className="studio-inline studio-person-actions">
      <Button variant="outline" disabled={busy || self || Boolean(row.bannedAt)} onClick={() => open(row.role === "admin" ? "revoke-admin" : "grant-admin")}>{t.role}</Button>
      <Button variant="outline" disabled={busy || self || row.role === "admin"} onClick={() => open(row.bannedAt ? "unban" : "ban")}>{row.bannedAt ? t.restore : t.suspend}</Button>
      <Button variant="ghost" disabled={busy || self || row.role === "admin"} onClick={() => open("delete")}>{t.delete}</Button>
    </div>
    {notice && <p className="studio-meta" role="status">{notice}</p>}
    <Dialog open={Boolean(kind)} onOpenChange={(open) => !open && !busy && setKind(null)}>
      <DialogContent className="studio-dialog" onInteractOutside={(event) => busy && event.preventDefault()} onEscapeKeyDown={(event) => busy && event.preventDefault()}>
        <div className="studio-dialog-brand"><BoksLogo /></div>
        <DialogHeader><p className="studio-eyebrow">{t.eyebrow}</p><DialogTitle>{kind ? actionCopy[kind].title : t.accountAccess}</DialogTitle>
          <DialogDescription>{kind === "delete" ? t.deleteText : kind === "ban" ? t.banText : kind === "unban" ? t.unbanText : t.adminText}</DialogDescription>
        </DialogHeader>
        <div className="studio-paper-slip"><span className="studio-eyebrow">{row.role === "admin" ? t.admin : t.reader}</span><h2 className={(row.handle?.length ?? 0) > 18 ? "studio-long-handle" : undefined}>@{row.handle || "reader"}</h2></div>
        {(kind === "grant-admin" || kind === "revoke-admin") && <p className="studio-hint">{t.lastAdmin}</p>}
        {kind === "ban" && <label className="studio-field">{t.reason}<Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} autoFocus /></label>}
        {kind === "delete" && <label className="studio-field">{t.typeToConfirm(expected)}<Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus /></label>}
        {error && <p role="alert" className="text-sm text-[var(--destructive)]">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setKind(null)}>{t.cancel}</Button><Button variant={kind === "delete" || kind === "ban" ? "destructive" : "default"} disabled={busy || !ready} onClick={() => void apply()}>{busy ? t.working : kind ? actionCopy[kind].action : t.confirm}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
