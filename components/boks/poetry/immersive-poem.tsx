"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, ArrowRight, X } from "lucide-react";
import {
  backdropAt,
  lineIndexAt,
  playedFraction,
  presetFor,
  sceneAt,
  sceneFor,
  tokenStateAt,
  zoneFor,
  type PoemLine,
  type PoemManifest,
  type PoemScene,
  type PoemToken,
  type SafeZone,
} from "@/lib/boks/poetry/manifest";

/**
 * A poem as a place rather than a page.
 *
 * The voice sets the pace, the picture changes with the sense, and each word
 * arrives in the frame at the moment it is spoken. Everything particular to a
 * poem - its lines, its images, where a word may sit, which effect it gets -
 * comes from the manifest, so a second poem is assets and JSON and no new code.
 *
 * `audio.currentTime` is the only clock. Every visible thing is a function of
 * it, computed in one frame, which is what makes pausing, seeking and coming
 * back to a backgrounded tab land exactly where they should. A chain of timers
 * would do none of that and would look fine until someone scrubbed.
 *
 * React is kept out of the loop deliberately. The frame loop writes crossfade
 * and scale straight onto the elements as CSS variables; state changes only
 * when the line or the spoken word changes, which is a few times a second
 * rather than sixty.
 */

type Status = "loading" | "ready" | "ended" | "error";

const controlsIdleMs = 2600;

export function ImmersivePoem({
  manifest,
  onClose,
  onNext,
}: {
  manifest: PoemManifest;
  onClose: () => void;
  onNext?: () => void;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const theme = useRef<HTMLAudioElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const idleTimer = useRef(0);
  const bar = useRef<HTMLDivElement>(null);
  /** The last values written to the DOM, so an unchanged frame writes nothing. */
  const painted = useRef({ fade: -1, played: -1, ms: -1 });

  const [status, setStatus] = useState<Status>("loading");
  const [playing, setPlaying] = useState(false);
  /**
   * Where the reading is: which line, and which of its words is being said.
   *
   * One piece of state rather than two. Held separately they could disagree
   * for a frame - a token index belonging to the previous line - and at the
   * wrong moment that rendered the whole line as not yet spoken, which is to
   * say invisible.
   */
  const [at, setAt] = useState({ line: 0, token: 0 });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [reduced, setReduced] = useState(false);

  const lineIndex = at.line;
  const activeToken = at.token;
  const line = manifest.lines[lineIndex];
  const scene = sceneFor(manifest, lineIndex);
  /**
   * The backdrop runs on its own clock, not on the line.
   *
   * A dissolve begins before the next line and lasts longer than that lead, so
   * it is still going once the words have moved on. Keyed to the line it would
   * be cut in half on the boundary and read as a jump.
   */
  const [backdrop, setBackdrop] = useState(() => backdropAt(manifest, 0));

  useEffect(() => {
    const handle = window.setTimeout(
      () => setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false),
      0
    );
    return () => window.clearTimeout(handle);
  }, []);

  // One element, built once. Created here rather than as <audio> in the tree so
  // the frame loop can read it without waiting for a ref to attach.
  useEffect(() => {
    const element = new window.Audio(manifest.audio);
    element.preload = "auto";
    element.playbackRate = 1;
    audio.current = element;
    const ready = () => setStatus("ready");
    const failed = () => setStatus("error");
    const done = () => {
      setStatus("ended");
      setPlaying(false);
      theme.current?.pause();
    };
    element.addEventListener("canplaythrough", ready);
    element.addEventListener("error", failed);
    element.addEventListener("ended", done);
    return () => {
      element.pause();
      element.src = "";
      element.removeEventListener("canplaythrough", ready);
      element.removeEventListener("error", failed);
      element.removeEventListener("ended", done);
      audio.current = null;
    };
  }, [manifest.audio]);

  /*
   * The theme, which is part of the reading rather than music behind it.
   *
   * No switch and no separate transport: it is created with the voice, and
   * every play, pause and seek below drives both. Its level was measured
   * against this recording - ten decibels under, present but clear of the
   * words - and the element is muted-by-volume rather than gated, so a missing
   * file costs the poem nothing.
   */
  useEffect(() => {
    const score = manifest.theme;
    if (!score) return;
    const element = new window.Audio(score.src);
    element.preload = "auto";
    element.volume = Math.min(1, score.gain);
    theme.current = element;
    return () => {
      element.pause();
      element.src = "";
      theme.current = null;
    };
  }, [manifest.theme]);

  /*
   * The next two pictures, decoded before they are needed.
   *
   * A crossfade onto an undecoded image is a flash of nothing in the middle of
   * a poem, and a failure here must not stop the voice: the current frame
   * simply stays.
   */
  useEffect(() => {
    for (const ahead of [1, 2]) {
      const upcoming = sceneFor(manifest, lineIndex + ahead);
      if (!upcoming) continue;
      const image = new Image();
      image.src = upcoming.image;
      void image.decode?.().catch(() => {});
    }
  }, [manifest, lineIndex]);

  // The frame loop. It owns the clock and writes straight to the DOM.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const element = audio.current;
      const root = stage.current;
      if (element && root) {
        const ms = element.currentTime * 1000;
        /*
         * Nothing to recompute while the clock is still.
         *
         * Paused, `currentTime` does not move, so every frame would redo the
         * same work and reach the same answer. Seeking while paused does move
         * it, so this costs nothing and still lands the new position.
         */
        if (ms === painted.current.ms) {
          raf = requestAnimationFrame(tick);
          return;
        }
        painted.current.ms = ms;

        const index = lineIndexAt(manifest.lines, ms);
        const current = manifest.lines[index];
        let token = 0;
        if (current) {
          // Read a little ahead of the voice, so a word has finished arriving
          // by the time it is spoken rather than still forming after it.
          const lit = ms + (manifest.playback.tokenLeadMs ?? 0);
          for (let i = 0; i < current.tokens.length; i += 1) {
            if (tokenStateAt(current, i, lit) === "active") token = i;
          }
        }
        setAt((shown) => (shown.line === index && shown.token === token ? shown : { line: index, token }));

        const pair = backdropAt(manifest, ms);
        setBackdrop((shown) =>
          shown.from === pair.from && shown.to === pair.to ? shown : pair
        );

        /*
         * Written only when they have actually moved.
         *
         * Setting a custom property on the root invalidates style for
         * everything beneath it, and beneath it are two full-screen images.
         * Doing that sixty times a second for a number that rounds to the same
         * value is most of the cost of this screen.
         */
        const fade = Math.round(pair.progress * 200) / 200;
        if (fade !== painted.current.fade) {
          painted.current.fade = fade;
          root.style.setProperty("--fade", String(fade));
        }

        const played = Math.round(playedFraction(ms, manifest.durationMs) * 400) / 400;
        if (played !== painted.current.played) {
          painted.current.played = played;
          root.style.setProperty("--played", String(played));
        }

        // Written onto the element rather than through state: a screen reader
        // needs the real position, and the position changes constantly.
        bar.current?.setAttribute("aria-valuenow", String(Math.round(played * 100)));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest]);

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setChromeVisible(false), controlsIdleMs);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(revealChrome, 0);
    return () => {
      window.clearTimeout(handle);
      window.clearTimeout(idleTimer.current);
    };
  }, [revealChrome]);

  const toggle = useCallback(() => {
    const element = audio.current;
    if (!element) return;
    revealChrome();
    if (element.paused) {
      if (status === "ended") element.currentTime = 0;
      void element.play().then(
        () => {
          setPlaying(true);
          setStatus("ready");
          const score = theme.current;
          if (score) {
            score.currentTime = element.currentTime;
            void score.play().catch(() => {});
          }
        },
        () => setStatus("error")
      );
      return;
    }
    element.pause();
    theme.current?.pause();
    setPlaying(false);
  }, [revealChrome, status]);

  // Seeking restores everything from the timecode, because everything is
  // derived from it. Nothing here has to be rewound by hand.
  const seekTo = useCallback(
    (fraction: number) => {
      const element = audio.current;
      if (!element) return;
      const at = (Math.min(1, Math.max(0, fraction)) * manifest.durationMs) / 1000;
      element.currentTime = at;
      if (theme.current) theme.current.currentTime = at;
      if (status === "ended") setStatus("ready");
      revealChrome();
    },
    [manifest.durationMs, revealChrome, status]
  );

  function scrub(event: React.PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width > 0) seekTo((event.clientX - box.left) / box.width);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const preset = scene ? presetFor(scene) : "quiet-breath";

  /*
   * A word's state on the line being spoken.
   *
   * Words still arrive one at a time with the voice, but they are lit by
   * phrase: everything up to the word just spoken is on, and it all goes out
   * together when the phrase ends. Lighting and unlighting one word at a time
   * is thirty-three handovers in this poem, which reads as a blinking line
   * however exactly it is timed.
   */
  function wordState(token: PoemToken, order: number): "hidden" | "active" | "settled" {
    const current = line?.tokens[activeToken];
    if (!current) return "hidden";
    const here = token.phrase ?? order;
    const now = current.phrase ?? activeToken;
    if (here < now) return "settled";
    if (here > now) return "hidden";
    return order <= activeToken ? "active" : "hidden";
  }

  return (
    <div
      ref={stage}
      className={`poem poem--${preset} ${reduced ? "is-still" : ""} ${chromeVisible ? "" : "is-quiet"}`}
      style={
        {
          "--fade": 0,
          "--played": 0,
          "--poem-text": manifest.palette.text,
          "--poem-active": manifest.palette.active,
          "--poem-shadow": manifest.palette.shadow,
        } as React.CSSProperties
      }
      role="dialog"
      aria-modal="true"
      aria-label={`${manifest.title} — ${manifest.author}`}
    >
      {/* A tap anywhere that is not a control plays or pauses. */}
      <button type="button" className="poem__surface" onClick={toggle} aria-label={playing ? "Пауза" : "Слушать"} />

      {/*
        Two layers that never move and never change picture while they can be
        seen.

        A scene gets a layer by the parity of its index, and the two sides of a
        dissolve are always consecutive, so they always land on different
        layers. The picture on a layer therefore only ever changes once that
        layer has faded out - swapping the `src` of a visible image was half of
        the jump.

        The slow drift lives on the frame around them rather than on each
        layer. Given to the layers it ran from whenever each one happened to
        mount, so a dissolve laid two copies of the scene over each other at
        different zooms, which was the other half.
      */}
      <div className="poem__frame">
        {[0, 1].map((parity) => {
          // Between dissolves the idle layer is not emptied - it holds the
          // scene that comes next, decoded and waiting, so the dissolve has
          // nothing left to load when it starts.
          const waiting = backdrop.to >= 0 ? backdrop.to : backdrop.from + 1;
          const index = backdrop.from % 2 === parity ? backdrop.from : waiting;
          // These are scene indexes, not line indexes: a picture may carry
          // more than one line.
          const layerScene = index >= 0 ? sceneAt(manifest, index) : null;
          const arriving = backdrop.to >= 0 && index === backdrop.to;
          const showing = index === backdrop.from;
          return (
            <Backdrop
              key={parity}
              scene={layerScene}
              className={`poem__scene ${showing ? "poem__scene--showing" : ""} ${
                arriving ? "poem__scene--arriving" : ""
              }`}
            />
          );
        })}
      </div>

      <div className="poem__veil" aria-hidden="true" />

      {/*
        Every line is rendered, all the time; only their state changes.

        Mounting a line's words when it begins and unmounting them when it ends
        made the screen blink: at two seconds a line, the whole text vanished
        and reappeared eight times in seventeen seconds. Kept in place they
        simply dissolve, the leaving line over the arriving one, and nothing
        has to be remounted for an animation to play.
      */}
      <div className="poem__words" aria-hidden="true">
        {manifest.lines.map((poemLine, index) => {
          const lineScene = sceneFor(manifest, index);
          if (!lineScene) return null;
          const state = index < lineIndex ? "past" : index === lineIndex ? "now" : "ahead";
          return (
            <div key={poemLine.sceneId} className={`poem__line is-${state}`}>
              {/*
                Grouped by zone and flowing inside it rather than pinned word by
                word. A line reads as a line that way - "страна рабов," low and
                left, "страна господ." high and right - and the words accumulate
                as they are spoken instead of each landing in its own box.
              */}
              {zonesOf(poemLine, lineScene).map((group) => (
                <div
                  key={group.role ?? "default"}
                  className="poem__zone"
                  style={{
                    left: `${group.zone.x * 100}%`,
                    top: `${group.zone.y * 100}%`,
                    width: `${group.zone.width * 100}%`,
                  }}
                >
                  {group.tokens.map(({ token, order }) => (
                    <span
                      key={order}
                      className={`poem__word ${
                        token.emphasis === "lead" ? "poem__word--lead" : ""
                      } is-${
                        state !== "now" ? (state === "past" ? "settled" : "hidden") : wordState(token, order)
                      }`}
                    >
                      {token.text}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* The whole poem, for a screen reader and for anyone who would rather
          read it than be read to. */}
      <p className="sr-only">
        {manifest.title}. {manifest.author}. {manifest.lines.map((l) => l.tokens.map((t) => t.text).join(" ")).join(" ")}
      </p>

      <button type="button" className="poem__close" onClick={onClose} aria-label="Закрыть">
        <X className="size-5" />
      </button>

      <div className="poem__controls">
        {/* Its own pointer handling, and it must not reach the surface
            underneath - dragging the bar would otherwise also pause. */}
        <div
          ref={bar}
          className="poem__bar"
          role="slider"
          tabIndex={0}
          aria-label="Положение"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            scrub(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event);
          }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const element = audio.current;
            if (!element) return;
            if (event.key === "ArrowLeft") element.currentTime = Math.max(0, element.currentTime - 2);
            else if (event.key === "ArrowRight") element.currentTime += 2;
            else return;
            event.preventDefault();
          }}
        >
          <span className="poem__bar-track" />
          <span className="poem__bar-fill" />
          {/*
            A waveform, drawn twice: once dim across the whole width, once warm
            and clipped to how much has been heard. Two copies rather than a bar
            per state, so the whole thing moves on one CSS variable and nothing
            is recomputed as it plays.
          */}
          <span className="poem__wave" aria-hidden="true">
            <WaveBars />
          </span>
          <span className="poem__wave poem__wave--played" aria-hidden="true">
            <WaveBars />
          </span>
        </div>

        <button type="button" className="poem__play" onClick={toggle} aria-label={playing ? "Пауза" : "Слушать"}>
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </button>
      </div>

      {status === "loading" && <p className="poem__state">Загружаем…</p>}
      {status === "error" && <p className="poem__state">Запись не загрузилась</p>}

      {status === "ended" && (
        <div className="poem__ended">
          <p className="poem__ended-title">{manifest.title}</p>
          <div className="poem__ended-actions">
            <button type="button" className="poem__again" onClick={() => { seekTo(0); toggle(); }}>
              <RotateCcw className="size-4" /> Ещё раз
            </button>
            {onNext && (
              <button type="button" className="poem__onward" onClick={onNext}>
                Следующий бок <ArrowRight className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The little waveform beside the controls.
 *
 * Decoration, and deliberately fixed: a real analysis of the audio would move
 * with the reading and pull the eye down to the bottom of the screen, which is
 * the one place this format does not want it.
 */
const waveHeights = [0.38, 0.94, 0.53, 0.4, 0.84, 0.43, 0.85, 0.5, 0.4, 0.94, 0.44, 0.74, 0.52, 0.44, 0.99, 0.4, 0.64, 0.6, 0.49, 0.98, 0.34, 0.59, 0.72, 0.5, 0.92, 0.31, 0.6, 0.84, 0.45, 0.82, 0.34, 0.64, 0.91, 0.36];

function WaveBars() {
  return (
    <>
      {waveHeights.map((height, index) => (
        <i key={index} style={{ "--h": height } as React.CSSProperties} />
      ))}
    </>
  );
}

/** The line's words, split into the zones the scene allows, in spoken order. */
function zonesOf(line: PoemLine, scene: PoemScene) {
  const groups = new Map<string, { role?: string; zone: SafeZone; tokens: { token: PoemToken; order: number }[] }>();
  line.tokens.forEach((token, order) => {
    const key = token.zone ?? "default";
    if (!groups.has(key)) {
      groups.set(key, { role: token.zone, zone: zoneFor(scene, token.zone), tokens: [] });
    }
    groups.get(key)!.tokens.push({ token, order });
  });
  return [...groups.values()];
}

function Backdrop({ scene, className }: { scene: PoemScene | null; className: string }) {
  if (!scene) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={scene.image}
      alt=""
      draggable={false}
      style={{ objectPosition: `${scene.focalPoint.x * 100}% ${scene.focalPoint.y * 100}%` }}
    />
  );
}
