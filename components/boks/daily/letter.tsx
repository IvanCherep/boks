"use client";

import { useEffect, useRef, useState } from "react";
import "@/app/daily.css";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { ReaderBackIcon } from "@/components/boks/reader/reader-icons";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { calendarDate } from "@/lib/boks/daily/game-day";
import { Envelope, type EnvelopeState } from "./envelope";
import { useEscape } from "./use-escape";
import type { DailyLetter } from "./data";
import { dailyMessages } from "./messages";

/** "From @north", "From a boks reader" or "From the boks editors". */
export function letterSignature(letter: Pick<DailyLetter, "source" | "senderHandle">, words: typeof dailyMessages.en) {
  if (letter.source === "editorial") return words.fromEditors;
  return letter.senderHandle ? words.fromHandle(letter.senderHandle) : words.fromReader;
}

/** A longer line gets a smaller face, so it still fits the paper. */
export function passageSize(passage: string) {
  const length = passage.length;
  if (length <= 60) return "l";
  if (length <= 140) return "m";
  return "s";
}

/**
 * A letter, full screen: who sent it, the line on paper risen from its
 * envelope, the work it comes from and the way to it. Today's letter opened
 * for the first time arrives sealed and opens itself; any other is shown open.
 */
export function LetterView({ letter, status, firstOpening, isToday, note, onOpenWork, onClose, onRetry }: {
  letter: DailyLetter | null;
  status: "opening" | "ready" | "error" | "empty";
  /** Play the opening: today's letter, opened just now. */
  firstOpening: boolean;
  isToday: boolean;
  /** In place of the date line: why this letter is here (a line sent by link). */
  note?: string;
  onOpenWork: (letter: DailyLetter) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const words = useMessages(dailyMessages);
  const language = useUiLanguage();
  const [envelope, setEnvelope] = useState<EnvelopeState>(firstOpening ? "sealed" : "open");
  const closeRef = useRef<HTMLButtonElement>(null);

  // Sealed while the letter is on its way; it opens itself once it has arrived.
  useEffect(() => {
    if (status !== "ready" || envelope !== "sealed") return;
    const timer = window.setTimeout(() => setEnvelope("opening"), 260);
    return () => window.clearTimeout(timer);
  }, [envelope, status]);
  useEffect(() => {
    if (envelope !== "opening") return;
    const timer = window.setTimeout(() => setEnvelope("open"), 1500);
    return () => window.clearTimeout(timer);
  }, [envelope]);
  useEscape(onClose);
  // Focus starts on the way out, once; the open envelope moves it to the work.
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const ready = status === "ready" && letter;
  const shown = envelope === "open" || envelope === "opening";
  return <div className="daily-overlay daily-letter" role="dialog" aria-modal="true" aria-label={words.letter}
    onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
    onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}
    onWheel={(event) => event.stopPropagation()}>
    <header className="daily-overlay__bar">
      <button ref={closeRef} type="button" aria-label={words.close} onClick={onClose}><ReaderBackIcon size={22} /></button>
      <BoksLogo />
      <span />
    </header>
    <div className="daily-letter__body">
      <span className={`daily-letter__from${ready && shown ? " is-shown" : ""}`}>{ready ? letterSignature(letter, words) : " "}</span>
      <Envelope state={ready ? envelope : "sealed"} className="daily-letter__envelope">
        {ready ? <div className="daily-paper">
          {letter.available && letter.passage ? <>
            <blockquote className={`daily-paper__line daily-paper__line--${passageSize(letter.passage)}`} lang="und" translate="no">{letter.passage}</blockquote>
            <i className="daily-paper__rule" aria-hidden="true" />
            <p className="daily-paper__source" translate="no">{[letter.authorName, letter.title].filter(Boolean).join(" · ")}</p>
          </> : <p className="daily-paper__gone">{words.unavailable}</p>}
        </div> : <div className="daily-paper" />}
      </Envelope>
      <div className="daily-letter__actions">
        {status === "opening" && <p className="daily-note" role="status">{words.opening}</p>}
        {status === "error" && <><p className="daily-note" role="alert">{words.letterFailed}</p><button type="button" className="daily-button" onClick={onRetry}>{words.tryAgain}</button></>}
        {status === "empty" && <p className="daily-note" role="status">{words.noLetter}</p>}
        {ready && <div className={`daily-letter__done${shown ? " is-shown" : ""}`}>
          {letter.available && letter.bokId && <button type="button" className="daily-button" onClick={() => onOpenWork(letter)}>{words.openWork}</button>}
          <p className="daily-note">{note ?? (isToday ? words.newLineTomorrow : words.receivedOn(calendarDate(letter.date, language)))}</p>
        </div>}
      </div>
    </div>
  </div>;
}
