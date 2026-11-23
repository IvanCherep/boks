"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { readingLines } from "@/lib/boks/author-desk/workflow";

type Phase = "check" | "count" | "rolling";

/**
 * The teleprompter (prototype). The whole screen: a level to check the
 * microphone, a three-second count, then the text moves up at the reading
 * pace and the line to read now is lit, the read ones fade. Space finishes,
 * R starts over, arrows change the speed, Escape cancels. The browser's call processing is off, as in the
 * Series recorder: echo cancellation and noise suppression flatten a reading.
 */
export function Teleprompter({
  text,
  title,
  estimatedSeconds,
  onDone,
  onCancel,
  lead,
}: {
  /** The first line of the check screen; in a run of recordings, what comes next. */
  lead?: string;
  text: string;
  title: string;
  estimatedSeconds: number;
  onDone: (blob: Blob, seconds: number) => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("check");
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0);
  // The pace a reader settled on carries over to the next take and to a fresh start.
  const [pace, setPaceState] = useState(readPace);
  const setPace = (change: (value: number) => number) =>
    setPaceState((value) => {
      const next = change(value);
      try {
        sessionStorage.setItem(paceKey, String(next));
      } catch {
        /* private mode: this teleprompter only */
      }
      return next;
    });
  const [held, setHeld] = useState(false);
  /** The browser gave the microphone: until then «Начать запись» waits, visibly. */
  const [micReady, setMicReady] = useState(false);
  const [error, setError] = useState("");
  /** «Попробовать снова» asks for the microphone again. */
  const [attempt, setAttempt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const startedRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    // Keys belong to the teleprompter now, not to whatever button opened it.
    (document.activeElement as HTMLElement | null)?.blur?.();
    let frame = 0;
    let context: AudioContext | null = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      const timer = window.setTimeout(() => setError("Этот браузер не даёт записывать звук на этой странице. Загрузите готовую запись или откройте кабинет в Chrome или Safari."), 0);
      return () => window.clearTimeout(timer);
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((stream) => {
        streamRef.current = stream;
        setMicReady(true);
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const value of data) peak = Math.max(peak, Math.abs(value - 128));
          setLevel(peak / 128);
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() =>
        setError(
          "Браузер не дал микрофон. Разрешите доступ: на телефоне через «аА» или замок рядом с адресом, на компьютере через значок микрофона или замка в адресной строке. Потом нажмите «Попробовать снова».",
        ),
      );
    return () => {
      cancelAnimationFrame(frame);
      void context?.close();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [attempt]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stop();
    onCancel();
  }, [onCancel, stop]);

  const start = () => {
    if (!streamRef.current) return;
    setPhase("count");
    setCount(3);
    let left = 3;
    const timer = window.setInterval(() => {
      left -= 1;
      setCount(left);
      if (left > 0) return;
      window.clearInterval(timer);
      const recorder = new MediaRecorder(streamRef.current!);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
      recorder.onstop = () => {
        // A take dropped by «Начать заново» or by Escape never reaches the list.
        if (cancelledRef.current || recorderRef.current !== recorder) return;
        const seconds = Math.round((performance.now() - startedRef.current) / 1000);
        onDone(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }), seconds);
      };
      recorder.start(1000);
      startedRef.current = performance.now();
      offsetRef.current = 0;
      setPhase("rolling");
    }, 1000);
  };

  /**
   * From the top without leaving: the take so far is dropped, the text goes
   * back to its first line and the count runs again. The pace stays, so a
   * reader who found it too fast changes it and starts over.
   */
  const restart = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    offsetRef.current = 0;
    if (scrollerRef.current) scrollerRef.current.style.transform = "translateY(0)";
    setHeld(false);
    setElapsed(0);
    start();
  };

  // Rolls the text: the whole height in the estimated time, times the pace.
  useEffect(() => {
    if (phase !== "rolling") return;
    let frame = 0;
    let last = performance.now();
    const roll = (now: number) => {
      const scroller = scrollerRef.current;
      const delta = (now - last) / 1000;
      last = now;
      if (scroller && !held) {
        const travel = scroller.scrollHeight;
        offsetRef.current = Math.min(travel, offsetRef.current + (travel / Math.max(estimatedSeconds, 5)) * pace * delta);
        scroller.style.transform = `translateY(${-offsetRef.current}px)`;
      }
      // The line nearest the reading mark is lit; the ones above it are read.
      if (scroller) {
        const mark = (scroller.parentElement?.getBoundingClientRect().top ?? 0) + (scroller.parentElement?.clientHeight ?? 0) * 0.36;
        const rows = [...scroller.children] as HTMLElement[];
        let best = 0;
        let distance = Infinity;
        rows.forEach((row, index) => {
          if (!row.textContent?.trim()) return;
          const box = row.getBoundingClientRect();
          const gap = Math.abs(box.top + box.height / 2 - mark);
          if (gap < distance) {
            distance = gap;
            best = index;
          }
        });
        rows.forEach((row, index) => {
          row.classList.toggle("is-current", index === best);
          row.classList.toggle("is-read", index < best);
        });
      }
      setElapsed(Math.round((now - startedRef.current) / 1000));
      frame = requestAnimationFrame(roll);
    };
    frame = requestAnimationFrame(roll);
    return () => cancelAnimationFrame(frame);
  }, [phase, held, pace, estimatedSeconds]);

  const restartRef = useRef(restart);
  useEffect(() => {
    restartRef.current = restart;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
      else if (event.code === "Space" && phase === "rolling") {
        event.preventDefault();
        event.stopPropagation();
        stop();
      } else if (event.key === "ArrowRight") setPace((value) => Math.min(2, +(value + 0.1).toFixed(1)));
      else if (event.key === "ArrowLeft") setPace((value) => Math.max(0.2, +(value - 0.1).toFixed(1)));
      else if (event.key === "+" || event.key === "=") setPace((value) => Math.min(2, +(value + 0.1).toFixed(1)));
      else if (event.key === "-") setPace((value) => Math.max(0.2, +(value - 0.1).toFixed(1)));
      else if ((event.key === "r" || event.key === "R" || event.key === "к" || event.key === "К") && phase === "rolling") restartRef.current();
      else if (event.key === "ArrowUp") offsetRef.current = Math.max(0, offsetRef.current - 40);
      else if (event.key === "ArrowDown") offsetRef.current += 40;
    };
    // Capture first: a page button left focused under the teleprompter must not take Space.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cancel, stop, phase]);

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return createPortal(
    <div className="desk-prompter" role="dialog" aria-label="Суфлёр">
      <header className="desk-prompter-top">
        <span className="desk-prompter-title">{title || "Без названия"}</span>
        {phase === "rolling" ? (
          <span className="desk-prompter-rec">
            <i /> {clock}
          </span>
        ) : null}
        <button type="button" onClick={cancel} className="desk-prompter-close">
          Отменить
        </button>
      </header>

      {phase === "check" ? (
        <div className="desk-prompter-check">
          <p className="desk-prompter-lead">{lead ?? "Проверим микрофон. Скажите пару слов обычным голосом."}</p>
          <div className="desk-level" aria-label="Уровень звука">
            <span style={{ width: `${Math.min(100, level * 260)}%` }} />
          </div>
          <p className="desk-prompter-hint">
            {error || (!micReady ? "Если браузер спросит, разрешите доступ к микрофону." : level > 0.5 ? "Громковато: отодвиньтесь чуть дальше." : level > 0.05 ? "Хорошо слышно." : "Тишина. Скажите что-нибудь.")}
          </p>
          {error ? (
            <div className="desk-prompter-retry">
              <button type="button" className="desk-btn desk-btn-red" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>
                Попробовать снова
              </button>
              <button type="button" className="desk-quiet" onClick={onCancel}>
                Закрыть и загрузить готовую запись
              </button>
            </div>
          ) : (
            <button type="button" className="desk-btn desk-btn-red" onClick={start} disabled={!micReady}>
              {micReady ? "Начать запись" : "Ждём микрофон…"}
            </button>
          )}
          <p className="desk-prompter-keys">На клавиатуре: пробел, чтобы закончить · R, чтобы начать заново · ← →, чтобы изменить скорость</p>
        </div>
      ) : null}

      {phase === "count" ? <div className="desk-prompter-count">{count}</div> : null}

      {phase === "rolling" ? (
        <>
          <div className="desk-prompter-window">
            <div className="desk-prompter-mark" aria-hidden />
            <div className="desk-prompter-text" ref={scrollerRef}>
              {readingLines(text, 56).map((line, index) => (
                <p key={index}>{line || " "}</p>
              ))}
            </div>
          </div>
          <footer className="desk-prompter-bar">
            <span className="desk-prompter-speed">
              <button type="button" onClick={() => setPace((value) => Math.max(0.2, +(value - 0.1).toFixed(1)))} aria-label="Медленнее">
                −
              </button>
              <span>
                Скорость: {pace < defaultPace - 0.05 ? "медленнее" : pace > defaultPace + 0.05 ? "быстрее" : "обычная"}
                <small>{Math.round(pace * 100)}%</small>
              </span>
              <button type="button" onClick={() => setPace((value) => Math.min(2, +(value + 0.1).toFixed(1)))} aria-label="Быстрее">
                +
              </button>
            </span>
            <button type="button" onClick={() => setHeld((value) => !value)}>
              {held ? "Продолжить" : "Пауза"}
            </button>
            <button type="button" onClick={restart} title="Начать с первой строки. Эта запись не сохранится, скорость останется.">
              ↺ Начать заново
            </button>
            <button type="button" className="desk-btn desk-btn-red" onClick={stop}>
              Готово
            </button>
          </footer>
        </>
      ) : null}
    </div>,
    document.body
  );
}

// v2: the default became 50% (2026-11-22); paces kept under the old key started at 100%.
const paceKey = "boks-desk-pace-v2";
/** Calm enough to read aloud without hurrying; − and + change it. */
const defaultPace = 0.5;

function readPace() {
  try {
    const stored = Number(sessionStorage.getItem(paceKey));
    return stored >= 0.2 && stored <= 2 ? stored : defaultPace;
  } catch {
    return defaultPace;
  }
}
