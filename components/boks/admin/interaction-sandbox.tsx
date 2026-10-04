"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Gauge, Volume2, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InteractiveScene } from "@/components/boks/interactions/interactive-scene";
import { interactionScenes, type InteractionScene } from "@/lib/boks/interactions/scenes";
import { setInteractionSoundMuted } from "@/lib/boks/interactions/sound";

/**
 * Twelve mechanics, one at a time, with a frame counter running.
 *
 * The question this screen exists to answer is which of them survive contact
 * with a real phone, and "does it feel laggy" is not a question anyone answers
 * the same way twice. So the overlay measures instead: frames per second while
 * you are touching it, and the longest single gap between frames, which is the
 * number that actually corresponds to a stutter you can see. A scene can run
 * at a respectable average and still drop one 200ms frame that ruins it.
 *
 * Verdicts live in this browser. They are notes from a testing session, not a
 * setting the product reads - what ships is decided by a person afterwards.
 */

const verdictKey = "boks-interaction-verdicts";

type Verdict = "keep" | "shelve";

function readVerdicts(): Record<string, Verdict> {
  try {
    const raw = window.localStorage.getItem(verdictKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, Verdict> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === "keep" || value === "shelve") out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveVerdicts(verdicts: Record<string, Verdict>) {
  try {
    window.localStorage.setItem(verdictKey, JSON.stringify(verdicts));
  } catch {
    // A session with storage off still works; the notes just do not survive it.
  }
}

/** Frames per second, and the worst gap - the one a reader actually notices. */
function useFrameMeter(active: boolean) {
  const [fps, setFps] = useState(0);
  // The worst frame of the whole session, not of the last half-second: one
  // 200ms stall is the thing being hunted, and it must not scroll away.
  const [worstMs, setWorstMs] = useState(0);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();
    let previous = windowStart;
    let worst = 0;

    const tick = (now: number) => {
      const delta = now - previous;
      previous = now;
      // The first frame after mount is not a dropped frame.
      if (frames > 0 && delta > worst) worst = delta;
      frames += 1;
      if (now - windowStart >= 500) {
        setFps(Math.round((frames * 1000) / (now - windowStart)));
        setWorstMs((previousWorst) => Math.max(previousWorst, Math.round(worst)));
        frames = 0;
        worst = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return { fps, worstMs };
}

function SceneOverlay({
  scene,
  verdict,
  onVerdict,
  onClose,
}: {
  scene: InteractionScene;
  verdict?: Verdict;
  onVerdict: (verdict: Verdict) => void;
  onClose: () => void;
}) {
  const { fps, worstMs } = useFrameMeter(true);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="isandbox__overlay" role="dialog" aria-modal="true" aria-label={scene.title}>
      <div className="isandbox__bar">
        <div>
          <strong>{scene.title}</strong>
          <span className="isandbox__primitive">{scene.primitive}</span>
        </div>
        <div className="isandbox__bar-actions">
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setInteractionSoundMuted(next);
            }}
            aria-label={muted ? "Sound on" : "Sound off"}
            aria-pressed={muted}
          >
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
      </div>

      <div className="isandbox__stage">
        <InteractiveScene scene={scene} />
      </div>

      <div className="isandbox__foot">
        <div className={`isandbox__meter ${worstMs > 50 ? "is-bad" : ""}`}>
          <Gauge className="size-4" />
          <span>{fps} FPS</span>
          <span className="isandbox__worst">worst frame {worstMs} ms</span>
        </div>
        <div className="isandbox__verdict">
          <Button
            variant={verdict === "keep" ? "default" : "outline"}
            size="sm"
            onClick={() => onVerdict("keep")}
          >
            <Check className="size-4" /> Keep
          </Button>
          <Button
            variant={verdict === "shelve" ? "default" : "outline"}
            size="sm"
            onClick={() => onVerdict("shelve")}
          >
            Shelve
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InteractionSandbox() {
  const [open, setOpen] = useState<InteractionScene | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});

  // Read once, off the effect body, so the server-rendered markup and the
  // first client render agree before the stored notes land.
  useEffect(() => {
    const handle = window.setTimeout(() => setVerdicts(readVerdicts()), 0);
    return () => window.clearTimeout(handle);
  }, []);

  const setVerdict = useCallback((id: string, verdict: Verdict) => {
    setVerdicts((current) => {
      // Pressing the same verdict again clears it, so a mistake is one tap to
      // undo rather than a state you cannot get out of.
      const next = { ...current };
      if (next[id] === verdict) delete next[id];
      else next[id] = verdict;
      saveVerdicts(next);
      return next;
    });
  }, []);

  const kept = Object.values(verdicts).filter((v) => v === "keep").length;
  const shelved = Object.values(verdicts).filter((v) => v === "shelve").length;

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Interactions</h2>
        <p className="text-sm text-muted-foreground">
          Twelve scenes on five mechanics. Open each on a phone, keep a finger on it and watch the
          counter: the average FPS lies, the worst frame does not. Verdicts are kept in this
          browser.
        </p>
        <p className="text-sm text-muted-foreground">
          Keep: <strong>{kept}</strong> · Shelved: <strong>{shelved}</strong> · Not
          looked at: <strong>{interactionScenes.length - kept - shelved}</strong>
        </p>
      </header>

      <ul className="isandbox__grid">
        {interactionScenes.map((scene) => (
          <li key={scene.id}>
            <button type="button" className="isandbox__card" onClick={() => setOpen(scene)}>
              {/* Only the cover, and only lazily: twelve scenes mounted at once
                  would decode twenty-four pictures to show twelve thumbnails. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/interactions/${scene.id}/before.webp`} alt="" loading="lazy" decoding="async" />
              <span className="isandbox__card-title">{scene.title}</span>
              <span className="isandbox__card-meta">
                {scene.primitive} · {scene.hint}
              </span>
              {verdicts[scene.id] && (
                <span className={`isandbox__tag isandbox__tag--${verdicts[scene.id]}`}>
                  {verdicts[scene.id] === "keep" ? "keep" : "shelved"}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {open && (
        <SceneOverlay
          scene={open}
          verdict={verdicts[open.id]}
          onVerdict={(verdict) => setVerdict(open.id, verdict)}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
