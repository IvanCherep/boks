"use client";

import { useState } from "react";
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

export type BokLifecycleAction = "archive" | "restore" | "delete";
export type BokLifecycleTarget = { kind: BokLifecycleAction; bok: { id: string; title: string } };

const copy: Record<BokLifecycleAction, { title: string; description: string; action: string }> = {
  archive: {
    title: "Hide this boks from readers?",
    description:
      "It leaves the reader feed for everyone immediately and moves to Admin → Content → Deleted. Its text, likes, comments and reading history stay in the database, and it can be restored from there.",
    action: "Hide boks",
  },
  restore: {
    title: "Restore this boks?",
    description: "It becomes eligible for the reader feed again.",
    action: "Restore",
  },
  delete: {
    title: "Delete this boks permanently?",
    description:
      "This erases the text and all related likes, comments, reports and metrics. It cannot be undone.",
    action: "Delete permanently",
  },
};

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
  const ready =
    (kind !== "archive" || reason.trim().length > 0) && (kind !== "delete" || confirmation === bok.title);

  async function apply() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "archive") await archiveBok(bok.id, reason.trim());
      else if (kind === "restore") await restoreArchivedBok(bok.id);
      else await permanentlyDeleteArchivedBok(bok.id, confirmation);
      await onDone(target);
    } catch (caught) {
      setError(readableBoksError(caught, "Could not update this boks."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent
      onInteractOutside={(event) => busy && event.preventDefault()}
      onEscapeKeyDown={(event) => busy && event.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>{copy[kind].title}</DialogTitle>
        <DialogDescription>
          <strong className="text-[var(--foreground)]">“{bok.title}”</strong>. {copy[kind].description}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        {kind === "archive" && (
          <label className="grid gap-2 text-sm font-medium">
            Reason (shown in the Deleted list)
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="Copyright complaint, broken text, duplicate…"
              autoFocus
            />
          </label>
        )}
        {kind === "delete" && (
          <label className="grid gap-2 text-sm font-medium">
            <span>
              Type <strong>{bok.title}</strong> to confirm
            </span>
            <Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus />
          </label>
        )}
        {error && (
          <p className="text-sm text-[var(--destructive)]" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={kind === "restore" ? "default" : "destructive"} disabled={busy || !ready}>
            {busy ? "Working…" : copy[kind].action}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
