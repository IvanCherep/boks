"use client";

/**
 * "Что почитать": the button on the cover and its sheet. A port of the agreed
 * prototype (`boks-what-to-read-2026-11-15`, `react/WhatToRead.tsx`).
 *
 * The sheet edits a draft; X, Escape and the backdrop discard it; Apply hands
 * it to the reader (`onApply`), which loads a real new feed and commits it.
 * Nothing here filters a slate, counts boks or stores anything. The reader
 * owns the clock, the gestures and the motion (`intent-motion.ts`).
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "@/components/boks/ui-language";
import {
  activeConditionCount,
  emptyReadingRequest,
  normalizeReadingRequest,
  readingAuthorGroups,
  readingFormats,
  readingMoods,
  type ReadingMood,
  type ReadingRequest,
} from "@/lib/boks/facets/request";
import { defineMessages } from "@/lib/i18n/messages";
import "./what-to-read.css";

/** "closed": the reader took over (e.g. the sign-up the guest limit asks for); the sheet just closes. */
export type ApplyResult = "applied" | "empty" | "error" | "closed";

export type WhatToReadProps = {
  /** The applied request, owned by the reader. */
  value: ReadingRequest;
  /** The positioned reader screen the sheet opens inside; never document.body. */
  screenHost: HTMLElement | null;
  /** Load and commit a real feed; "empty" when nothing new fits. */
  onApply: (draft: ReadingRequest, signal: AbortSignal) => Promise<ApplyResult>;
  /** The reader holds its clock and gestures while the sheet is open. */
  onOpenChange: (open: boolean) => void;
  /** A bounded server check: false disables Apply. A failed check allows Apply. */
  checkAvailability?: (draft: ReadingRequest, signal: AbortSignal) => Promise<boolean>;
  disabled?: boolean;
};

const words = defineMessages(
  {
    choose: "What to read", summary: "Mood, form and authors", mood: "Mood", sad: "Feel wistful", fun: "Have fun", think: "Reflect",
    form: "Form", any: "Either", prose: "Prose", poetry: "Poetry", authors: "Authors", classics: "Classics", contemporary: "Contemporary",
    reset: "Clear all", apply: "Apply", close: "Close", empty: "No boks match this combination yet",
    error: "Could not update the feed. Try again.", checking: "Checking…", applying: "Updating…",
  },
  {
    ru: {
      choose: "Что почитать", summary: "Настроение, форма, авторы", mood: "Настроение", sad: "Погрустить", fun: "Повеселиться", think: "Подумать",
      form: "Форма", any: "Любая", prose: "Проза", poetry: "Поэзия", authors: "Авторы", classics: "Классики", contemporary: "Современные",
      reset: "Сбросить всё", apply: "Применить", close: "Закрыть", empty: "В этом сочетании пока нет boks",
      error: "Не удалось обновить ленту. Попробуйте ещё раз.", checking: "Проверяем…", applying: "Обновляем…",
    },
  }
);

const iconSource = (mood: ReadingMood) => `/what-to-read/${mood}.webp`;
const clone = (value: ReadingRequest): ReadingRequest => ({ ...value, authorGroups: [...value.authorGroups] });

function Icon({ name }: { name: "check" | "close" | "arrow" | "book" | "chevron" }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {name === "check" ? <path d="m5 12 4 4L19 6" />
        : name === "close" ? <path d="m6 6 12 12M18 6 6 18" />
        : name === "arrow" ? <path d="M4 12h16m-6-6 6 6-6 6" />
        : name === "chevron" ? <path d="m7 10 5 5 5-5" />
        : <path d="M12 5v15M3 4c3-1 6 0 9 1 3-1 6-2 9-1v15c-3-1-6 0-9 1-3-1-6-2-9-1z" />}
    </svg>
  );
}

export function WhatToRead({ value, screenHost, onApply, onOpenChange, checkAvailability, disabled = false }: WhatToReadProps) {
  const t = useMessages(words);
  const id = useId().replace(/:/g, "");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ReadingRequest>(() => clone(value));
  const [pending, setPending] = useState(false);
  const [availability, setAvailability] = useState<"unknown" | "checking" | "yes" | "no">("unknown");
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const applying = useRef<AbortController | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  // The reader passes new functions on every render; the check must not restart with each one.
  const checkRef = useRef(checkAvailability);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
    checkRef.current = checkAvailability;
  }, [onOpenChange, checkAvailability]);
  const canCheck = Boolean(checkAvailability);

  const summary = useMemo(() => {
    const parts = [
      value.format !== "any" ? t[value.format] : null,
      ...value.authorGroups.map((group) => t[group]),
      value.mood ? t[value.mood] : null,
    ].filter((part): part is string => Boolean(part));
    return {
      full: parts.join(" · "),
      short: parts.length ? parts.slice(0, 2).join(" · ") + (parts.length > 2 ? ` · +${parts.length - 2}` : "") : t.summary,
      count: activeConditionCount(value),
    };
  }, [value, t]);

  function close() {
    operation.current += 1;
    applying.current?.abort();
    applying.current = null;
    setPending(false);
    setOpen(false);
    onOpenChangeRef.current(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }

  function begin() {
    if (!screenHost || disabled) return;
    setDraft(clone(value));
    setError(false);
    setAvailability(checkAvailability ? "checking" : "unknown");
    setOpen(true);
    onOpenChangeRef.current(true);
  }

  function edit(next: ReadingRequest) {
    setDraft(normalizeReadingRequest(next));
    setError(false);
    setAvailability(checkAvailability ? "checking" : "unknown");
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current += 1;
      applying.current?.abort();
      onOpenChangeRef.current(false);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    heading.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex=\"0\"]")].filter((node) => node.offsetParent !== null);
      if (!items.length) {
        event.preventDefault();
        heading.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialog.current.contains(document.activeElement) || document.activeElement === heading.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (dialog.current && !dialog.current.contains(event.target as Node)) heading.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
    // Only on opening: re-rendering a selected option must not move focus.
  }, [open]);

  useEffect(() => {
    if (!open || !canCheck) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const check = checkRef.current;
      if (!check) return;
      void check(clone(draft), abort.signal).then(
        (yes) => { if (!abort.signal.aborted) setAvailability(yes ? "yes" : "no"); },
        () => { if (!abort.signal.aborted) setAvailability("unknown"); }
      );
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [open, draft, canCheck]);

  async function apply() {
    if (pending || availability === "checking" || availability === "no") return;
    const generation = ++operation.current;
    const abort = new AbortController();
    applying.current = abort;
    setPending(true);
    setError(false);
    try {
      const result = await onApply(clone(draft), abort.signal);
      if (!mounted.current || abort.signal.aborted || operation.current !== generation) return;
      if (result === "applied" || result === "closed") close();
      else if (result === "empty") setAvailability("no");
      else setError(true);
    } catch {
      if (mounted.current && !abort.signal.aborted && operation.current === generation) setError(true);
    } finally {
      if (mounted.current && operation.current === generation) {
        applying.current = null;
        setPending(false);
      }
    }
  }

  const blocked = pending || availability === "checking" || availability === "no";
  const status = error ? t.error : availability === "no" ? t.empty : availability === "checking" ? t.checking : "";

  const panel = open && screenHost ? createPortal(
    <div className="reading-request-layer boks-wtr-panel">
      <button type="button" className="reading-request-backdrop" onClick={close} aria-label={t.close} tabIndex={-1} />
      <section ref={dialog} id={`${id}-panel`} className="reading-request-panel is-entering" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={pending}>
        <header className="reading-request-header">
          <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>{t.choose}</h2>
          <button type="button" className="request-close" onClick={close} aria-label={t.close}><Icon name="close" /></button>
        </header>
        <div className="reading-request-body">
          <section className="request-section">
            <h3>{t.mood}</h3>
            <div className="request-moods">
              {readingMoods.map((mood) => (
                <button type="button" key={mood} className="request-mood" aria-pressed={draft.mood === mood} disabled={pending}
                  onClick={() => edit({ ...draft, mood: draft.mood === mood ? null : mood })}>
                  <span className="request-mood-art"><img src={iconSource(mood)} alt="" width={70} height={67} /><span><Icon name="check" /></span></span>
                  <strong>{t[mood]}</strong>
                </button>
              ))}
            </div>
          </section>
          <section className="request-section">
            <h3>{t.form}</h3>
            <div className="request-form" role="group" aria-label={t.form}>
              {readingFormats.map((format) => (
                <button type="button" key={format} aria-pressed={draft.format === format} disabled={pending} onClick={() => edit({ ...draft, format })}>{t[format]}</button>
              ))}
            </div>
          </section>
          <section className="request-section">
            <h3>{t.authors}</h3>
            <div className="request-authors">
              {readingAuthorGroups.map((group) => (
                <button type="button" key={group} aria-pressed={draft.authorGroups.includes(group)} disabled={pending}
                  onClick={() => edit({ ...draft, authorGroups: draft.authorGroups.includes(group) ? draft.authorGroups.filter((entry) => entry !== group) : [...draft.authorGroups, group] })}>
                  <span className="request-author-top"><strong>{t[group]}</strong><span className="request-author-check"><Icon name="check" /></span></span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <footer className="reading-request-footer">
          <div className="request-footer-meta">
            <span className={error || availability === "no" ? "no-matches" : ""} role="status">{status}</span>
            <button type="button" disabled={pending} onClick={() => edit(clone(emptyReadingRequest))}>{t.reset}</button>
          </div>
          <button type="button" className="request-apply" disabled={blocked} onClick={() => void apply()}>{pending ? t.applying : t.apply}<Icon name="arrow" /></button>
        </footer>
      </section>
    </div>,
    screenHost
  ) : null;

  return (
    <>
      <div className="boks-wtr intent-anchor intent-anchor--cover">
        <button ref={trigger} type="button" className={`intent-control${summary.count ? " active" : ""}`} data-intent-slot="cover"
          disabled={disabled || !screenHost} onClick={begin}
          aria-label={`${t.choose}${summary.full ? `: ${summary.full}` : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-panel` : undefined}>
          <span className={`intent-trigger-art${!value.mood && value.format === "any" ? " intent-trigger-art--fan" : ""}`} aria-hidden="true">
            {value.mood ? <img src={iconSource(value.mood)} alt="" />
              : value.format !== "any" ? <Icon name="book" />
              : readingMoods.map((mood) => <img key={mood} src={iconSource(mood)} alt="" />)}
            {summary.count > 0 && <span className="reading-trigger-count">{summary.count}</span>}
          </span>
          <span className="reading-trigger-copy">
            <span data-intent-label>{t.choose}</span>
            <span className="reading-trigger-summary" aria-hidden="true">{summary.short}</span>
          </span>
          <span className="intent-chevron"><Icon name="chevron" /></span>
        </button>
      </div>
      {panel}
    </>
  );
}
