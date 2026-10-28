"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import { loadPoemManifest, poemManifestFor, sandboxPoems } from "@/components/boks/poetry/poems";
import { seriesPieces } from "@/components/boks/series/series-catalogue";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const words = defineMessages({
  manifestFailed: (error: string) => `The manifest did not load: ${error}`,
  retry: "Retry manifests",
  eyebrow: "Immersive poem",
  lines: "Lines",
  scenes: "Scenes",
  duration: "Duration",
  seconds: (value: string) => `${value} s`,
  fromRecording: "from the recording",
  timings: "timings",
  aligned: "Aligned",
  draft: "Draft",
  open: "Open poem",
  recordingView: "Recording view",
  textNote: "No autograph survives, the readings differ and the attribution is disputed; the academic tradition keeps the poem in Lermontov's canon.",
  workshop: "In the workshop",
  alignedTimings: "Aligned timings",
  draftTimings: "Draft timings",
  notPublic: " · not in the public catalogue",
}, {
  ru: {
    manifestFailed: (error) => `Манифест не загрузился: ${error}`,
    retry: "Загрузить манифесты снова",
    eyebrow: "Иммерсивный стих",
    lines: "Строки",
    scenes: "Сцены",
    duration: "Длительность",
    seconds: (value) => `${value} с`,
    fromRecording: "по записи",
    timings: "тайминги",
    aligned: "Выровнены",
    draft: "Черновик",
    open: "Открыть стих",
    recordingView: "Вид для записи",
    textNote: "Автограф не сохранился, списки расходятся, авторство оспаривается; академическая традиция оставляет стихотворение в каноне Лермонтова.",
    workshop: "В мастерской",
    alignedTimings: "Тайминги выровнены",
    draftTimings: "Черновые тайминги",
    notPublic: " · нет в публичном каталоге",
  },
});

/**
 * The immersive poetry format, before it has a boks of its own.
 *
 * Every poem the format has, including "Прощай, немытая Россия", which is not
 * in the catalogue and can only be watched here. Nothing here is particular to that poem: the
 * player takes a manifest, and a second poem is a second manifest.
 */
export function PoetrySandbox() {
  const t = useMessages(words);
  const [manifests, setManifests] = useState<PoemManifest[]>([]);
  const [open, setOpen] = useState<PoemManifest | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      Promise.all(sandboxPoems.map(loadPoemManifest)).then((items) => { setManifests(items); setError(""); }, (reason: Error) =>
        setError(reason.message)
      );
    }, 0);
    return () => window.clearTimeout(handle);
  }, [attempt]);

  const close = useCallback(() => setOpen(null), []);
  const selected = manifests.find((manifest) => manifest.id === selectedId) ?? manifests.find((manifest) => manifest.id.startsWith("hope-feathers")) ?? manifests[0];

  return (
    <section className="space-y-4">
      {error && <div role="alert"><p className="text-sm text-destructive">{t.manifestFailed(error)}</p><Button variant="outline" onClick={() => setAttempt((value) => value + 1)}><RefreshCw /> {t.retry}</Button></div>}

      {selected && [selected].map((manifest) => (
        <div key={manifest.id} className="studio-poem-card space-y-3 border p-4">
          <div className="studio-poem-preview">
            <span className="studio-poem-mark" aria-hidden="true">✺</span>
            <div><span className="studio-eyebrow">{t.eyebrow}</span><h3>{manifest.title}</h3><p>{manifest.author}</p></div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{t.lines}</dt>
              <dd>{manifest.lines.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.scenes}</dt>
              <dd>{manifest.scenes.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t.duration}</dt>
              <dd>{t.seconds((manifest.durationMs / 1000).toFixed(1))}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{manifest.timingMode === "forced-alignment" ? t.fromRecording : t.timings}</dt>
              <dd>{manifest.timingMode === "forced-alignment" ? t.aligned : t.draft}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { setRecording(false); setOpen(manifest); }}><Play className="size-4" /> {t.open}</Button>
            <Button variant="outline" onClick={() => { setRecording(true); setOpen(manifest); }}><Camera className="size-4" /> {t.recordingView}</Button>
          </div>
          {/*
            A textological note the editors asked for: no autograph survives,
            the text exists in variants, and the attribution has been argued
            over - though the academic tradition keeps it in Lermontov.
          */}
          {manifest.id.startsWith("farewell-russia") && (
            <p className="text-xs text-muted-foreground">{t.textNote}</p>
          )}
        </div>
      ))}

      <section className="studio-editorial-section"><h2>{t.workshop}</h2><div className="studio-link-rows">{manifests.filter(manifest => manifest.id !== selected?.id).map(manifest => <button type="button" key={manifest.id} onClick={() => { setSelectedId(manifest.id); window.scrollTo({ top: 0 }); }}><span><strong>{manifest.title}</strong><small>{manifest.author} · {manifest.timingMode === "forced-alignment" ? t.alignedTimings : t.draftTimings}{manifest.id.startsWith("farewell-russia") ? t.notPublic : ""}</small></span><span>↗</span></button>)}</div></section>
      {open && <ImmersivePoem manifest={open} coverArtwork={seriesPieces.find(piece => poemManifestFor(piece.storyId) === open.audio.replace(/[^/]+$/, "manifest.json"))?.cover} onClose={close} recording={recording} />}
    </section>
  );
}
