"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Share } from "lucide-react";
import "@/app/daily.css";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { ReaderBackIcon } from "@/components/boks/reader/reader-icons";
import { useMessages } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { Envelope, type EnvelopeState } from "./envelope";
import { passageSize } from "./letter";
import { dailyMessages } from "./messages";
import { useEscape } from "./use-escape";
import { Postmark } from "./postmark";
import { stampDate } from "@/lib/boks/daily/days";

/**
 * - `world`: into tomorrow's letters of random readers (`share_line`);
 * - `link`: to one person, as a link that opens as a letter (`create_line_link`).
 * Either way the reader's @handle signs it, and the paper folds into the
 * envelope while the database checks the line.
 */
export type LineSendMode = "world" | "link";
export type LineSendResult = { created: boolean; url?: string };

export function SendLineSheet({ mode, passage, title, authorName, handle, onSend, onClose }: {
  mode: LineSendMode;
  passage: string;
  title: string;
  authorName: string;
  handle: string | null;
  onSend: () => Promise<LineSendResult>;
  onClose: () => void;
}) {
  const words = useMessages(dailyMessages);
  const [phase, setPhase] = useState<"compose" | "sending" | "sent">("compose");
  const [envelope, setEnvelope] = useState<EnvelopeState>("open");
  const [error, setError] = useState("");
  const [result, setResult] = useState<LineSendResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const sendRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sendRef.current?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEscape(onClose);
  useEffect(() => {
    if (phase === "sent") doneRef.current?.focus({ preventScroll: true });
  }, [phase]);

  async function send() {
    if (phase !== "compose") return;
    setError("");
    setPhase("sending");
    setEnvelope("closing");
    const folded = new Promise((resolve) => window.setTimeout(resolve, 900));
    try {
      const [next] = await Promise.all([onSend(), folded]);
      setResult(next);
      setEnvelope("away");
      window.setTimeout(() => setPhase("sent"), 650);
    } catch (failure) {
      await folded;
      setEnvelope("open");
      setPhase("compose");
      setError(readableBoksError(failure, words.saveFailed));
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard (an old browser, a denied permission): the link is selected to copy by hand.
      linkRef.current?.select();
    }
  }

  async function shareLink(url: string) {
    try {
      await navigator.share({ title: `${authorName} · ${title}`, text: passage, url });
    } catch {
      // Cancelled, or the share sheet failed: copying still works.
    }
  }

  const heading = mode === "world" ? words.shareWorld : words.sendLine;
  const stamped = stampDate(new Date().toISOString().slice(0, 10));
  const sealed = phase !== "compose";
  const url = result?.url ?? null;
  return <div className="daily-overlay daily-send" role="dialog" aria-modal="true" aria-label={heading}
    onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
    onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}>
    <header className="daily-overlay__bar">
      <button type="button" aria-label={words.close} onClick={onClose} disabled={phase === "sending"}><ReaderBackIcon size={22} /></button>
      <BoksLogo />
      <span />
    </header>
    {phase !== "sent" ? <div className="daily-send__body">
      <Envelope state={envelope} className="daily-send__envelope">
        <div className="daily-paper daily-paper--compose">
          <h2 className="daily-paper__title">{heading}</h2>
          <i className="daily-paper__hairline" aria-hidden="true" />
          <blockquote className={`daily-paper__line daily-paper__line--${passageSize(passage)} daily-paper__line--left`} lang="und" translate="no">{passage}</blockquote>
          <p className="daily-paper__source daily-paper__source--left" translate="no">{[authorName, title].filter(Boolean).join(" · ")}</p>
        </div>
      </Envelope>
      <div className={`daily-send__controls${sealed ? " is-sealed" : ""}`}>
        <p className="daily-send__lead">{mode === "world" ? words.worldLead : words.linkLead}</p>
        {handle && <p className="daily-send__handle" translate="no">{mode === "world" ? words.seenByMany(handle) : words.seenByOne(handle)}</p>}
        {error && <p className="daily-error" role="alert">{error}</p>}
        <button ref={sendRef} type="button" className="daily-button" onClick={() => void send()} disabled={sealed}>
          {phase === "sending" ? words.sealing : mode === "world" ? words.share : words.send}
        </button>
      </div>
    </div> : <div className="daily-send__sent" role="status">
      <div className="daily-send__mark" aria-hidden="true"><Envelope state="sealed" size="small" /><Postmark caption={stamped} stamp size="l" /></div>
      {mode === "world" ? <>
        <h2>{result?.created === false ? words.worldAgain : words.worldSent}</h2>
        {result?.created !== false && <p>{words.worldSentLead}</p>}
        <button ref={doneRef} type="button" className="daily-button" onClick={onClose}>{words.backToReading}</button>
      </> : <>
        <h2>{words.linkReady}</h2>
        <p>{words.linkReadyLead}</p>
        {url && <>
          <input ref={linkRef} className="daily-send__link" readOnly value={url} aria-label={words.copyLink} onFocus={(event) => event.currentTarget.select()} />
          {canShare && <button ref={doneRef} type="button" className="daily-button" onClick={() => void shareLink(url)}><Share aria-hidden="true" size={18} />{words.shareLink}</button>}
          <button ref={canShare ? undefined : doneRef} type="button" className={`daily-button${canShare ? " daily-button--quiet" : ""}`} onClick={() => void copy(url)}><Copy aria-hidden="true" size={18} />{copied ? words.copied : words.copyLink}</button>
        </>}
        <button type="button" className="daily-link" onClick={onClose}>{words.backToReading}</button>
      </>}
    </div>}
  </div>;
}
