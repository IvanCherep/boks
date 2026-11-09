"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { randomBoksId } from "@/lib/boks/browser-id";
import { estimateMinutes } from "@/components/boks/client-format";
import { readableBoksError } from "@/lib/boks/errors";
import { maxBokCharacters } from "@/lib/boks/contracts";
import { titleFromText } from "@/lib/boks/bok-title";
import {
  authorFileAccept,
  episodeTitle,
  isSupportedAuthorFile,
  readAuthorFile,
  splitIntoEpisodes,
} from "@/lib/boks/author/author-files";
import { submitBokForReview } from "@/components/boks/supabase-browser-data";
import type { UiLanguage } from "@/lib/i18n/ui-language";
import type { CabinetWords } from "./messages";
import { Icon, Topbar } from "./ui";

/**
 * Publishing in the author cabinet (design v51): write or upload, look at it
 * as a reader would, confirm the rights, send for review. One text or a whole
 * folder; no limit on how many. Every bok is sent on its own, so one failure
 * leaves the rest sent and itself in the queue with its reason.
 */

export type PublishingView = "write" | "preview" | "review" | "upload" | "queue" | "split" | "sending" | "result";

type Draft = { title: string; body: string; authorName: string };

/** A rejected or withdrawn bok being reworked: resubmitted in place. */
type Revising = { id: string; title: string; reviewNote: string | null };

type QueueItem = {
  key: string;
  fileName: string;
  title: string;
  text: string;
  /** From the file's front matter; empty means the submission's byline. */
  authorName: string;
  failed?: (w: CabinetWords, language: UiLanguage) => string;
};

type Problem = "emptyFile" | "tooLongStatus" | "duplicate" | "failed" | null;

type SendItem = { key: string; title: string; state: "waiting" | "sending" | "sent" | "failed" };

type Result = { sent: string[]; failed: string[]; stopped: boolean; remaining: number };

const draftKey = "boks-author-draft";

function readDraft(): Draft | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(draftKey) ?? "null") as Partial<Draft> | null;
    if (!parsed || (!parsed.title && !parsed.body)) return null;
    return { title: parsed.title ?? "", body: parsed.body ?? "", authorName: parsed.authorName ?? "" };
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft) {
  try {
    if (!draft.title.trim() && !draft.body.trim()) window.localStorage.removeItem(draftKey);
    else window.localStorage.setItem(draftKey, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the draft is simply not kept.
  }
}

const titleOf = (item: { title: string; text: string }) => item.title.trim() || titleFromText(item.text);

function problemOf(item: QueueItem, queue: QueueItem[]): Problem {
  if (item.failed) return "failed";
  if (!item.text.trim() || !titleOf(item)) return "emptyFile";
  if (item.text.length > maxBokCharacters) return "tooLongStatus";
  const first = queue.find((other) => other.text === item.text);
  if (first && first.key !== item.key) return "duplicate";
  return null;
}

export function usePublishing({
  w,
  language,
  defaultByline,
  canSend,
  onNeedAccount,
  onSent,
  go,
  toast,
}: {
  w: CabinetWords;
  language: UiLanguage;
  defaultByline: string;
  /** A signed-in, unsuspended author. */
  canSend: boolean;
  onNeedAccount: () => void;
  /** Something reached review: the library reloads. */
  onSent: () => void;
  go: (view: PublishingView | "library") => void;
  toast: (text: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>({ title: "", body: "", authorName: "" });
  const [revising, setRevising] = useState<Revising | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [byline, setByline] = useState("");
  const [rights, setRights] = useState(false);
  const [rightsNote, setRightsNote] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [split, setSplit] = useState<{ key: string; checked: boolean; expanded: number[] } | null>(null);
  const [sending, setSending] = useState<SendItem[]>([]);
  const [stopAsked, setStopAsked] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [readingFiles, setReadingFiles] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stopRef = useRef(false);
  const restored = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  // The title grows with its lines, like the heading it becomes.
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  });

  // A text left half-written on this device comes back, and stays saved as it changes.
  useEffect(() => {
    const saved = readDraft();
    restored.current = true;
    if (!saved) return;
    const handle = window.setTimeout(() => setDraft(saved), 0);
    return () => window.clearTimeout(handle);
  }, []);
  useEffect(() => {
    if (!restored.current || editKey) return;
    const handle = window.setTimeout(() => writeDraft(draft), 400);
    return () => window.clearTimeout(handle);
  }, [draft, editKey]);

  const busySending = sending.some((item) => item.state === "waiting" || item.state === "sending");

  // Files read into the queue live only in this tab: warn before it is closed.
  useEffect(() => {
    if (!queue.length && !busySending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = w.leaveWarning;
      return w.leaveWarning;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [queue.length, busySending, w.leaveWarning]);

  const hasDraft = Boolean(draft.title.trim() || draft.body.trim());
  const readyItems = queue.filter((item) => problemOf(item, queue) === null);

  // ---------------------------------------------------------------- actions

  function startWriting(blank: boolean) {
    setEditKey(null);
    if (blank) {
      setRevising(null);
      setDraft((current) => ({ title: "", body: "", authorName: current.authorName }));
    }
    go("write");
  }

  /** A rejected or withdrawn bok opens in the editor; sending it resubmits it in place. */
  function revise(item: { id: string; title: string; body: string; authorName: string; reviewNote: string | null }) {
    setEditKey(null);
    setRevising({ id: item.id, title: item.title, reviewNote: item.reviewNote });
    setDraft({ title: item.title, body: item.body, authorName: item.authorName });
    go("write");
  }

  function toReview() {
    if (!draft.body.trim()) {
      toast(w.noText);
      return;
    }
    if (draft.body.length > maxBokCharacters) {
      toast(w.tooLong);
      return;
    }
    if (editKey) {
      setQueue((current) =>
        current.map((item) =>
          item.key === editKey ? { ...item, title: draft.title, text: draft.body, authorName: draft.authorName, failed: undefined } : item
        )
      );
      setEditKey(null);
      setDraft(readDraft() ?? { title: "", body: "", authorName: "" });
      go("queue");
      return;
    }
    setMode("single");
    // The attestation is about this one text; it is never carried over.
    setRights(false);
    setByline(draft.authorName || defaultByline);
    go("review");
  }

  function reviewQueue() {
    setMode("batch");
    setRights(false);
    setByline(defaultByline);
    go("review");
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setReadingFiles(true);
    const unsupported: string[] = [];
    const unreadable: string[] = [];
    const read: QueueItem[] = [];
    for (const file of files) {
      if (!isSupportedAuthorFile(file.name)) {
        unsupported.push(file.name);
        continue;
      }
      try {
        const piece = await readAuthorFile(file);
        read.push({ key: randomBoksId(), fileName: piece.fileName, title: piece.title, text: piece.text, authorName: piece.authorName });
      } catch {
        unreadable.push(file.name);
      }
    }
    // A numbered folder is meant to be read in order.
    read.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));
    setQueue((current) => [...current, ...read]);
    setReadingFiles(false);
    const notes = [read.length ? w.added(read.length) : "", unsupported.length ? w.unsupported(unsupported.join(", ")) : "", unreadable.length ? w.unreadable(unreadable.join(", ")) : ""]
      .filter(Boolean)
      .join(" ");
    if (notes) toast(notes);
    if (read.length) go("queue");
  }

  function editQueueItem(key: string) {
    const item = queue.find((entry) => entry.key === key);
    if (!item) return;
    // The draft on this device stays saved; the editor borrows the screen.
    writeDraft(draft);
    setRevising(null);
    setEditKey(key);
    setDraft({ title: item.title, body: item.text, authorName: item.authorName });
    go("write");
  }

  function openSplit(key: string) {
    setSplit({ key, checked: false, expanded: [] });
    go("split");
  }

  function splitSource() {
    if (!split) return null;
    if (split.key === "draft") return { title: draft.title, text: draft.body, fileName: "", authorName: draft.authorName };
    return queue.find((item) => item.key === split.key) ?? null;
  }

  function applySplit() {
    const source = splitSource();
    if (!source || !split?.checked) return;
    const base = titleOf(source) || w.titlePlaceholder;
    const parts = splitIntoEpisodes(source.text).map((text, index) => ({
      key: randomBoksId(),
      fileName: source.fileName,
      title: episodeTitle(base, index, language),
      text,
      authorName: source.authorName,
    }));
    if (split.key === "draft") {
      setQueue((current) => [...current, ...parts]);
      setDraft((current) => ({ ...current, title: "", body: "" }));
    } else {
      setQueue((current) => current.flatMap((item) => (item.key === split.key ? parts : [item])));
    }
    setSplit(null);
    toast(w.partsAdded);
    go("queue");
  }

  async function send() {
    if (!canSend) {
      onNeedAccount();
      return;
    }
    if (!rights) {
      toast(w.rightRequired);
      return;
    }
    const batch =
      mode === "batch"
        ? readyItems.map((item) => ({ key: item.key, title: item.title, text: item.text, authorName: item.authorName || byline, bokId: null as string | null }))
        : [{ key: "single", title: draft.title, text: draft.body, authorName: byline, bokId: revising?.id ?? null }];
    if (!batch.length) return;

    stopRef.current = false;
    setStopAsked(false);
    setResult(null);
    setSending(batch.map((item) => ({ key: item.key, title: titleOf(item) || w.titlePlaceholder, state: "waiting" })));
    go("sending");

    const sent: string[] = [];
    const failed: string[] = [];
    for (const item of batch) {
      if (stopRef.current) break;
      setSending((current) => current.map((entry) => (entry.key === item.key ? { ...entry, state: "sending" } : entry)));
      try {
        await submitBokForReview({
          title: item.title,
          body: item.text,
          minutes: estimateMinutes(item.text),
          authorName: item.authorName,
          rightsConfirmed: true,
          rightsNote,
          bokId: item.bokId,
        });
        sent.push(titleOf(item));
        setSending((current) => current.map((entry) => (entry.key === item.key ? { ...entry, state: "sent" } : entry)));
        if (mode === "batch") setQueue((current) => current.filter((entry) => entry.key !== item.key));
      } catch (error) {
        failed.push(titleOf(item));
        setSending((current) => current.map((entry) => (entry.key === item.key ? { ...entry, state: "failed" } : entry)));
        const reason = (words: CabinetWords, lang: UiLanguage) => readableBoksError(error, words.submitFailed, lang);
        if (mode === "batch") setQueue((current) => current.map((entry) => (entry.key === item.key ? { ...entry, failed: reason } : entry)));
        else toast(reason(w, language));
      }
    }

    const stopped = stopRef.current;
    if (mode === "single" && sent.length) {
      setRevising(null);
      // The byline is kept for the next piece; the text is not.
      setDraft((current) => ({ title: "", body: "", authorName: current.authorName }));
      writeDraft({ title: "", body: "", authorName: "" });
    }
    setRights(false);
    setRightsNote("");
    setSourceOpen(false);
    setResult({ sent, failed, stopped, remaining: batch.length - sent.length });
    if (sent.length) onSent();
    if (mode === "single" && !sent.length) go("review");
    else go("result");
  }

  function retryFailed() {
    setQueue((current) => current.map((item) => ({ ...item, failed: undefined })));
    reviewQueue();
  }

  // ---------------------------------------------------------------- views

  function header(title: string, back: PublishingView | "library") {
    return <Topbar title={title} backLabel={w.back} languageLabel={w.languageSwitch} onBack={() => go(back)} />;
  }

  function counter(body: string) {
    return (
      <div className={`pub-count ${body.length > maxBokCharacters ? "pub-count--over" : ""}`}>
        <span>
          <b>{w.charactersOf(body.length, maxBokCharacters)}</b>
        </span>
        <span>
          {body.trim() ? estimateMinutes(body) : 0} {w.min}
        </span>
      </div>
    );
  }

  function WriteView() {
    const over = draft.body.length > maxBokCharacters;
    return (
      <div className="page pub-editor">
        {header(revising ? w.editing : w.newText, editKey ? "queue" : "library")}
        <div className="pub-editor-top">
          <span className="eyebrow">{w.draft}</span>
          <button type="button" className="btn-quiet pub-preview-button" onClick={() => go("preview")} disabled={!draft.body.trim()}>
            <Icon name="eye" />
            <span>{w.preview}</span>
          </button>
        </div>
        {revising?.reviewNote && (
          <aside className="pub-review-note">
            <span className="eyebrow">{w.reviewNote}</span>
            <p>{revising.reviewNote}</p>
            <small>{w.rejectionHelp}</small>
          </aside>
        )}
        <div className="pub-manuscript">
          <label className="pub-sr-only" htmlFor="pub-title">
            {w.titlePlaceholder}
          </label>
          <textarea
            id="pub-title"
            ref={titleRef}
            className="pub-title-input"
            rows={1}
            maxLength={300}
            placeholder={titleFromText(draft.body) || w.titlePlaceholder}
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value.replace(/\n/g, " ") })}
          />
          <div className="pub-manuscript-rule">
            <span>{draft.authorName || defaultByline || ""}</span>
            <i />
          </div>
          <label className="pub-sr-only" htmlFor="pub-body">
            {w.text}
          </label>
          <textarea
            id="pub-body"
            className="pub-body-input"
            placeholder={w.bodyPlaceholder}
            spellCheck
            value={draft.body}
            onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          />
          <p className="pub-writing-hint">{w.formatHint}</p>
        </div>
        <div className="pub-editor-bottom">
          {counter(draft.body)}
          {over && (
            <div className="pub-overlength">
              <p>{w.tooLong}</p>
              {!revising && !editKey && (
                <button type="button" className="btn-quiet" onClick={() => openSplit("draft")}>
                  {w.splitAction}
                </button>
              )}
            </div>
          )}
          <button type="button" className="btn pub-full" disabled={!draft.body.trim() || over} onClick={toReview}>
            {editKey ? w.saveToQueue : w.reviewAndSend}
            <Icon name="arrow" />
          </button>
          {!editKey && <small>{w.savedHere}</small>}
        </div>
      </div>
    );
  }

  function PreviewView() {
    return (
      <div className="page pub-reader-preview">
        {header(w.readPreview, "write")}
        <article className="pub-reader-text">
          <div className="eyebrow">{draft.authorName || defaultByline}</div>
          <h1>{titleOf({ title: draft.title, text: draft.body })}</h1>
          {draft.body.split(/\n\s*\n+/).map((paragraph, index) => (
            <p key={index}>
              {paragraph.split("\n").map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 && <br />}
                  {line}
                </span>
              ))}
            </p>
          ))}
          <div className="pub-endmark">b.</div>
        </article>
        <div className="pub-preview-footer">
          <small>{w.previewFoot}</small>
          <button type="button" className="btn btn-secondary" onClick={() => go("write")}>
            {w.backToText}
          </button>
        </div>
      </div>
    );
  }

  function ReviewView() {
    const batch = mode === "batch";
    const items = batch
      ? readyItems.map((item) => ({ key: item.key, title: item.title, text: item.text }))
      : [{ key: "single", title: draft.title, text: draft.body }];
    return (
      <div className="page pub-review">
        {header(w.reviewTitle, batch ? "queue" : "write")}
        <div className="page-head">
          <span className="eyebrow">{w.reviewEyebrow}</span>
          <h1 className="serif">
            {w.reviewTitle}
            <span className="pub-red-dot">.</span>
          </h1>
        </div>
        <section className="pub-review-section">
          <h2 className="pub-section-title">{w.reviewBoks}</h2>
          <div className="pub-proof-list">
            {items.map((item) => (
              <div key={item.key} className="pub-proof">
                <span className="pub-proof-number">
                  <Icon name="file" />
                </span>
                <div>
                  <h2>{titleOf(item) || w.titlePlaceholder}</h2>
                  <p>
                    {estimateMinutes(item.text)} {w.min} · {w.characters(item.text.length)}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={w.change}
                  onClick={() => (item.key === "single" ? go("write") : editQueueItem(item.key))}
                >
                  <Icon name="write" />
                </button>
              </div>
            ))}
          </div>
        </section>
        <div className="pub-review-fields">
          <label className="field pub-field">
            <span>
              {w.byline} <small>{w.optional}</small>
            </span>
            <input type="text" maxLength={120} value={byline} placeholder={w.optional} onChange={(event) => setByline(event.target.value)} />
            <small>{w.bylineHint}</small>
          </label>
          <div className="pub-rights">
            <h2 className="pub-section-title">{w.publishingRights}</h2>
            <label className="pub-check">
              <input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} />
              <span>{batch ? w.rightsBatch(items.length) : w.rights}</span>
            </label>
            <p>
              {w.rightsWhy} {w.licence}
            </p>
            <a href="/terms#author-content" target="_blank" rel="noreferrer">
              {w.terms}
              <Icon name="arrow" />
            </a>
          </div>
          <button type="button" className="btn-quiet pub-source-toggle" onClick={() => setSourceOpen(!sourceOpen)}>
            {sourceOpen ? w.hideSource : w.expandSource}
            <Icon name={sourceOpen ? "x" : "plus"} />
          </button>
          {sourceOpen && (
            <label className="field pub-field">
              <span>{w.source}</span>
              <textarea rows={3} placeholder={w.sourcePlaceholder} value={rightsNote} onChange={(event) => setRightsNote(event.target.value)} />
              <small>{w.sourceHint}</small>
            </label>
          )}
        </div>
        <div className="pub-review-submit">
          <p>{canSend ? w.afterReview : w.signInToSend}</p>
          <button type="button" className="btn pub-full" disabled={!rights || !items.length} onClick={() => void send()}>
            {batch ? w.submitMany(items.length) : w.submit}
            <Icon name="arrow" />
          </button>
        </div>
      </div>
    );
  }

  function fileInputNode() {
    return (
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept={authorFileAccept}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          void addFiles(files);
        }}
      />
    );
  }

  function UploadView() {
    const input = fileInput;
    return (
      <div className="page pub-upload">
        {header(w.newText, "library")}
        <div className="page-head">
          <span className="eyebrow">
            <span className="pub-step">
              <span>01</span>
              {w.chooseFiles}
            </span>
          </span>
          <h1 className="serif">{w.importTitle}</h1>
          <p className="muted">{w.importIntro}</p>
        </div>
        <div
          className={`pub-drop ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <div className="pub-file-art" aria-hidden="true">
            <i />
            <i />
            <span>
              <Icon name="file" />
              <b>Ab</b>
              <em>b.</em>
            </span>
          </div>
          <h2 className="serif">{w.dropFiles}</h2>
          <p>{w.supported}</p>
          <button type="button" className="btn" disabled={readingFiles} onClick={() => input.current?.click()}>
            <Icon name="plus" />
            {readingFiles ? w.reading : w.chooseFiles}
          </button>
          {fileInputNode()}
        </div>
        <p className="pub-local-note">
          <Icon name="eye" />
          {w.localNote}
        </p>
        <div className="pub-upload-alternatives">
          {queue.length > 0 && (
            <button type="button" className="btn-quiet" onClick={() => go("queue")}>
              {w.queueTitle} ({queue.length})
              <Icon name="arrow" />
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => startWriting(!hasDraft)}>
            {w.writeInstead}
          </button>
        </div>
      </div>
    );
  }

  function QueueView() {
    const input = fileInput;
    const attention = queue.length - readyItems.length;
    return (
      <div className="page pub-queue">
        {header(w.queueTitle, "upload")}
        <div className="pub-queue-heading">
          <div>
            <span className="eyebrow">{w.queueEyebrow}</span>
            <h1 className="serif">
              {w.queueTitle}
              <span className="pub-red-dot">.</span>
            </h1>
          </div>
          <button type="button" className="icon-btn" aria-label={w.addFiles} disabled={readingFiles} onClick={() => input.current?.click()}>
            <Icon name="plus" />
          </button>
        </div>
        {fileInputNode()}
        <div className="pub-queue-summary">
          <span>
            <Icon name="check" />
            {w.readyCount(readyItems.length)}
          </span>
          {attention > 0 && <span>{w.attentionCount(attention)}</span>}
        </div>
        {queue.length ? (
          <>
            <ol className="pub-files">
              {queue.map((item) => {
                const issue = problemOf(item, queue);
                return (
                  <li key={item.key} className={`pub-file-row ${issue ? "pub-file-row--attention" : ""}`}>
                    <div className="pub-file-index" aria-hidden="true">
                      <Icon name="file" />
                    </div>
                    <div className="pub-file-main">
                      <div className="pub-file-meta">
                        <span className={`pub-file-status pub-file-status--${issue ?? "ready"}`}>{issue ? w[issue] : w.ready}</span>
                        <span>
                          {item.text.trim() ? estimateMinutes(item.text) : 0} {w.min}
                        </span>
                      </div>
                      <label className="pub-sr-only" htmlFor={`pub-queue-title-${item.key}`}>
                        {w.titlePlaceholder}
                      </label>
                      <input
                        id={`pub-queue-title-${item.key}`}
                        className="pub-queue-title"
                        value={item.title}
                        placeholder={titleFromText(item.text) || w.titlePlaceholder}
                        onChange={(event) =>
                          setQueue((current) => current.map((entry) => (entry.key === item.key ? { ...entry, title: event.target.value } : entry)))
                        }
                      />
                      <small className="pub-filename">
                        {item.fileName}
                        {item.authorName ? ` · ${item.authorName}` : ""}
                      </small>
                      {issue === "tooLongStatus" ? (
                        <>
                          <p className="pub-file-detail">
                            {w.characters(item.text.length)} · {w.tooLong}
                          </p>
                          <button type="button" className="btn-quiet" onClick={() => openSplit(item.key)}>
                            {w.split}
                            <Icon name="arrow" />
                          </button>
                        </>
                      ) : issue === "duplicate" ? (
                        <p className="pub-file-detail">{w.duplicateHelp}</p>
                      ) : issue === "emptyFile" ? (
                        <p className="pub-file-detail">{w.emptyFileHelp}</p>
                      ) : issue === "failed" ? (
                        <>
                          <p className="pub-file-detail">{item.failed?.(w, language)}</p>
                          <button
                            type="button"
                            className="btn-quiet"
                            onClick={() => setQueue((current) => current.map((entry) => (entry.key === item.key ? { ...entry, failed: undefined } : entry)))}
                          >
                            {w.retry}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn-quiet" onClick={() => editQueueItem(item.key)}>
                          {w.editText}
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-btn pub-remove"
                      aria-label={w.remove}
                      onClick={() => setQueue((current) => current.filter((entry) => entry.key !== item.key))}
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="pub-queue-submit">
              <p>{w.queueRemaining}</p>
              <button type="button" className="btn pub-full" disabled={!readyItems.length} onClick={reviewQueue}>
                {w.sendReady(readyItems.length)}
                <Icon name="arrow" />
              </button>
              <small>{w.leaveQueue}</small>
            </div>
          </>
        ) : (
          <div className="pub-empty">
            <span className="pub-empty-mark">b.</span>
            <h2 className="serif">{w.queueEmpty}</h2>
            <p>{w.queueEmptyHint}</p>
            <button type="button" className="btn" onClick={() => input.current?.click()}>
              {w.chooseFiles}
            </button>
          </div>
        )}
      </div>
    );
  }

  function SplitView() {
    const source = splitSource();
    if (!source || !split) return null;
    const parts = splitIntoEpisodes(source.text);
    return (
      <div className="page pub-split">
        {header(w.splitAction, split.key === "draft" ? "write" : "queue")}
        <div className="page-head">
          <span className="eyebrow">{w.splitEyebrow}</span>
          <h1 className="serif">{w.splitTitle}</h1>
          <p className="muted">{w.splitIntro}</p>
        </div>
        <div className="pub-split-original">
          <Icon name="file" />
          <span>{titleOf(source)}</span>
          <span>{w.characters(source.text.length)}</span>
        </div>
        <div className="pub-parts">
          {parts.map((body, index) => {
            const open = split.expanded.includes(index);
            return (
              <article key={index} className="pub-part">
                <div className="pub-part-top">
                  <span className="pub-part-number">
                    <Icon name="file" />
                  </span>
                  <div>
                    <h2>{w.part(index + 1)}</h2>
                    <small>
                      {w.characters(body.length)} · {estimateMinutes(body)} {w.min}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={open ? w.closePart : w.openPart}
                    onClick={() =>
                      setSplit({ ...split, expanded: open ? split.expanded.filter((entry) => entry !== index) : [...split.expanded, index] })
                    }
                  >
                    <Icon name={open ? "x" : "book"} />
                  </button>
                </div>
                {open ? (
                  <div className="pub-part-full">
                    {body.split(/\n\s*\n+/).map((paragraph, paragraphIndex) => (
                      <p key={paragraphIndex}>{paragraph}</p>
                    ))}
                  </div>
                ) : (
                  <div className="pub-boundary">
                    <small>{w.partBeginning}</small>
                    <p>
                      {body.slice(0, 145)}
                      {body.length > 145 ? "…" : ""}
                    </p>
                    <div className="pub-cutline">···</div>
                    <small>{w.partEnding}</small>
                    <p>…{body.slice(-170)}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        <label className="pub-check pub-split-check">
          <input type="checkbox" checked={split.checked} onChange={(event) => setSplit({ ...split, checked: event.target.checked })} />
          <span>{w.boundaryCheck}</span>
        </label>
        <button type="button" className="btn pub-full" disabled={!split.checked} onClick={applySplit}>
          {w.addParts(parts.length)}
          <Icon name="arrow" />
        </button>
      </div>
    );
  }

  function SendingView() {
    const total = sending.length || 1;
    const done = sending.filter((item) => item.state === "sent" || item.state === "failed").length;
    return (
      <div className="page pub-sending">
        <header className="topbar">
          <span />
          <span className="bar-title">{w.newText}</span>
          <span />
        </header>
        <div className="pub-process-heading">
          <div className="pub-process-orbit" aria-hidden="true">
            <span>b.</span>
            <i />
          </div>
          <span className="eyebrow">{w.sendingCount(done, total)}</span>
          <h1 className="serif">{w.sendingTitle}</h1>
          <p className="muted">{w.sendingSubtitle}</p>
        </div>
        <div className="pub-progress-track" role="progressbar" aria-label={w.sendingNow} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <i style={{ width: `${Math.max(5, (done / total) * 100)}%` }} />
        </div>
        <div className="pub-progress-list">
          {sending.map((item, index) => (
            <div key={item.key}>
              <span className={`pub-progress-status ${item.state === "sent" ? "is-sent" : ""}`}>
                {item.state === "sent" ? <Icon name="check" /> : item.state === "sending" ? <i /> : String(index + 1).padStart(2, "0")}
              </span>
              <span>{item.title}</span>
              <small>{item.state === "sent" ? w.sent : item.state === "failed" ? w.failed : item.state === "sending" ? w.sendingNow : w.waiting}</small>
            </div>
          ))}
        </div>
        {sending.length > 1 && (
          <button
            type="button"
            className="btn btn-secondary pub-full"
            disabled={stopAsked}
            onClick={() => {
              stopRef.current = true;
              setStopAsked(true);
            }}
          >
            {stopAsked ? w.stopRequested : w.stop}
          </button>
        )}
        <p className="pub-process-note">{w.stopHelp}</p>
      </div>
    );
  }

  function ResultView() {
    if (!result) return null;
    const partial = result.failed.length > 0;
    const stopped = !partial && result.stopped && result.remaining > 0;
    return (
      <div className="page pub-result">
        {header(w.newText, "library")}
        <div className={`pub-result-stamp ${partial ? "pub-result-stamp--partial" : ""}`} aria-hidden="true">
          {partial ? "…" : stopped ? <Icon name="undo" /> : <Icon name="check" />}
        </div>
        <div className="page-head">
          <span className="eyebrow">
            {partial ? w.partialResult(result.sent.length, result.failed.length) : stopped ? w.remaining(queue.length) : w.statusReview}
          </span>
          <h1 className="serif">{partial ? w.partialTitle : stopped ? w.stoppedTitle : w.successTitle}</h1>
          <p className="muted">{partial ? w.partialIntro : stopped ? w.stoppedIntro : result.sent.length > 1 ? w.successMany : w.successIntro}</p>
        </div>
        <div className="pub-result-receipt">
          {result.sent.map((title, index) => (
            <div key={`s${index}`}>
              <Icon name="check" />
              <span>{title}</span>
              <small>{w.statusReview}</small>
            </div>
          ))}
          {result.failed.map((title, index) => (
            <div key={`f${index}`} className="pub-receipt-failed">
              <Icon name="undo" />
              <span>{title}</span>
              <small>{w.failed}</small>
            </div>
          ))}
        </div>
        <div className="pub-result-actions">
          {partial ? (
            <button type="button" className="btn pub-full" onClick={retryFailed}>
              {w.retryFailed}
              <Icon name="arrow" />
            </button>
          ) : stopped ? (
            <button type="button" className="btn pub-full" onClick={reviewQueue}>
              {w.continueSending}
              <Icon name="arrow" />
            </button>
          ) : (
            <button type="button" className="btn pub-full" onClick={() => go("library")}>
              {w.viewBoks}
            </button>
          )}
          {partial || stopped ? (
            <button type="button" className="btn btn-secondary pub-full" onClick={() => go("queue")}>
              {w.queueTitle}
            </button>
          ) : (
            <button type="button" className="btn btn-quiet pub-full" onClick={() => startWriting(true)}>
              {w.another}
            </button>
          )}
        </div>
        <p className="pub-process-note">{w.successNote}</p>
      </div>
    );
  }

  /** Which views can be shown with what is in memory; the rest fall back to the library. */
  function canShow(view: PublishingView) {
    if (view === "split") return Boolean(splitSource());
    if (view === "sending") return sending.length > 0;
    if (view === "result") return result !== null;
    if (view === "review") return mode === "single" ? Boolean(draft.body.trim()) : readyItems.length > 0;
    if (view === "preview") return Boolean(draft.body.trim());
    return true;
  }

  const views: Record<PublishingView, () => React.ReactNode> = {
    write: WriteView,
    preview: PreviewView,
    review: ReviewView,
    upload: UploadView,
    queue: QueueView,
    split: SplitView,
    sending: SendingView,
    result: ResultView,
  };

  return {
    hasDraft,
    busySending,
    startWriting,
    revise,
    canShow,
    /** Rendered as plain calls, not components: their state lives in this hook. */
    render: (view: PublishingView) => views[view](),
  };
}
