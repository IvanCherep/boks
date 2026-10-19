"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import { loadPoemManifest, poemManifestFor, sandboxPoems } from "@/components/boks/poetry/poems";
import { seriesPieces } from "@/components/boks/series/series-catalogue";
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
      {error && <div role="alert"><p className="text-sm text-destructive">The manifest did not load: {error}</p><Button variant="outline" onClick={() => setAttempt((value) => value + 1)}><RefreshCw /> Retry manifests</Button></div>}

      {selected && [selected].map((manifest) => (
        <div key={manifest.id} className="studio-poem-card space-y-3 border p-4">
          <div className="studio-poem-preview">
            <span className="studio-poem-mark" aria-hidden="true">✺</span>
            <div><span className="studio-eyebrow">Immersive poem</span><h3>{manifest.title}</h3><p>{manifest.author}</p></div>
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
              <dt className="text-muted-foreground">{manifest.timingMode === "forced-alignment" ? "from the recording" : "timings"}</dt>
              <dd>{manifest.timingMode === "forced-alignment" ? "Aligned" : "Draft"}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { setRecording(false); setOpen(manifest); }}><Play className="size-4" /> Open poem</Button>
            <Button variant="outline" onClick={() => { setRecording(true); setOpen(manifest); }}><Camera className="size-4" /> Recording view</Button>
          </div>
          {/*
            A textological note the editors asked for: no autograph survives,
            the text exists in variants, and the attribution has been argued
            over - though the academic tradition keeps it in Lermontov.
          */}
          {manifest.id.startsWith("farewell-russia") && (
            <p className="text-xs text-muted-foreground">
              No autograph survives, the readings differ and the attribution is disputed; the academic
              tradition keeps the poem in Lermontov&apos;s canon.
            </p>
          )}
        </div>
      ))}

      <section className="studio-editorial-section"><h2>In the workshop</h2><div className="studio-link-rows">{manifests.filter(manifest => manifest.id !== selected?.id).map(manifest => <button type="button" key={manifest.id} onClick={() => { setSelectedId(manifest.id); window.scrollTo({ top: 0 }); }}><span><strong>{manifest.title}</strong><small>{manifest.author} · {manifest.timingMode === "forced-alignment" ? "Aligned timings" : "Draft timings"}{manifest.id.startsWith("farewell-russia") ? " · not in the public catalogue" : ""}</small></span><span>↗</span></button>)}</div></section>
      {open && <ImmersivePoem manifest={open} coverArtwork={seriesPieces.find(piece => poemManifestFor(piece.storyId) === open.audio.replace(/[^/]+$/, "manifest.json"))?.cover} onClose={close} recording={recording} />}
    </section>
  );
}
