"use client";

import { useEffect, useRef, useState } from "react";
import type { Story } from "@/components/boks/client-types";
import { CinemaMode } from "@/components/boks/cinema/cinema-mode";
import { isBoksSeriesPiece } from "@/components/boks/cinema/series";
import type { FormatPlaybackState } from "@/components/boks/cinema/format-controls";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import { loadPoemManifest, poemManifestFor } from "@/components/boks/poetry/poems";
import type { FinaleActions } from "@/components/boks/reading-finale";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import type { GestureTrace } from "@/lib/boks/studies/gesture-trace";
import type { StudyWords } from "@/components/boks/studies/study-copy";

/** Is this bok playable as Series - a poem manifest or a finished cinema piece. */
export function isSeriesBok(storyId: string) {
  return Boolean(poemManifestFor(storyId)) || isBoksSeriesPiece(storyId);
}

export type SeriesMeasure = {
  /** Wall seconds the player was open. */
  seconds: number;
  /** How far the recording got, 0..1. */
  progress: number;
  ended: boolean;
};

// The cinema player wants an ending's actions even when it shows none.
const noFinale: FinaleActions = {
  liked: false,
  likeCount: 0,
  commentCount: 0,
  onLike: () => undefined,
  onShare: () => undefined,
  onNext: () => undefined,
  onAftertaste: () => undefined,
};

/**
 * A Series piece inside a study: the product's own player, without its
 * ending, likes or comments. The piece ends in a Continue button; closing the
 * player early counts as leaving it, with how far it got.
 */
export function StudySeriesPlayer({ story, words, gestureTrace, onDone }: {
  story: Story;
  words: StudyWords;
  gestureTrace?: { mode: "record"; onTrace: (trace: GestureTrace) => void } | { mode: "replay"; trace: GestureTrace };
  onDone: (measure: SeriesMeasure) => void;
}) {
  const manifestUrl = poemManifestFor(story.id);
  const [manifest, setManifest] = useState<PoemManifest | null>(null);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const opened = useRef(0);
  const progress = useRef(0);

  useEffect(() => {
    opened.current = Date.now();
    if (!manifestUrl) return;
    let cancelled = false;
    loadPoemManifest(manifestUrl).then(
      (loaded) => { if (!cancelled) setManifest(loaded); },
      () => { if (!cancelled) setFailed(true); }
    );
    return () => { cancelled = true; };
  }, [manifestUrl]);

  const finish = () =>
    onDone({ seconds: Math.round((Date.now() - opened.current) / 100) / 10, progress: Math.round(progress.current * 1000) / 1000, ended });
  const onPlayback = (state: FormatPlaybackState) => {
    progress.current = Math.max(progress.current, state.progress);
    if (state.ended) setEnded(true);
  };

  if (failed) {
    return (
      <div className="study-series__status">
        <p>{words.failed}</p>
        <button type="button" className="study-button" onClick={finish}>{words.continue}</button>
      </div>
    );
  }

  return (
    <div className="study-series">
      {manifestUrl ? (
        manifest ? (
          <ImmersivePoem manifest={manifest} autoPlay withoutFinale gestureTrace={gestureTrace} onPlaybackChange={onPlayback} onClose={finish} />
        ) : (
          <p className="study-series__status">{words.loading}</p>
        )
      ) : (
        <CinemaMode story={story} finale={noFinale} autoPlay withoutFinale onPlaybackChange={onPlayback} onClose={finish} />
      )}
      {ended && (
        <div className="study-series__end">
          <button type="button" className="study-button" onClick={finish}>{words.continue}</button>
        </div>
      )}
    </div>
  );
}
