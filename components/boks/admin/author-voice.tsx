"use client";

import { useEffect, useState } from "react";
import { Download, Mic } from "lucide-react";
import "@/app/author-composer.css";
import { useMessages } from "@/components/boks/ui-language";
import { clock } from "@/components/boks/admin/series-recorder/messages";
import { loadStudioVoice, takeUrl, type SavedVoice } from "@/components/boks/author-cabinet/voice-data";
import { defineMessages } from "@/lib/i18n/messages";

/**
 * Studio → Moderation: the author's reading of a piece sent from My page
 * (`docs/author-publishing.md`, "The author's voice"), to listen to before
 * approving and to build the Boks Series from. Nothing is shown for a piece
 * without one, unless it came from My page, where a voice is expected.
 */

const words = defineMessages({
  title: "The author's voice",
  teleprompter: "Recorded with the teleprompter",
  upload: "The author's own recording",
  current: "Reads the text as it is",
  stale: "Recorded for an earlier version of the text",
  download: "Download",
  loading: "Loading the recording…",
  failed: "Could not load the recording.",
  none: "No reading by the author yet. A piece sent before 22 November may have none.",
}, { ru: {
  title: "Голос автора",
  teleprompter: "Записано с суфлёром",
  upload: "Своя запись автора",
  current: "Читает текст в нынешнем виде",
  stale: "Записано для прежней версии текста",
  download: "Скачать",
  loading: "Загружаем запись…",
  failed: "Не удалось загрузить запись.",
  none: "Чтения автора пока нет. У бока, отправленного до 22 ноября, его может не быть.",
} });

export function AuthorVoicePanel({ bokId, expected }: { bokId: string; expected: boolean }) {
  const t = useMessages(words);
  const [voice, setVoice] = useState<SavedVoice | null | undefined>(undefined);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let made: string | null = null;
    loadStudioVoice(bokId).then(async (found) => {
      if (!live) return;
      setVoice(found);
      if (!found) return;
      made = await takeUrl(bokId, found.file);
      if (live) setUrl(made);
      else URL.revokeObjectURL(made);
    }).catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [bokId]);

  if (voice === undefined && !failed) return expected ? <p className="studio-author-voice__muted">{t.loading}</p> : null;
  if (!voice) return expected || failed ? <div className="studio-author-voice is-none"><strong><Mic /> {t.title}</strong><p>{failed ? t.failed : t.none}</p></div> : null;
  return (
    <div className="studio-author-voice">
      <strong><Mic /> {t.title}</strong>
      <p>{voice.source === "upload" ? `${t.upload}${voice.name ? `: ${voice.name}` : ""}` : t.teleprompter} · {clock(voice.durationMs)}</p>
      <p className={voice.current ? "is-current" : "is-stale"}>{voice.current ? t.current : t.stale}</p>
      {url ? <audio controls preload="metadata" src={url} /> : <p className="studio-author-voice__muted">{failed ? t.failed : t.loading}</p>}
      {url && <a className="studio-author-voice__download" href={url} download={`${bokId}-${voice.file}`}><Download /> {t.download}</a>}
    </div>
  );
}
