"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CloudOff, Copy, ExternalLink, MessageCircle, Mic, Minus, Pause, Play, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, Upload } from "lucide-react";
import "@/app/series-recorder.css";
import { Button } from "@/components/ui/button";
import type { FeedbackSurface } from "@/components/boks/feedback";
import { sendBoksFeedback } from "@/components/boks/supabase-browser-data";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { linkOnlyPiecePath } from "@/lib/boks/link-only";
import { canRegenerate, draftGaps, estimatedReadingMs, poemLines, seriesLimits, takeExtension, type SeriesBuildResult, type SeriesDraft, type SeriesDraftSummary } from "@/lib/boks/series-recorder/rules";
import { linesPerPicture } from "@/lib/boks/series-recorder/scene-plan";
import {
  buildSeriesDraft,
  createSeriesDraft,
  deleteSeriesDraft,
  deleteSeriesFile,
  generateSeriesImages,
  listSeriesDrafts,
  loadSeriesDraft,
  publishSeriesDraft,
  regenerateSeriesImage,
  seriesFileUrl,
  updateSeriesDraft,
  uploadSeriesImage,
  uploadSeriesTake,
  type SeriesAllowance,
} from "./api";
import { clock, recorderMessages } from "./messages";
import { levelVerdict, useMicrophone } from "./microphone";
import { Teleprompter } from "./teleprompter";

type Step = "text" | "record" | "pictures" | "build";
const steps: Step[] = ["text", "record", "pictures", "build"];
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Studio → Series recorder (beta). A poem's text, a few takes read through
 * the teleprompter, the author's pictures, and the Series built from the
 * chosen take into a link-only piece (`docs/series-recorder.md`).
 */
export function SeriesRecorder({ mode = "studio" }: {
  /** Studio sees every draft and makes as many as it likes; an author, their own, from their grant. */
  mode?: "studio" | "author";
}) {
  const t = useMessages(recorderMessages);
  const [drafts, setDrafts] = useState<SeriesDraftSummary[] | null>(null);
  const [allowance, setAllowance] = useState<SeriesAllowance | null>(null);
  const [failed, setFailed] = useState(false);
  const [createError, setCreateError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const author = mode === "author" && !allowance?.admin;
  const spent = author && (allowance?.left ?? 0) < 1;

  const refresh = useCallback(() => listSeriesDrafts().then((list) => {
    setDrafts(list.drafts);
    setAllowance(list.access);
    setFailed(false);
  }, () => setFailed(true)), []);
  useEffect(() => void refresh(), [refresh]);

  const create = async () => {
    setCreating(true);
    setConfirming(false);
    setCreateError("");
    try {
      const draft = await createSeriesDraft();
      await refresh();
      setOpenId(draft.id);
    } catch (e) {
      setCreateError(errorText(e) || t.createFailed);
    } finally {
      setCreating(false);
    }
  };

  return <div className={`series-rec${openId ? " is-open" : ""}`}>
    <aside className="series-rec__list">
      <header>
        <h2>{author ? t.myDrafts : t.drafts} <small>{t.beta}</small></h2>
        <p>{t.draftsLead}</p>
      </header>
      {author && allowance && <div className="series-rec__allowance" role="status">
        <span className="series-rec__budget-marks" aria-hidden="true">
          {Array.from({ length: Math.min(allowance.granted, 20) }, (_, index) => <i key={index} className={index < allowance.used ? "is-used" : ""} />)}
        </span>
        <strong>{t.allowanceLeft(allowance.left, allowance.granted)}</strong>
        <small>{spent ? t.allowanceSpent : t.allowanceRule}</small>
      </div>}
      {confirming
        ? <div className="series-rec__confirm-new">
          <p>{t.confirmNew(allowance?.left ?? 0)}</p>
          <span>
            <Button size="sm" onClick={() => void create()} disabled={creating}>{t.confirmStart}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t.cancel}</Button>
          </span>
        </div>
        : <Button onClick={() => (author ? setConfirming(true) : void create())} disabled={creating || spent || !allowance}><Plus className="size-4" />{t.newDraft}</Button>}
      {failed && <p className="series-rec__error">{t.loadFailed}</p>}
      {createError && <p className="series-rec__error">{createError}</p>}
      {drafts?.length === 0 && <p className="series-rec__muted">{t.noDrafts}</p>}
      <ul>
        {drafts?.map((draft) => <li key={draft.id}>
          <button type="button" className={`series-rec__item${draft.id === openId ? " is-selected" : ""}`} onClick={() => setOpenId(draft.id)}>
            <span>
              <strong>{draft.title || t.untitled}</strong>
              <small>{[mode === "studio" && draft.ownerHandle ? `@${draft.ownerHandle}` : null, draft.author, t.takesCount(draft.takes), t.imagesCount(draft.images)].filter(Boolean).join(" · ")}</small>
            </span>
            <em className={`series-rec__state is-${draft.status}`}>{t.state[draft.status]}</em>
          </button>
        </li>)}
      </ul>
    </aside>
    {openId
      ? <DraftEditor key={openId} id={openId} ownByline={author} onChanged={refresh} onClose={() => setOpenId(null)} onDeleted={() => {
        setOpenId(null);
        void refresh();
      }} />
      : <section className="series-rec__empty"><Mic aria-hidden="true" /><p>{t.draftsLead}</p></section>}
  </div>;
}

function DraftEditor({ id, ownByline, onChanged, onClose, onDeleted }: {
  id: string;
  /** An author's own recording: signed with their name, not typed. */
  ownByline: boolean;
  onChanged: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useMessages(recorderMessages);
  const [draft, setDraft] = useState<SeriesDraft | null>(null);
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("text");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const apply = useCallback((next: SeriesDraft) => {
    setDraft(next);
    setError("");
    onChanged();
  }, [onChanged]);

  useEffect(() => {
    loadSeriesDraft(id).then((loaded) => {
      setDraft(loaded);
      // An existing recording opens where it stands.
      const gaps = draftGaps(loaded);
      setStep(gaps.includes("title") || gaps.includes("text") ? "text" : gaps.includes("take") ? "record" : gaps.includes("images") ? "pictures" : "build");
    }, (e) => setError(errorText(e)));
  }, [id]);

  // While a build runs or pictures are drawn, their progress.
  const building = draft?.status.state === "queued" || draft?.status.state === "processing";
  const drawing = Boolean(draft && draft.art.state !== "idle");
  useEffect(() => {
    if (!building && !drawing) return;
    const timer = setInterval(() => loadSeriesDraft(id).then((next) => {
      setDraft(next);
      const settled = next.status.state !== "queued" && next.status.state !== "processing" && next.art.state === "idle";
      if (settled) onChanged();
    }, () => {}), 1500);
    return () => clearInterval(timer);
  }, [building, drawing, id, onChanged]);

  if (!draft) return <section className="series-rec__editor">{error ? <p className="series-rec__error">{error}</p> : null}</section>;
  const gaps = draftGaps(draft);
  const done: Record<Step, boolean> = {
    text: !gaps.includes("title") && !gaps.includes("text"),
    record: !gaps.includes("take"),
    pictures: !gaps.includes("images"),
    build: draft.status.state === "ready" && !draft.status.stale,
  };

  return <section className="series-rec__editor">
    <header className="series-rec__head">
      <button type="button" className="series-rec__back" onClick={onClose} aria-label={t.drafts}><ArrowLeft aria-hidden="true" /></button>
      <h2>{draft.title || t.untitled}</h2>
      {confirmDelete
        ? <span className="series-rec__confirm">
          {t.deleteDraftConfirm}
          <Button size="sm" variant="destructive" onClick={() => deleteSeriesDraft(id).then(onDeleted, (e) => setError(errorText(e)))}>{t.delete}</Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>{t.cancel}</Button>
        </span>
        : <Button size="sm" variant="ghost" className="series-rec__delete" onClick={() => setConfirmDelete(true)} disabled={building} aria-label={t.deleteDraft}><Trash2 className="size-4" /><span>{t.deleteDraft}</span></Button>}
    </header>
    <ol className="series-rec__steps">
      {steps.map((name, index) => <li key={name}>
        <button type="button" className={`${name === step ? "is-current" : ""}${done[name] ? " is-done" : ""}`} onClick={() => setStep(name)} aria-current={name === step ? "step" : undefined}>
          <b>{done[name] ? <Check aria-hidden="true" /> : index + 1}</b>{t.steps[name]}
        </button>
      </li>)}
    </ol>
    {error && <p className="series-rec__error" role="alert">{error}</p>}
    {step === "text" && <TextStep draft={draft} ownByline={ownByline} onSaved={apply} onError={setError} onNext={() => setStep("record")} />}
    {step === "record" && <RecordStep draft={draft} onSaved={apply} onError={setError} onNext={() => setStep("pictures")} />}
    {step === "pictures" && <PicturesStep draft={draft} onSaved={apply} onError={setError} onNext={() => setStep("build")} />}
    {step === "build" && <BuildStep draft={draft} ownByline={ownByline} onSaved={apply} onError={setError} onGo={setStep} />}
    <StepFeedback key={step} step={step} />
  </section>;
}

type StepProps = { draft: SeriesDraft; onSaved: (draft: SeriesDraft) => void; onError: (message: string) => void };

function TextStep({ draft, ownByline, onSaved, onError, onNext }: StepProps & { ownByline: boolean; onNext: () => void }) {
  const t = useMessages(recorderMessages);
  const [fields, setFields] = useState({ title: draft.title, author: draft.author, text: draft.text });
  const [savedOnce, setSavedOnce] = useState(false);
  const dirty = fields.title !== draft.title || fields.author !== draft.author || fields.text !== draft.text;

  // Saved a moment after typing stops.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      updateSeriesDraft(draft.id, ownByline ? { title: fields.title, text: fields.text } : fields).then((next) => {
        onSaved(next);
        setSavedOnce(true);
      }, (e) => onError(errorText(e)));
    }, 700);
    return () => clearTimeout(timer);
  }, [fields, dirty, draft.id, onSaved, onError]);

  const poem = useMemo(() => poemLines(fields.text), [fields.text]);
  const set = (name: keyof typeof fields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => ({ ...f, [name]: event.target.value }));

  return <div className="series-rec__step series-rec__text">
    <div className="series-rec__fields">
      <label><span>{t.title}</span><input value={fields.title} onChange={set("title")} maxLength={seriesLimits.titleChars} /></label>
      {ownByline
        ? <p className="series-rec__byline"><span>{t.author}</span>{draft.author}</p>
        : <label><span>{t.author}</span><input value={fields.author} onChange={set("author")} maxLength={seriesLimits.authorChars} /></label>}
    </div>
    <label className="series-rec__poem">
      <span>{t.text}</span>
      <textarea value={fields.text} onChange={set("text")} placeholder={t.textPlaceholder} maxLength={seriesLimits.textChars} rows={16} spellCheck={false} />
      <small>{t.textHint}</small>
    </label>
    <footer className="series-rec__foot">
      <p className="series-rec__muted">
        {poem.lines.length > 0 && <>{t.lines(poem.lines.length)} · {t.stanzas(poem.stanzas.length)} · {t.reading(clock(estimatedReadingMs(poem.lines)))}</>}
        <span className="series-rec__saved" aria-live="polite">{dirty ? t.saving : savedOnce ? t.saved : ""}</span>
      </p>
      <Button onClick={onNext} disabled={!fields.title.trim() || !poem.lines.length}>{t.next}<ArrowRight className="size-4" /></Button>
    </footer>
  </div>;
}

function RecordStep({ draft, onSaved, onError, onNext }: StepProps & { onNext: () => void }) {
  const t = useMessages(recorderMessages);
  const mic = useMicrophone();
  const [prompting, setPrompting] = useState(false);
  const [pending, setPending] = useState<{ blob: Blob; durationMs: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const poem = useMemo(() => poemLines(draft.text), [draft.text]);
  const stanzas = useMemo(() => {
    const groups: string[][] = [];
    let cursor = 0;
    for (const size of poem.stanzas) {
      groups.push(poem.lines.slice(cursor, cursor + size));
      cursor += size;
    }
    return groups;
  }, [poem]);
  const full = draft.takes.length >= seriesLimits.takes;
  const nextNumber = draft.takes.reduce((top, take) => Math.max(top, Number(take.file.match(/\d+/)?.[0] ?? 0)), 0) + 1;

  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState("");

  /**
   * A recording made elsewhere: its length read here from the file itself
   * (the worker reads it again and refuses one over ten minutes), its kind
   * from the browser or, failing that, from its name.
   */
  const uploadFile = async (file: File | undefined) => {
    if (!file) return;
    setFileError("");
    const byName: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm" };
    const type = takeExtension(file.type) ? file.type : byName[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) return setFileError(t.fileKind);
    if (file.size > seriesLimits.takeBytes) return setFileError(t.fileTooLarge);
    const url = URL.createObjectURL(file);
    const durationMs = await new Promise<number>((resolve) => {
      const probe = new Audio();
      probe.preload = "metadata";
      probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? probe.duration * 1000 : 0);
      probe.onerror = () => resolve(0);
      probe.src = url;
    }).finally(() => URL.revokeObjectURL(url));
    if (!durationMs) return setFileError(t.fileUnreadable);
    if (durationMs > seriesLimits.takeMs) return setFileError(t.fileTooLong);
    const take = { blob: new Blob([file], { type }), durationMs };
    setPending(take);
    void save(take);
  };

  const save = useCallback(async (take: { blob: Blob; durationMs: number }) => {
    setUploading(true);
    setUploadFailed(false);
    try {
      onSaved(await uploadSeriesTake(draft.id, take.blob, take.durationMs));
      setPending(null);
    } catch (e) {
      setUploadFailed(true);
      onError(errorText(e));
    } finally {
      setUploading(false);
    }
  }, [draft.id, onSaved, onError]);

  if (!poem.lines.length) return <div className="series-rec__step"><p className="series-rec__muted">{t.needText}</p></div>;
  const verdict = levelVerdict(mic.level);

  return <div className="series-rec__step series-rec__record">
    <section className="series-rec__mic">
      {mic.state === "on"
        ? <>
          <div className="series-rec__mic-row">
            {mic.devices.length > 1 && <label><span>{t.device}</span>
              <select value={mic.deviceId} onChange={(event) => mic.choose(event.target.value)}>
                {mic.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t.device} ${index + 1}`}</option>)}
              </select>
            </label>}
            <div className="series-rec__level">
              <span>{t.level}</span>
              <span className={`series-rec__meter is-${verdict}`}><span style={{ width: `${Math.max(0, Math.min(100, (mic.level.peak + 60) * (100 / 60)))}%` }} /></span>
              <em className={`is-${verdict}`}>{{ silent: t.levelSilent, quiet: t.levelQuiet, good: t.levelGood, loud: t.levelLoud }[verdict]}</em>
            </div>
          </div>
          {/* The one action of this step, and what it will do: a teleprompter over the whole screen. */}
          <button type="button" className="series-rec__start" onClick={() => setPrompting(true)} disabled={full || uploading || Boolean(pending)}>
            <span className="series-rec__start-dot" aria-hidden="true"><i /></span>
            <span className="series-rec__start-text">
              <strong>{t.startTake(nextNumber)}</strong>
              <small>{t.startTakeLead}</small>
            </span>
          </button>
          <ol className="series-rec__how">
            <li>{t.howPrompter}</li>
            <li>{t.howCount}</li>
            <li>{t.howStop}</li>
            <li>{t.howPace}</li>
          </ol>
          <p className="series-rec__muted">{t.recordTips}</p>
          {full && <p className="series-rec__muted">{t.takesFull(seriesLimits.takes)}</p>}
        </>
        : <>
          <strong>{mic.state === "unsupported" ? t.micUnsupported : t.micOff}</strong>
          {mic.state !== "unsupported" && <p className="series-rec__muted">{mic.state === "denied" ? t.micDenied : t.micOffLead}</p>}
          {mic.state !== "unsupported" && <Button onClick={() => void mic.open()} disabled={mic.state === "asking"}><Mic className="size-4" />{t.micOn}</Button>}
        </>}
    </section>

    <section className="series-rec__upload">
      <span><strong>{t.uploadTitle}</strong><small>{t.uploadLead}</small></span>
      <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={full || uploading || Boolean(pending)}><Upload className="size-4" />{t.uploadAudio}</Button>
      <input ref={fileInput} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm" hidden onChange={(event) => {
        void uploadFile(event.target.files?.[0]);
        event.target.value = "";
      }} />
      {fileError && <p className="series-rec__error" role="alert">{fileError}</p>}
    </section>

    {pending && <p className="series-rec__pending" role="status">
      {uploading ? t.uploading : uploadFailed ? <>{t.uploadFailed} <Button size="sm" variant="outline" onClick={() => void save(pending)}>{t.retryUpload}</Button> <Button size="sm" variant="ghost" onClick={() => setPending(null)}>{t.discard}</Button></> : null}
    </p>}

    <section className="series-rec__takes">
      <h3>{t.takes}</h3>
      {draft.takes.length === 0 && <p className="series-rec__muted">{t.noTakes}</p>}
      <ul>
        {[...draft.takes].reverse().map((take) => <TakeRow key={take.file} draft={draft} file={take.file} durationMs={take.durationMs} createdAt={take.createdAt} onSaved={onSaved} onError={onError} />)}
      </ul>
    </section>

    <footer className="series-rec__foot">
      <span />
      <Button onClick={onNext} disabled={!draft.chosenTake}>{t.next}<ArrowRight className="size-4" /></Button>
    </footer>

    {prompting && mic.stream && <Teleprompter
      title={draft.title}
      stanzas={stanzas}
      stream={mic.stream}
      level={mic.level}
      estimatedMs={estimatedReadingMs(poem.lines)}
      onCancel={() => setPrompting(false)}
      onDone={(take) => {
        setPrompting(false);
        setPending(take);
        void save(take);
      }}
    />}
  </div>;
}

function TakeRow({ draft, file, durationMs, createdAt, onSaved, onError }: StepProps & { file: string; durationMs: number; createdAt: string }) {
  const t = useMessages(recorderMessages);
  const language = useUiLanguage();
  const [playing, setPlaying] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const chosen = draft.chosenTake === file;
  const number = Number(file.match(/\d+/)?.[0] ?? 0);

  useEffect(() => () => {
    if (audio.current) {
      audio.current.pause();
      URL.revokeObjectURL(audio.current.src);
    }
  }, []);

  const toggle = async () => {
    try {
      if (!audio.current) {
        audio.current = new Audio(await seriesFileUrl(draft.id, file));
        audio.current.onended = () => setPlaying(false);
      }
      if (audio.current.paused) {
        await audio.current.play();
        setPlaying(true);
      } else {
        audio.current.pause();
        setPlaying(false);
      }
    } catch (e) {
      onError(errorText(e));
    }
  };

  const when = new Date(createdAt).toLocaleString(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return <li className={`series-rec__take${chosen ? " is-chosen" : ""}`}>
    <button type="button" className="series-rec__play" onClick={() => void toggle()} aria-label={playing ? t.pause : t.play}>
      {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
    </button>
    <span className="series-rec__take-name">
      <strong>{t.take(number)}</strong>
      <small>{clock(durationMs)} · {when}</small>
    </span>
    {chosen
      ? <em className="series-rec__chosen"><Check aria-hidden="true" />{t.chosen}</em>
      : <Button size="sm" variant="outline" onClick={() => updateSeriesDraft(draft.id, { chosenTake: file }).then(onSaved, (e) => onError(errorText(e)))}>{t.choose}</Button>}
    {confirm
      ? <span className="series-rec__confirm">
        <Button size="sm" variant="destructive" onClick={() => deleteSeriesFile(draft.id, file).then(onSaved, (e) => onError(errorText(e)))}>{t.delete}</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t.cancel}</Button>
      </span>
      : <Button size="icon-sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={t.delete}><Trash2 className="size-4" /></Button>}
  </li>;
}

function PicturesStep({ draft, onSaved, onError, onNext }: StepProps & { onNext: () => void }) {
  const t = useMessages(recorderMessages);
  const [uploading, setUploading] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const poem = useMemo(() => poemLines(draft.text), [draft.text]);
  const art = draft.art;
  const generating = art.state !== "idle" && art.kind === "generate" ? art.count : 0;
  const redrawing = art.state !== "idle" && art.kind === "regenerate" ? art.file : null;
  const busy = art.state !== "idle" || uploading > 0;
  // Pictures being drawn hold their places already, so the lines under each are the ones it will carry.
  const room = seriesLimits.images - draft.images.length - generating - uploading;
  const spans = linesPerPicture(poem.stanzas, draft.images.length + generating + uploading);
  const budget = draft.artBudget;
  const maxGenerate = Math.max(0, Math.min(seriesLimits.generate, room, poem.lines.length - draft.images.length, budget.left));
  const unavailable = art.state === "idle" && art.error === "unavailable";
  const [count, setCount] = useState(() => Math.max(1, Math.min(3, maxGenerate)));
  const wanted = Math.min(count, maxGenerate);

  // Each picture's preview, every version of it, fetched once with the admin's token.
  useEffect(() => {
    for (const file of draft.images.flatMap((image) => (image.versions ?? [image]).map((version) => version.file))) {
      if (urls[file]) continue;
      seriesFileUrl(draft.id, file).then((url) => setUrls((all) => ({ ...all, [file]: url })), () => {});
    }
  }, [draft.id, draft.images, urls]);
  useEffect(() => () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: FileList | null) => {
    const chosen = [...(files ?? [])].filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, room));
    for (const file of chosen) {
      setUploading((n) => n + 1);
      try {
        onSaved(await uploadSeriesImage(draft.id, file));
      } catch (e) {
        onError(`${t.pictureFailed} ${errorText(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const act = (call: Promise<SeriesDraft>) => call.then(onSaved, (e) => onError(errorText(e)));
  const linesFor = (index: number) => {
    const from = spans.slice(0, index).reduce((sum, n) => sum + n, 0);
    return poem.lines.slice(from, from + (spans[index] ?? 0));
  };

  return <div className="series-rec__step series-rec__pictures">
    <section className="series-rec__art-actions">
      {unavailable
        ? <div className="series-rec__generate is-paused" role="status">
          <span className="series-rec__generate-text">
            <strong><CloudOff aria-hidden="true" />{t.unavailableTitle}</strong>
            <small>{t.unavailableLead}</small>
          </span>
          <Budget used={budget.used} limit={budget.limit} />
          <Button variant="outline" onClick={() => act(generateSeriesImages(draft.id, Math.max(1, wanted)))} disabled={busy || wanted < 1}>
            <RotateCcw className="size-4" />{t.tryAgain}
          </Button>
        </div>
        : budget.left < 1 && art.state === "idle"
          ? <div className="series-rec__generate is-spent">
            <span className="series-rec__generate-text">
              <strong><Sparkles aria-hidden="true" />{t.budgetSpent(budget.limit)}</strong>
              <small>{t.budgetSpentLead}</small>
            </span>
            <Budget used={budget.used} limit={budget.limit} />
          </div>
          : <div className="series-rec__generate">
            <span className="series-rec__generate-text">
              <strong><Sparkles aria-hidden="true" />{t.generateTitle}</strong>
              <small>{t.generateLead(seriesLimits.generate)}</small>
            </span>
            <Budget used={budget.used} limit={budget.limit} />
            <span className="series-rec__generate-go">
              <span className="series-rec__counter" aria-label={t.howMany}>
                <button type="button" onClick={() => setCount((n) => Math.max(1, n - 1))} disabled={busy || wanted <= 1} aria-label={t.fewer}><Minus aria-hidden="true" /></button>
                <b>{wanted || 0}</b>
                <button type="button" onClick={() => setCount((n) => Math.min(maxGenerate, n + 1))} disabled={busy || wanted >= maxGenerate} aria-label={t.more}><Plus aria-hidden="true" /></button>
              </span>
              <Button onClick={() => act(generateSeriesImages(draft.id, wanted))} disabled={busy || wanted < 1}>
                <Sparkles className="size-4" />{t.generate(wanted)}
              </Button>
            </span>
            <small className="series-rec__budget-rule">{t.budgetRule(budget.limit)}</small>
          </div>}
      <div className="series-rec__own">
        <Button variant="outline" onClick={() => input.current?.click()} disabled={busy || room < 1}><Upload className="size-4" />{t.uploadOwn}</Button>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(event) => {
          void upload(event.target.files);
          event.target.value = "";
        }} />
        <small>{t.picturesLead}</small>
      </div>
    </section>
    {art.state !== "idle" && <p className="series-rec__drawing" role="status"><i aria-hidden="true" />{art.kind === "generate" ? t.drawingMany(art.count) : t.drawingOne}</p>}
    {art.state === "idle" && art.error && art.error !== "unavailable" && <p className="series-rec__error" role="alert">{t.artErrors[art.error]}</p>}
    {room < 1 && art.state === "idle" && <p className="series-rec__muted">{t.picturesFull(seriesLimits.images)}</p>}

    {draft.images.length + generating + uploading > 0 && <ol className="series-rec__frames">
      {draft.images.map((image, index) => {
        const versions = image.versions ?? [image];
        const slot = versions[0].file;
        const lines = linesFor(index);
        const isRedrawing = redrawing === slot;
        return <li key={slot}>
          <figure className={`series-rec__frame${isRedrawing ? " is-drawing" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob of the admin's own picture */}
            {urls[image.file] ? <img src={urls[image.file]} alt="" /> : <span className="series-rec__frame-wait" />}
            <figcaption>{index + 1}</figcaption>
            <em className={`series-rec__source is-${image.source ?? "upload"}`}>{image.source === "generated" ? t.generated : t.own}</em>
            {isRedrawing && <span className="series-rec__frame-busy"><i aria-hidden="true" />{t.redrawing}</span>}
            {image.width > image.height && <small className="series-rec__warn">{t.wide}</small>}
          </figure>
          {versions.length > 1 && <div className="series-rec__versions" role="group" aria-label={t.versions}>
            {versions.map((version, n) => <button key={version.file} type="button" aria-pressed={version.file === image.file}
              className={version.file === image.file ? "is-on" : ""} disabled={busy}
              onClick={() => act(updateSeriesDraft(draft.id, { showImage: version.file }))}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob of the admin's own picture */}
              {urls[version.file] && <img src={urls[version.file]} alt="" />}
              {n === 0 ? t.versionFirst : t.versionSecond}
            </button>)}
          </div>}
          <div className="series-rec__frame-tools">
            {/* With the allowance spent the panel above says so once; no button repeats it on every picture. */}
            {canRegenerate(image) && budget.left > 0 && <Button size="sm" variant="outline" disabled={busy || unavailable}
              onClick={() => act(regenerateSeriesImage(draft.id, image.file))}>
              <RefreshCw className="size-4" />{t.regenerate}
            </Button>}
            {image.source === "generated" && !canRegenerate(image) && <small className="series-rec__muted">{t.regenerateUsed}</small>}
            <Button size="icon-sm" variant="ghost" disabled={busy || isRedrawing} onClick={() => act(deleteSeriesFile(draft.id, image.file))} aria-label={t.remove} title={t.removeHint}><Trash2 className="size-4" /></Button>
          </div>
          {lines.length > 0 && <div className="series-rec__frame-lines">
            <small>{t.onPicture} · {t.lines(lines.length)}</small>
            <blockquote>{lines.map((line, n) => <span key={n}>{line}</span>)}</blockquote>
          </div>}
        </li>;
      })}
      {Array.from({ length: generating + uploading }, (_, n) => {
        const lines = linesFor(draft.images.length + n);
        return <li key={`pending-${n}`}>
          <figure className="series-rec__frame is-drawing">
            <span className="series-rec__frame-wait" />
            <figcaption>{draft.images.length + n + 1}</figcaption>
            <span className="series-rec__frame-busy"><i aria-hidden="true" />{n < generating ? t.drawingFrame : t.uploadingFrame}</span>
          </figure>
          {lines.length > 0 && <div className="series-rec__frame-lines">
            <small>{t.onPicture} · {t.lines(lines.length)}</small>
            <blockquote>{lines.map((line, k) => <span key={k}>{line}</span>)}</blockquote>
          </div>}
        </li>;
      })}
    </ol>}
    {draft.images.length + generating + uploading === 0 && <p className="series-rec__empty-pictures">{t.noPictures}</p>}

    <footer className="series-rec__foot">
      <span />
      <Button onClick={onNext} disabled={!draft.images.length || busy}>{t.next}<ArrowRight className="size-4" /></Button>
    </footer>
  </div>;
}

function BuildStep({ draft, ownByline, onSaved, onError, onGo }: StepProps & { ownByline: boolean; onGo: (step: Step) => void }) {
  const t = useMessages(recorderMessages);
  const [copied, setCopied] = useState(false);
  const status = draft.status;
  const builds = status.state === "ready" ? status.builds : [];
  const kept = status.state === "ready" ? status.kept : 0;
  // Which version is on show; the kept one until another is picked to look at.
  const [shown, setShown] = useState<number | null>(null);
  const showing = Math.min(shown ?? kept, Math.max(0, builds.length - 1));
  const gaps = draftGaps(draft);
  const busy = status.state === "queued" || status.state === "processing";
  const currentStep = status.state === "processing" ? status.step : null;
  const order = ["audio", "listening", "pictures", "assembling"] as const;
  const canRebuild = builds.length < seriesLimits.builds;
  const build = builds[showing];
  const link = build ? `${window.location.origin}${linkOnlyPiecePath(build.token)}` : "";
  const failure = status.state === "failed" ? status.result : status.state === "ready" ? status.failure : undefined;

  const run = () => buildSeriesDraft(draft.id).then((next) => {
    setShown(null);
    onSaved(next);
  }, (e) => onError(errorText(e)));
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return <div className="series-rec__step series-rec__build">
    <div className="series-rec__build-main">
      {gaps.length > 0 && <p className="series-rec__notice">{t.missing(gaps.map((gap) => t.gaps[gap]).join(", "))}</p>}
      {!busy && status.state !== "ready" && !failure && <>
        <p className="series-rec__muted">{t.buildLead}</p>
        <Button size="lg" onClick={() => void run()} disabled={gaps.length > 0}>{t.build}</Button>
      </>}

      {busy && <ol className="series-rec__progress" aria-live="polite">
        {status.state === "queued" && <li className="is-current">{t.queued}</li>}
        {status.state === "processing" && order.map((name) => {
          const at = currentStep ? order.indexOf(currentStep) : -1;
          const index = order.indexOf(name);
          return <li key={name} className={index < at ? "is-done" : index === at ? "is-current" : ""}>
            {index < at ? <Check aria-hidden="true" /> : <i aria-hidden="true" />}{t.buildSteps[name]}
          </li>;
        })}
      </ol>}

      {!busy && failure && <BuildFailure result={failure} canRetry={canRebuild && !gaps.length} onRetry={() => void run()} onRecord={() => onGo("record")} />}

      {!busy && build && <section className="series-rec__result">
        <h3>{builds.length > 1 ? t.chooseVersion : t.built}</h3>
        {builds.length > 1 && <div className="series-rec__builds" role="tablist" aria-label={t.versions}>
          {builds.map((entry, index) => <button key={entry.token} type="button" role="tab" aria-selected={index === showing}
            className={index === showing ? "is-on" : ""} onClick={() => setShown(index)}>
            <strong>{t.buildVersion(index + 1)}</strong>
            <small>{clock(entry.result.durationMs ?? 0)}{index === kept ? ` · ${t.keptShort}` : ""}</small>
          </button>)}
        </div>}
        {builds.length > 1 && (showing === kept
          ? <p className="series-rec__kept"><Check aria-hidden="true" />{t.keptVersion}</p>
          : <Button onClick={() => updateSeriesDraft(draft.id, { keepBuild: showing }).then((next) => { setShown(null); onSaved(next); }, (e) => onError(errorText(e)))}>
            <Check className="size-4" />{t.keepThis}
          </Button>)}
        {status.state === "ready" && status.stale && canRebuild && <p className="series-rec__notice">{t.stale}</p>}
        {ownByline && <PublishOnPage draft={draft} keptToken={builds[kept]?.token ?? null} stale={status.state === "ready" && status.stale} onSaved={onSaved} onError={onError} />}
        <dl>
          <div><dt>{t.duration}</dt><dd>{clock(build.result.durationMs ?? 0)}</dd></div>
          <div><dt>{t.pictures}</dt><dd>{build.result.scenes}</dd></div>
        </dl>
        <div className="series-rec__link">
          <code>{link}</code>
          <Button size="sm" variant="outline" onClick={() => void copy()}><Copy className="size-4" />{copied ? t.copied : t.copy}</Button>
          <Button size="sm" asChild><a href={link} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />{t.open}</a></Button>
        </div>
        <p className="series-rec__muted">{t.linkNote}</p>
        {canRebuild
          ? <div className="series-rec__rebuild">
            <Button variant="outline" onClick={() => void run()} disabled={gaps.length > 0}><RotateCcw className="size-4" />{t.rebuild}</Button>
            <small>{t.rebuildRule}</small>
          </div>
          : <p className="series-rec__muted">{t.rebuildUsed}</p>}
      </section>}
    </div>
    {!busy && build && <figure className="series-rec__phone">
      {/* A real phone's width, shown smaller: the player lays itself out for 390 px, and opens behind the curtain. */}
      <span className="series-rec__phone-screen"><iframe key={`${build.token}-${build.result.finishedAt}`} src={`${linkOnlyPiecePath(build.token)}?curtain=1`} title={t.preview} allow="autoplay" /></span>
      <figcaption>{builds.length > 1 ? `${t.preview} · ${t.buildVersion(showing + 1)}` : t.preview}</figcaption>
    </figure>}
  </div>;
}

/** Why the last build did not come out: the service's trouble calmly, the take's plainly, with what to do. */
function BuildFailure({ result, canRetry, onRetry, onRecord }: { result: SeriesBuildResult; canRetry: boolean; onRetry: () => void; onRecord: () => void }) {
  const t = useMessages(recorderMessages);
  const code = result.errorCode ?? "unexpected";
  if (code === "quota" || code === "service" || code === "unexpected") {
    return <section className="series-rec__paused" role="status">
      <span className="series-rec__paused-icon" aria-hidden="true"><CloudOff /></span>
      <div>
        <h3>{t.paused}</h3>
        <p>{t.buildErrors[code]}</p>
        <Button variant="outline" onClick={onRetry} disabled={!canRetry}><RotateCcw className="size-4" />{t.tryAgain}</Button>
      </div>
    </section>;
  }
  return <section className="series-rec__result is-failed">
    <h3>{t.failed}</h3>
    <p>{t.buildErrors[code]}</p>
    <Differences missed={result.missed} extra={result.extra} />
    <div className="series-rec__actions">
      <Button variant="outline" onClick={onRecord}><Mic className="size-4" />{t.recordAgain}</Button>
      <Button onClick={onRetry} disabled={!canRetry}><RotateCcw className="size-4" />{t.tryAgain}</Button>
    </div>
  </section>;
}

function Differences({ missed, extra }: { missed?: string[]; extra?: string[] }) {
  const t = useMessages(recorderMessages);
  if (!missed?.length && !extra?.length) return null;
  return <details className="series-rec__diff">
    <summary>{t.heardDifferently}</summary>
    {missed?.length ? <p><span>{t.notHeard}:</span> {missed.join(", ")}</p> : null}
    {extra?.length ? <p><span>{t.notInText}:</span> {extra.join(", ")}</p> : null}
  </details>;
}

/** The allowance as marks, one a picture: drawn ones filled, the ones being drawn now pulsing. */
function Budget({ used, limit }: { used: number; limit: number }) {
  const t = useMessages(recorderMessages);
  return <span className="series-rec__budget" role="img" aria-label={t.budgetMeter(used, limit)}>
    <span className="series-rec__budget-marks">
      {Array.from({ length: limit }, (_, index) => <i key={index} className={index < used ? "is-used" : ""} />)}
    </span>
    <small>{t.budgetLeft(Math.max(0, limit - used), limit)}</small>
  </span>;
}

const feedbackSurface: Record<Step, FeedbackSurface> = {
  text: "series_text",
  record: "series_record",
  pictures: "series_pictures",
  build: "series_build",
};

/**
 * A word on this step, to the team: a quiet line under every step that opens
 * into a small box. The note lands in Studio → Feedback, marked with the step.
 */
function StepFeedback({ step }: { step: Step }) {
  const t = useMessages(recorderMessages);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const send = async () => {
    setState("sending");
    try {
      await sendBoksFeedback({ message: message.trim(), surface: feedbackSurface[step] });
      setState("sent");
      setMessage("");
    } catch {
      setState("failed");
    }
  };

  if (state === "sent") return <p className="series-rec__feedback is-sent" role="status"><Check aria-hidden="true" />{t.feedbackThanks}</p>;
  if (!open) {
    return <button type="button" className="series-rec__feedback-open" onClick={() => setOpen(true)}>
      <MessageCircle aria-hidden="true" /><span>{t.feedbackAsk}</span>
    </button>;
  }
  return <form className="series-rec__feedback" onSubmit={(event) => {
    event.preventDefault();
    if (message.trim().length >= 2) void send();
  }}>
    <label>
      <span>{t.feedbackTitle(t.steps[step])}</span>
      <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t.feedbackPlaceholder} rows={3} maxLength={2000} autoFocus />
    </label>
    {state === "failed" && <p className="series-rec__error">{t.feedbackFailed}</p>}
    <div className="series-rec__actions">
      <Button type="submit" size="sm" disabled={state === "sending" || message.trim().length < 2}>{state === "sending" ? t.feedbackSending : t.feedbackSend}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t.cancel}</Button>
    </div>
  </form>;
}

/**
 * An author's own Series goes straight onto their page: no review, the team
 * trusted them when it granted Boks Series (`publish_my_recorded_series`).
 * Published, it says so and links to the page; a different version kept
 * since can replace it.
 */
function PublishOnPage({ draft, keptToken, stale, onSaved, onError }: StepProps & { keptToken: string | null; stale: boolean }) {
  const t = useMessages(recorderMessages);
  const [busy, setBusy] = useState(false);
  const published = draft.published ?? null;
  const current = Boolean(published && published.token === keptToken);
  const publish = () => {
    setBusy(true);
    publishSeriesDraft(draft.id).then(onSaved, (e) => onError(errorText(e))).finally(() => setBusy(false));
  };
  const page = draft.ownerHandle ? `/@${draft.ownerHandle}` : "/author";
  if (current) {
    return <div className="series-rec__published" role="status">
      <span className="series-rec__published-mark" aria-hidden="true"><Check /></span>
      <span><strong>{t.publishedTitle}</strong><small>{t.publishedLead}</small></span>
      <Button size="sm" variant="outline" asChild><a href={page} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />{t.openMyPage}</a></Button>
    </div>;
  }
  return <div className="series-rec__publish">
    <span>
      <strong>{published ? t.replaceTitle : t.publishTitle}</strong>
      <small>{stale ? t.publishStale : published ? t.replaceLead : t.publishLead}</small>
    </span>
    <Button onClick={publish} disabled={busy || stale || !keptToken}>{busy ? t.publishing : published ? t.replace : t.publish}</Button>
  </div>;
}
