"use client";

import { useEffect, useState } from "react";
import { Bookmark, RotateCcw, X } from "lucide-react";
import { loadAdminBok } from "@/components/boks/supabase-browser-data";
import type { AdminBokDetail } from "@/components/boks/client-types";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
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
import { readableBoksError } from "@/lib/boks/errors";
import {
  archiveBok,
  permanentlyDeleteArchivedBok,
  restoreArchivedBok,
} from "@/components/boks/supabase-browser-data";
import { currentUiLanguage, useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

export type BokLifecycleAction = "archive" | "restore" | "delete";
export type BokLifecycleTarget = { kind: BokLifecycleAction; bok: { id: string; title: string } };

const words = defineMessages({
  copy: {
    archive: {
      title: "Hide this bok?",
      description:
        "It leaves the reader feed for everyone immediately and moves to Admin → Content → Deleted. Its text, likes, comments and reading history stay in the database, and it can be restored from there.",
      action: "Hide bok",
    },
    restore: {
      title: "Restore bok?",
      description:
        "It goes back to where it was before it was hidden: the reader feed if it was published, the review queue if it was waiting, or refused.",
      action: "Restore",
    },
    delete: {
      title: "Delete permanently?",
      description:
        "This erases the text and all related likes, comments, reports and metrics. It cannot be undone.",
      action: "Delete permanently",
    },
  } as Record<BokLifecycleAction, { title: string; description: string; action: string }>,
  rightsLoadFailed: "Could not load the rights record. The server will check it before restoring.",
  updateFailed: "Could not update this bok.",
  studio: "Studio",
  cannotUndo: "This cannot be undone.",
  deleteWarning: "The text, comments, likes, reports and reading metrics for this bok will be erased.",
  typeTitle: "Type this title exactly",
  archiveSummary: "It will leave the feed and move to Deleted. Its text, comments and reading history stay.",
  restoreSummary: "Return this bok to the state it had before it was hidden.",
  rightsConfirmed: "Rights confirmed",
  rightsNotConfirmed: "Rights not confirmed",
  loadingRights: "Loading rights…",
  rightsRequired: "A bok cannot return to the published feed without confirmed rights.",
  whyHide: "Why are you hiding it?",
  reasonPlaceholder: "Explain the reason…",
  confirmation: "Confirmation",
  archiveHistory: "Your reason, name and time are kept in the bok’s history.",
  restoreHistory: "The record of hiding this bok stays in its history.",
  deleteOnlyDeleted: "Only a bok already in Deleted can be permanently erased.",
  cancel: "Cancel",
  working: "Working…",
}, { ru: {
  copy: {
    archive: {
      title: "Скрыть этот бок?",
      description:
        "Он сразу исчезнет из ленты у всех и переместится в админке в раздел «Контент», вкладку «Удалённые». Текст, лайки, комментарии и история чтения останутся в базе, и оттуда его можно восстановить.",
      action: "Скрыть бок",
    },
    restore: {
      title: "Восстановить бок?",
      description:
        "Он вернётся туда, где был до скрытия: в ленту, если был опубликован, в очередь проверки, если ждал проверки, или в отклонённые.",
      action: "Восстановить",
    },
    delete: {
      title: "Удалить навсегда?",
      description:
        "Будут стёрты текст и все связанные лайки, комментарии, жалобы и метрики. Это нельзя отменить.",
      action: "Удалить навсегда",
    },
  },
  rightsLoadFailed: "Не удалось загрузить сведения о правах. Сервер проверит их перед восстановлением.",
  updateFailed: "Не удалось изменить бок.",
  studio: "Админка",
  cannotUndo: "Это нельзя отменить.",
  deleteWarning: "Текст, комментарии, лайки, жалобы и метрики чтения этого бока будут стёрты.",
  typeTitle: "Введите название точно",
  archiveSummary: "Он уйдёт из ленты в Удалённые. Текст, комментарии и история чтения сохранятся.",
  restoreSummary: "Вернуть бок в состояние, в котором он был до скрытия.",
  rightsConfirmed: "Права подтверждены",
  rightsNotConfirmed: "Права не подтверждены",
  loadingRights: "Загружаем права…",
  rightsRequired: "Без подтверждённых прав бок не вернётся в ленту.",
  whyHide: "Почему вы его скрываете?",
  reasonPlaceholder: "Объясните причину…",
  confirmation: "Подтверждение",
  archiveHistory: "Ваша причина, имя и время сохранятся в истории бока.",
  restoreHistory: "Запись о скрытии останется в истории бока.",
  deleteOnlyDeleted: "Навсегда стереть можно только бок, который уже в Удалённых.",
  cancel: "Отмена",
  working: "Выполняем…",
} });

/**
 * The one confirmation for changing a boks's lifecycle - hide, restore, erase -
 * used by the Content table, the admin boks view and the reader's admin Hide
 * button, so the warning and its safeguards exist once.
 *
 * The safeguards here are for the admin's own sake: a reason is required to
 * hide, and the exact title to erase. Authority is not decided here at all.
 * Every action is an RPC that checks `is_boks_admin` on the server, which
 * reads the role from the database, so this dialog in anyone else's hands
 * changes nothing.
 */
export function BokLifecycleDialog({
  target,
  onClose,
  onDone,
}: {
  target: BokLifecycleTarget | null;
  onClose: () => void;
  onDone: (target: BokLifecycleTarget) => void | Promise<void>;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      {/* Keyed so each opening starts with an empty reason and confirmation. */}
      {target && <LifecycleForm key={`${target.kind}:${target.bok.id}`} target={target} onClose={onClose} onDone={onDone} />}
    </Dialog>
  );
}

function LifecycleForm({
  target,
  onClose,
  onDone,
}: {
  target: BokLifecycleTarget;
  onClose: () => void;
  onDone: (target: BokLifecycleTarget) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { kind, bok } = target;
  const [record, setRecord] = useState<AdminBokDetail | null>(null);
  const [rightsError, setRightsError] = useState("");
  const t = useMessages(words);
  const copy = t.copy;
  useEffect(() => {
    if (kind !== "restore") return;
    let active = true;
    void loadAdminBok(bok.id).then((value) => { if (active) setRecord(value); }).catch(() => { if (active) setRightsError(words[currentUiLanguage()].rightsLoadFailed); });
    return () => { active = false; };
  }, [bok.id, kind]);
  const ready =
    (kind !== "archive" || reason.trim().length > 0) && (kind !== "delete" || confirmation.trim() === bok.title.trim());

  async function apply() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "archive") await archiveBok(bok.id, reason.trim());
      else if (kind === "restore") await restoreArchivedBok(bok.id);
      else await permanentlyDeleteArchivedBok(bok.id, confirmation.trim());
      await onDone(target);
    } catch (caught) {
      setError(readableBoksError(caught, t.updateFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent
      className="studio-dialog"
      onInteractOutside={(event) => busy && event.preventDefault()}
      onEscapeKeyDown={(event) => busy && event.preventDefault()}
    >
      <div className="studio-dialog-brand"><BoksLogo /></div>
      <DialogHeader><p className="studio-eyebrow">{t.studio}</p><DialogTitle>{copy[kind].title}</DialogTitle><DialogDescription className="sr-only">{copy[kind].description}</DialogDescription></DialogHeader>
      <div className={`studio-dialog-symbol studio-dialog-symbol--${kind}`} aria-hidden="true">{kind === "archive" ? <Bookmark /> : kind === "restore" ? <RotateCcw /> : <X />}</div>
      {kind === "delete" ? <><p className="studio-hint studio-hint--danger"><strong>{t.cannotUndo}</strong><br />{t.deleteWarning}</p><div className="studio-paper-slip"><p className="studio-eyebrow">{t.typeTitle}</p><h2>{bok.title}</h2></div></> : <><h2 className="studio-dialog-book">{bok.title}</h2><p className="studio-meta">{kind === "archive" ? t.archiveSummary : t.restoreSummary}</p></>}
      {kind === "restore" && <div className={`studio-hint ${record?.rights?.confirmed ? "studio-hint--confirmed" : ""}`}><strong>{record ? record.rights?.confirmed ? t.rightsConfirmed : t.rightsNotConfirmed : rightsError || t.loadingRights}</strong>{record?.rights?.note && <p>{record.rights.note}</p>}{record && !record.rights?.confirmed && <p>{t.rightsRequired}</p>}</div>}
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        {kind === "archive" && (
          <label className="grid gap-2 text-sm font-medium">
            {t.whyHide}
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder={t.reasonPlaceholder}
              autoFocus
            />
          </label>
        )}
        {kind === "delete" && (
          <label className="grid gap-2 text-sm font-medium">
            <span>{t.confirmation}</span>
            <Input placeholder={bok.title} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus />
          </label>
        )}
        {kind === "archive" && <p className="studio-hint">{t.archiveHistory}</p>}
        {kind === "restore" && <p className="studio-meta">{t.restoreHistory}</p>}
        {kind === "delete" && <p className="studio-meta">{t.deleteOnlyDeleted}</p>}
        {error && (
          <p className="text-sm text-[var(--destructive)]" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t.cancel}
          </Button>
          <Button type="submit" variant={kind === "restore" ? "default" : "destructive"} disabled={busy || !ready}>
            {busy ? t.working : copy[kind].action}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
