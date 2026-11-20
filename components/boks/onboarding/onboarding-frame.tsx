"use client";

import { useEffect, useRef, useState } from "react";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * The reader introduction over the reader (docs/onboarding.md): the designers'
 * page from public/onboarding/ in a frame, talking to boks through its bridge
 * (scripts/onboarding/bridge.js). The reader underneath keeps loading, so the
 * first bok is ready when the introduction lands on it; nothing is counted as
 * reading while the frame is open (the reader holds its clock).
 */

export type OnboardingAnswers = {
  version: number;
  status: "completed" | "skipped";
  readingLanguages: string[];
  form: "any" | "prose" | "poetry";
  classics: { id: string; name: unknown }[];
};

export type FirstBook = { id: string; title: string; cover: string | null; author: string };

const frameVersion = "1";

export function OnboardingFrame({ language, readingLanguages, firstBook, onAnswers, onDone, onSignIn }: {
  language: UiLanguage;
  /** Where the language bay starts: the reading languages boks has for this reader now. */
  readingLanguages: readonly string[];
  firstBook: FirstBook | null;
  /** The shelf is behind: answers known, the scenes still to come. */
  onAnswers: (answers: OnboardingAnswers) => void;
  onDone: (answers: OnboardingAnswers) => void;
  onSignIn: (answers: OnboardingAnswers) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const handlers = useRef({ onAnswers, onDone, onSignIn });
  useEffect(() => { handlers.current = { onAnswers, onDone, onSignIn }; });

  const ready = useRef(false);
  const sendFirstBook = (book: FirstBook | null) => {
    if (!book || !ready.current) return;
    frame.current?.contentWindow?.postMessage({ type: "boks-first-book", book }, window.location.origin);
  };
  const latestBook = useRef(firstBook);
  useEffect(() => { latestBook.current = firstBook; sendFirstBook(firstBook); }, [firstBook]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; answers?: OnboardingAnswers } | null;
      if (!data?.type) return;
      if (data.type === "boks-onboarding-ready") { ready.current = true; sendFirstBook(latestBook.current); return; }
      if (!data.answers) return;
      if (data.type === "boks-onboarding-answers") handlers.current.onAnswers(data.answers);
      if (data.type === "boks-onboarding-done") { setLeaving(true); window.setTimeout(() => handlers.current.onDone(data.answers!), 420); }
      if (data.type === "boks-onboarding-sign-in") handlers.current.onSignIn(data.answers);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Always from the first room: the reader asked for it (`welcome=1` resets the page's own saved progress).
  const src = `/onboarding/index.html?lang=${language}&scenario=onboarding&focus=1&reading=${readingLanguages.join(",")}&welcome=1&v=${frameVersion}`;
  return (
    <div className={`onboarding-frame${leaving ? " is-leaving" : ""}${loaded ? " is-loaded" : ""}`} role="dialog" aria-modal="true" aria-label={language === "ru" ? "Знакомство с boks" : "Welcome to boks"}>
      <iframe ref={frame} src={src} title={language === "ru" ? "Знакомство с boks" : "Welcome to boks"} onLoad={() => setLoaded(true)} allow="autoplay" />
    </div>
  );
}
