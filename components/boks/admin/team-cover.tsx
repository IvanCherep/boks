"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Sparkles } from "lucide-react";
import "@/app/author-composer.css";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { prepareCover } from "@/lib/boks/author/covers/cover-image";
import { loadStudioBokCover, setStudioBokCover, startDrawing, waitForDrawing } from "@/components/boks/author-cabinet/composer-data";

/**
 * The review queue's cover panel (`docs/author-publishing.md`): the author
 * asked the team to find this bok's picture. Studio uploads one or draws two
 * and picks; the database refuses to publish the bok without one.
 */

const words = defineMessages({
  title: "The author asked us for the cover",
  hint: "Upload a picture or draw two from the text, then approve. Without a cover the bok cannot be published.",
  upload: "Upload",
  draw: "Draw two",
  drawing: "Drawing…",
  use: "Use this one",
  saved: "Cover saved. Approve to publish.",
  failed: "Could not do that. Try again or upload a picture.",
  current: "Current cover",
  seriesTitle: "The bok's cover",
  seriesHint: "Upload a picture or draw two from the text. The series goes to the author only with a cover.",
  seriesSaved: "Cover saved.",
}, { ru: {
  title: "Автор просит подобрать обложку",
  hint: "Загрузите картинку или нарисуйте две по тексту, потом одобрите. Без обложки бок не опубликовать.",
  upload: "Загрузить",
  draw: "Нарисовать две",
  drawing: "Рисуем…",
  use: "Взять эту",
  saved: "Обложка сохранена. Одобрите, чтобы опубликовать.",
  failed: "Не получилось. Попробуйте ещё раз или загрузите картинку.",
  current: "Текущая обложка",
  seriesTitle: "Обложка бока",
  seriesHint: "Загрузите картинку или нарисуйте две по тексту. Серия уходит автору только с обложкой.",
  seriesSaved: "Обложка сохранена.",
} });

export function TeamCoverPanel({ bokId, title, text, onCover, forSeries = false }: { bokId: string; title: string; text: string; onCover: (version: number) => void; /** In «Boks Series в работе»: the cover goes with the series, nothing is approved. */ forSeries?: boolean }) {
  const t = useMessages(words);
  const [image, setImage] = useState<string | null>(null);
  const [pictures, setPictures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const report = useRef(onCover);
  useEffect(() => { report.current = onCover; });

  useEffect(() => {
    let live = true;
    void loadStudioBokCover(bokId).then((cover) => {
      if (!live || !cover) return;
      setImage(`data:${cover.webp.startsWith("/9j/") ? "image/jpeg" : "image/webp"};base64,${cover.webp}`);
      report.current(cover.version);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [bokId]);

  async function save(blob: Blob, source: "upload" | "generated") {
    setBusy(true);
    setNote("");
    try {
      const prepared = await prepareCover(blob, source);
      const saved = await setStudioBokCover(bokId, prepared);
      setImage(prepared.preview);
      report.current(saved.coverVersion);
      setNote(forSeries ? t.seriesSaved : t.saved);
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  }

  async function draw() {
    setBusy(true);
    setNote("");
    try {
      const started = await startDrawing(bokId, title, text);
      const result = await waitForDrawing(started.jobId);
      if ("pictures" in result) setPictures(result.pictures);
      else setNote(t.failed);
    } catch (error) {
      setNote(error instanceof Error ? error.message : t.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-team-cover">
      <strong>{forSeries ? t.seriesTitle : t.title}</strong>
      <p>{forSeries ? t.seriesHint : t.hint}</p>
      {image && (
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" />
          <figcaption>{t.current}</figcaption>
        </figure>
      )}
      <div className="studio-team-cover__actions">
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}><ImagePlus /> {t.upload}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void draw()}><Sparkles /> {busy && !pictures.length ? t.drawing : t.draw}</Button>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void save(file, "upload"); }} />
      {pictures.length > 0 && (
        <div className="studio-team-cover__variants">
          {pictures.map((url) => (
            <button key={url} type="button" disabled={busy} onClick={() => void fetch(url).then((response) => response.blob()).then((blob) => save(blob, "generated"))}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" />
              <span>{t.use}</span>
            </button>
          ))}
        </div>
      )}
      {note && <p role="status">{note}</p>}
    </div>
  );
}
