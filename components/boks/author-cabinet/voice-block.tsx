"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/app/series-recorder.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { levelVerdict, useMicrophone } from "@/components/boks/admin/series-recorder/microphone";
import { Teleprompter } from "@/components/boks/admin/series-recorder/teleprompter";
import { clock } from "@/components/boks/admin/series-recorder/messages";
import { estimatedReadingMs, takeExtension } from "@/lib/boks/series-recorder/rules";
import { isStaleTake, promptStanzas, voiceFingerprint, voiceLimits, type VoiceTake, type VoiceTakes } from "@/lib/boks/author/voice/rules";
import { readableBoksError } from "@/lib/boks/errors";
import { defineMessages } from "@/lib/i18n/messages";
import { takeAfterNote } from "@/lib/boks/author/editor-decisions";
import { chooseTake, deleteTake, loadTakes, takeUrl, uploadTake } from "./voice-data";
import { decisionWords } from "./decision-words";

/**
 * The composer's Voice block (`docs/author-publishing.md`, "The author's
 * voice"): every bok goes out with its author's reading. Two equal ways, the
 * teleprompter (the Series recorder's own) or a recording of one's own, then
 * the takes: listen, choose, delete. A take of an older text is marked and
 * does not count; the composer sends to the editors only with a chosen take
 * of the text as it is.
 */

export const voiceWords = defineMessages(
  {
    label: "Voice",
    title: "Your voice",
    lead: "Every bok goes out in your voice. The editors make the pictures and the series; all we need from you is your voice.",
    needText: "Paste the text first: the teleprompter shows it.",
    promptTitle: "Record with the teleprompter",
    promptLead: "The text moves up the screen, large, at your pace. Space stops.",
    micOn: "Turn on the microphone",
    micAsking: "Waiting for the browser…",
    micDenied: "The browser did not give the microphone. Allow it in the address bar, then try again.",
    micUnsupported: "This browser cannot record. Attach a recording instead, or open boks in Chrome or Safari.",
    level: "Level",
    levels: { silent: "Say something", quiet: "Too quiet: come closer", good: "Good", loud: "Too loud: move back a little" } as Record<string, string>,
    start: "Start recording",
    attachTitle: "Upload a finished recording",
    attachLead: "From a studio, for example. mp3, m4a, wav files, up to 15 minutes.",
    attach: "Choose a file",
    fileKind: "This file is not a recording we can read: mp3, m4a, wav, ogg or webm.",
    fileTooLarge: "The file is larger than 25 MB.",
    fileTooLong: "The recording is longer than 15 minutes.",
    fileUnreadable: "The browser could not read this recording. Try mp3 or m4a.",
    saving: "Saving the recording…",
    failed: "The recording was not saved. Try again.",
    takes: "Recordings",
    take: (n: number) => `Recording ${n}`,
    recorded: "teleprompter",
    attached: "uploaded",
    play: "Listen",
    pause: "Pause",
    choose: "Choose",
    chosen: "Goes into the series",
    remove: "Delete",
    confirmRemove: "Delete this recording?",
    stale: "old text",
    staleWhy: "Recorded before the text was edited. Record it again.",
    full: (n: number) => `${n} recordings is the most. Delete one to add another.`,
    ready: (name: string) => `Your voice is here: ${name} goes to the editors with the text.`,
    missing: "Record or upload a reading: no bok goes out without your voice.",
    staleMissing: "The text changed after your reading. Record it again or upload a new one.",
  },
  {
    ru: {
      label: "Голос",
      title: "Ваш голос",
      lead: "Каждый бок выходит с вашим голосом. Рисунки и серию делает редакция, от вас нужен только голос.",
      needText: "Сначала вставьте текст: суфлёр покажет его.",
      promptTitle: "Записать с суфлёром",
      promptLead: "Текст пойдёт по экрану крупно, в вашем темпе. Пробел останавливает запись.",
      micOn: "Включить микрофон",
      micAsking: "Ждём браузер…",
      micDenied: "Браузер не дал микрофон. Разрешите его в адресной строке и попробуйте снова.",
      micUnsupported: "Этот браузер не умеет записывать. Загрузите готовую запись или откройте boks в Chrome или Safari.",
      level: "Уровень",
      levels: { silent: "Скажите что-нибудь", quiet: "Тихо: подойдите ближе", good: "Хорошо", loud: "Громко: отодвиньтесь немного" },
      start: "Начать запись",
      attachTitle: "Загрузить готовую запись",
      attachLead: "Например, из студии. Файлы mp3, m4a, wav, до 15 минут.",
      attach: "Выбрать файл",
      fileKind: "Этот файл не похож на запись. Подойдут mp3, m4a, wav, ogg или webm.",
      fileTooLarge: "Файл больше 25 МБ.",
      fileTooLong: "Запись длиннее 15 минут.",
      fileUnreadable: "Браузер не смог прочитать эту запись. Попробуйте mp3 или m4a.",
      saving: "Сохраняем запись…",
      failed: "Запись не сохранилась. Попробуйте ещё раз.",
      takes: "Записи",
      take: (n: number) => `Запись ${n}`,
      recorded: "суфлёр",
      attached: "загружена",
      play: "Слушать",
      pause: "Пауза",
      choose: "Выбрать",
      chosen: "Пойдёт в серию",
      remove: "Удалить",
      confirmRemove: "Удалить эту запись?",
      stale: "старый текст",
      staleWhy: "Записана до правки текста. Запишите ещё раз.",
      full: (n: number) => `Больше ${n} записей нельзя. Удалите одну, чтобы добавить новую.`,
      ready: (name: string) => `Голос есть: ${name} уйдёт в редакцию вместе с текстом.`,
      missing: "Запишите или загрузите чтение: без голоса бок не выходит.",
      staleMissing: "Текст изменился после вашего чтения. Запишите ещё раз или загрузите новую запись.",
    },
  },
);

const byName: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm" };

/** A recording's length, read by the browser from the file itself; 0 when it cannot. */
function audioLength(blob: Blob) {
  const url = URL.createObjectURL(blob);
  return new Promise<number>((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration * 1000 : 0);
    probe.onerror = () => resolve(0);
    probe.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

export function VoiceBlock({ bokId, title, text, notBefore = null, onReady }: {
  bokId: string;
  title: string;
  /** The text as it is now; a take of another text does not count. */
  text: string;
  /** The editors returned the piece for its recording: takes made before their note do not count either. */
  notBefore?: string | null;
  onReady: (ready: boolean) => void;
}) {
  const w = useMessages(voiceWords);
  const d = useMessages(decisionWords);
  const language = useUiLanguage();
  const mic = useMicrophone();
  const [takes, setTakes] = useState<VoiceTakes | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [prompting, setPrompting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const hasText = Boolean(text.trim());
  const stanzas = useMemo(() => promptStanzas(text), [text]);

  useEffect(() => {
    let live = true;
    loadTakes(bokId).then((loaded) => { if (live) setTakes(loaded); }, () => { if (live) setTakes({ ownerId: "", takes: [], chosen: null, uploads: 0 }); });
    return () => { live = false; };
  }, [bokId]);

  useEffect(() => {
    let live = true;
    void voiceFingerprint(text).then((value) => { if (live) setFingerprint(value); });
    return () => { live = false; };
  }, [text]);

  /** A take that does not count: of another text, or made before the editors asked for a new recording. */
  const oldWhy = (take: VoiceTake) => (fingerprint && isStaleTake(take, fingerprint) ? w.staleWhy : !takeAfterNote(take.createdAt, notBefore) ? d.beforeNote : null);
  const chosenTakeNow = takes?.takes.find((take) => take.file === takes.chosen) ?? null;
  const current = fingerprint && hasText && chosenTakeNow && !oldWhy(chosenTakeNow) ? chosenTakeNow : null;
  const ready = Boolean(current);
  useEffect(() => onReady(ready), [ready, onReady]);

  const save = useCallback(async (blob: Blob, durationMs: number, source: "teleprompter" | "upload", name: string | null) => {
    setSaving(true);
    setProblem("");
    try {
      let next = await uploadTake(bokId, blob, { durationMs, source, name, fingerprint: await voiceFingerprint(text) });
      // A chosen take from before the editors' note gives way to the new one.
      const chosen = next.takes.find((take) => take.file === next.chosen);
      const newest = next.takes.at(-1);
      if (chosen && newest && chosen !== newest && !takeAfterNote(chosen.createdAt, notBefore)) next = await chooseTake(bokId, newest.file);
      setTakes(next);
    } catch (error) {
      setProblem(readableBoksError(error, w.failed, language));
    } finally {
      setSaving(false);
    }
  }, [bokId, text, notBefore, w.failed, language]);

  async function attach(file: File | undefined) {
    if (!file) return;
    setProblem("");
    const type = takeExtension(file.type) ? file.type : byName[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) return setProblem(w.fileKind);
    if (file.size > voiceLimits.takeBytes) return setProblem(w.fileTooLarge);
    const durationMs = await audioLength(file);
    if (!durationMs) return setProblem(w.fileUnreadable);
    if (durationMs > voiceLimits.takeMs) return setProblem(w.fileTooLong);
    await save(new Blob([file], { type }), durationMs, "upload", file.name);
  }

  const list = takes?.takes ?? [];
  const full = list.length >= voiceLimits.takes;
  const blocked = !hasText || saving || full;
  const verdict = levelVerdict(mic.level);
  const chosenStale = Boolean(chosenTakeNow && oldWhy(chosenTakeNow));

  return (
    <section className="acomp-voice" id="acomp-voice" aria-labelledby="acomp-voice-title">
      <header className="acomp-voice__head">
        <span className="acomp-label">{w.label}</span>
        <h2 id="acomp-voice-title" className="serif">{w.title}</h2>
        <p>{w.lead}</p>
      </header>
      {!hasText && <p className="acomp-hint">{w.needText}</p>}

      <div className="acomp-ways">
        <div className="acomp-way">
          <strong>{w.promptTitle}</strong>
          <small>{w.promptLead}</small>
          {mic.state === "on" ? (
            <>
              <span className="acomp-level" aria-label={w.level}>
                <span className={`acomp-meter is-${verdict}`}><span style={{ width: `${Math.max(0, Math.min(100, (mic.level.peak + 60) * (100 / 60)))}%` }} /></span>
                <em className={`is-${verdict}`}>{w.levels[verdict]}</em>
              </span>
              <button type="button" className="btn btn-red acomp-way__go" disabled={blocked} onClick={() => setPrompting(true)}>
                <span className="acomp-rec-dot" aria-hidden="true" />{w.start}
              </button>
            </>
          ) : mic.state === "unsupported" ? (
            <p className="acomp-hint">{w.micUnsupported}</p>
          ) : (
            <>
              {mic.state === "denied" && <p className="acomp-hint is-warn">{w.micDenied}</p>}
              <button type="button" className="btn btn-red acomp-way__go" disabled={blocked || mic.state === "asking"} onClick={() => void mic.open()}>
                <span className="acomp-rec-dot" aria-hidden="true" />{mic.state === "asking" ? w.micAsking : w.micOn}
              </button>
            </>
          )}
        </div>
        <div className="acomp-way">
          <strong>{w.attachTitle}</strong>
          <small>{w.attachLead}</small>
          <button type="button" className="btn btn-secondary acomp-way__go" disabled={blocked} onClick={() => fileInput.current?.click()}>{w.attach}</button>
          <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset at once, so the same file can be chosen again.
            event.target.value = "";
            void attach(file);
          }} />
        </div>
      </div>

      {saving && <p className="acomp-hint" role="status">{w.saving}</p>}
      {problem && <p className="acomp-problem" role="alert">{problem}</p>}
      {full && <p className="acomp-hint">{w.full(voiceLimits.takes)}</p>}

      {list.length > 0 && (
        <div className="acomp-takes">
          <span className="acomp-label">{w.takes}</span>
          <ul>
            {[...list].reverse().map((take) => (
              <TakeRow key={take.file} bokId={bokId} take={take} chosen={takes?.chosen === take.file} why={oldWhy(take)}
                onChange={setTakes} onProblem={setProblem} fingerprint={fingerprint ?? ""} />
            ))}
          </ul>
        </div>
      )}

      {hasText && takes && (
        <p className={`acomp-voice__state${ready ? " is-ready" : ""}`} role="status">
          {ready && current ? w.ready(current.source === "upload" && current.name ? `«${current.name}»` : w.take(numberOf(current))) : chosenStale ? w.staleMissing : w.missing}
        </p>
      )}

      {prompting && mic.stream && (
        <Teleprompter
          title={title}
          stanzas={stanzas}
          stream={mic.stream}
          level={mic.level}
          estimatedMs={estimatedReadingMs(stanzas.flat())}
          onCancel={() => setPrompting(false)}
          onDone={(take) => {
            setPrompting(false);
            if (take.durationMs > voiceLimits.takeMs) { setProblem(w.fileTooLong); return; }
            void save(take.blob, take.durationMs, "teleprompter", null);
          }}
        />
      )}
    </section>
  );
}

const numberOf = (take: Pick<VoiceTake, "file">) => Number(take.file.match(/\d+/)?.[0] ?? 0);

function TakeRow({ bokId, take, chosen, why, fingerprint, onChange, onProblem }: {
  bokId: string;
  take: VoiceTake;
  chosen: boolean;
  /** Why the take does not count, or null when it does. */
  why: string | null;
  fingerprint: string;
  onChange: (takes: VoiceTakes) => void;
  onProblem: (message: string) => void;
}) {
  const w = useMessages(voiceWords);
  const language = useUiLanguage();
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const stale = Boolean(why);

  useEffect(() => () => {
    if (audio.current) {
      audio.current.pause();
      URL.revokeObjectURL(audio.current.src);
    }
  }, []);

  async function toggle() {
    try {
      if (!audio.current) {
        audio.current = new Audio(await takeUrl(bokId, take.file));
        audio.current.onended = () => setPlaying(false);
      }
      if (audio.current.paused) {
        await audio.current.play();
        setPlaying(true);
      } else {
        audio.current.pause();
        setPlaying(false);
      }
    } catch (error) {
      onProblem(readableBoksError(error, w.failed, language));
    }
  }

  async function act(call: () => Promise<VoiceTakes>) {
    setBusy(true);
    try {
      onChange(await call());
    } catch (error) {
      onProblem(readableBoksError(error, w.failed, language));
    } finally {
      setBusy(false);
    }
  }

  const when = new Date(take.createdAt).toLocaleString(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <li className={`acomp-take${chosen && !stale ? " is-chosen" : ""}${stale ? " is-stale" : ""}`}>
      <button type="button" className="acomp-take__play" onClick={() => void toggle()} aria-label={playing ? w.pause : w.play}>{playing ? "❚❚" : "▶"}</button>
      <span className="acomp-take__name">
        <strong>{w.take(numberOf(take))}{stale && <em className="acomp-take__stale">{w.stale}</em>}</strong>
        <small>{clock(take.durationMs)} · {take.source === "upload" ? `${w.attached}${take.name ? `: ${take.name}` : ""}` : w.recorded} · {when}</small>
        {stale && <small className="acomp-take__why">{why}</small>}
      </span>
      <span className="acomp-take__actions">
        {chosen && !stale
          ? <em className="acomp-take__chosen">✓ {w.chosen}</em>
          : !stale && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(() => chooseTake(bokId, take.file))}>{w.choose}</button>}
        <button type="button" className="btn btn-quiet acomp-take__remove" disabled={busy} aria-label={w.remove}
          onClick={() => { if (window.confirm(w.confirmRemove)) void act(() => deleteTake(bokId, take.file, fingerprint)); }}>✕</button>
      </span>
    </li>
  );
}
