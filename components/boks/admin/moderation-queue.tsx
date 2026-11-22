"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, RefreshCw, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { Textarea } from "@/components/ui/textarea";
import type { AdminBokDetail, AdminModerationItem } from "@/components/boks/client-types";
import { loadAdminBok } from "@/components/boks/supabase-browser-data";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { loadCoverRequests } from "@/components/boks/author-cabinet/composer-data";
import { TeamCoverPanel } from "@/components/boks/admin/team-cover";
import { AuthorVoicePanel } from "@/components/boks/admin/author-voice";
import { EditorDecisionDialog, RefusedDecision, editorDecisionWords } from "@/components/boks/admin/editor-decision";
import { studioAccept } from "@/components/boks/author-cabinet/voice-data";
import { readableBoksError } from "@/lib/boks/errors";

const words = defineMessages({
  rightsLoadFailed: "Could not load the rights record. Retry or open the complete record.",
  reasonRequired: "Add a clear reason before sending a bok back. The author sees it.",
  noPending: "No pending submissions",
  noRefused: "No refused submissions",
  emptyHint: "New boks will appear here when their authors submit them.",
  viewRefused: "View refused submissions",
  backToPending: "Back to pending submissions",
  submissions: "Submissions",
  waiting: "Waiting",
  refused: "Refused",
  notSubmitted: "Not submitted",
  minutes: (n: number) => `${n} min`,
  words: (n: number) => `${n} words`,
  privateSubmission: "Private submission",
  refusedSubmission: "Refused submission",
  readAndReview: "Read & review",
  privateUntilApproved: "Submissions stay private until approved.",
  refreshQueue: "Refresh queue",
  reviewQueue: "Review queue",
  beforePublishing: "Before publishing",
  loadingRights: "Loading rights…",
  rightsConfirmed: "Rights confirmed",
  rightsNotConfirmed: "Rights not confirmed",
  noRightsRecord: "No rights record is available.",
  retryRights: "Retry rights",
  account: "Account",
  unavailable: "Unavailable",
  submitted: "Submitted",
  length: "Length",
  previousReason: "Previous reason:",
  noteToAuthor: "Note to the author",
  requiredIfSentBack: "Required if you send this back.",
  approvePublish: "Approve & publish",
  sendBack: "Send back with note",
  openRecord: "Open complete record",
  studio: "Studio",
  requestChanges: "Request changes",
  requestChangesHint: "Send the author a note so they can revise this bok.",
  to: (handle: string) => `To @${handle}`,
  whatToChange: "What needs to change?",
  authorSeesNote: "The author will see this exact note and can revise the same bok.",
  nothingPublished: "Nothing is published when you send this note.",
  cancel: "Cancel",
  needsCover: "Needs a cover",
  coverFirst: "Add the cover first: the author asked us to choose it.",
}, { ru: {
  rightsLoadFailed: "Не удалось загрузить сведения о правах. Повторите или откройте полную карточку.",
  reasonRequired: "Укажите понятную причину, прежде чем вернуть бок. Автор её увидит.",
  noPending: "Нет боков на проверке",
  noRefused: "Нет отклонённых боков",
  emptyHint: "Новые боки появятся здесь, когда авторы их отправят.",
  viewRefused: "Показать отклонённые",
  backToPending: "Вернуться к ожидающим",
  submissions: "Присланные боки",
  waiting: "Ожидают",
  refused: "Отклонены",
  notSubmitted: "Не отправлен",
  minutes: (n: number) => `${n} мин`,
  words: (n: number) => `${n} ${plural("ru", n, { one: "слово", few: "слова", many: "слов", other: "слова" })}`,
  privateSubmission: "Закрытая заявка",
  refusedSubmission: "Отклонённая заявка",
  readAndReview: "Прочитать и проверить",
  privateUntilApproved: "Заявки остаются закрытыми до одобрения.",
  refreshQueue: "Обновить очередь",
  reviewQueue: "Очередь проверки",
  beforePublishing: "Перед публикацией",
  loadingRights: "Загружаем права…",
  rightsConfirmed: "Права подтверждены",
  rightsNotConfirmed: "Права не подтверждены",
  noRightsRecord: "Сведений о правах нет.",
  retryRights: "Повторить загрузку прав",
  account: "Аккаунт",
  unavailable: "Недоступен",
  submitted: "Отправлен",
  length: "Объём",
  previousReason: "Прошлая причина:",
  noteToAuthor: "Записка автору",
  requiredIfSentBack: "Обязательна, если вы возвращаете бок.",
  approvePublish: "Одобрить и опубликовать",
  sendBack: "Вернуть с запиской",
  openRecord: "Открыть полную карточку",
  studio: "Админка",
  requestChanges: "Попросить правки",
  requestChangesHint: "Отправьте автору записку, чтобы он доработал бок.",
  to: (handle: string) => `Для @${handle}`,
  whatToChange: "Что нужно изменить?",
  authorSeesNote: "Автор увидит именно эту записку и сможет доработать тот же бок.",
  nothingPublished: "Отправка записки ничего не публикует.",
  cancel: "Отмена",
  needsCover: "Нужна обложка",
  coverFirst: "Сначала добавьте обложку: автор попросил подобрать её нам.",
} });

/** One reading room, with the same real review action used by the old queue. */
export function ModerationQueue({ items, busy, onReview, onRefresh }: {
  items: AdminModerationItem[];
  busy: boolean;
  onRefresh: () => void;
  onReview: (item: AdminModerationItem, decision: "approve" | "reject", reason: string) => Promise<boolean>;
}) {
  const [queueStatus, setQueueStatus] = useState<"pending_review" | "rejected">("pending_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refusalOpen, setRefusalOpen] = useState(false);
  /** A piece sent from My page: returned for changes or refused, with a reason (`EditorDecisionDialog`). */
  const [deciding, setDeciding] = useState<"changes" | "refused" | null>(null);
  const td = useMessages(editorDecisionWords);
  const [accepting, setAccepting] = useState(false);
  const [reading, setReading] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [evidence, setEvidence] = useState<AdminBokDetail | null>(null);
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceAttempt, setEvidenceAttempt] = useState(0);
  const { openBok, openPerson } = useAdminInspector();
  /** Waiting pieces whose author asked us for the cover, and the cover they have now. */
  const [coverRequests, setCoverRequests] = useState<Map<string, number | null>>(new Map());
  useEffect(() => {
    let live = true;
    void loadCoverRequests().then((rows) => {
      if (live) setCoverRequests(new Map(rows.map((row) => [row.bokId, row.coverVersion])));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [items]);
  const onCover = useCallback((bokId: string, version: number) => {
    setCoverRequests((current) => (current.get(bokId) === version ? current : new Map(current).set(bokId, version)));
  }, []);
  const t = useMessages(words);
  const language = useUiLanguage();
  const visibleItems = items.filter((item) => item.status === queueStatus);
  const selected = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0];
  const id = selected?.id;

  useEffect(() => {
    if (!id) return;
    let active = true;
    void loadAdminBok(id).then((detail) => {
      if (active) { setEvidence(detail); setEvidenceError(""); }
    }).catch(() => {
      if (active) setEvidenceError(words[currentUiLanguage()].rightsLoadFailed);
    });
    return () => { active = false; };
  }, [id, evidenceAttempt]);

  async function review(item: AdminModerationItem, decision: "approve" | "reject") {
    const reason = reasons[item.id]?.trim() ?? "";
    if (decision === "approve" && coverRequests.has(item.id) && !coverRequests.get(item.id)) {
      setStatus(t.coverFirst);
      return;
    }
    if (decision === "reject" && !reason) {
      setStatus(t.reasonRequired);
      return;
    }
    setStatus("");
    const saved = await onReview(item, decision, reason);
    if (!saved) return;
    setReasons((current) => { const next = { ...current }; delete next[item.id]; return next; });
    setReading(false);
    setRefusalOpen(false);
  }

  if (!selected) {
    return <section className="studio-empty"><span aria-hidden="true">b.</span><h2>{queueStatus === "pending_review" ? t.noPending : t.noRefused}</h2><p>{t.emptyHint}</p>{items.some((item) => item.status !== queueStatus) && <Button variant="outline" onClick={() => setQueueStatus(queueStatus === "pending_review" ? "rejected" : "pending_review")}>{queueStatus === "pending_review" ? t.viewRefused : t.backToPending}</Button>}</section>;
  }
  const rights = evidence?.id === selected.id ? evidence.rights : undefined;
  const wordCount = evidence?.id === selected.id ? evidence.wordCount : selected.wordCount;
  // Sent from My page (text and voice, the editors make the cover): returned or refused with a reason, never sent back silently.
  const myPagePiece = selected.status === "pending_review" && coverRequests.has(selected.id);

  return (
    <section className={`studio-review ${reading ? "studio-review--reading" : ""}`}>
      <nav className="studio-review-queue" aria-label={t.submissions}>
        <div className="studio-queue-filter"><button type="button" aria-pressed={queueStatus === "pending_review"} onClick={() => { setQueueStatus("pending_review"); setReading(false); }}>{t.waiting}</button><button type="button" aria-pressed={queueStatus === "rejected"} onClick={() => { setQueueStatus("rejected"); setReading(false); }}>{t.refused}</button></div>
        {visibleItems.map((item, index) => (
          <button type="button" key={item.id} aria-current={selected.id === item.id ? "true" : undefined}
            onClick={() => { setSelectedId(item.id); setReading(true); setStatus(""); setEvidenceError(""); window.scrollTo({ top: 0, behavior: "instant" }); }}>
            <span>{String(index + 1).padStart(2, "0")} · {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString(language) : t.notSubmitted}</span>
            <h2>{item.title}</h2><p>{[item.authorName, item.authorHandle ? `@${item.authorHandle.replace(/^@+/, "")}` : ""].filter(Boolean).join(" · ")}</p>
            <small>{t.minutes(item.minutes)} · {item.status === "rejected" ? t.refused : t.privateSubmission}{coverRequests.has(item.id) && !coverRequests.get(item.id) ? ` · ${t.needsCover}` : ""}</small>
            <p className="studio-review-excerpt">{item.body.slice(0, 140)}{item.body.length > 140 ? "…" : ""}</p>
            <span className="studio-review-open">{t.readAndReview} <ArrowUpRight /></span>
          </button>
        ))}
        <p>{t.privateUntilApproved}</p><Button variant="ghost" onClick={onRefresh} disabled={busy}><RefreshCw /> {t.refreshQueue}</Button>
      </nav>
      <article className="studio-review-text" key={selected.id}>
        <Button variant="ghost" className="studio-review-back" onClick={() => { setReading(false); window.scrollTo({ top: 0, behavior: "instant" }); }}><ArrowLeft /> {t.reviewQueue}</Button>
        <span className="studio-eyebrow">{selected.status === "rejected" ? t.refusedSubmission : t.privateSubmission}</span>
        <h2>{selected.title}</h2><p className="studio-review-byline">{selected.authorName || `@${selected.authorHandle}`}</p>
        <div>{selected.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <div className="studio-endmark" aria-hidden="true">b.</div>
      </article>
      <aside className="studio-review-evidence">
        <h3>{t.beforePublishing}</h3>
        {coverRequests.has(selected.id) && (
          <TeamCoverPanel key={selected.id} bokId={selected.id} title={selected.title} text={selected.body} onCover={(version) => onCover(selected.id, version)} />
        )}
        <AuthorVoicePanel key={`voice-${selected.id}`} bokId={selected.id} expected={coverRequests.has(selected.id)} />
        <div className={`studio-rights-note ${rights?.confirmed ? "is-confirmed" : ""}`}>
          <strong><ShieldCheck /> {rights === undefined ? t.loadingRights : rights?.confirmed ? t.rightsConfirmed : t.rightsNotConfirmed}</strong>
          {rights?.note && <p>{rights.note}</p>}
          {rights === null && <p>{t.noRightsRecord}</p>}
        </div>
        {evidenceError && <div role="alert"><p>{evidenceError}</p><Button variant="outline" onClick={() => setEvidenceAttempt((value) => value + 1)}>{t.retryRights}</Button></div>}
        <dl><dt>{t.account}</dt><dd>{selected.authorUserId ? <button type="button" className="inspector-link" onClick={() => openPerson(selected.authorUserId!)}>@{selected.authorHandle.replace(/^@+/, "")} ↗</button> : selected.authorHandle || t.unavailable}</dd>
          <dt>{t.submitted}</dt><dd>{selected.submittedAt ? new Date(selected.submittedAt).toLocaleString(language) : "—"}</dd>
          <dt>{t.length}</dt><dd>{t.minutes(selected.minutes)}{Number.isFinite(wordCount) ? ` · ${t.words(wordCount)}` : ""}</dd></dl>
        {selected.status === "rejected" && <RefusedDecision key={`decision-${selected.id}`} bokId={selected.id} onReopened={onRefresh} />}
        {selected.reviewNote && <p className="studio-review-previous">{t.previousReason} {selected.reviewNote}</p>}
        {!myPagePiece && <>
          <label htmlFor={`review-note-${selected.id}`}>{t.noteToAuthor}</label>
          <Textarea id={`review-note-${selected.id}`} value={reasons[selected.id] ?? ""} rows={5}
            onChange={(event) => setReasons((current) => ({ ...current, [selected.id]: event.target.value }))} />
          <small>{t.requiredIfSentBack}</small>
        </>}
        {status && <p role="alert">{status}</p>}
        <div className="studio-review-decisions">
          {/* A voiced piece from My page is not published from here: it is accepted into work for its Boks Series. */}
          {myPagePiece
            ? <Button disabled={busy || accepting} onClick={() => {
              setAccepting(true);
              setStatus("");
              studioAccept(selected.id).then(() => { setReading(false); onRefresh(); }, (error) => setStatus(readableBoksError(error, td.acceptFailed, language))).finally(() => setAccepting(false));
            }}><Check /> {td.accept}</Button>
            : <Button disabled={busy} onClick={() => void review(selected, "approve")}><Check /> {t.approvePublish}</Button>}
          {myPagePiece ? <>
            <Button variant="outline" disabled={busy} onClick={() => setDeciding("changes")}><RotateCcw /> {td.returnForChanges}</Button>
            <Button variant="outline" disabled={busy} onClick={() => setDeciding("refused")}><XCircle /> {td.refuse}</Button>
          </> : <Button variant="outline" disabled={busy} onClick={() => setRefusalOpen(true)}><XCircle /> {t.sendBack}</Button>}
        </div>
        <EditorDecisionDialog key={`dialog-${selected.id}`} bokId={selected.id} title={selected.title} decision={deciding}
          onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); setReading(false); onRefresh(); }} />
        <button type="button" className="inspector-link" onClick={() => openBok(selected.id)}>{t.openRecord} <ArrowUpRight className="inline size-4" /></button>
      </aside>
      <Dialog open={refusalOpen} onOpenChange={(open) => !busy && setRefusalOpen(open)}><DialogContent className="studio-dialog" onInteractOutside={(event) => busy && event.preventDefault()} onEscapeKeyDown={(event) => busy && event.preventDefault()}><div className="studio-dialog-brand"><BoksLogo /></div><DialogHeader><p className="studio-eyebrow">{t.studio}</p><DialogTitle>{t.requestChanges}</DialogTitle><DialogDescription className="sr-only">{t.requestChangesHint}</DialogDescription></DialogHeader><div className="studio-paper-slip"><p className="studio-eyebrow">{t.to(selected.authorHandle.replace(/^@+/, ""))}</p><h2>{selected.title}</h2></div><label className="studio-field">{t.whatToChange}<Textarea value={reasons[selected.id] ?? ""} rows={6} autoFocus onChange={(event) => setReasons((current) => ({ ...current, [selected.id]: event.target.value }))} /></label><p className="studio-hint">{t.authorSeesNote}</p><p className="studio-meta">{t.nothingPublished}</p>{status && <p role="alert">{status}</p>}<DialogFooter><Button variant="outline" onClick={() => setRefusalOpen(false)} disabled={busy}>{t.cancel}</Button><Button disabled={busy || !reasons[selected.id]?.trim()} onClick={() => void review(selected, "reject")}>{t.sendBack}</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}
