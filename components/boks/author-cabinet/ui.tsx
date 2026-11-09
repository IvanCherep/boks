"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { setUiLanguagePreference, useUiLanguage } from "@/components/boks/ui-language";

/** Line icons of design v51, drawn at 24px with a 1.65 stroke. */
const paths = {
  arrow: "M4 12h15m-6-6 6 6-6 6",
  back: "M20 12H5m6-6-6 6 6 6",
  write: "m4 16-1 5 5-1L21 7l-4-4L4 16Zm11-11 4 4",
  upload: "M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6",
  check: "m4 12 5 5L20 6",
  x: "m6 6 12 12M6 18 18 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  share: "m3 4 19 8-19 8 4-8zm4 8h15",
  book: "M12 5C8 3 5 3 3 4v16c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v16",
  file: "M5 3h9l5 5v13H5V3Zm9 0v5h5M8 12h8m-8 4h7",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  heart: "M12 21 3 12C-2 5 6-1 12 6 18-1 26 5 21 12L12 21Z",
  comment: "M21 11a9 9 0 0 1-13 8l-6 2 2-6A9 9 0 1 1 21 11Z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  undo: "M4 9a8 8 0 1 1 0 6M4 3v6h6",
  trash: "M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  stats: "M4 20V12m8 8V4m8 16V9",
  plus: "M12 4v16M4 12h16",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
} as const;

export type IconName = keyof typeof paths | "camera";

export function Icon({ name }: { name: IconName }) {
  if (name === "camera") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 5l1.5-2h5L16 5h4v15H4V5h4Z" />
        <circle cx="12" cy="12.5" r="4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

/** A ref that always holds the latest value, for listeners set up once. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** EN on a Russian page, RU on an English one: the switch names the other language. */
export function LanguageSwitch({ label }: { label: string }) {
  const language = useUiLanguage();
  return (
    <button type="button" className="language" aria-label={label} onClick={() => setUiLanguagePreference(language === "ru" ? "en" : "ru")}>
      {language === "ru" ? "EN" : "RU"}
    </button>
  );
}

export function Topbar({ title, backLabel, languageLabel, onBack }: { title: string; backLabel: string; languageLabel: string; onBack: () => void }) {
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" aria-label={backLabel} onClick={onBack}>
        <Icon name="back" />
      </button>
      <span className="bar-title">{title}</span>
      <LanguageSwitch label={languageLabel} />
    </header>
  );
}

/**
 * A bok's square cover: boks have no cover art, so it is the title's first
 * letter on one of the design's paper tints, the same one every time.
 */
const tints = [
  ["#263e40", "#e9d7ae"],
  ["#803e37", "#efbe8d"],
  ["#b7c6bb", "#244538"],
  ["#d7b87e", "#47352c"],
  ["#9a4f3a", "#eed4a8"],
  ["#c7c8d6", "#394250"],
  ["#d2cdbe", "#50544a"],
  ["#6e857b", "#e4ddbe"],
  ["#c2c9b5", "#526347"],
  ["#e4ceac", "#855e43"],
  ["#d1d3c5", "#677566"],
] as const;

export function coverLetter(title: string) {
  return Array.from(title).find((character) => /[\p{L}\p{N}]/u.test(character))?.toLocaleUpperCase() ?? "b";
}

export function Thumb({ id, title, className = "work-thumb" }: { id: string; title: string; className?: string }) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const [background, color] = tints[hash % tints.length];
  return (
    <div className={className} style={{ background, color }} aria-hidden="true">
      {coverLetter(title)}
    </div>
  );
}

/**
 * The glass sheet that rises from the bottom (menus, confirmations). It holds
 * focus while open, Escape closes it, and focus goes back where it was.
 */
export function Sheet({
  title,
  closeLabel,
  onClose,
  head,
  children,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** A bok's cover and byline beside the title. */
  head?: { thumb: ReactNode; byline: string };
  children: ReactNode;
}) {
  const sheet = useRef<HTMLElement | null>(null);
  const onCloseRef = useLatest(onClose);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sheet.current?.querySelector<HTMLElement>("button, input, textarea, a")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheet.current) return;
      const focusable = [...sheet.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea")];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable[focusable.length - 1].focus();
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault();
        focusable[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [onCloseRef]);

  return (
    <div
      className="scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="handle" aria-hidden="true" />
        <header className={`sheet-head ${head ? "sheet-bok-head" : ""}`}>
          {head?.thumb}
          <div>
            <h2>{title}</h2>
            {head && <small>{head.byline}</small>}
          </div>
          <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function SheetAction({
  icon,
  label,
  hint,
  danger,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`sheet-action ${danger ? "danger" : ""}`} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
      <span>
        {hint ? <strong>{label}</strong> : label}
        {hint && (
          <>
            <br />
            <small className="muted">{hint}</small>
          </>
        )}
      </span>
      <span className="arrow">
        <Icon name="arrow" />
      </span>
    </button>
  );
}

/** A short line at the bottom of the screen, gone after three seconds. */
export function useToast() {
  const [text, setText] = useState("");
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  function show(next: string) {
    setText(next);
    setVisible(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), 3100);
  }
  const node = (
    <div id="toast" className={visible ? "visible" : ""} role="status" aria-live="polite">
      {text}
    </div>
  );
  return { show, node };
}
