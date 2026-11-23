"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "@/app/story-kit.css";
import { Sheet } from "@/components/boks/author-cabinet/ui";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { ShareLinkPair } from "@/components/boks/share/share-link-pair";
import { loadBokSlug } from "@/components/boks/supabase-browser-data";
import { authorShareLabel, authorShareUrl, bokShareUrl, russianShareUrl } from "@/lib/boks/share-link";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { renderKitCard, type KitCard, type KitFormat } from "./kit-render";
import { shareToStory } from "./kit-share";
import { defaultQuote, kitFileName, kitLanguage, manifestFrames, manifestLines, quotedLines, textLines, toggleQuoteLine, type KitFrame, type KitManifest } from "./kit-content";

/**
 * "For social media" (`docs/story-kit.md`): ready pictures for stories and
 * posts about the author's page or one of their works, in the boks look, to
 * save or send straight to a story from the phone's share sheet.
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

type Style = "poster" | "frame" | "lines" | "author";

const words = defineMessages(
  {
    title: "For social media",
    close: "Close",
    intro: "Pictures for stories and posts, in the boks look. Save one, or send it straight to a story.",
    story: "Story 9:16",
    post: "Post 4:5",
    styles: { poster: "Poster", frame: "Frame", lines: "Lines", author: "Page" } as Record<Style, string>,
    frames: "Choose a frame",
    linesPick: "Choose up to 8 lines",
    full: "The card is full: take a line off first.",
    drawing: "Drawing…",
    failed: "Could not draw the picture. Try again.",
    share: "Share to a story",
    save: "Save the picture",
    copied: "The link is copied: paste it into the “Link” sticker.",
    notCopied: "Copy the link with a button below.",
    shareFailed: "The phone did not open its menu. Save the picture and post it from your gallery.",
    saved: "Saved to downloads.",
    howTitle: "How to post",
    how: {
      instagram: "Instagram: choose Instagram in the menu, then Story. Add the “Link” sticker and paste the address, it is already copied.",
      vk: "VK: choose VK, then Story, and add the “Link” sticker with the same address.",
      telegram: "Telegram: from the menu the picture goes to a chat or a channel. For a story, save it and pick it in Telegram, New story; the link goes into the caption.",
      other: "No network you need in the menu? Choose “Save image” there and post the picture from your gallery.",
    },
    linkTitle: "The link, by hand",
    linkHint: "If it did not copy, or for a post: the address for Russian networks, and the one Telegram previews.",
    noFrames: "This Series has no pictures to show yet.",
  },
  {
    ru: {
      title: "Для соцсетей",
      close: "Закрыть",
      intro: "Готовые картинки для сторис и постов в стиле boks. Сохраните или сразу отправьте в сторис.",
      story: "Сторис 9:16",
      post: "Пост 4:5",
      styles: { poster: "Афиша", frame: "Кадр", lines: "Строки", author: "Страница" },
      frames: "Выберите кадр",
      linesPick: "Выберите до 8 строк",
      full: "Карточка заполнена: сначала уберите строку.",
      drawing: "Рисуем…",
      failed: "Не получилось нарисовать картинку. Попробуйте ещё раз.",
      share: "Поделиться в сторис",
      save: "Сохранить картинку",
      copied: "Ссылка скопирована: вставьте её в стикер «Ссылка».",
      notCopied: "Скопируйте ссылку кнопкой ниже.",
      shareFailed: "Телефон не открыл меню. Сохраните картинку и выложите её из галереи.",
      saved: "Сохранено в загрузки.",
      howTitle: "Как выложить",
      how: {
        instagram: "Instagram: в меню выберите Instagram, затем «История». Добавьте стикер «Ссылка» и вставьте адрес — он уже скопирован.",
        vk: "ВКонтакте: выберите ВКонтакте, затем «История», и добавьте стикер «Ссылка» с тем же адресом.",
        telegram: "Telegram: из меню картинка уходит в чат или канал. Для истории сохраните её и выберите в Telegram → «Новая история», ссылку — в подпись.",
        other: "Нужной соцсети нет в меню? Нажмите там «Сохранить изображение» и выложите картинку из галереи.",
      },
      linkTitle: "Ссылка вручную",
      linkHint: "Если не скопировалась или нужна для поста: адрес для российских соцсетей и тот, что показывает превью в Telegram.",
      noFrames: "У этой Series пока нет кадров.",
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

export function StoryKitSheet({ subject, handle, onClose }: { subject: KitSubject; handle: string; onClose: () => void }) {
  const w = useMessages(words);
  const device = useUiLanguage();
  const cardLanguage = kitLanguage(subject.kind === "work" ? `${subject.title} ${subject.byline ?? ""}` : subject.name);
  const cw = cardWords[cardLanguage];
  const [format, setFormat] = useState<KitFormat>("story");
  const [style, setStyle] = useState<Style>(subject.kind === "page" ? "author" : "poster");
  const [manifest, setManifest] = useState<KitManifest | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [chosen, setChosen] = useState<number[] | null>(null);
  const [notice, setNotice] = useState("");
  const [picture, setPicture] = useState<{ url: string; blob: Blob } | null>(null);
  const [drawing, setDrawing] = useState(true);
  const [failed, setFailed] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const work = subject.kind === "work" ? subject : null;
  const isSeries = Boolean(work?.series);
  useEffect(() => {
    if (!work?.manifest) return;
    let live = true;
    void loadManifest(work.manifest).then((value) => { if (live) setManifest(value); });
    return () => { live = false; };
  }, [work?.manifest]);
  useEffect(() => {
    if (!work) return;
    let live = true;
    void loadBokSlug(work.bokId).then((value) => { if (live) setSlug(value); });
    return () => { live = false; };
  }, [work]);

  const frames: KitFrame[] = useMemo(() => (manifest ? manifestFrames(manifest) : []), [manifest]);
  // A Series quotes what it reads; a text, its own lines.
  const body = work?.body ?? null;
  const lines = useMemo(() => (manifest ? manifestLines(manifest) : body ? textLines(body) : []), [manifest, body]);
  const selection = chosen ?? defaultQuote(lines);
  const styles: Style[] = subject.kind === "page" ? ["author"] : ["poster", ...(frames.length ? (["frame"] as const) : []), ...(lines.length ? (["lines"] as const) : [])];

  const link = authorShareLabel(handle);
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
  const file = picture ? new File([picture.blob], fileName, { type: "image/jpeg" }) : null;
  // Only a phone sends a picture to a story; a computer's share sheet (AirDrop, Mail) is not that, so it saves.
  const phone = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const canShareFile = Boolean(phone && file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }));

  const pageUrl = typeof window === "undefined" ? "" : work ? bokShareUrl({ id: work.bokId, slug }, window.location.origin) : authorShareUrl(handle, window.location.origin);
  // A link sticker shows no preview, so it takes the direct address: no detour abroad for a reader in Russia.
  const stickerLink = russianShareUrl(pageUrl);

  async function share() {
    if (!file) return;
    const { outcome, copied } = await shareToStory(file, stickerLink, { share: (data) => navigator.share(data), clipboard: navigator.clipboard });
    if (outcome === "failed") setNotice(w.shareFailed);
    else setNotice(copied ? w.copied : w.notCopied);
  }

  return (
    <Sheet title={w.title} closeLabel={w.close} onClose={onClose}>
      <div className="kit">
        <p className="kit-intro">{w.intro}</p>
        <div className="kit-layout">
          <figure className={`kit-preview kit-preview--${format}`} aria-busy={drawing}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a picture drawn here, as a blob */}
            {picture && <img src={picture.url} alt={subject.kind === "work" ? subject.title : subject.name} />}
            {drawing && <span className="kit-drawing">{w.drawing}</span>}
            {failed && <span className="kit-drawing">{w.failed}</span>}
          </figure>
          <div className="kit-controls">
            <div className="kit-segment" role="radiogroup" aria-label={w.title}>
              {(["story", "post"] as const).map((value) => (
                <button key={value} type="button" role="radio" aria-checked={format === value} className={format === value ? "is-on" : ""} onClick={() => setFormat(value)}>
                  {value === "story" ? w.story : w.post}
                </button>
              ))}
            </div>
            {styles.length > 1 && (
              <div className="kit-styles">
                {styles.map((value) => (
                  <button key={value} type="button" aria-pressed={style === value} className={`kit-chip${style === value ? " is-on" : ""}`} onClick={() => { setStyle(value); setNotice(""); }}>
                    {w.styles[value]}
                  </button>
                ))}
              </div>
            )}
            {style === "frame" && (
              <div className="kit-pick">
                <small>{w.frames}</small>
                <div className="kit-frames">
                  {frames.map((frame, index) => (
                    <button key={frame.image} type="button" aria-pressed={index === frameIndex} className={index === frameIndex ? "is-on" : ""} onClick={() => setFrameIndex(index)} aria-label={`${w.styles.frame} ${index + 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={frame.image} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {style === "lines" && (
              <div className="kit-pick">
                <small>{w.linesPick}</small>
                <ol className="kit-lines">
                  {lines.map((line, index) => (
                    <li key={`${index}:${line}`}>
                      <button type="button" aria-pressed={selection.includes(index)} className={selection.includes(index) ? "is-on" : ""}
                        onClick={() => {
                          const next = toggleQuoteLine(lines, selection, index);
                          if (next) { setChosen(next); setNotice(""); } else setNotice(w.full);
                        }}>
                        {line}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {notice && <p className="kit-notice" role="status">{notice}</p>}
            <div className="kit-actions">
              {canShareFile && <button type="button" className="btn" disabled={!picture || drawing} onClick={() => void share()}>{w.share}</button>}
              <a className={`btn ${canShareFile ? "btn-secondary" : ""}`} href={picture?.url} download={fileName} aria-disabled={!picture || drawing} onClick={(event) => { if (!picture || drawing) event.preventDefault(); else setNotice(w.saved); }}>
                {w.save}
              </a>
            </div>
            <section className="kit-how" aria-label={w.howTitle}>
              <strong>{w.howTitle}</strong>
              <ul>
                <li>{w.how.instagram}</li>
                <li>{w.how.vk}</li>
                <li>{w.how.telegram}</li>
              </ul>
              <small>{w.how.other}</small>
            </section>
            <section className="kit-link">
              <strong>{w.linkTitle}</strong>
              <small>{w.linkHint}</small>
              <ShareLinkPair url={pageUrl} caption={false} language={device} />
            </section>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
