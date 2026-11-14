"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthorPortraitPage } from "@/components/boks/author-portrait-page";
import type { AuthorProfile } from "@/components/boks/client-types";
import { useMessages } from "@/components/boks/ui-language";
import { authorShareUrl } from "@/lib/boks/share-link";
import { readableBoksError } from "@/lib/boks/errors";
import { defineMessages } from "@/lib/i18n/messages";
import { LinkOnlyPoem } from "@/components/boks/link-only/link-only-poem";
import { loadSpacePreview, type PreviewItem, type SpacePreview } from "./data";

const words = defineMessages(
  {
    loading: "Loading the preview…",
    unavailable: "This preview is not available.",
    visibleToEditors: "Preview · visible to the team",
    visibleToOwner: "Preview · visible to you and the team",
    close: "Close",
    format: { text: "Text", series: "Series" } as Record<string, string>,
    notPublished: "Not published yet",
    published: "Published",
    openSeries: "Watch the release",
    seriesNote: "The Series release opens in the reader, with its recording, music and illustrations.",
    seriesPieceNote: "Prepared for this text: your reading, word by word, with illustrations. Only you and the team can open it; after publication the team releases it with the text.",
  },
  {
    ru: {
      loading: "Загружаем предпросмотр…",
      unavailable: "Этот предпросмотр недоступен.",
      visibleToEditors: "Предпросмотр · видно редакции",
      visibleToOwner: "Предпросмотр · видно вам и редакции",
      close: "Закрыть",
      format: { text: "Текст", series: "Series" },
      notPublished: "Ещё не опубликовано",
      published: "Опубликовано",
      openSeries: "Посмотреть выпуск",
      seriesNote: "Выпуск Series откроется в читалке, с записью, музыкой и иллюстрациями.",
      seriesPieceNote: "Подготовлена к этому тексту: ваше чтение, слово в слово, с иллюстрациями. Открыть её можете только вы и редакция; после публикации редакция выпустит её вместе с текстом.",
    },
  }
);

/** Builds the reader's page from the draft: the same component, other data. */
export function previewAuthor(preview: SpacePreview): { profile: AuthorProfile; byId: Map<string, PreviewItem> } {
  const byId = new Map<string, PreviewItem>();
  const boks = preview.items.map((item) => {
    const id = item.bokId ?? item.key;
    byId.set(id, item);
    return {
      id,
      title: item.title,
      minutes: 0,
      readingShape: "",
      createdAt: "",
      // A text with a Series prepared for it is previewed as it will read
      // once the team releases that Series.
      format: item.seriesPiece ? ("series" as const) : item.format,
      // A prepared text never borrows a registered production's look.
      seriesHeld: item.seriesPiece ? false : (item.seriesHeld ?? item.format !== "series"),
      ...(item.seriesPiece ? { artwork: `/l/${item.seriesPiece}/f/cover.webp` } : {}),
    };
  });
  return {
    byId,
    profile: {
      authorUserId: "",
      authorName: preview.name ?? `@${preview.handle ?? ""}`,
      authorHandle: preview.handle ?? "",
      byline: null,
      followers: 0,
      following: false,
      totalBoks: boks.length,
      writers: [],
      boks,
    },
  };
}

export function SpacePreviewPage() {
  const t = useMessages(words);
  const [preview, setPreview] = useState<SpacePreview | null>(null);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<PreviewItem | null>(null);

  useEffect(() => {
    const space = new URLSearchParams(window.location.search).get("space");
    loadSpacePreview(space && /^[0-9a-f-]{36}$/i.test(space) ? space : null)
      .then(setPreview)
      .catch((error) => setStatus(readableBoksError(error, t.unavailable)));
  }, [t.unavailable]);

  const built = useMemo(() => (preview ? previewAuthor(preview) : null), [preview]);

  if (!preview || !built) {
    return (
      <main className="asp-preview-empty">
        <p role="status">{status || t.loading}</p>
      </main>
    );
  }

  const photo = preview.photo ? `data:image/jpeg;base64,${preview.photo}` : null;
  const handle = preview.handle ?? "";
  const embedded = typeof window !== "undefined" && window.parent !== window;

  return (
    <>
      <AuthorPortraitPage
        identity={{ handle, name: preview.name || `@${handle}`, photo, thumb: photo, focus: "50% 50%" }}
        author={built.profile}
        profileLink={typeof window === "undefined" ? "" : authorShareUrl(handle, window.location.origin)}
        following={false}
        busy={false}
        preview={{ label: preview.access === "owner" ? t.visibleToOwner : t.visibleToEditors }}
        onToggleFollow={() => undefined}
        onOpenBok={(id) => setOpen(built.byId.get(id) ?? null)}
        onClose={() => { if (!embedded) window.location.href = "/author#my-page"; }}
      />
      {/* A Series card plays its Series, behind the curtain, as readers will see it. */}
      {open && <WorkPreview item={open} t={t} watchFirst={Boolean(open.seriesPiece)} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One work as it would read: the exact version that would be published. */
export function WorkPreview({
  item,
  t,
  onClose,
  watchFirst = false,
}: {
  item: PreviewItem;
  t: (typeof words)["en"];
  onClose: () => void;
  /** Open on the Series rather than the text; Back then leaves both. */
  watchFirst?: boolean;
}) {
  const [watching, setWatching] = useState(watchFirst && Boolean(item.seriesPiece));
  useEffect(() => {
    if (watching) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, watching]);

  if (watching && item.seriesPiece) {
    // Its own layer: the author page (and the cabinet's reader) sit above the
    // player's usual place in the feed.
    return (
      <div className="asp-series-stage">
        <LinkOnlyPoem token={item.seriesPiece} curtain onClose={() => (watchFirst ? onClose() : setWatching(false))} />
      </div>
    );
  }

  return (
    <div className="asp-reader" role="dialog" aria-modal="true" aria-label={item.title}>
      <header>
        <span className="asp-reader__meta">{t.format[item.format]} · {item.published ? t.published : t.notPublished}</span>
        <button type="button" onClick={onClose} aria-label={t.close}>×</button>
      </header>
      <article>
        <h1>{item.title}</h1>
        {item.seriesPiece && (
          <p className="asp-reader__series">
            <button type="button" className="asp-reader__play" onClick={() => setWatching(true)}>▶ {t.openSeries}</button>
            <small>{t.seriesPieceNote}</small>
          </p>
        )}
        {item.format === "series" && item.bokId && (
          <p className="asp-reader__series">
            <a href={`/b/${item.bokId}`} target="_blank" rel="noopener noreferrer">▶ {t.openSeries}</a>
            <small>{t.seriesNote}</small>
          </p>
        )}
        <div className="asp-reader__text">{item.body}</div>
      </article>
    </div>
  );
}

export const previewWords = words;
