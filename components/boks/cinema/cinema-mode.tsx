"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { ReaderBackIcon as ArrowLeft } from "@/components/boks/reader/reader-icons";
import { FormatControls, FormatStatus, type FormatPlaybackState } from "@/components/boks/cinema/format-controls";
import { ReadingFinale, type FinaleActions } from "@/components/boks/reading-finale";
import { FormatCurtain } from "@/components/boks/author-stage/format-curtain";
import { StoryMomentScene } from "@/components/boks/cinema/story-moment";
import {
  momentDueAt,
  momentsToRearm,
  storyMomentsFor,
  type StoryMoment,
} from "@/components/boks/cinema/story-moments";
import { SceneArt } from "@/components/boks/cinema/scene-art";
import {
  createNarrator,
  primeVoices,
  speechSupported,
  type Narrator,
  type NarratorState,
} from "@/components/boks/cinema/narrator";
import {
  estimateNarrationSeconds,
  planScenes,
  sceneAtLine,
} from "@/components/boks/cinema/scene-plan";
import { createAudioNarrator } from "@/components/boks/cinema/audio-narrator";
import {
  lineStartTimes,
  narrationTrackFor,
  type NarrationAlignment,
} from "@/components/boks/cinema/narration-track";
import { sceneImageFor, sceneImagesFor } from "@/components/boks/cinema/scene-image";
import type { Story } from "@/components/boks/client-types";

/** A prose bok with its authored scenes, narration and story moments. */

type Phase = "cover" | "playing" | "ended";

/**
 * Two scene layers, so one picture dissolves into the next.
 *
 * A cut between scenes reads as a glitch at this size; a dissolve reads as a
 * film. The outgoing layer is kept mounted for the length of the fade and then
 * dropped, so there are never more than two skylines on the page.
 */
function Backdrop({
  seed,
  scene,
  sceneCount,
  storyId,
}: {
  seed: number;
  scene: number;
  sceneCount: number;
  storyId: string;
}) {
  const [layers, setLayers] = useState([{ scene, key: 0 }]);
  const nextKey = useRef(0);

  useEffect(() => {
    setLayers((current) => {
      if (current[current.length - 1].scene === scene) return current;
      nextKey.current += 1;
      return [...current.slice(-1), { scene, key: nextKey.current }];
    });
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), 1200);
    return () => window.clearTimeout(timer);
  }, [scene]);

  /**
   * Read the next picture while this one is still on screen.
   *
   * A scene image is around 400 KB, and `decoding="async"` only says the
   * decode may not block - it does not say it has happened. Mounted at the
   * moment the dissolve begins, the decode lands inside the animation, and a
   * dissolve that has to wait for a JPEG is the dissolve the reader calls
   * laggy. Decoded a scene early, the fade has nothing left to do but
   * composite two layers.
   *
   * Failures are ignored on purpose: this is a cache warm, and the real
   * `<img>` will report anything that actually matters.
   */
  useEffect(() => {
    const next = sceneImageFor(storyId, scene + 1);
    const image = new Image();
    image.src = next.src;
    void image.decode?.().catch(() => {});
  }, [storyId, scene]);

  return (
    <>
      {layers.map((layer, index) => (
        <SceneArt
          key={layer.key}
          seed={seed}
          scene={layer.scene}
          sceneCount={sceneCount}
          storyId={storyId}
          className={`cinema__backdrop ${index < layers.length - 1 ? "cinema__backdrop--leaving" : ""}`}
        />
      ))}
    </>
  );
}

/** Interface language is independent of the bok's language. */
function cinemaWords(t: (english: string, russian: string) => string) { return {
  listen: t("Listen and read", "Слушать и читать"),
  minutes: (n: number) => t(`${n} ${n === 1 ? "minute" : "minutes"}`, `${n} мин`),
  close: t("Close", "Закрыть"),
  back: t("Back 15 seconds", "Назад на 15 секунд"),
  forward: t("Forward 15 seconds", "Вперёд на 15 секунд"),
  scrub: t("Position", "Позиция"),
  resume: (at: string) => t(`Continue from ${at}`, `Продолжить с ${at}`),
  fromStart: t("From the beginning", "С начала"),
  hideWords: t("Hide the words", "Скрыть текст"),
  showWords: t("Show the words", "Показать текст"),
  pause: t("Pause", "Пауза"),
  play: t("Resume", "Продолжить"),
  silent: t("This browser has no voice - the bok runs without sound", "В этом браузере нет голоса, бок идёт без звука"),
  placeholder: t("Placeholder illustration", "Временная иллюстрация"),
}; }

const skipSeconds = 15;

/**
 * How far back the voice picks up after a moment.
 *
 * Russian runs at around thirteen characters a second, so this is two or three
 * words: enough to re-enter the sentence, not enough to feel like a repeat.
 */
const rewindOnResumeSeconds = 1.6;

/**
 * Where this boks was left, on this device.
 *
 * Closing the window by accident half way through a story and having to find
 * the place again by dragging is the kind of small insult that stops people
 * coming back. Kept per boks, forgotten once it has been finished, and never
 * acted on silently - the cover offers to continue rather than just doing it,
 * because a reader who meant to start again should not have to fight it.
 */
// Exact media seconds only for an explicit Read text → format round trip.
const textRoundTrips = new Map<string, number>();

const positionKey = (storyId: string) => `boks-cinema-at:${storyId}`;

function readPosition(storyId: string) {
  try {
    const raw = window.localStorage.getItem(positionKey(storyId));
    const seconds = raw ? Number(raw) : 0;
    return Number.isFinite(seconds) && seconds > 5 ? seconds : 0;
  } catch {
    return 0;
  }
}

function writePosition(storyId: string, seconds: number, total: number) {
  try {
    // Almost at the end is finished; nobody wants to be offered the last line.
    if (!seconds || seconds < 5 || (total && seconds > total - 8)) {
      window.localStorage.removeItem(positionKey(storyId));
      return;
    }
    window.localStorage.setItem(positionKey(storyId), String(Math.floor(seconds)));
  } catch {
    // A reader with storage turned off simply starts from the beginning.
  }
}

/** Cyrillic against Latin. The catalogue holds exactly these two. */
function languageOf(text: string) {
  const sample = text.slice(0, 2000);
  const cyrillic = (sample.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  return cyrillic > latin ? "ru" : "en";
}

export function CinemaMode({
  story,
  finale,
  recording = false,
  autoPlay = false,
  suspended = false,
  onReadText,
  onOpenAuthor,
  onComments,
  onPlaybackChange,
  onClose,
  withoutFinale = false,
  curtain = false,
  curtainExit = "fade",
}: {
  story: Story;
  /** What the ending's buttons do - the same object every format is given. */
  finale: FinaleActions;
  /**
   * Filming the piece: no close button, no bar, no transport. A tap on the
   * cover starts from the beginning; Space pauses, the arrows skip, Escape
   * leaves. See `recording-mode.ts`.
   */
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
   * Opens behind the author stage's curtain and closes it again before the
   * ending (`format-curtain.tsx`). Only with `autoPlay`, never while filming.
   */
  curtain?: boolean;
  /** How the drawn-aside curtain goes (`FormatCurtain`'s `exit`). */
  curtainExit?: "fade" | "slide";
}) {
  const { t } = useReaderPreferences();
  const words = cinemaWords(t);
  const curtained = curtain && autoPlay && !recording;
  const [curtainUp, setCurtainUp] = useState(curtained);
  const [curtainDown, setCurtainDown] = useState(false);
  const openedCurtain = useCallback(() => setCurtainUp(false), []);
  const closedCurtain = useCallback(() => setCurtainDown(true), []);

  const language = useMemo(() => languageOf(story.body), [story.body]);
  const plan = useMemo(() => planScenes({ id: story.id, text: story.body }), [story.id, story.body]);
  const totalSeconds = useMemo(
    () => estimateNarrationSeconds(plan.spoken, language),
    [plan.spoken, language]
  );
  const charactersPerSecond = Math.max(1, plan.spoken.length / totalSeconds);
  const picture = sceneImageFor(story.id, 0);

  const [phase, setPhase] = useState<Phase>(autoPlay ? "playing" : "cover");
  /** With the curtain the piece has ended once it has closed; the ending comes up under it. */
  const ended = phase === "ended" && (!curtained || curtainDown);
  const [menuOpen, setMenuOpen] = useState(false);
  const [voice, setVoice] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [startPending, setStartPending] = useState(autoPlay);
  const beginRef = useRef<(from?: number) => void>(() => {});
  /** The moment on screen, if the story has stopped to ask for something. */
  const [moment, setMoment] = useState<StoryMoment | null>(null);
  const momentsDone = useRef<Set<string>>(new Set());
  /** Guards the trigger: pausing emits one more update, which is still due. */
  const momentOpen = useRef(false);
  /**
   * Where to pick the reading back up, which is not where it stopped.
   *
   * Coming back exactly on the cut leaves the reader holding half a sentence
   * they heard a quarter of a minute ago. A second and a half is two or three
   * words in Russian - enough to catch the thread, short enough that nobody
   * notices they have heard it twice.
   */
  const resumeFrom = useRef(0);
  const momentsHere = useMemo(() => storyMomentsFor(story.id), [story.id]);
  const [progress, setProgress] = useState<NarratorState>({
    line: 0,
    elapsedSeconds: 0,
    totalSeconds,
    speaking: false,
    done: false,
  });
  const narrator = useRef<Narrator | null>(null);
  // Read once, as the initial value rather than in an effect: this component
  // only ever mounts after a tap, so there is no server render to disagree
  // with, and an effect here would set state during the first paint.
  const [savedAt] = useState(() => readPosition(story.id));
  const [textResumeAt] = useState(() => textRoundTrips.get(story.id) ?? 0);
  const pendingFrom = useRef<number | null>(null);
  useEffect(() => { textRoundTrips.delete(story.id); }, [story.id]);
  /** Tapped the picture: the words step aside and the painting has the screen. */
  const [bare, setBare] = useState(false);

  /**
   * The recording for this boks, if there is one. Fetched on open rather than
   * on first play, so pressing the button starts the voice instead of starting
   * a download.
   */
  const track = narrationTrackFor(story.id);
  const [lineStarts, setLineStarts] = useState<number[] | null>(null);
  /**
   * The recording, downloaded whole and held as an object URL.
   *
   * Streaming it straight from its address cannot be seeked: the server
   * answers a range request with the entire file and a 200, so the element
   * reports an empty `seekable` range and clamps every seek to zero - pressing
   * "forward 15 seconds" started the story from the beginning. Downloading
   * first costs 1.2MB while the cover is on screen and makes the bar real.
   */
  const [localAudio, setLocalAudio] = useState<string | null>(null);
  useEffect(() => {
    if (!track) return;
    let objectUrl = "";
    // Closed before the download finished: the URL made afterwards would have
    // nobody left to revoke it, and it pins the whole recording in memory.
    let cancelled = false;
    void fetch(track.audio)
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLocalAudio(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [track, loadAttempt]);

  // If the reader pressed play before the download finished, hand the copy over.
  useEffect(() => {
    if (localAudio) narrator.current?.setSource?.(localAudio);
  }, [localAudio]);
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    void fetch(track.alignment)
      .then((response) => (response.ok ? (response.json() as Promise<NarrationAlignment>) : null))
      .then((alignment) => {
        if (cancelled) return;
        if (!alignment) { setLoadError(true); return; }
        // Null when the words and the recording have drifted apart: better the
        // browser voice than a highlight in the wrong place.
        const starts = lineStartTimes(plan.lines, alignment);
        if (!starts) { setLoadError(true); return; }
        setLineStarts(starts);
        setLoadError(false);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => {
      cancelled = true;
    };
  }, [track, plan.lines, loadAttempt]);

  useEffect(() => {
    primeVoices();
    return () => narrator.current?.stop();
  }, []);

  /**
   * Fetch every picture while the cover is still up.
   *
   * They are about 380KB each and the scene changes on a dissolve, so one that
   * begins downloading when its scene starts arrives after the scene does -
   * the crossfade would land on nothing. Two minutes of reading is plenty of
   * time to have fetched all six, and the browser cache serves them instantly
   * when their turn comes.
   */
  useEffect(() => {
    const warmed = sceneImagesFor(story.id).map((src) => {
      const image = new Image();
      image.src = src;
      return image;
    });
    return () => warmed.forEach((image) => { image.src = ""; });
  }, [story.id]);

  // Escape closes, as it does for every other sheet in the reader. While
  // recording there is nothing on screen to press, so the keys do the rest.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (suspended || menuOpen || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (!recording || moment) return;
      if (event.key === " ") {
        if (phase === "cover") begin(0);
        else if (phase === "playing") {
          if (progress.speaking) narrator.current?.pause();
          else narrator.current?.resume();
        } else return;
      } else if (phase === "playing" && event.key === "ArrowLeft") skip(-skipSeconds);
      else if (phase === "playing" && event.key === "ArrowRight") skip(skipSeconds);
      else return;
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  function ensureNarrator() {
    if (!narrator.current) {
      narrator.current =
        track && lineStarts
          ? createAudioNarrator({
              audioUrl: localAudio ?? track.audio,
              streamUrl: track.audio,
              lineStarts,
              estimatedSeconds: totalSeconds,
            })
          : createNarrator({ lines: plan.lines, language, charactersPerSecond, totalSeconds });
      narrator.current.setVolume(voice);
      narrator.current.subscribe((next) => {
        setProgress(next);

        /*
         * A moment stops the voice where the text stops being description and
         * starts being a situation. Checked here rather than in an effect
         * because this is the only place the recording's own clock is read,
         * and a moment that opened a beat late would open over the wrong line.
         */
        if (!next.done && !momentOpen.current) {
          /*
           * Rewinding past a moment makes it available again.
           *
           * Someone who missed it, or liked it, should be able to drag back and
           * have it happen - there is nothing to protect here, and refusing
           * would make the mark on the bar a liar. Stated as a rule about where
           * the playhead is rather than by watching for a jump, so it holds for
           * a scrub, the fifteen-second button and a replay alike.
           */
          for (const id of momentsToRearm(momentsHere, next.elapsedSeconds)) {
            momentsDone.current.delete(id);
          }

          const due = momentDueAt(momentsHere, next.elapsedSeconds, momentsDone.current);
          if (due) {
            momentOpen.current = true;
            // Ridden down rather than cut off. A recording can do this; the
            // browser voice cannot, so it falls back to stopping.
            resumeFrom.current = Math.max(0, next.elapsedSeconds - rewindOnResumeSeconds);
            const player = narrator.current;
            if (player?.fadeOutAndPause) player.fadeOutAndPause(600);
            else player?.pause();
            setMoment(due);
          }
        }
        // The ending lands here, not on the menu: the question only means
        // anything while the last line is still in the air.
        if (next.done) { writePosition(story.id, 0, next.totalSeconds); setPhase("ended"); }
      });
    }
    return narrator.current;
  }

  function begin(from = 0) {
    setPhase("playing");
    if (track && !lineStarts) { pendingFrom.current = from; setStartPending(true); return; }
    setStartPending(false);
    const player = ensureNarrator();
    player.play();
    if (from > 0) player.seek(from);
  }

  useEffect(() => { beginRef.current = begin; });
  useEffect(() => {
    if (startPending && !curtainUp && !suspended && !document.hidden && (!track || lineStarts)) beginRef.current(pendingFrom.current ?? (autoPlay ? textResumeAt : savedAt));
  }, [startPending, curtainUp, suspended, track, lineStarts, savedAt, autoPlay, textResumeAt]);
  useEffect(() => { narrator.current?.setVolume(voice); }, [voice]);
  useEffect(() => { if (suspended || menuOpen) narrator.current?.pause(); }, [suspended, menuOpen]);
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) narrator.current?.pause(); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);
  useEffect(() => {
    onPlaybackChange?.({ playing: progress.speaking && !suspended && !menuOpen && !moment, progress: progress.totalSeconds > 0 ? Math.min(1, progress.elapsedSeconds / progress.totalSeconds) : 0, ended });
  }, [progress, suspended, menuOpen, moment, ended, onPlaybackChange]);

  function readText() {
    // Read after the end: coming back plays it from the start, not the end.
    textRoundTrips.set(story.id, phase === "ended" ? 0 : progress.elapsedSeconds);
    if (textRoundTrips.size > 32) textRoundTrips.delete(textRoundTrips.keys().next().value!);
    writePosition(story.id, phase === "ended" ? 0 : progress.elapsedSeconds, progress.totalSeconds);
    narrator.current?.stop(); narrator.current = null;
    (onReadText ?? onClose)();
  }

  function skip(seconds: number) {
    narrator.current?.seek(Math.max(0, progress.elapsedSeconds + seconds));
  }

  function close() {
    writePosition(story.id, progress.elapsedSeconds, progress.totalSeconds);
    narrator.current?.stop();
    narrator.current = null;
    onClose();
  }

  // The narrator knows which line it is on - the recording to the character,
  // the browser voice because it speaks one line at a time.
  const line = progress.done ? plan.lines.length - 1 : progress.line;
  const scene = sceneAtLine(plan.sceneStarts, line);
  const elapsed = progress.elapsedSeconds;
  const total = progress.totalSeconds || totalSeconds;
  const audioStatus = loadError || progress.error ? "error" : phase === "playing" && track && !lineStarts ? "loading" : null;

  return (
    <div
      className={`cinema ${bare ? "cinema--bare" : ""} ${recording ? "is-recording" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={story.title}
    >
      <Backdrop
        seed={plan.seed}
        scene={phase === "cover" ? 0 : scene}
        sceneCount={plan.sceneStarts.length}
        storyId={story.id}
      />


      {(ended || moment) && <button type="button" className="cinema__close" onClick={close} aria-label={t("Back", "Назад")}><ArrowLeft /></button>}

      {phase === "cover" && recording && (
        <button type="button" className="cinema__peek" onClick={() => begin(0)} aria-label={words.listen} />
      )}

      {phase === "cover" && (
        <div className="cinema__cover">
          <p className="cinema__author">{story.authorName || "boks"}</p>
          <h1 className="cinema__title">{story.title}</h1>
          {!track && !speechSupported() && <p className="cinema__note">{words.silent}</p>}
          {/* A piece that has its own pictures and its own voice is one of
              ours, made for this text, and says so as a mark rather than as a
              technical note. A piece still wearing the shared stand-in cannot
              claim that, and says what it actually is instead. */}
          {picture.placeholder ? (
            <p className="cinema__stamp">{words.placeholder}</p>
          ) : null}
        </div>
      )}

      {phase === "playing" && (
        <>
          {/* The whole picture, on one tap. Somebody who wants to look at it
              should not have to read around a page laid over it - and the
              voice carries on, so nothing is lost by looking. */}
          <button
            type="button"
            className="cinema__peek"
            onClick={() => setBare((hidden) => !hidden)}
            aria-label={bare ? words.showWords : words.hideWords}
            aria-pressed={bare}
          />

          <div className={`cinema__stage ${bare ? "is-bare" : ""}`}>
            {/* The line being spoken, and only that one. The line before it has
                already been heard and the line after it is a small spoiler that
                pulls the eye down the page; carrying all three made the paper
                a third of the screen tall and put it over the part of the
                painting the painter composed. */}
            <div className="cinema__card">
              <p className="cinema__line" key={line}>
                <span>{plan.lines[line]?.text ?? ""}</span>
              </p>
            </div>

          </div>
        </>
      )}

      {phase !== "ended" && !moment && !recording && <FormatControls
        onShare={finale?.onShare}
        onOpenAuthor={onOpenAuthor}
        title={story.title} byline={story.authorName || "boks"} artwork={picture.placeholder ? undefined : picture.src}
        elapsed={elapsed} total={total} playing={progress.speaking} stepSeconds={15} hidden={bare && progress.speaking} start={phase === "cover"}
        status={audioStatus}
        onToggle={() => { if (!narrator.current) begin(); else if (progress.speaking) narrator.current.pause(); else narrator.current.resume(); }}
        onSeek={(seconds) => narrator.current?.seek(Math.max(0, seconds))}
        onRestart={() => { momentsDone.current.clear(); momentOpen.current = false; begin(0); }}
        onReadText={readText} onClose={close} voice={voice} onVoiceChange={(value) => { narrator.current?.setVolume(value, true); setVoice(value); }} onMenuChange={setMenuOpen}
        moments={momentsHere.map((mark) => mark.atSeconds)}
      />}
      {audioStatus && <FormatStatus error={audioStatus === "error"} onReadText={readText} onRetry={() => {
        if (loadError) { setLoadError(false); setLoadAttempt((value) => value + 1); setStartPending(true); }
        else narrator.current?.resume();
      }} />}

      {moment && (
        <StoryMomentScene
          moment={moment}
          onDone={() => {
            momentsDone.current.add(moment.id);
            momentOpen.current = false;
            setMoment(null);
            // Back to the voice exactly where it stopped, brought up out of the
            // silence rather than snapped back into it.
            const player = narrator.current;
            player?.seek(resumeFrom.current);
            if (!suspended && !document.hidden) {
              if (player?.fadeInAndResume) player.fadeInAndResume(700);
              else player?.resume();
            }
          }}
        />
      )}

      {curtained && <FormatCurtain
        title={story.title} byline={story.authorName ?? ""} ready={!track || Boolean(lineStarts)} closed={phase === "ended"}
        onOpened={openedCurtain} onClosed={closedCurtain} exit={curtainExit}
      />}

      {ended && !withoutFinale && (
        <ReadingFinale
          actions={{
            ...finale,
            onComments: onComments ?? finale.onComments,
            onNext: () => {
              narrator.current?.stop();
              narrator.current = null;
              finale.onNext();
            },
          }}
          onReadText={readText}
          title={story.title}
          byline={story.authorName}
          artwork={picture.placeholder ? undefined : picture.src}
          onAgain={() => {
            // A second listen is a second telling: the crowd gathers again
            // and the heart beats again.
            momentsDone.current.clear();
            momentOpen.current = false;
            setCurtainDown(false);
            setPhase("playing");
            ensureNarrator().restart();
          }}
        />
      )}
    </div>
  );
}
