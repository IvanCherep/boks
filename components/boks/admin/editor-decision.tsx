"use client";

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import "@/app/author-composer.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { loadStudioDecision, studioDecide, studioReopen } from "@/components/boks/author-cabinet/voice-data";
import { decisionKinds, decisionReady, type DecisionKind, type EditorDecision, type EditorDecisionKind } from "@/lib/boks/author/editor-decisions";
import { readableBoksError } from "@/lib/boks/errors";
import { defineMessages } from "@/lib/i18n/messages";

/**
 * Studio → Moderation for a piece sent from My page (`docs/author-publishing.md`,
 * "When the editors cannot take a piece"): return it for changes or refuse it,
 * always with what it is about and words the author will read on My page.
 * Nothing is mailed or messaged to the author.
 */

export const editorDecisionWords = defineMessages({
  returnForChanges: "Return for changes",
  refuse: "Refuse",
  returnTitle: "Return to the author for changes",
  refuseTitle: "Refuse this piece",
  returnHint: "The piece goes back to the author. They read your words on My page, change the recording or the text and send it again.",
  refuseHint: "The author reads your words on My page. The text stays with them; it cannot be sent again unless you reopen it.",
  about: "What is it about?",
  kinds: { recording: "Recording", text: "Text", law: "Law", other: "Other" } as Record<DecisionKind, string>,
  note: "Words for the author",
  notePlaceholder: "Plainly and respectfully: what is wrong and what would help.",
  noMail: "No email or message is sent: the author sees it in their cabinet.",
  cancel: "Cancel",
  send: "Send to the author",
  failed: "Could not save the decision. Try again.",
  refusedTitle: "Refused by the editors",
  reopen: "Reopen: return for changes",
  reopenHint: "The author gets it back as a request for changes, with the same words, and can send it again.",
}, { ru: {
  returnForChanges: "Вернуть на доработку",
  refuse: "Отказать",
  returnTitle: "Вернуть автору на доработку",
  refuseTitle: "Отказать в публикации",
  returnHint: "Бок вернётся к автору. Он прочитает ваши слова на «Моей странице», переделает запись или текст и отправит снова.",
  refuseHint: "Автор прочитает ваши слова на «Моей странице». Текст останется у него; снова отправить его нельзя, пока вы не откроете бок заново.",
  about: "О чём причина?",
  kinds: { recording: "Запись", text: "Текст", law: "Законодательство", other: "Другое" },
  note: "Слова для автора",
  notePlaceholder: "Просто и уважительно: что не так и что поможет.",
  noMail: "Писем и сообщений не отправляем: автор увидит это в кабинете.",
  cancel: "Отмена",
  send: "Отправить автору",
  failed: "Не удалось сохранить решение. Попробуйте ещё раз.",
  refusedTitle: "Редакция отказала",
  reopen: "Открыть заново: вернуть на доработку",
  reopenHint: "Автор получит бок обратно как просьбу доработать, с теми же словами, и сможет отправить снова.",
} });

export function EditorDecisionDialog({ bokId, title, decision, onClose, onDone }: {
  bokId: string;
  title: string;
  decision: EditorDecisionKind | null;
  onClose: () => void;
  onDone: (result: EditorDecision) => void;
}) {
  const t = useMessages(editorDecisionWords);
  const language = useUiLanguage();
  const [kind, setKind] = useState<DecisionKind | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  async function send() {
    if (!decision || !kind || !decisionReady(kind, note)) return;
    setBusy(true);
    setProblem("");
    try {
      onDone(await studioDecide(bokId, decision, kind, note.trim()));
      setKind(null);
      setNote("");
    } catch (error) {
      setProblem(readableBoksError(error, t.failed, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={decision !== null} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="studio-dialog">
        <DialogHeader>
          <DialogTitle>{decision === "refused" ? t.refuseTitle : t.returnTitle}</DialogTitle>
          <DialogDescription>{decision === "refused" ? t.refuseHint : t.returnHint}</DialogDescription>
        </DialogHeader>
        <div className="studio-paper-slip"><h2>{title}</h2></div>
        <p className="studio-eyebrow">{t.about}</p>
        <div className="studio-decision-kinds" role="group" aria-label={t.about}>
          {decisionKinds.map((value) => (
            <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>{t.kinds[value]}</button>
          ))}
        </div>
        <label className="studio-field">{t.note}
          <Textarea value={note} rows={5} maxLength={2000} placeholder={t.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
        </label>
        <p className="studio-hint">{t.noMail}</p>
        {problem && <p role="alert">{problem}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t.cancel}</Button>
          <Button disabled={busy || !decisionReady(kind, note)} onClick={() => void send()}>{t.send}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A refused piece in the queue's Refused list: what was decided, and the way back. */
export function RefusedDecision({ bokId, onReopened }: { bokId: string; onReopened: () => void }) {
  const t = useMessages(editorDecisionWords);
  const language = useUiLanguage();
  const [decision, setDecision] = useState<EditorDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    let live = true;
    loadStudioDecision(bokId).then((found) => { if (live) setDecision(found); }, () => undefined);
    return () => { live = false; };
  }, [bokId]);
  if (!decision || decision.decision !== "refused") return null;
  return (
    <div className="studio-decision-done">
      <strong>{t.refusedTitle} · {t.kinds[decision.kind]}</strong>
      <p>{decision.note}</p>
      <Button variant="outline" disabled={busy} onClick={() => {
        setBusy(true);
        studioReopen(bokId).then(onReopened, (error) => setProblem(readableBoksError(error, t.failed, language))).finally(() => setBusy(false));
      }}><RotateCcw /> {t.reopen}</Button>
      <p>{t.reopenHint}</p>
      {problem && <p role="alert">{problem}</p>}
    </div>
  );
}
