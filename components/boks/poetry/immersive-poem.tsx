"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createMediaLevel } from "@/components/boks/cinema/media-level";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { ReaderBackIcon as ArrowLeft } from "@/components/boks/reader/reader-icons";
import { FormatControls, FormatStatus, type FormatPlaybackState } from "@/components/boks/cinema/format-controls";
import { ReadingFinale, type FinaleActions } from "@/components/boks/reading-finale";
import { gestureHintIn } from "@/components/boks/poetry/gesture-hints";
import { FormatCurtain } from "@/components/boks/author-stage/format-curtain";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import {
  backdropAt,
  lineIndexAt,
  playedFraction,
  presetFor,
  sceneFor,
  wordReachedAt,
  zoneFor,
  type PoemLine,
  type PoemManifest,
  type PoemScene,
  type PoemToken,
  type SafeZone,
} from "@/lib/boks/poetry/manifest";
import {
  approach,
  dragLean,
  gestureSceneAt,
  isGestureNotTap,
  isWarpAmbience,
  isWarpGesture,
  layersOf,
  needsLayer,
  swipeStep,
} from "@/lib/boks/poetry/gesture";
import {
  createGestureLayer,
  type GestureInput,
  type GestureLayer,
} from "@/components/boks/poetry/gesture-layer";
import { createOverlayLayer } from "@/components/boks/poetry/gesture-overlay";
import {
  createTraceRecorder,
  dueSamples,
  type GestureSampleKind,
  type GestureTrace,
} from "@/lib/boks/studies/gesture-trace";

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
/** The player's band at the foot of the screen, as a share of its height; no stanza ends inside it. */
const controlsBand = 0.19;
/** How high a stanza may be raised to clear the controls. */
const stanzaTopMargin = 0.08;
/** The replayed hand of study b1; a real pointer id is never negative. */
const replayPointerId = -1;
// Actual media positions for a format/text round trip in this page session.
// Never inferred from recommendation telemetry, never sent as a read outcome.
const poemPositions = new Map<string, number>();

/** Only the controls are translated; the poem keeps its own language. */
const messages = defineMessages(
  {
    pause: "Pause",
    listen: "Listen",
    close: "Close",
    position: "Position",
    previousLine: "Previous line",
    nextLine: "Next line",
    loading: "Loading…",
    failed: "The recording did not load",
  },
  {
    ru: {
      pause: "Пауза",
      listen: "Слушать",
      close: "Закрыть",
      position: "Позиция",
      previousLine: "Предыдущая строка",
      nextLine: "Следующая строка",
      loading: "Загрузка…",
      failed: "Запись не загрузилась",
    },
  }
);

export function ImmersivePoem({
  manifest,
  coverArtwork,
  finale,
  recording = false,
  autoPlay = false,
  suspended = false,
  onReadText,
  onOpenAuthor,
  onComments,
  onPlaybackChange,
  onClose,
  gestureTrace,
  withoutFinale = false,
  curtain = false,
}: {
  manifest: PoemManifest;
  coverArtwork?: string;
  /**
   * What the ending's buttons do - the same object every format is given.
   * Absent only in the admin sandbox, where the poem has no boks yet.
   */
  finale?: FinaleActions;
  /** Filming the piece: no close button and no controls - see `recording-mode.ts`. */
  recording?: boolean;
  autoPlay?: boolean;
  suspended?: boolean;
  onReadText?: () => void;
  /** Opens the author over the player (`FormatControls`). */
  onOpenAuthor?: () => void;
  onComments?: () => void;
  onPlaybackChange?: (state: FormatPlaybackState) => void;
  onClose: () => void;
  /**
   * A study ends the piece with its own questions. The shared ending asks
   * "what stayed with you - moved me, want to think", which in study rg1
   * would put the questions' own words in front of one condition only.
   */
  withoutFinale?: boolean;
  /**
   * Study b1 only (`lib/boks/studies/gesture-trace.ts`). `record` hands back
   * what the reader's hand did, once, when the poem ends or closes; `replay`
   * takes the gestures away from the reader and performs a recorded trace at
   * the same moments of the reading instead.
   */
  gestureTrace?: { mode: "record"; onTrace: (trace: GestureTrace) => void } | { mode: "replay"; trace: GestureTrace };
  /**
   * Opens behind the author stage's curtain, which draws aside once the voice
   * can play, and closes again before the ending (`format-curtain.tsx`). Only with
   * `autoPlay`, never while filming.
   */
  curtain?: boolean;
}) {
  const words = useMessages(messages);
  const uiLanguage = useUiLanguage();
  const { t } = useReaderPreferences();
  const audio = useRef<HTMLAudioElement | null>(null);
  const theme = useRef<HTMLAudioElement | null>(null);
  const voiceLevel = useRef<ReturnType<typeof createMediaLevel> | null>(null);
  const musicLevel = useRef<ReturnType<typeof createMediaLevel> | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const idleTimer = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [voice, setVoice] = useState(1);
  const [music, setMusic] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasBegun, setHasBegun] = useState(autoPlay || recording);
  const [textPreview, setTextPreview] = useState(false);
  const autoStarted = useRef(false);
  const curtained = curtain && autoPlay && !recording;
  const [curtainUp, setCurtainUp] = useState(curtained);
  /** The end, with the curtain: it closes first, then the ending comes up under it. */
  const [curtainDown, setCurtainDown] = useState(false);
  const openedCurtain = useCallback(() => setCurtainUp(false), []);
  const closedCurtain = useCallback(() => setCurtainDown(true), []);
  const rememberTextPosition = useRef(false);
  const lastElapsed = useRef(-1);
  /*
   * The elements the frame loop writes to: one picture per scene, and the
   * control bar.
   *
   * A custom property set on the root invalidates style for everything beneath
   * it - all eight lines and thirty-three words. Written on the elements that
   * actually read them, the recalculation is a picture or a control bar.
   */
  const pictures = useRef<(HTMLElement | null)[]>([]);
  /** The same pictures blurred at the sides of a wide screen; they follow the frame. */
  const ambients = useRef<(HTMLImageElement | null)[]>([]);
  /*
   * A gesture scene's own picture and the canvas that redraws it, by scene
   * index. Empty for every poem without a `gesture` in its scene map.
   */
  const gestureImages = useRef<(HTMLImageElement | null)[]>([]);
  const gestureCanvases = useRef<(HTMLCanvasElement | null)[]>([]);
  /** The second canvas of a scene that warps its picture and draws over it as well. */
  const overlayCanvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const gestureLayers = useRef<(GestureLayer | null)[]>([]);
  /*
   * Where the hand is and where the picture is, outside React: both change
   * every frame while a finger is down. `hold` and `lean` ease towards their
   * targets in the frame loop, so letting go returns the water to ripples and
   * the landscape to its middle gradually rather than in one frame.
   */
  const hand = useRef({
    hold: 0,
    holdTarget: 0,
    lean: 0,
    leanTarget: 0,
    pointer: null as null | { id: number; x: number; y: number; at: number; moved: number; scene: number },
    swallowClick: false,
  });
  /** The hand as the overlay gestures read it - see `GestureInput`. */
  const input = useRef<GestureInput>({ drag: null, releases: [], flown: 0, connections: 0 });
  const surface = useRef<HTMLButtonElement>(null);
  const replaying = gestureTrace?.mode === "replay";
  const traceRecorder = useRef<ReturnType<typeof createTraceRecorder> | null>(null);
  const traceHandler = useRef<((trace: GestureTrace) => void) | null>(null);
  const traceFlushed = useRef(false);
  const replayCursor = useRef({ index: 0, at: 0 });
  const stillRef = useRef(false);
  /** The last values written to the DOM, so an unchanged frame writes nothing. */
  const painted = useRef({ from: -1, to: -1, fade: -1, played: -1, ms: -1 });

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
  /** Scenes whose gesture the reader has already found; their hint stays away. */
  const [gestureFound, setGestureFound] = useState<Record<string, true>>({});

  const lineIndex = at.line;
  const activeToken = at.token;
  const line = manifest.lines[lineIndex];
  const scene = sceneFor(manifest, lineIndex);

  useEffect(() => {
    const handle = window.setTimeout(
      () => {
        const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        stillRef.current = still;
        setReduced(still);
      },
      0
    );
    return () => window.clearTimeout(handle);
  }, []);

  // One element, built once. Created here rather than as <audio> in the tree so
  // the frame loop can read it without waiting for a ref to attach.
  useEffect(() => {
    // No source yet: it is set to the in-memory copy below, and "Loading…"
    // stays up until that copy can play.
    const element = new window.Audio();
    element.preload = "auto";
    element.playbackRate = 1;
    audio.current = element;
    voiceLevel.current = createMediaLevel(element);
    // Only ever out of loading. The browser fires this again after every
    // seek, and a seek onto the end lands after `ended` - which turned the
    // finale back off and left the player paused on the last frame.
    const restore = () => {
      const saved = poemPositions.get(manifest.audio) ?? 0;
      poemPositions.delete(manifest.audio);
      if (saved > 0 && saved < manifest.durationMs / 1000 - 0.5) {
        element.currentTime = saved;
        if (theme.current) theme.current.currentTime = saved;
      }
    };
    element.addEventListener("loadedmetadata", restore, { once: true });
    const ready = () => setStatus((current) => (current === "loading" ? "ready" : current));
    const failed = () => { element.pause(); theme.current?.pause(); setPlaying(false); setStatus("error"); };
    const paused = () => setPlaying(false);
    const started = () => setPlaying(true);
    const done = () => {
      setStatus("ended");
      setPlaying(false);
      theme.current?.pause();
    };
    element.addEventListener("canplay", ready);
    element.addEventListener("error", failed);
    element.addEventListener("boks-mixer-error", failed);
    element.addEventListener("ended", done);
    const release = inMemoryCopy(manifest.audio, (src) => {
      element.src = src;
      element.load();
    });
    element.addEventListener("pause", paused);
    element.addEventListener("waiting", paused);
    element.addEventListener("playing", started);
    return () => {
      release();
      const seconds = element.currentTime;
      if (rememberTextPosition.current) poemPositions.set(manifest.audio, element.ended ? 0 : seconds);
      else poemPositions.delete(manifest.audio);
      if (poemPositions.size > 32) poemPositions.delete(poemPositions.keys().next().value!);
      element.pause();
      element.src = "";
      element.removeEventListener("loadedmetadata", restore);
      element.removeEventListener("canplay", ready);
      element.removeEventListener("error", failed);
      element.removeEventListener("boks-mixer-error", failed);
      element.removeEventListener("ended", done);
      element.removeEventListener("pause", paused);
      element.removeEventListener("waiting", paused);
      element.removeEventListener("playing", started);
      voiceLevel.current?.dispose();
      voiceLevel.current = null;
      audio.current = null;
    };
  }, [manifest.audio, manifest.durationMs]);

  /*
   * The theme, which is part of the reading rather than music behind it.
   *
   * Its own level and the same transport: it is created with the voice, and
   * every play, pause and seek below drives both. Its level was measured
   * against this recording - ten decibels under, present but clear of the
   * words - and the element is muted-by-volume rather than gated, so a missing
   * file costs the poem nothing.
   */
  useEffect(() => {
    const score = manifest.theme;
    if (!score) return;
    const element = new window.Audio();
    element.preload = "auto";
    element.volume = Math.min(1, score.gain);
    theme.current = element;
    // The voice does not wait for the theme. If the reading has begun by the
    // time the theme's copy is in, it joins at the voice's place.
    const release = inMemoryCopy(score.src, (src) => {
      element.src = src;
      element.load();
      const voice = audio.current;
      if (!voice || voice.paused) return;
      element.addEventListener(
        "loadedmetadata",
        () => {
          element.currentTime = voice.currentTime;
          if (!voice.paused) void element.play().catch(() => undefined);
        },
        { once: true }
      );
    });
    musicLevel.current = createMediaLevel(element);
    const failed = () => { audio.current?.pause(); setStatus("error"); };
    element.addEventListener("boks-mixer-error", failed);
    return () => {
      release();
      element.pause();
      element.src = "";
      element.removeEventListener("boks-mixer-error", failed);
      musicLevel.current?.dispose();
      musicLevel.current = null;
      theme.current = null;
    };
  }, [manifest.theme]);

  /*
   * A layer for each gesture scene, built once its picture has decoded.
   *
   * Built up front with the rest of the pictures, not when the scene arrives:
   * compiling a shader and uploading a texture is exactly the kind of cost
   * that, paid at the start of a dissolve, shows as the one frame that jumps.
   */
  useEffect(() => {
    const layers = gestureLayers.current;
    const waiting: (() => void)[] = [];
    manifest.scenes.forEach((poemScene, index) => {
      const gesture = poemScene.gesture;
      const image = gestureImages.current[index];
      const canvas = gestureCanvases.current[index];
      if (!needsLayer(poemScene) || !image || !canvas) return;
      const build = () => {
        if (layers[index] || !image.naturalWidth) return;
        // A warp redraws the picture in WebGL; everything else is drawn over
        // it, on a second canvas when the scene does both.
        const { warp, overlay } = layersOf(poemScene);
        const warped = warp
          ? createGestureLayer(
              canvas,
              image,
              {
                ...poemScene,
                gesture: isWarpGesture(gesture) ? gesture : undefined,
                ambience: isWarpAmbience(poemScene.ambience) ? poemScene.ambience : undefined,
              },
              index
            )
          : null;
        const overCanvas = warp ? overlayCanvases.current[index] : canvas;
        const drawn = overlay && overCanvas ? createOverlayLayer(overCanvas, image, poemScene, index) : null;
        layers[index] =
          warped && drawn
            ? {
                paint: (frame, hand) => {
                  warped.paint(frame, hand);
                  drawn.paint(frame, hand);
                },
                dispose: () => {
                  warped.dispose();
                  drawn.dispose();
                },
              }
            : (warped ?? drawn);
      };
      if (image.complete) build();
      else {
        image.addEventListener("load", build, { once: true });
        waiting.push(() => image.removeEventListener("load", build));
      }
    });
    return () => {
      waiting.forEach((stop) => stop());
      layers.forEach((layer) => layer?.dispose());
      gestureLayers.current = [];
    };
  }, [manifest]);

  // The frame loop. It owns the clock and writes straight to the DOM.
  useEffect(() => {
    let raf = 0;
    /*
     * The backdrop, written whole in the frame that computed it.
     *
     * It used to be split: the dissolve's opacity was written here, straight
     * away, and which picture was showing and which arriving went through
     * React state, which commits after the frame has been painted. On the
     * last frame of every dissolve the opacity was already back to zero while
     * the old picture was still the one marked as showing - one frame of the
     * previous scene, whole, between the new one at 98% and the new one at
     * 100%. Measured, it happened on all three changes. Nothing about the
     * backdrop goes through React now, so the two halves cannot disagree.
     *
     * Each scene keeps its own picture for the whole poem; a layer's `src`
     * never changes, so there is nothing to load or decode at the moment a
     * dissolve begins. Only the showing, arriving and next pictures are
     * visible to the compositor - the next one at zero opacity, so its
     * texture is uploaded while nothing is happening.
     */
    /*
     * The cinematic change, for a poem that asks for it: the arriving picture
     * settles from six percent closer while the leaving one drifts on. Scale
     * and opacity only, both of which the compositor does on its own.
     */
    const style = manifest.transitionStyle;
    const cinematic = style === "cinematic" || style === "page-turn";
    const moveDissolve = (pair: { from: number; to: number }, fade: number) => {
      if (!cinematic || stillRef.current || pair.to < 0) return;
      const settle = 1 - (1 - fade) * (1 - fade);
      const arriving = pictures.current[pair.to];
      const leaving = pictures.current[pair.from];
      if (style === "page-turn") {
        /*
         * A page turning towards the reader: the arriving picture swings in
         * on its left edge as a leaf does, the one under it sinks a little.
         * A 3D transform and opacity only - still the compositor's work.
         */
        if (arriving) {
          arriving.style.transformOrigin = "left center";
          arriving.style.transform = `translateZ(0) perspective(1600px) rotateY(${(-70 * (1 - settle)).toFixed(2)}deg)`;
          arriving.style.opacity = String(Math.min(1, fade * 1.6));
        }
        if (leaving) leaving.style.transform = `translateZ(0) scale(${(1 - 0.04 * fade).toFixed(4)})`;
        return;
      }
      if (arriving) arriving.style.transform = `translateZ(0) scale(${(1.06 - 0.06 * settle).toFixed(4)})`;
      if (leaving) leaving.style.transform = `translateZ(0) scale(${(1 + 0.035 * fade).toFixed(4)})`;
    };
    const paintBackdrop = (pair: { from: number; to: number; progress: number }) => {
      const fade = Math.round(pair.progress * 200) / 200;
      const shown = painted.current;
      if (pair.from === shown.from && pair.to === shown.to) {
        if (fade !== shown.fade && pair.to >= 0) {
          const arriving = pictures.current[pair.to];
          if (arriving) arriving.style.opacity = String(fade);
          const arrivingSide = ambients.current[pair.to];
          if (arrivingSide) arrivingSide.style.opacity = String(fade);
          moveDissolve(pair, fade);
        }
        shown.fade = fade;
        return;
      }
      shown.from = pair.from;
      shown.to = pair.to;
      shown.fade = fade;
      const next = pair.to >= 0 ? pair.to : pair.from + 1;
      pictures.current.forEach((picture, index) => {
        if (!picture) return;
        const arriving = index === pair.to;
        picture.style.opacity = index === pair.from ? "1" : arriving ? String(fade) : "0";
        // The arriving picture on top, whichever comes first in the document;
        // under an opaque outgoing picture a dissolve is invisible.
        picture.style.zIndex = arriving ? "1" : "0";
        picture.style.visibility =
          index === pair.from || arriving || index === next ? "visible" : "hidden";
        if (cinematic) {
          picture.style.transform = "";
          picture.style.transformOrigin = "";
        }
        const side = ambients.current[index];
        if (side) {
          side.style.opacity = picture.style.opacity;
          side.style.zIndex = picture.style.zIndex;
          side.style.visibility = picture.style.visibility;
        }
      });
      moveDissolve(pair, fade);
    };

    /*
     * The gesture scene, drawn every frame it is on screen - paused or not.
     *
     * The water keeps moving while the voice is stopped; a picture that froze
     * with the pause would say the gesture belongs to the recording, and it
     * does not. Only the layers that are visible are drawn.
     */
    let lastFrame = performance.now();
    const paintGestures = (now: number) => {
      const elapsed = Math.min(100, now - lastFrame);
      lastFrame = now;
      const state = hand.current;
      state.hold = approach(state.hold, state.holdTarget, elapsed, state.holdTarget > state.hold ? 600 : 900);
      state.lean = approach(state.lean, state.leanTarget, elapsed, state.pointer ? 180 : 700);
      const shown = painted.current;
      const next = shown.to >= 0 ? shown.to : shown.from + 1;
      gestureLayers.current.forEach((layer, index) => {
        if (!layer || (index !== shown.from && index !== shown.to && index !== next)) return;
        layer.paint(
          {
            time: stillRef.current ? 0 : now / 1000,
            now,
            still: stillRef.current,
            hold: state.hold,
            lean: state.lean,
            ms: (audio.current?.currentTime ?? 0) * 1000,
          },
          input.current
        );
      });
    };
    paintBackdrop(backdropAt(manifest, (audio.current?.currentTime ?? 0) * 1000));

    const tick = (now: number) => {
      paintGestures(now);
      const element = audio.current;
      if (element) {
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
          token = wordReachedAt(current, ms + (manifest.playback.tokenLeadMs ?? 0));
        }
        setAt((shown) => (shown.line === index && shown.token === token ? shown : { line: index, token }));

        paintBackdrop(backdropAt(manifest, ms));

        // Written only when it has actually moved: a number that rounds to the
        // same value sixty times a second is a style recalculation for nothing.
        const played = Math.round(playedFraction(ms, manifest.durationMs) * 400) / 400;
        if (played !== painted.current.played) {
          painted.current.played = played;

        }

        // Written onto the element rather than through state: a screen reader
        // needs the real position, and the position changes constantly.
        const seconds = Math.floor(ms / 250) / 4;
        if (seconds !== lastElapsed.current) { lastElapsed.current = seconds; setElapsed(seconds); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest]);

  /*
   * Study b1: the reader's hand as a trace. Started with the first sample,
   * handed over once - when the reading ends, or when the poem closes before
   * that - so a participant who leaves early still leaves what they did.
   */
  useEffect(() => {
    traceHandler.current = gestureTrace?.mode === "record" ? gestureTrace.onTrace : null;
  }, [gestureTrace]);

  /*
   * No word wider than its zone.
   *
   * A zone is a fraction of the screen, and a long word set half again as
   * large ("рассуждаешь" in a zone half a phone wide) ran off the edge. Each
   * zone is measured once it is laid out, and again when the screen changes
   * size; one that holds a word wider than itself is set smaller, just enough
   * to hold it. Layout widths (offsetWidth), not boxes, so the words' own
   * arrival scaling does not count. Never during the reading: the size of a
   * word stays fixed for the whole poem.
   */
  useLayoutEffect(() => {
    const root = stage.current;
    if (!root) return;
    const fit = () => {
      for (const zone of root.querySelectorAll<HTMLElement>(".poem__zone")) {
        zone.style.removeProperty("--poem-fit");
        const room = zone.clientWidth;
        let widest = 0;
        for (const word of zone.querySelectorAll<HTMLElement>(".poem__word")) widest = Math.max(widest, word.offsetWidth);
        if (room > 0 && widest > room) zone.style.setProperty("--poem-fit", (Math.floor((room / widest) * 100) / 100).toString());
        settle(zone);
      }
    };
    /*
     * No stanza below the player.
     *
     * A zone has a top and no bottom: two long lines that wrap, set low in the
     * picture, ran under the controls and off the screen ("Нишевые интересы",
     * 2026-11-14). A zone that would end inside the controls' band is raised
     * just enough to end above it, never past the top margin; one still too
     * tall for that space is set smaller as well. Zones that fit stay exactly
     * where the manifest put them.
     */
    const settle = (zone: HTMLElement) => {
      zone.style.removeProperty("margin-top");
      const frame = zone.offsetParent instanceof HTMLElement ? zone.offsetParent.clientHeight : 0;
      if (!frame) return;
      const floor = frame * (1 - controlsBand);
      const ceiling = Math.min(zone.offsetTop, frame * stanzaTopMargin);
      if (zone.offsetTop + zone.offsetHeight <= floor) return;
      const space = floor - ceiling;
      if (zone.offsetHeight > space && space > 0) {
        const fit = Number(zone.style.getPropertyValue("--poem-fit") || 1);
        zone.style.setProperty("--poem-fit", (Math.floor(fit * (space / zone.offsetHeight) * 100) / 100).toString());
      }
      const lift = Math.min(zone.offsetTop - ceiling, zone.offsetTop + zone.offsetHeight - floor);
      if (lift > 0) zone.style.marginTop = `${-lift}px`;
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(root);
    void document.fonts?.ready.then(fit);
    return () => observer?.disconnect();
  }, [manifest, recording]);
  function traceSample(kind: GestureSampleKind, clientX: number, clientY: number) {
    if (!traceHandler.current || traceFlushed.current) return;
    const box = surface.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    traceRecorder.current ??= createTraceRecorder(manifest.durationMs);
    const element = audio.current;
    traceRecorder.current.add(kind, (element?.currentTime ?? 0) * 1000, (clientX - box.left) / box.width, (clientY - box.top) / box.height, {
      now: performance.now(),
      paused: !element || element.paused,
    });
  }
  const flushTrace = useCallback(() => {
    const handler = traceHandler.current;
    if (!handler || traceFlushed.current) return;
    traceFlushed.current = true;
    handler(traceRecorder.current?.trace() ?? { version: 1, durationMs: manifest.durationMs, samples: [], pausedSamples: 0 });
  }, [manifest.durationMs]);
  useEffect(() => {
    if (status === "ended") flushTrace();
  }, [status, flushTrace]);
  useEffect(() => () => flushTrace(), [flushTrace]);

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
    autoStarted.current = true;
    setHasBegun(true);
    revealChrome();
    // Still downloading: a play now would fail on an element with no source
    // and put up "did not load". "Loading…" is on screen; the next tap plays.
    if (!element.src) return;
    if (element.paused) {
      if (status === "ended") { element.currentTime = 0; setCurtainDown(false); }
      voiceLevel.current?.resume();
      musicLevel.current?.resume();
      // Ask for both tracks in the same gesture, before either play promise
      // resolves. Waiting for the voice first can lose mobile activation.
      const score = theme.current;
      if (score) {
        score.currentTime = element.currentTime;
        void score.play().catch(() => {});
      }
      void element.play().then(
        () => {
          if (audio.current !== element || document.hidden) { element.pause(); score?.pause(); return; }
          if (!element.paused) { setPlaying(true); setStatus("ready"); }
        },
        (reason: unknown) => {
          if (element.paused && reason instanceof Error && reason.name === "AbortError") return;
          if (audio.current === element) { score?.pause(); setPlaying(false); setStatus("error"); }
        }
      );
      return;
    }
    element.pause();
    theme.current?.pause();
    setPlaying(false);
  }, [revealChrome, status]);

  // Seeking restores everything from the timecode, because everything is
  // derived from it. Nothing here has to be rewound by hand.
  const seekMs = useCallback(
    (ms: number) => {
      const element = audio.current;
      if (!element) return;
      const at = Math.min(manifest.durationMs, Math.max(0, ms)) / 1000;
      element.currentTime = at;
      // The theme is part of the reading, so it goes wherever the voice goes.
      if (theme.current) theme.current.currentTime = at;
      // Back into the poem leaves the ending; onto its very end does not. A
      // "next line" pressed as the last word ends would otherwise take the
      // finale away and leave the player paused on nothing.
      if (status === "ended" && ms < manifest.durationMs) { setStatus("ready"); setCurtainDown(false); }
      revealChrome();
    },
    [manifest.durationMs, revealChrome, status]
  );

  const seekTo = useCallback(
    (fraction: number) => seekMs(Math.min(1, Math.max(0, fraction)) * manifest.durationMs),
    [manifest.durationMs, seekMs]
  );

  // The format keeps its authored timeline; the transport moves by five seconds.
  const step = useCallback((direction: -1 | 1) => {
    seekMs((audio.current?.currentTime ?? 0) * 1000 + direction * 5000);
  }, [seekMs]);

  useEffect(() => {
    if (!autoPlay || curtainUp || autoStarted.current || suspended || document.hidden || status !== "ready") return;
    autoStarted.current = true;
    toggle();
  }, [autoPlay, curtainUp, status, suspended, toggle]);

  useEffect(() => {
    if (!suspended && !menuOpen) return;
    audio.current?.pause();
    theme.current?.pause();
  }, [suspended, menuOpen]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (!document.hidden) return;
      audio.current?.pause(); theme.current?.pause(); setPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);

  useEffect(() => { voiceLevel.current?.set(voice); }, [voice]);
  useEffect(() => { musicLevel.current?.set((manifest.theme?.gain ?? 0) * music); }, [music, manifest.theme]);
  useEffect(() => {
    // With the curtain the piece has ended once it is closed: only then does the
    // reader's interface (the ending, a sign-in notice) come up.
    const ended = status === "ended" && (!curtained || curtainDown);
    onPlaybackChange?.({ playing: playing && !suspended && !menuOpen, progress: Math.min(1, elapsed * 1000 / manifest.durationMs), ended });
  }, [playing, suspended, menuOpen, elapsed, manifest.durationMs, status, curtained, curtainDown, onPlaybackChange]);

  function readText() {
    rememberTextPosition.current = true;
    audio.current?.pause(); theme.current?.pause();
    if (onReadText) onReadText();
    else { setMenuOpen(false); setTextPreview(true); }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (suspended || menuOpen || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        if (textPreview) setTextPreview(false);
        else onClose();
      } else if (recording && event.key === " ") {
        // Nothing on screen to press while filming; Space is the play button.
        event.preventDefault();
        event.stopPropagation();
        toggle();
      } else if (recording && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault(); event.stopPropagation(); step(event.key === "ArrowLeft" ? -1 : 1);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, recording, toggle, step, suspended, menuOpen, textPreview]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (recording || stage.current?.querySelector(".format-menu-layer")) return;
    stage.current?.querySelector<HTMLButtonElement>(textPreview ? ".poem-text-preview button" : status === "ended" ? ".poem__close" : ".format-top__back")?.focus();
  }, [recording, status, textPreview, curtainDown]);

  /*
   * The hand lifts: the water ripples again and the landscape goes back to its
   * ambiguous middle, both eased by the frame loop. A press long enough, or a
   * movement far enough, to have been the gesture does not also pause.
   */
  /*
   * The hand going down and moving: what a pointer does on a gesture scene,
   * kept apart from the event so study b1's replay can do the same.
   */
  function handDown(pointerId: number, clientX: number, clientY: number) {
    const target = surface.current;
    if (!target) return false;
    const shown = painted.current;
    const index = gestureSceneAt(manifest.scenes, { from: shown.from, to: shown.to, progress: shown.fade });
    const gesture = manifest.scenes[index]?.gesture;
    if (!gesture) return false;
    hand.current.swallowClick = false;
    const box = target.getBoundingClientRect();
    if (gesture.kind === "fling" || gesture.kind === "threads" || gesture.kind === "wipe") {
      const x = clientX - box.left;
      const y = clientY - box.top;
      input.current.drag = { scene: index, x0: x, y0: y, x, y };
    }
    hand.current.pointer = {
      id: pointerId,
      x: clientX,
      y: clientY,
      at: performance.now(),
      moved: 0,
      scene: index,
    };
    if (gesture.kind === "hold") hand.current.holdTarget = 1;
    return true;
  }

  function handMove(pointerId: number, clientX: number, clientY: number) {
    const target = surface.current;
    const pointer = hand.current.pointer;
    if (!target || !pointer || pointer.id !== pointerId) return;
    const dx = clientX - pointer.x;
    pointer.moved = Math.max(pointer.moved, Math.hypot(dx, clientY - pointer.y));
    const effect = manifest.scenes[pointer.scene]?.gesture?.effect;
    if (effect === "lean-between") {
      hand.current.leanTarget = dragLean(dx, target.clientWidth);
    } else if (effect === "turn-away") {
      // Turning all the way round takes more than leaning does.
      hand.current.leanTarget = dragLean(dx, target.clientWidth, 0.55);
    }
    const drag = input.current.drag;
    if (drag) {
      const box = target.getBoundingClientRect();
      drag.x = clientX - box.left;
      drag.y = clientY - box.top;
    }
  }

  function handUp(pointerId: number, x?: number, y?: number) {
    const width = surface.current?.clientWidth ?? 0;
    const state = hand.current;
    const pointer = state.pointer;
    if (!pointer || pointer.id !== pointerId) return;
    state.pointer = null;
    state.holdTarget = 0;
    state.leanTarget = 0;
    // A drag let go - an arrow loosed, a thread laid on a light - is handed
    // to the scene's layer, which decides what it became. A cancelled one is
    // dropped: the browser took the touch, the reader did not let go.
    const drag = input.current.drag;
    input.current.drag = null;
    if (drag && x !== undefined) input.current.releases.push(drag);
    const gesture = manifest.scenes[pointer.scene]?.gesture;
    if (gesture?.kind === "swipe" && x !== undefined && y !== undefined) {
      const step = swipeStep(x - pointer.x, y - pointer.y, width);
      const target = manifest.scenes[pointer.scene + step];
      if (step !== 0 && target) {
        // Playing, land just before the page so it turns in front of the
        // reader; paused, land on the turned page.
        const element = audio.current;
        const turned = target.startMs + manifest.playback.crossfadeOffsetMs + target.transitionMs;
        seekMs(element && !element.paused ? Math.max(0, target.startMs - 40) : turned);
      }
    }
    if (isGestureNotTap(performance.now() - pointer.at, pointer.moved)) {
      state.swallowClick = true;
      const found = manifest.scenes[pointer.scene];
      if (found) setGestureFound((seen) => (seen[found.id] ? seen : { ...seen, [found.id]: true }));
    }
  }

  /*
   * Study b1's passive version: the recorded hand, performed through the same
   * three functions a real pointer goes through, at the recording's moments.
   * Its own loop, so the poem's frame loop stays as it was. The cursor lives
   * in a ref: the loop restarts with every render, the replay must not. A
   * seek backwards lets go of whatever was held and picks the trace up again
   * after the new position.
   */
  const replay = gestureTrace?.mode === "replay" ? gestureTrace.trace : null;
  useEffect(() => {
    if (!replay) return;
    let raf = 0;
    const frame = () => {
      const element = audio.current;
      const box = surface.current?.getBoundingClientRect();
      if (element && box) {
        const ms = element.currentTime * 1000;
        const cursor = replayCursor.current;
        const step = dueSamples(replay, cursor.index, cursor.at, ms);
        replayCursor.current = { index: step.cursor, at: ms };
        if (step.released) handUp(replayPointerId);
        for (const [, kind, x, y] of step.due) {
          const clientX = box.left + x * box.width;
          const clientY = box.top + y * box.height;
          if (kind === "down") handDown(replayPointerId, clientX, clientY);
          else if (kind === "move") handMove(replayPointerId, clientX, clientY);
          else if (kind === "up") handUp(replayPointerId, clientX, clientY);
          else handUp(replayPointerId);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });

  const gestureHint =
    scene?.gesture && !gestureFound[scene.id] && status !== "ended" && !recording && !replaying
      ? gestureHintIn(scene.gesture.hint, uiLanguage)
      : null;

  const preset = scene ? presetFor(scene) : "quiet-breath";
  const stanzas = useMemo(() => stanzasOf(manifest), [manifest]);
  const currentStanza = stanzas.findIndex((stanza) =>
    stanza.verses.some((verse) => verse === lineIndex)
  );
  /*
   * The line before this one starts leaving early when the next line will
   * take its row: once the voice is on this line's last word. Left until the
   * new line began, the two were legible over each other in the same place.
   */
  const rowHandsOver =
    Boolean(line) &&
    activeToken === line.tokens.length - 1 &&
    stanzas[currentStanza]?.verses.includes(lineIndex + 1);
  const isGone = (verseLine: number) =>
    verseLine < lineIndex - 1 || (rowHandsOver && verseLine === lineIndex - 1);

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
      className={`poem poem--${preset} ${reduced ? "is-still" : ""} ${chromeVisible || !playing ? "" : "is-quiet"} ${menuOpen ? "has-playback-menu" : ""} ${recording ? "is-recording" : ""} ${!hasBegun ? "is-cover" : ""} ${textPreview ? "has-text-preview" : ""}`}
      style={
        {
          "--poem-text": manifest.palette.text,
          "--poem-active": manifest.palette.active,
          "--poem-shadow": manifest.palette.shadow,
          "--poem-text-scale": manifest.textScale ?? 1,
          "--poem-veil": manifest.veil ?? 1,
        } as React.CSSProperties
      }
      role="dialog"
      aria-modal="true"
      aria-label={`${manifest.title} — ${manifest.author}`}
      onFocusCapture={revealChrome}
      onKeyDown={(event) => {
        if (recording || menuOpen || event.key !== "Tab") return;
        const root = textPreview ? event.currentTarget.querySelector(".poem-text-preview") : event.currentTarget;
        const controls = [...(root?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]') ?? [])];
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
    >
      {/* A tap anywhere that is not a control plays or pauses. */}
      {/* A press or a sideways movement on a gesture scene works the picture;
          only a quick tap still plays and pauses. */}
      <button
        ref={surface}
        type="button"
        className="poem__surface"
        disabled={suspended || status === "ended" || textPreview}
        onClick={() => {
          if (hand.current.swallowClick) {
            hand.current.swallowClick = false;
            return;
          }
          toggle();
        }}
        onPointerDown={(event) => {
          // The passive version: the recorded hand does the gestures; a tap
          // still plays and pauses.
          if (replaying) return;
          if (!handDown(event.pointerId, event.clientX, event.clientY)) return;
          traceSample("down", event.clientX, event.clientY);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (replaying || hand.current.pointer?.id !== event.pointerId) return;
          handMove(event.pointerId, event.clientX, event.clientY);
          traceSample("move", event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (replaying || hand.current.pointer?.id !== event.pointerId) return;
          traceSample("up", event.clientX, event.clientY);
          handUp(event.pointerId, event.clientX, event.clientY);
        }}
        onPointerCancel={(event) => {
          if (replaying || hand.current.pointer?.id !== event.pointerId) return;
          traceSample("cancel", event.clientX, event.clientY);
          handUp(event.pointerId);
        }}
        // A long press is the gesture here, not a request for a menu.
        onContextMenu={(event) => event.preventDefault()}
        aria-label={playing ? words.pause : words.listen}
      />

      {/*
        One picture per scene, mounted once, never moved and never given
        another `src`. Which is showing, which arriving and how far is written
        by the frame loop alone - React renders these and then leaves them be.
        A poem has a handful of scenes, and loading them all up front means no
        dissolve ever waits on the network.
      */}
      {/*
        A wide screen shows the picture whole, as a phone does, in a 9:16
        column; the sides hold the same picture, blurred and darkened, so the
        frame sits in its own light rather than between white bars. Hidden on
        a phone. Written by the same frame loop as the pictures it copies.
      */}
      <div className="poem__ambient" aria-hidden="true">
        {manifest.scenes.map((poemScene, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={poemScene.id}
            ref={(element) => {
              ambients.current[index] = element;
            }}
            src={poemScene.image}
            alt=""
            draggable={false}
            decoding="async"
          />
        ))}
      </div>

      <div className="poem__frame">
        {manifest.scenes.map((poemScene, index) => (
          <Backdrop
            key={poemScene.id}
            scene={poemScene}
            ref={(element) => {
              pictures.current[index] = element;
            }}
            imageRef={(element) => {
              gestureImages.current[index] = element;
            }}
            canvasRef={(element) => {
              gestureCanvases.current[index] = element;
            }}
            overlayRef={(element) => {
              overlayCanvases.current[index] = element;
            }}
          />
        ))}
      </div>

      {(!hasBegun || ((status === "loading" || status === "error") && elapsed === 0)) && coverArtwork && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="format-status__cover" src={coverArtwork} alt="" />
      )}

      <div className="poem__veil" aria-hidden="true" />
      {!hasBegun && status === "ready" && !textPreview && <div className="poem__cover" lang={manifest.language}>
        <p>{manifest.author}</p><h1>{manifest.title}</h1>
      </div>}

      {/*
        Every line is rendered, all the time; only their state changes.

        Mounting a line's words when it begins and unmounting them when it ends
        made the screen blink. Kept in place they simply dissolve, and nothing
        has to be remounted for an animation to play.

        And they are grouped by picture, not shown one at a time. A line on its
        own lasted two seconds and then went out exactly where the next one was
        arriving, eight times in seventeen seconds - which is what read as the
        text flickering. Now the lines a picture carries build up into a
        stanza: the first stays while the second is spoken under it, and the
        stanza leaves with its picture. Nothing goes out until the picture
        does.
      */}
      {/* Cleared when the poem ends. Nobody clears the last line otherwise,
          so it sat over the closing panel. */}
      <div className={`poem__words ${status === "ended" ? "is-over" : ""}`} aria-hidden="true">
        {stanzas.map((stanza, stanzaIndex) => {
          const state =
            stanzaIndex < currentStanza ? "past" : stanzaIndex === currentStanza ? "now" : "ahead";
          return (
            <div key={stanza.scene.id} className={`poem__line is-${state}`}>
              {/*
                Grouped by zone and flowing inside it rather than pinned word by
                word. A line reads as a line that way - "страна рабов," low and
                left, "страна господ." high and right - and inside a zone each
                line of the stanza is a row of its own, so the second sits under
                the first instead of on top of it.
              */}
              {stanza.zones.map((group) => (
                <div
                  key={group.role ?? "default"}
                  className="poem__zone"
                  style={{
                    left: `${group.zone.x * 100}%`,
                    // Leave room for the Reels header when filming; zones
                    // already lower in the picture keep their composition.
                    top: `${(recording ? Math.max(0.16, group.zone.y) : group.zone.y) * 100}%`,
                    width: `${group.zone.width * 100}%`,
                  }}
                >
                  {group.verses.map((verse) => (
                    <div
                      key={verse.lineIndex}
                      // Two lines of a picture at most: the third takes the
                      // first one's place, and the first leaves as it arrives.
                      // A stanza that has passed keeps its gone lines gone.
                      // Limited to the current stanza, they lost the class the
                      // moment it passed and faded back in under the next
                      // stanza's first line while the old one was leaving -
                      // three texts in one place, which read as the line
                      // shaking.
                      className={`poem__verse ${
                        state !== "ahead" && isGone(verse.lineIndex) ? "is-gone" : ""
                      }`}
                      style={{
                        gridRow: verse.slot + 1,
                        // Each row is as tall as the longest line it holds, so
                        // the two lines hug the line between the rows instead
                        // of a short first line floating far above the second.
                        alignSelf: verse.slot === 0 ? "end" : "start",
                      }}
                    >
                      {verse.tokens.map(({ token, order }) => (
                        <span
                          key={order}
                          // The searchlight's glow is a copy of the word drawn
                          // by `::after`; see `.poem--searchlight-scan`.
                          data-text={token.text}
                          className={`poem__word ${
                            token.emphasis === "lead" ? "poem__word--lead" : ""
                          } is-${
                            state !== "now"
                              ? state === "past"
                                ? "settled"
                                : "hidden"
                              : verse.lineIndex < lineIndex
                                ? "settled"
                                : verse.lineIndex > lineIndex
                                  ? "hidden"
                                  : wordState(token, order)
                          }`}
                        >
                          {token.text}
                        </span>
                      ))}
                    </div>
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

      {status === "ended" && (!curtained || curtainDown) && <button type="button" className="poem__close" onClick={onClose} aria-label={t("Back", "Назад")}><ArrowLeft /></button>}

      {curtained && <FormatCurtain
        title={manifest.title} byline={manifest.author} ready={status !== "loading"} closed={status === "ended"}
        onOpened={openedCurtain} onClosed={closedCurtain}
      />}

      {status !== "ended" && !recording && !textPreview && <FormatControls
        onShare={finale?.onShare}
        onOpenAuthor={onOpenAuthor}
        title={manifest.title} byline={manifest.author} artwork={coverArtwork ?? manifest.scenes[0]?.image} start={!hasBegun}
        elapsed={elapsed} total={manifest.durationMs / 1000} playing={playing} stepSeconds={5}
        status={status === "loading" || status === "error" ? status : null}
        hidden={!chromeVisible && playing} onToggle={toggle} onSeek={(seconds) => seekMs(seconds * 1000)}
        onRestart={() => { seekTo(0); if (audio.current?.paused) toggle(); }}
        onReadText={readText} onClose={onClose} voice={voice} onVoiceChange={(value) => { voiceLevel.current?.set(value, true); setVoice(value); }}
        music={manifest.theme ? music : undefined} onMusicChange={manifest.theme ? (value) => { musicLevel.current?.set((manifest.theme?.gain ?? 0) * value, true); setMusic(value); } : undefined}
        onMenuChange={setMenuOpen}
      />}
      {!textPreview && (status === "loading" || status === "error") && <FormatStatus error={status === "error"} onReadText={readText} onRetry={() => {
          const element = audio.current;
          if (element?.error) {
            const at = element.currentTime;
            element.addEventListener("loadedmetadata", () => { element.currentTime = at; }, { once: true });
            element.load();
          }
          setStatus("loading");
          toggle();
        }} />}

      {textPreview && <div className="poem-text-preview">
        <header><button type="button" onClick={() => setTextPreview(false)}><ArrowLeft /><span>{t("Back to audio", "К аудио")}</span></button></header>
        <article lang={manifest.language}><h1>{manifest.title}</h1><div className="poem-text-preview__verse">{manifest.lines.map((verse, index) => <p key={index}>{verse.tokens.map(token => token.text).join(" ")}</p>)}</div><div className="poem-text-preview__end" aria-hidden="true">b.</div></article>
      </div>}
      {/* Keyed by scene so it fades in afresh on its own picture. */}
      {gestureHint && (
        <p key={scene?.id} className="poem__hint" aria-hidden="true">
          {gestureHint}
        </p>
      )}


      {/* The same ending as every other boks series piece - see
          reading-finale.tsx. The poem draws the reading, never its own end. */}
      {status === "ended" && (!curtained || curtainDown) && !withoutFinale && !textPreview && (
        <ReadingFinale
          actions={finale ? { ...finale, onComments: onComments ?? finale.onComments } : undefined}
          onReadText={readText}
          title={manifest.title}
          byline={manifest.author}
          artwork={manifest.scenes.at(-1)?.image}
          onAgain={() => {
            seekTo(0);
            toggle();
          }}
        />
      )}
    </div>
  );
}

/**
 * Hands `use` an in-memory copy of a recording, or its address if the
 * download fails.
 *
 * A streamed file can only be seeked if the server answers range requests,
 * and ours answers one with the whole file and a 200. The element then
 * reports an empty `seekable` range and clamps every seek to zero: the bar,
 * the line steps and "again" all did nothing, which on a six-minute poem is
 * the whole transport. A blob is seekable whatever the server does - the
 * cinema's fix too (`cinema-mode.tsx`).
 *
 * Given before the first play rather than swapped in during it: changing the
 * source of a playing element interrupts its `play()`, and the theme, which
 * starts when the voice's play resolves, never started. Returns the cleanup.
 */
function inMemoryCopy(url: string, use: (src: string) => void) {
  let objectUrl = "";
  // Closed before the download finished: nobody would be left to revoke the
  // URL made afterwards, and it pins the whole recording in memory.
  let cancelled = false;
  void fetch(url)
    .then((response) => (response.ok ? response.blob() : null))
    .then((blob) => {
      if (cancelled) return;
      if (!blob) return use(url);
      objectUrl = URL.createObjectURL(blob);
      use(objectUrl);
    })
    .catch(() => {
      // Playable, if not seekable: better than a poem that never starts.
      if (!cancelled) use(url);
    });
  return () => {
    cancelled = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

/**
 * One line's words in one zone. `slot` is the row it takes: a picture shows at
 * most two lines, so its lines alternate between two rows - the third line
 * takes the first one's place, which is how a sonnet over four pictures, or a
 * hundred-character Whitman line, stays a couplet on screen rather than a
 * page.
 */
type Verse = { lineIndex: number; slot: number; tokens: { token: PoemToken; order: number }[] };

/**
 * The poem as stanzas: each run of lines spoken over one picture, with every
 * line's words split into the zones that picture allows, in spoken order.
 */
function stanzasOf(manifest: PoemManifest) {
  const stanzas: {
    scene: PoemScene;
    verses: number[];
    zones: { role?: string; zone: SafeZone; verses: Verse[] }[];
  }[] = [];
  manifest.lines.forEach((line: PoemLine, lineIndex) => {
    const lineScene = sceneFor(manifest, lineIndex);
    if (!lineScene) return;
    let stanza = stanzas.at(-1);
    if (!stanza || stanza.scene.id !== lineScene.id) {
      stanza = { scene: lineScene, verses: [], zones: [] };
      stanzas.push(stanza);
    }
    stanza.verses.push(lineIndex);
    line.tokens.forEach((token, order) => {
      const role = token.zone;
      const zone = zoneFor(lineScene, role);
      // Keyed by the zone it resolves to, not the name it asked for: a word
      // with no zone and one naming the first zone land in the same place and
      // must share a column, or the two would be drawn over each other.
      let group = stanza.zones.find((candidate) => candidate.zone === zone);
      if (!group) {
        group = { role: zone.role, zone, verses: [] };
        stanza.zones.push(group);
      }
      let verse = group.verses.find((candidate) => candidate.lineIndex === lineIndex);
      if (!verse) {
        verse = { lineIndex, slot: (stanza.verses.length - 1) % 2, tokens: [] };
        group.verses.push(verse);
      }
      verse.tokens.push({ token, order });
    });
  });
  return stanzas;
}

function Backdrop({
  scene,
  ref,
  imageRef,
  canvasRef,
  overlayRef,
}: {
  scene: PoemScene;
  ref: React.Ref<HTMLElement>;
  imageRef: React.Ref<HTMLImageElement>;
  canvasRef: React.Ref<HTMLCanvasElement>;
  overlayRef: React.Ref<HTMLCanvasElement>;
}) {
  const objectPosition = `${scene.focalPoint.x * 100}% ${scene.focalPoint.y * 100}%`;
  /*
   * A gesture scene is a layer holding its picture and the canvas that
   * redraws it, so the frame loop's opacity dissolves both as one. The
   * picture stays underneath: until the canvas has drawn, or wherever WebGL
   * is missing, it is the scene.
   */
  if (needsLayer(scene)) {
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} className="poem__scene poem__scene--gesture">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imageRef}
          className="poem__scene-image"
          src={scene.image}
          alt=""
          draggable={false}
          decoding="async"
          style={{ objectPosition }}
        />
        <canvas ref={canvasRef} className="poem__gesture" aria-hidden="true" />
        {layersOf(scene).warp && layersOf(scene).overlay && (
          <canvas ref={overlayRef} className="poem__gesture" aria-hidden="true" />
        )}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref as React.Ref<HTMLImageElement>}
      className="poem__scene"
      src={scene.image}
      alt=""
      draggable={false}
      decoding="async"
      style={{ objectPosition }}
    />
  );
}
