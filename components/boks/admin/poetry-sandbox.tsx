"use client";

import { useCallback, useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import { loadPoemManifest, sandboxPoems } from "@/components/boks/poetry/poems";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";

/**
 * The immersive poetry format, before it has a boks of its own.
 *
 * Every poem the format has, including "Прощай, немытая Россия", which is not
 * in the catalogue and can only be watched here. Nothing here is particular to that poem: the
 * player takes a manifest, and a second poem is a second manifest.
 */
export function PoetrySandbox() {
  const [manifests, setManifests] = useState<PoemManifest[]>([]);
  const [open, setOpen] = useState<PoemManifest | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = window.setTimeout(() => {
      Promise.all(sandboxPoems.map(loadPoemManifest)).then(setManifests, (reason: Error) =>
        setError(reason.message)
      );
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  const close = useCallback(() => setOpen(null), []);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Immersive poems</h2>
        <p className="text-sm text-muted-foreground">
          A renderer of its own for verse: the voice sets the pace, the picture changes with the
          sense, and each word arrives in the frame as it is spoken. Everything comes from the
          manifest; no poem needs a component of its own.
        </p>
      </header>

      {error && <p className="text-sm text-destructive">The manifest did not load: {error}</p>}

      {manifests.map((manifest) => (
        <div key={manifest.id} className="space-y-3 rounded-lg border p-4">
          <div>
            <p className="font-semibold">{manifest.title}</p>
            <p className="text-sm text-muted-foreground">{manifest.author}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Lines</dt>
              <dd>{manifest.lines.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Scenes</dt>
              <dd>{manifest.scenes.length}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Duration</dt>
              <dd>{(manifest.durationMs / 1000).toFixed(1)} s</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Timings</dt>
              <dd>{manifest.timingMode === "forced-alignment" ? "from the recording" : "draft"}</dd>
            </div>
          </dl>
          <Button onClick={() => setOpen(manifest)}>
            <Play className="size-4" /> Open
          </Button>
          {/*
            A textological note the editors asked for: no autograph survives,
            the text exists in variants, and the attribution has been argued
            over - though the academic tradition keeps it in Lermontov.
          */}
          {manifest.id.startsWith("farewell-russia") && (
            <p className="text-xs text-muted-foreground">
              No autograph survives, the readings differ and the attribution is disputed; the academic
              tradition keeps the poem in Lermontov's canon.
            </p>
          )}
        </div>
      ))}

      {open && <ImmersivePoem manifest={open} onClose={close} />}
    </section>
  );
}
