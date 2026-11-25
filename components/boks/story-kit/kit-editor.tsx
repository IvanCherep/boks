"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/components/boks/ui-language";
import { authorShareLabel, authorShareLabelPrefix } from "@/lib/boks/share-link";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { renderKitCard, type KitCard, type KitFormat } from "./kit-render";
import { defaultQuote, kitFileName, kitLanguage, manifestFrames, manifestLines, quotedLines, textLines, toggleQuoteLine, type KitFrame, type KitManifest } from "./kit-content";

/**
 * The picture a sheet draws and what changes it (`docs/story-kit.md`): one
 * engine for the author's "For social media" and the reader's "Share bok".
 * `useKitCard` holds the choices and draws the picture; `KitPreview` shows it;
 * `KitOptions` offers the choices (format, style, frame, lines).
 */

export type KitSubject =
  | {
      kind: "work";
      bokId: string;
      title: string;
      byline: string | null;
      cover: string | null;
      focus?: string;
      /** Readers get it as a Series. */
      series: boolean;
      /** The Series' manifest (its pictures and the lines its recording reads), or null. */
      manifest: string | null;
      body: string | null;
    }
  | { kind: "page"; name: string; photo: string | null; covers: string[]; works: number; series: number };

export type KitStyle = "poster" | "frame" | "lines" | "author";

export const kitWords = defineMessages(
  {
    format: "Format",
    story: "Story 9:16",
    post: "Post 4:5",
    styles: { poster: "Poster", frame: "Frame", lines: "Lines", author: "Page" } as Record<KitStyle, string>,
    frames: "Choose a frame",
    linesPick: "Choose up to 8 lines",
    full: "The card is full: take a line off first.",
    drawing: "Drawing…",
    failed: "Could not draw the picture. Try again.",
  },
  {
    ru: {
      format: "Формат",
      story: "Сторис 9:16",
      post: "Пост 4:5",
      styles: { poster: "Афиша", frame: "Кадр", lines: "Строки", author: "Страница" },
      frames: "Выберите кадр",
      linesPick: "Выберите до 8 строк",
      full: "Карточка заполнена: сначала уберите строку.",
      drawing: "Рисуем…",
      failed: "Не получилось нарисовать картинку. Попробуйте ещё раз.",
    },
  }
);

/** The card's own small words, in the language of the work, not of the phone. */
const cardWords = {
  ru: { read: "Читайте на boks", watch: "Смотрите и слушайте на boks", page: "Мои тексты на boks", series: "boks series", texts: { one: "# текст", few: "# текста", many: "# текстов", other: "# текста" }, seriesCount: "# Series" },
  en: { read: "Read on boks", watch: "Watch and listen on boks", page: "My writing on boks", series: "boks series", texts: { one: "# text", other: "# texts" }, seriesCount: "# Series" },
} as const;

async function loadManifest(url: string): Promise<KitManifest | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<KitManifest>;
    return Array.isArray(data.scenes) && Array.isArray(data.lines) ? (data as KitManifest) : null;
  } catch {
    return null;
  }
}

/** The address printed on a card: the author's page, or the site's own when the bok has no author page. */
function printedLink(handle: string) {
  if (handle) return authorShareLabel(handle);
  return authorShareLabelPrefix().replace(/\/@$/, "");
}

export function useKitCard(subject: KitSubject, handle: string, initialFormat: KitFormat = "story") {
  const w = useMessages(kitWords);
  const cardLanguage = kitLanguage(subject.kind === "work" ? `${subject.title} ${subject.byline ?? ""}` : subject.name);
  const cw = cardWords[cardLanguage];
  const [format, setFormat] = useState<KitFormat>(initialFormat);
  const [style, setStyle] = useState<KitStyle>(subject.kind === "page" ? "author" : "poster");
  const [manifest, setManifest] = useState<KitManifest | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [chosen, setChosen] = useState<number[] | null>(null);
  const [picture, setPicture] = useState<{ url: string; blob: Blob } | null>(null);
  const [drawing, setDrawing] = useState(true);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef<string | null>(null);

  const work = subject.kind === "work" ? subject : null;
  const isSeries = Boolean(work?.series);
  useEffect(() => {
    if (!work?.manifest) return;
    let live = true;
    void loadManifest(work.manifest).then((value) => { if (live) setManifest(value); });
    return () => { live = false; };
  }, [work?.manifest]);

  const frames: KitFrame[] = useMemo(() => (manifest ? manifestFrames(manifest) : []), [manifest]);
  // A Series quotes what it reads; a text, its own lines.
  const body = work?.body ?? null;
  const lines = useMemo(() => (manifest ? manifestLines(manifest) : body ? textLines(body) : []), [manifest, body]);
  const selection = chosen ?? defaultQuote(lines);
  const styles: KitStyle[] = subject.kind === "page" ? ["author"] : ["poster", ...(frames.length ? (["frame"] as const) : []), ...(lines.length ? (["lines"] as const) : [])];

  const link = printedLink(handle);
  const card: KitCard = (() => {
    if (subject.kind === "page") {
      const note = [subject.works ? plural(cardLanguage, subject.works, cw.texts).replace("#", String(subject.works)) : "", subject.series ? cw.seriesCount.replace("#", String(subject.series)) : ""].filter(Boolean).join(" · ");
      return { format, link, invite: cw.page, style: "author", photo: subject.photo, name: subject.name, covers: subject.covers, note: note || null };
    }
    const invite = isSeries ? cw.watch : cw.read;
    if (style === "frame" && frames.length) {
      const frame = frames[Math.min(frameIndex, frames.length - 1)];
      return { format, link, invite, style: "frame", image: frame.image, lines: frame.lines, title: subject.title, byline: subject.byline };
    }
    if (style === "lines" && lines.length && selection.length) {
      return { format, link, invite, style: "lines", image: subject.cover, focus: subject.focus, lines: quotedLines(lines, selection), title: subject.title, byline: subject.byline };
    }
    return { format, link, invite, style: "poster", image: subject.cover, focus: subject.focus, title: subject.title, byline: subject.byline, kicker: isSeries ? cw.series : null };
  })();
  // What is drawn, as text: the picture is drawn again only when this changes.
  const cardKey = JSON.stringify(card);

  // Drawn again on every change; the last picture stays until the next is ready.
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setDrawing(true);
      setFailed(false);
      renderKitCard(JSON.parse(cardKey) as KitCard)
        .then((blob) => {
          if (!live) return;
          const url = URL.createObjectURL(blob);
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = url;
          setPicture({ url, blob });
        })
        .catch(() => { if (live) setFailed(true); })
        .finally(() => { if (live) setDrawing(false); });
    }, 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [cardKey]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const fileName = kitFileName([subject.kind === "page" ? subject.name : subject.title, style === "author" ? "" : w.styles[style], format]);
  const file = useMemo(() => (picture ? new File([picture.blob], fileName, { type: "image/jpeg" }) : null), [picture, fileName]);
  const ready = Boolean(picture) && !drawing;

  return {
    subject, format, setFormat, style, setStyle, styles, frames, frameIndex, setFrameIndex, lines, selection, setChosen,
    picture, drawing, failed, ready, fileName, file,
    alt: subject.kind === "work" ? subject.title : subject.name,
  };
}

export type KitState = ReturnType<typeof useKitCard>;

/** True where a picture can go straight into the phone's share sheet (and on to a story). */
export function canShareKitFile(file: File | null) {
  // Only a phone sends a picture to a story; a computer's share sheet (AirDrop, Mail) is not that, so it saves.
  const phone = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  return Boolean(phone && file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }));
}

export function KitPreview({ kit }: { kit: KitState }) {
  const w = useMessages(kitWords);
  return (
    <figure className={`kit-preview kit-preview--${kit.format}`} aria-busy={kit.drawing}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture drawn here, as a blob */}
      {kit.picture && <img src={kit.picture.url} alt={kit.alt} />}
      {kit.drawing && <span className="kit-drawing">{w.drawing}</span>}
      {kit.failed && <span className="kit-drawing">{w.failed}</span>}
    </figure>
  );
}

/** The choices that change the picture. `onNotice` hears what the sheet should say (a full card), and "" to clear it. */
export function KitOptions({ kit, onNotice }: { kit: KitState; onNotice: (text: string) => void }) {
  const w = useMessages(kitWords);
  return (
    <>
      <div className="kit-segment" role="radiogroup" aria-label={w.format}>
        {(["story", "post"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={kit.format === value} className={kit.format === value ? "is-on" : ""} onClick={() => kit.setFormat(value)}>
            {value === "story" ? w.story : w.post}
          </button>
        ))}
      </div>
      {kit.styles.length > 1 && (
        <div className="kit-styles">
          {kit.styles.map((value) => (
            <button key={value} type="button" aria-pressed={kit.style === value} className={`kit-chip${kit.style === value ? " is-on" : ""}`} onClick={() => { kit.setStyle(value); onNotice(""); }}>
              {w.styles[value]}
            </button>
          ))}
        </div>
      )}
      {kit.style === "frame" && (
        <div className="kit-pick">
          <small>{w.frames}</small>
          <div className="kit-frames">
            {kit.frames.map((frame, index) => (
              <button key={frame.image} type="button" aria-pressed={index === kit.frameIndex} className={index === kit.frameIndex ? "is-on" : ""} onClick={() => kit.setFrameIndex(index)} aria-label={`${w.styles.frame} ${index + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={frame.image} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
      {kit.style === "lines" && (
        <div className="kit-pick">
          <small>{w.linesPick}</small>
          <ol className="kit-lines">
            {kit.lines.map((line, index) => (
              <li key={`${index}:${line}`}>
                <button type="button" aria-pressed={kit.selection.includes(index)} className={kit.selection.includes(index) ? "is-on" : ""}
                  onClick={() => {
                    const next = toggleQuoteLine(kit.lines, kit.selection, index);
                    if (next) { kit.setChosen(next); onNotice(""); } else onNotice(w.full);
                  }}>
                  {line}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
}
