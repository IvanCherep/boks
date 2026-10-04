"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { ReadingFinale, type FinaleActions } from "@/components/boks/reading-finale";
import {
  backdropAt,
  lineIndexAt,
  nextLineStart,
  playedFraction,
  previousLineStart,
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
  finale,
  onClose,
}: {
  manifest: PoemManifest;
  /**
   * What the ending's buttons do - the same object every format is given.
   * Absent only in the admin sandbox, where the poem has no boks yet.
   */
  finale?: FinaleActions;
  onClose: () => void;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const theme = useRef<HTMLAudioElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const idleTimer = useRef(0);
  const bar = useRef<HTMLDivElement>(null);
  /*
   * The elements the frame loop writes to: one picture per scene, and the
   * control bar.
   *
   * A custom property set on the root invalidates style for everything beneath
   * it - all eight lines and thirty-three words. Written on the elements that
   * actually read them, the recalculation is a picture or a control bar.
   */
  const pictures = useRef<(HTMLImageElement | null)[]>([]);
  const controls = useRef<HTMLDivElement>(null);
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

  const lineIndex = at.line;
  const activeToken = at.token;
  const line = manifest.lines[lineIndex];
  const scene = sceneFor(manifest, lineIndex);

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
    // Only ever out of loading. The browser fires this again after every
    // seek, and a seek onto the end lands after `ended` - which turned the
    // finale back off and left the player paused on the last frame.
    const ready = () => setStatus((current) => (current === "loading" ? "ready" : current));
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
    const paintBackdrop = (pair: { from: number; to: number; progress: number }) => {
      const fade = Math.round(pair.progress * 200) / 200;
      const shown = painted.current;
      if (pair.from === shown.from && pair.to === shown.to) {
        if (fade !== shown.fade && pair.to >= 0) {
          const arriving = pictures.current[pair.to];
          if (arriving) arriving.style.opacity = String(fade);
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
      });
    };
    paintBackdrop(backdropAt(manifest, (audio.current?.currentTime ?? 0) * 1000));

    const tick = () => {
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
          controls.current?.style.setProperty("--played", String(played));
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
      if (status === "ended" && ms < manifest.durationMs) setStatus("ready");
      revealChrome();
    },
    [manifest.durationMs, revealChrome, status]
  );

  const seekTo = useCallback(
    (fraction: number) => seekMs(Math.min(1, Math.max(0, fraction)) * manifest.durationMs),
    [manifest.durationMs, seekMs]
  );

  /*
   * Stepping is by line, not by seconds.
   *
   * Fifteen seconds is the whole poem and two is most of a line, so neither is
   * a unit anybody could aim with. A line is what a reader would ask for -
   * "again, from «Страна рабов»" - and everything is a function of the
   * timecode, so landing on one restores the scene, the phrase and the lit
   * word in a single frame.
   */
  const step = useCallback(
    (direction: -1 | 1) => {
      const element = audio.current;
      if (!element) return;
      const ms = element.currentTime * 1000;
      seekMs(
        direction < 0
          ? previousLineStart(manifest.lines, ms)
          : nextLineStart(manifest.lines, ms, manifest.durationMs)
      );
    },
    [manifest.durationMs, manifest.lines, seekMs]
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
      className={`poem poem--${preset} ${reduced ? "is-still" : ""} ${chromeVisible ? "" : "is-quiet"}`}
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
    >
      {/* A tap anywhere that is not a control plays or pauses. */}
      <button type="button" className="poem__surface" onClick={toggle} aria-label={playing ? "Pause" : "Listen"} />

      {/*
        One picture per scene, mounted once, never moved and never given
        another `src`. Which is showing, which arriving and how far is written
        by the frame loop alone - React renders these and then leaves them be.
        A poem has a handful of scenes, and loading them all up front means no
        dissolve ever waits on the network.
      */}
      <div className="poem__frame">
        {manifest.scenes.map((poemScene, index) => (
          <Backdrop
            key={poemScene.id}
            scene={poemScene}
            ref={(element) => {
              pictures.current[index] = element;
            }}
          />
        ))}
      </div>

      <div className="poem__veil" aria-hidden="true" />

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
                    top: `${group.zone.y * 100}%`,
                    width: `${group.zone.width * 100}%`,
                  }}
                >
                  {group.verses.map((verse) => (
                    <div
                      key={verse.lineIndex}
                      // Two lines of a picture at most: the third takes the
                      // first one's place, and the first leaves as it arrives.
                      className={`poem__verse ${
                        state === "now" && isGone(verse.lineIndex) ? "is-gone" : ""
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

      <button type="button" className="poem__close" onClick={onClose} aria-label="Close">
        <X className="size-5" />
      </button>

      <div
        ref={controls}
        className={`poem__controls ${status === "ended" ? "is-over" : ""}`}
        style={{ "--played": 0 } as React.CSSProperties}>
        {/* Its own pointer handling, and it must not reach the surface
            underneath - dragging the bar would otherwise also pause. */}
        <div
          ref={bar}
          className="poem__bar"
          role="slider"
          tabIndex={0}
          aria-label="Position"
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
            if (event.key === "ArrowLeft") step(-1);
            else if (event.key === "ArrowRight") step(1);
            else return;
            event.preventDefault();
          }}
        >
          <span className="poem__bar-track" />
          <span className="poem__bar-fill" />
          {/* Where each line begins, so the bar shows the poem's shape and a
              drag has something to aim at rather than being a blind scrub. */}
          {manifest.lines.map((poemLine) => (
            <span
              key={poemLine.startMs}
              className="poem__bar-line"
              style={{ left: `${(poemLine.startMs / manifest.durationMs) * 100}%` }}
              aria-hidden="true"
            />
          ))}
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

        <div className="poem__transport">
          <button
            type="button"
            className="poem__step"
            onClick={(event) => {
              event.stopPropagation();
              step(-1);
            }}
            aria-label="Previous line"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" className="poem__play" onClick={toggle} aria-label={playing ? "Pause" : "Listen"}>
            {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <button
            type="button"
            className="poem__step"
            onClick={(event) => {
              event.stopPropagation();
              step(1);
            }}
            aria-label="Next line"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {status === "loading" && <p className="poem__state">Loading…</p>}
      {status === "error" && <p className="poem__state">The recording did not load</p>}

      {/* The same ending as every other boks series piece - see
          reading-finale.tsx. The poem draws the reading, never its own end. */}
      {status === "ended" && (
        <ReadingFinale
          actions={finale}
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

function Backdrop({ scene, ref }: { scene: PoemScene; ref: React.Ref<HTMLImageElement> }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      className="poem__scene"
      src={scene.image}
      alt=""
      draggable={false}
      decoding="async"
      style={{ objectPosition: `${scene.focalPoint.x * 100}% ${scene.focalPoint.y * 100}%` }}
    />
  );
}
