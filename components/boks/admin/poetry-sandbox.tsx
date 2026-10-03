"use client";

import { useCallback, useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import { loadPoemManifest, sandboxPoem } from "@/components/boks/poetry/poems";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";

/**
 * The immersive poetry format, before it has a boks of its own.
 *
 * "Прощай, немытая Россия" is not in the catalogue, so this is where the format
 * can be watched and judged. Nothing here is particular to that poem: the
 * player takes a manifest, and a second poem is a second manifest.
 */
export function PoetrySandbox() {
  const [manifest, setManifest] = useState<PoemManifest | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      loadPoemManifest(sandboxPoem).then(setManifest, (reason: Error) => setError(reason.message));
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Иммерсивные стихи</h2>
        <p className="text-sm text-muted-foreground">
          Отдельный рендерер для стихотворений: голос задаёт темп, фон меняется со смыслом, слова
          появляются в кадре в момент произнесения. Всё — из манифеста, под каждое стихотворение
          свой компонент не нужен.
        </p>
      </header>

      {error && <p className="text-sm text-destructive">Манифест не загрузился: {error}</p>}

      {manifest && (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="font-semibold">{manifest.title}</p>
            <p className="text-sm text-muted-foreground">{manifest.author}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Строк</dt>
              <dd>{manifest.lines.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Сцен</dt>
              <dd>{manifest.scenes.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Длительность</dt>
              <dd>{(manifest.durationMs / 1000).toFixed(1)} с</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Тайминги</dt>
              <dd>{manifest.timingMode === "forced-alignment" ? "по записи" : "черновые"}</dd>
            </div>
          </dl>
          <Button onClick={() => setOpen(true)}>
            <Play className="size-4" /> Открыть
          </Button>
          {/*
            A textological note the editors asked for: no autograph survives,
            the text exists in variants, and the attribution has been argued
            over - though the academic tradition keeps it in Lermontov.
          */}
          <p className="text-xs text-muted-foreground">
            Автограф не сохранился, известны разночтения, атрибуция обсуждается; академическая
            традиция включает стихотворение в корпус Лермонтова.
          </p>
        </div>
      )}

      {open && manifest && <ImmersivePoem manifest={manifest} onClose={close} />}
    </section>
  );
}
