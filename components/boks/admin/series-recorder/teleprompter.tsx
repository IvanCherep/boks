"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Pause, Play, Plus, RotateCcw, Square, X } from "lucide-react";
import { useMessages } from "@/components/boks/ui-language";
import { levelVerdict, startRecording, type MicLevel } from "./microphone";
import { clock, recorderMessages } from "./messages";

/**
 * The teleprompter: the whole screen dark, the poem large, the line to read
 * on a band a third of the way down, the text moving up at the pace the poem
 * was estimated to take. The reader can hold it, nudge it with the arrows,
 * or change the pace; Space stops the take. A three-second count first, so
 * the take starts in silence.
 */
export function Teleprompter({ title, stanzas, stream, level, estimatedMs, onDone, onCancel }: {
  title: string;
  /** The poem's lines, stanza by stanza. */
  stanzas: string[][];
  stream: MediaStream;
  level: MicLevel;
  estimatedMs: number;
  onDone: (take: { blob: Blob; durationMs: number }) => void;
  onCancel: () => void;
}) {
  const t = useMessages(recorderMessages);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  // The pace a reader settled on carries over to the next take and to a fresh start.
  const [pace, setPace] = useState(readPace);
  const [held, setHeld] = useState(false);
  const [current, setCurrent] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const bandLine = useRef<HTMLDivElement>(null);
  const take = useRef<ReturnType<typeof startRecording> | null>(null);
  const finished = useRef(false);
  const paceRef = useRef(pace);
  const heldRef = useRef(held);
  useEffect(() => {
    paceRef.current = pace;
    heldRef.current = held;
  }, [pace, held]);
  const numbered = useMemo(() => {
    let index = 0;
    return stanzas.map((stanza) => stanza.map((line) => ({ line, index: index++ })));
  }, [stanzas]);
  const recording = count === 0;

  // The count, then the take.
  useEffect(() => {
    if (count === 0) {
      take.current = startRecording(stream);
      return;
    }
    const timer = setTimeout(() => setCount((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [count, stream]);

  const stop = useCallback(async () => {
    if (!take.current || finished.current) return;
    finished.current = true;
    onDone(await take.current.stop());
  }, [onDone]);

  /**
   * From the top: the take so far is dropped, the text goes back to its first
   * line and the count runs again. The pace stays as it was set, so a reader
   * who found it wrong changes it and starts over without leaving.
   */
  const restart = useCallback(() => {
    take.current?.cancel();
    take.current = null;
    finished.current = false;
    if (scroller.current) scroller.current.scrollTop = 0;
    setHeld(false);
    setElapsed(0);
    setCurrent(0);
    setCount(3);
  }, []);

  const changePace = useCallback((by: number) => setPace((p) => {
    const next = Math.min(2, Math.max(0.2, Math.round((p + by) * 10) / 10));
    try {
      sessionStorage.setItem(paceKey, String(next));
    } catch {
      // Private mode: the pace lasts for this teleprompter only.
    }
    return next;
  }), []);

  const cancel = useCallback(() => {
    finished.current = true;
    take.current?.cancel();
    onCancel();
  }, [onCancel]);

  // A take never outlives the page.
  useEffect(() => () => {
    if (!finished.current) take.current?.cancel();
  }, []);

  // The scroll, and which line is on the reading band.
  useEffect(() => {
    if (!recording) return;
    const element = scroller.current;
    if (!element) return;
    const rows = [...element.querySelectorAll<HTMLElement>("[data-line]")];
    const travel = Math.max(1, (rows.at(-1)?.offsetTop ?? 0) - (rows[0]?.offsetTop ?? 0));
    let frame = 0;
    let last = performance.now();
    let position = element.scrollTop;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const delta = now - last;
      last = now;
      // A wheel or an arrow moved it: carry on from there.
      if (Math.abs(element.scrollTop - position) > 2) position = element.scrollTop;
      if (!heldRef.current) {
        position += (travel / estimatedMs) * paceRef.current * delta;
        element.scrollTop = position;
      }
      // Whole seconds, so the clock re-renders once a second, not every frame.
      setElapsed(Math.floor((take.current?.elapsed() ?? 0) / 1000) * 1000);
      // Where the band is drawn, in the text's own coordinates: the line on it is the one to read.
      const band = element.scrollTop + (bandLine.current?.getBoundingClientRect().top ?? 0) - element.getBoundingClientRect().top;
      let near = 0;
      rows.forEach((row, index) => {
        // Lit once the band reaches a fifth of the way into the line, so the band runs through the line it lights.
        if (row.offsetTop + row.offsetHeight * 0.2 <= band) near = index;
      });
      setCurrent(near);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recording, estimatedMs]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        if (recording) void stop();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        changePace(event.key === "ArrowLeft" ? -0.1 : 0.1);
      } else if (event.key === "r" || event.key === "R" || event.key === "к" || event.key === "К") {
        if (recording) restart();
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        scroller.current?.scrollBy({ top: event.key === "ArrowUp" ? -56 : 56 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording, stop, cancel, restart, changePace]);

  const verdict = levelVerdict(level);
  // On the page itself: Studio's panels animate in with a transform, which would trap a fixed layer inside them.
  return createPortal(<div className="prompter" role="dialog" aria-modal="true" aria-label={title}>
    <header className="prompter__top">
      <span className={`prompter__state${recording ? " is-recording" : ""}`}>
        <i aria-hidden="true" />{recording ? `${t.recording} · ${clock(elapsed)}` : t.countdown}
      </span>
      <span className={`prompter__meter is-${verdict}`} aria-label={t.level}>
        <span style={{ width: `${Math.max(0, Math.min(100, (level.peak + 60) * (100 / 60)))}%` }} />
      </span>
      <button type="button" className="prompter__ghost" onClick={cancel} aria-label={t.cancelTake}><X aria-hidden="true" /><span className="prompter__label">{t.cancelTake}</span></button>
    </header>

    <div className="prompter__stage">
    <div className="prompter__text" ref={scroller}>
      <p className="prompter__title">{title}</p>
      {numbered.map((stanza, s) => <div className="prompter__stanza" key={s}>
        {stanza.map(({ line, index }) => <p key={index} data-line className={recording && index === current ? "is-current" : recording && index < current ? "is-read" : ""}>{line}</p>)}
      </div>)}
    </div>
    <div className="prompter__band" ref={bandLine} aria-hidden="true" />
    </div>

    {!recording && <div className="prompter__count" aria-live="assertive"><b key={count}>{count}</b></div>}

    <footer className="prompter__controls">
      <div className="prompter__pace" aria-label={t.pace}>
        <button type="button" onClick={() => changePace(-0.1)} aria-label={t.slower}><Minus aria-hidden="true" /></button>
        <span>{t.pace} {pace.toFixed(1)}×<kbd>← →</kbd></span>
        <button type="button" onClick={() => changePace(0.1)} aria-label={t.faster}><Plus aria-hidden="true" /></button>
      </div>
      <button type="button" className="prompter__stop" onClick={() => void stop()} disabled={!recording}>
        <Square aria-hidden="true" />{t.stop}<kbd>{t.stopHint}</kbd>
      </button>
      <button type="button" className="prompter__ghost" onClick={() => setHeld((h) => !h)} disabled={!recording} aria-label={held ? t.resumeScroll : t.pauseScroll}>
        {held ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}<span className="prompter__label">{held ? t.resumeScroll : t.pauseScroll}</span>
      </button>
      <button type="button" className="prompter__ghost" onClick={restart} disabled={!recording} title={t.restartHint} aria-label={t.restart}>
        <RotateCcw aria-hidden="true" /><span className="prompter__label">{t.restart}</span>
      </button>
    </footer>
  </div>, document.body);
}

// v2: the default became 0.5× (2026-11-22), as in the Workshop.
const paceKey = "boks-series-recorder-pace-v2";
const defaultPace = 0.5;

function readPace() {
  try {
    const stored = Number(sessionStorage.getItem(paceKey));
    return stored >= 0.2 && stored <= 2 ? stored : defaultPace;
  } catch {
    return defaultPace;
  }
}
