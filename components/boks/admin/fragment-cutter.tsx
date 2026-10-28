"use client";

import { useMemo, useRef, useState } from "react";
import { Copy, Download, Play, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { callFragmentModel, importStudyFragments } from "@/components/boks/supabase-browser-data";
import { readingWordsPerMinute } from "@/components/boks/reader-behavior";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { countWords } from "@/lib/boks/fragments/text";
import { checklist, type ChecklistKey } from "@/lib/boks/fragments/judge";
import {
  defaultStageModels,
  withCache,
  withConcurrency,
  withRetries,
  yandexConcurrency,
  yandexModels,
  type LlmCall,
  type LlmTask,
  type YandexModel,
} from "@/lib/boks/fragments/llm";
import {
  pipelineImportRows,
  runFragmentPipeline,
  strictnessBars,
  type PipelineFragment,
  type PipelineResult,
  type PipelineStage,
  type RejectedFragment,
  type Strictness,
} from "@/lib/boks/fragments/pipeline";

/**
 * Studio → Research → Cutter: a long work in, fragments that read on their
 * own out (`docs/fragment-cutter.md`). The pipeline runs here, in the
 * browser; only the model stages leave it, one task at a time, through the
 * Worker that holds the key. A work may yield fewer fragments than asked
 * for, or none, and the page says why.
 */

const words = defineMessages({
  stages: {
    structure: "Structure",
    lexical: "Lexical cohesion",
    markers: "Transition markers",
    candidates: "Candidates",
    scenes: "Scenes (model)",
    refine: "Edges (model)",
    judge: "Judge (model)",
    tournament: "Pairwise tournament (model)",
    rank: "Rank and accept",
  } as Record<PipelineStage, string>,
  checks: {
    names_who: "Names who",
    clear_setting: "Clear setting",
    has_event: "Something happens",
    self_explanatory: "Needs no backstory",
    closes_episode: "Closes the episode",
    no_open_question: "No open question",
  } as Record<ChecklistKey, string>,
  strictness: { lenient: "lenient", normal: "normal", strict: "strict" } as Record<Strictness, string>,
  untitled: "Untitled",
  stopped: "Stopped.",
  runFailed: "The run failed.",
  imported: (count: number, batch: string) => `${count} rows (fragments and their same-length windows) imported into Б3 batch “${batch}”.`,
  importFailed: "Could not import.",
  intro: "Paste or upload a long work. The cutter finds runs of whole paragraphs that read in 1–5 minutes, then a language model marks scenes, adjusts the edges, checks each candidate as a reader would and compares the best in pairs. The text is never edited: every fragment is a slice of what you give it. A work that does not cut well yields fewer fragments, or none, with the reason.",
  upload: "Upload .txt",
  workSize: (count: number, minutes: string) => `${count.toLocaleString("en")} words · ${minutes} min of reading`,
  pastePlaceholder: "…or paste the work here",
  workText: "Work text",
  title: "Title",
  author: "Author",
  language: "Language",
  languagePlaceholder: (detected: string) => `Language (auto: ${detected})`,
  fragments: "Fragments",
  fragmentsPerWork: "Fragments per work",
  strictnessLabel: "Strictness",
  useModel: "Use the language model",
  model: "Language model",
  modelStages: (calls: number) => `Model stages · up to ${calls} calls`,
  stageModel: (stage: string) => `${stage} model`,
  chunks: "chunks",
  sceneChunks: "Scene chunks",
  modelNote: "Alice AI marks scenes, edges and the checklist; gpt-oss-120b runs the tournament, because Alice picks the second of two fragments whichever it is.",
  cut: "Cut",
  stop: "Stop",
  statusOk: (count: number) => `${count} fragments`,
  statusPartial: (count: number) => `Only ${count} fragment${count === 1 ? "" : "s"}`,
  statusNone: "This work did not cut",
  workStats: (wordCount: number, paragraphs: number) => `${wordCount.toLocaleString("en")} words, ${paragraphs} paragraphs`,
  splitPieces: (count: number) => ` (+${count} pieces of long ones)`,
  candidateSpans: (count: string) => `, ${count} candidate spans`,
  usage: (calls: number, tokens: string) => ` · ${calls} model calls, ${tokens} tokens`,
  offline: " · offline",
  b3Rows: "Б3 rows",
  report: "Report",
  stagesHeading: "Stages",
  stageCalls: (calls: number, failed: number) => `${calls} calls${failed ? `, ${failed} unusable` : ""}`,
  seconds: (value: string) => `${value} s`,
  batch: "Б3 batch",
  importInto: "Import into Б3",
  windowNote: "with a same-length window per fragment",
  notKept: (count: number) => `Not kept (${count})`,
  cardMeta: (minutes: string, count: number) => `${minutes} min · ${count} words`,
  copyText: "Copy text",
  final: "Final",
  algorithm: "algorithm",
  judge: "judge",
  pairs: "pairs",
  edgesMoved: (first: number, last: number) => `Edges moved from ¶${first}–${last}:`,
  standalone: "Standalone",
  complete: "complete",
  opening: "opening",
  interest: "interest",
  b3Answers: "Б3 answers:",
  missing: "Missing:",
  text: "Text",
}, {
  ru: {
    stages: {
      structure: "Структура",
      lexical: "Лексическая связность",
      markers: "Маркеры перехода",
      candidates: "Кандидаты",
      scenes: "Сцены (модель)",
      refine: "Границы (модель)",
      judge: "Судья (модель)",
      tournament: "Попарный турнир (модель)",
      rank: "Ранжирование и отбор",
    },
    checks: {
      names_who: "Названо, кто",
      clear_setting: "Ясна обстановка",
      has_event: "Что-то происходит",
      self_explanatory: "Не нужна предыстория",
      closes_episode: "Эпизод закрыт",
      no_open_question: "Нет открытого вопроса",
    },
    strictness: { lenient: "мягкая", normal: "обычная", strict: "строгая" },
    untitled: "Без названия",
    stopped: "Остановлено.",
    runFailed: "Прогон не удался.",
    imported: (count, batch) =>
      `${count} ${plural("ru", count, { one: "строка", few: "строки", many: "строк", other: "строки" })} (фрагменты и окна той же длины) импортировано в партию Б3 «${batch}».`,
    importFailed: "Не удалось импортировать.",
    intro: "Вставьте или загрузите длинное произведение. Нарезка находит отрезки из целых абзацев, которые читаются за 1–5 минут, затем языковая модель размечает сцены, подправляет границы, проверяет каждого кандидата глазами читателя и сравнивает лучших попарно. Текст никогда не правится: каждый фрагмент — срез того, что вы дали. Произведение, которое плохо режется, даёт меньше фрагментов или ни одного, и причина указывается.",
    upload: "Загрузить .txt",
    workSize: (count, minutes) => `${count.toLocaleString("ru")} ${plural("ru", count, { one: "слово", few: "слова", many: "слов", other: "слова" })} · ${minutes} мин чтения`,
    pastePlaceholder: "…или вставьте произведение сюда",
    workText: "Текст произведения",
    title: "Название",
    author: "Автор",
    language: "Язык",
    languagePlaceholder: (detected) => `Язык (авто: ${detected})`,
    fragments: "Фрагменты",
    fragmentsPerWork: "Фрагментов на произведение",
    strictnessLabel: "Строгость",
    useModel: "Использовать языковую модель",
    model: "Языковая модель",
    modelStages: (calls) => `Этапы модели · до ${calls} ${plural("ru", calls, { one: "вызова", few: "вызовов", many: "вызовов", other: "вызовов" })}`,
    stageModel: (stage) => `${stage}: модель`,
    chunks: "куски",
    sceneChunks: "Куски для сцен",
    modelNote: "Alice AI размечает сцены, границы и чек-лист; gpt-oss-120b проводит турнир, потому что Alice выбирает второй из двух фрагментов, каким бы он ни был.",
    cut: "Нарезать",
    stop: "Стоп",
    statusOk: (count) => `${count} ${plural("ru", count, { one: "фрагмент", few: "фрагмента", many: "фрагментов", other: "фрагмента" })}`,
    statusPartial: (count) => `Только ${count} ${plural("ru", count, { one: "фрагмент", few: "фрагмента", many: "фрагментов", other: "фрагмента" })}`,
    statusNone: "Это произведение не нарезалось",
    workStats: (wordCount, paragraphs) => `${wordCount.toLocaleString("ru")} ${plural("ru", wordCount, { one: "слово", few: "слова", many: "слов", other: "слова" })}, ${paragraphs} ${plural("ru", paragraphs, { one: "абзац", few: "абзаца", many: "абзацев", other: "абзаца" })}`,
    splitPieces: (count) => ` (+${count} ${plural("ru", count, { one: "часть", few: "части", many: "частей", other: "части" })} длинных)`,
    candidateSpans: (count) => `, отрезков-кандидатов: ${count}`,
    usage: (calls, tokens) => ` · вызовов модели: ${calls}, токенов: ${tokens}`,
    offline: " · офлайн",
    b3Rows: "Строки Б3",
    report: "Отчёт",
    stagesHeading: "Этапы",
    stageCalls: (calls, failed) => `вызовов: ${calls}${failed ? `, непригодных: ${failed}` : ""}`,
    seconds: (value) => `${value} с`,
    batch: "Партия Б3",
    importInto: "Импортировать в Б3",
    windowNote: "с окном той же длины для каждого фрагмента",
    notKept: (count) => `Не оставлены (${count})`,
    cardMeta: (minutes, count) => `${minutes} мин · ${count} ${plural("ru", count, { one: "слово", few: "слова", many: "слов", other: "слова" })}`,
    copyText: "Копировать текст",
    final: "Итог",
    algorithm: "алгоритм",
    judge: "судья",
    pairs: "пары",
    edgesMoved: (first, last) => `Границы сдвинуты с ¶${first}–${last}:`,
    standalone: "Самостоятельность",
    complete: "завершённость",
    opening: "начало",
    interest: "интерес",
    b3Answers: "Ответы Б3:",
    missing: "Не хватает:",
    text: "Текст",
  },
});

type ModelStage = LlmTask["stage"];

export function FragmentCutter() {
  const t = useMessages(words);
  const uiLanguage = useUiLanguage();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [language, setLanguage] = useState("");
  const [perWork, setPerWork] = useState(5);
  const [strictness, setStrictness] = useState<Strictness>("normal");
  const [useModel, setUseModel] = useState(true);
  const [stages, setStages] = useState({ scenes: true, refine: true, judge: true, tournament: true });
  const [models, setModels] = useState<Record<ModelStage, YandexModel>>(defaultStageModels);
  const [sceneCalls, setSceneCalls] = useState(16);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ stage: PipelineStage; done: number; total: number } | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState("");
  const [batch, setBatch] = useState("");
  const [note, setNote] = useState("");
  const abort = useRef<AbortController | null>(null);

  const wordCount = useMemo(() => countWords(text), [text]);
  const detectedLanguage = useMemo(() => {
    const sample = text.slice(0, 20_000);
    const cyrillic = (sample.match(/[а-яё]/giu) ?? []).length;
    const latin = (sample.match(/[a-z]/gi) ?? []).length;
    return cyrillic >= latin ? "ru" : "en";
  }, [text]);
  const pool = Math.min(24, perWork * 3);
  const callEstimate = useModel
    ? (stages.scenes ? sceneCalls : 0) + (stages.refine ? pool : 0) + (stages.judge ? pool : 0) + (stages.tournament ? 3 * Math.min(10, Math.max(6, perWork * 2)) : 0)
    : 0;

  async function loadFile(file: File) {
    const bytes = await file.arrayBuffer();
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      // Russian texts from older sites come in Windows-1251.
      decoded = new TextDecoder("windows-1251").decode(bytes);
    }
    setText(decoded);
    setFileName(file.name);
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
    setResult(null);
  }

  async function run() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError("");
    setNote("");
    setResult(null);
    setProgress(null);
    const llm: LlmCall | undefined = useModel
      ? withCache(withConcurrency(withRetries((task) => callFragmentModel(models[task.stage], task, controller.signal)), yandexConcurrency))
      : undefined;
    try {
      // Let the spinner paint before the offline stages take the thread.
      await new Promise((resolve) => setTimeout(resolve, 30));
      const outcome = await runFragmentPipeline(
        { sourceTitle: title.trim() || t.untitled, sourceAuthor: author.trim(), language: language.trim() || detectedLanguage, text },
        {
          perWork,
          llm,
          strictness,
          maxSceneCalls: sceneCalls,
          stages,
          signal: controller.signal,
          uiLanguage,
          onProgress: (event) => setProgress(event),
        },
      );
      setResult(outcome);
      if (!batch) setBatch(`cutter-${new Date().toISOString().slice(0, 10)}`);
    } catch (reason) {
      setError(reason instanceof Error && reason.name === "AbortError" ? t.stopped : reason instanceof Error ? reason.message : t.runFailed);
    } finally {
      setRunning(false);
      abort.current = null;
    }
  }

  async function importRows() {
    if (!result) return;
    setNote("");
    try {
      const count = await importStudyFragments(batch.trim(), pipelineImportRows(result) as unknown as Record<string, unknown>[]);
      setNote(t.imported(count, batch.trim()));
    } catch (reason) {
      setNote(reason instanceof Error ? reason.message : t.importFailed);
    }
  }

  return (
    <section className="grid gap-5">
      <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">{t.intro}</p>

      <div className="panel grid gap-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <Upload className="size-4" /> {t.upload}
            <input type="file" accept=".txt,text/plain" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); }} />
          </label>
          {fileName && <span className="text-sm text-[var(--muted-foreground)]">{fileName}</span>}
          <span className="text-sm text-[var(--muted-foreground)]">
            {t.workSize(wordCount, (wordCount / readingWordsPerMinute).toFixed(0))}
          </span>
        </div>
        <Textarea className="min-h-48 font-mono text-xs" value={text} spellCheck={false} placeholder={t.pastePlaceholder} onChange={(event) => { setText(event.target.value); setResult(null); }} aria-label={t.workText} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input placeholder={t.title} value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t.title} />
          <Input placeholder={t.author} value={author} onChange={(event) => setAuthor(event.target.value)} aria-label={t.author} />
          <Input placeholder={t.languagePlaceholder(detectedLanguage)} value={language} onChange={(event) => setLanguage(event.target.value)} aria-label={t.language} />
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            {t.fragments}
            <Input type="number" min={1} max={10} className="w-20" value={perWork} onChange={(event) => setPerWork(Math.min(10, Math.max(1, Number(event.target.value) || 1)))} aria-label={t.fragmentsPerWork} />
          </label>
          <label className="flex items-center gap-2">
            {t.strictnessLabel}
            <select className="field-control" value={strictness} onChange={(event) => setStrictness(event.target.value as Strictness)} aria-label={t.strictnessLabel}>
              {(Object.keys(strictnessBars) as Strictness[]).map((level) => <option key={level} value={level}>{t.strictness[level]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={useModel} onCheckedChange={setUseModel} aria-label={t.useModel} /> {t.model}
          </label>
        </div>

        {useModel && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">{t.modelStages(callEstimate)}</summary>
            <div className="mt-3 grid gap-2 text-sm">
              {(["scenes", "refine", "judge", "tournament"] as const).map((stage) => (
                <div key={stage} className="flex flex-wrap items-center gap-3">
                  <Switch checked={stages[stage]} onCheckedChange={(on) => setStages((value) => ({ ...value, [stage]: on }))} aria-label={t.stages[stage]} />
                  <span className="w-56">{t.stages[stage]}</span>
                  <select className="field-control" value={models[stage]} disabled={!stages[stage]} onChange={(event) => setModels((value) => ({ ...value, [stage]: event.target.value as YandexModel }))} aria-label={t.stageModel(t.stages[stage])}>
                    {yandexModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                  {stage === "scenes" && (
                    <label className="flex items-center gap-2">
                      {t.chunks}
                      <Input type="number" min={1} max={40} className="w-20" value={sceneCalls} onChange={(event) => setSceneCalls(Math.min(40, Math.max(1, Number(event.target.value) || 1)))} aria-label={t.sceneChunks} />
                    </label>
                  )}
                </div>
              ))}
              <p className="text-[var(--muted-foreground)]">{t.modelNote}</p>
            </div>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <Button disabled={wordCount === 0} onClick={() => void run()}><Play /> {t.cut}</Button>
          ) : (
            <Button variant="outline" onClick={() => abort.current?.abort()}><Square /> {t.stop}</Button>
          )}
          {running && progress && (
            <span className="text-sm" role="status">
              {t.stages[progress.stage]}{progress.total > 1 ? ` ${progress.done}/${progress.total}` : ""}…
            </span>
          )}
          {error && <span className="text-sm text-[var(--destructive)]" role="alert">{error}</span>}
        </div>
      </div>

      {result && <CutterResult result={result} batch={batch} setBatch={setBatch} onImport={() => void importRows()} note={note} />}
    </section>
  );
}

function CutterResult({ result, batch, setBatch, onImport, note }: {
  result: PipelineResult;
  batch: string;
  setBatch: (value: string) => void;
  onImport: () => void;
  note: string;
}) {
  const t = useMessages(words);
  const uiLanguage = useUiLanguage();
  const statusText = {
    ok: t.statusOk(result.fragments.length),
    partial: t.statusPartial(result.fragments.length),
    none: t.statusNone,
  }[result.status];

  return (
    <div className="grid gap-4">
      <div className="panel grid gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="studio-eyebrow">{result.work.sourceTitle}{result.work.sourceAuthor ? ` · ${result.work.sourceAuthor}` : ""}</p>
            <h3 className="text-xl font-semibold tracking-normal">{statusText}</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t.workStats(result.stats.words, result.stats.paragraphs)}
              {result.stats.splitParagraphs ? t.splitPieces(result.stats.splitParagraphs) : ""}{t.candidateSpans(result.stats.candidates.toLocaleString(uiLanguage))}
              {result.usage.calls ? t.usage(result.usage.calls, (result.usage.promptTokens + result.usage.completionTokens).toLocaleString(uiLanguage)) : t.offline}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => download(`${slug(result.work.sourceTitle)}-b3.json`, pipelineImportRows(result))}><Download /> {t.b3Rows}</Button>
            <Button variant="outline" size="sm" onClick={() => download(`${slug(result.work.sourceTitle)}-report.json`, reportOf(result))}><Download /> {t.report}</Button>
          </div>
        </div>
        {result.diagnosis.length > 0 && (
          <ul className="list-disc pl-5 text-sm">{result.diagnosis.map((line) => <li key={line}>{line}</li>)}</ul>
        )}
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t.stagesHeading}</summary>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {result.stages.map((stage) => (
                <tr key={stage.stage} className="border-t border-[var(--border)]">
                  <td className="py-1 font-medium">{t.stages[stage.stage]}</td>
                  <td className="py-1">{stage.note}</td>
                  <td className="py-1 text-right">{stage.calls ? t.stageCalls(stage.calls, stage.failed) : ""}</td>
                  <td className="py-1 text-right">{t.seconds((stage.ms / 1000).toFixed(1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        {result.fragments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Input className="w-56" value={batch} onChange={(event) => setBatch(event.target.value)} aria-label={t.batch} />
            <Button size="sm" disabled={!batch.trim()} onClick={onImport}>{t.importInto}</Button>
            <span className="text-[var(--muted-foreground)]">{t.windowNote}</span>
          </div>
        )}
        {note && <p className="text-sm" role="status">{note}</p>}
      </div>

      {result.fragments.map((fragment) => <FragmentCard key={fragment.start} fragment={fragment} source={result.work.text} />)}

      {result.rejected.length > 0 && (
        <details className="panel p-4">
          <summary className="cursor-pointer text-sm font-medium">{t.notKept(result.rejected.length)}</summary>
          <div className="mt-3 grid gap-3">
            {result.rejected.map((fragment) => <FragmentCard key={fragment.start} fragment={fragment} source={result.work.text} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function FragmentCard({ fragment, source }: { fragment: PipelineFragment | RejectedFragment; source: string }) {
  const t = useMessages(words);
  const body = source.slice(fragment.start, fragment.end);
  const judgement = fragment.judgement;
  const rank = "rank" in fragment ? fragment.rank : null;
  const reasons = "reasons" in fragment ? fragment.reasons : null;
  return (
    <article className="panel grid gap-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="studio-eyebrow">
            {rank ? `#${rank} · ` : ""}{t.cardMeta(fragment.minutes.toFixed(1), fragment.words)} · ¶{fragment.firstParagraph}–{fragment.lastParagraph}
          </p>
          <h4 className="font-semibold">{judgement?.title || firstLine(body)}</h4>
        </div>
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(body)}><Copy /> {t.copyText}</Button>
      </div>
      <p className="text-sm">
        {t.final} {fragment.scores.final.toFixed(2)} · {t.algorithm} {fragment.scores.algorithmNormalised.toFixed(2)}
        {fragment.scores.judge !== null && ` · ${t.judge} ${fragment.scores.judge.toFixed(2)}`}
        {fragment.scores.tournament !== null && ` · ${t.pairs} ${fragment.scores.tournament.toFixed(2)}`}
        {fragment.candidate.cues.length > 0 && ` · ${fragment.candidate.cues.join(", ").replaceAll("_", " ")}`}
      </p>
      {reasons && <p className="text-sm text-[var(--destructive)]">{reasons.join("; ")}</p>}
      {fragment.refinedFrom && (
        <p className="text-sm text-[var(--muted-foreground)]">
          {t.edgesMoved(fragment.refinedFrom.firstParagraph, fragment.refinedFrom.lastParagraph)} {fragment.refinedFrom.reason}
        </p>
      )}
      {judgement && (
        <>
          <p className="text-sm">{judgement.summary}</p>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.standalone} {judgement.standalone.toFixed(1)} · {t.complete} {judgement.complete.toFixed(1)} · {t.opening} {judgement.opening.toFixed(1)} · {t.interest} {judgement.interest.toFixed(1)}
            {" · "}{t.b3Answers} {judgement.verdict.standalone} / {judgement.verdict.complete}
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(checklist) as ChecklistKey[]).map((key) => (
              <span key={key} className="rounded bg-[var(--muted)] px-2 py-1" title={checklist[key]}>
                {judgement.checks[key] ? "✓" : "✗"} {t.checks[key]}
              </span>
            ))}
          </div>
          {judgement.missingContext.length > 0 && <p className="text-sm text-[var(--muted-foreground)]">{t.missing} {judgement.missingContext.join("; ")}</p>}
          {judgement.reason && <p className="text-sm text-[var(--muted-foreground)]">{judgement.reason}</p>}
        </>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">{t.text}</summary>
        <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm">{body}</div>
      </details>
    </article>
  );
}

function reportOf(result: PipelineResult) {
  const strip = (fragment: PipelineFragment | RejectedFragment) => {
    // The candidate repeats the offsets; the body is what a reader of the report wants.
    const { candidate, ...rest } = fragment;
    return { ...rest, cues: candidate.cues, body: result.work.text.slice(fragment.start, fragment.end) };
  };
  return {
    work: { title: result.work.sourceTitle, author: result.work.sourceAuthor, language: result.work.language },
    status: result.status,
    diagnosis: result.diagnosis,
    stats: result.stats,
    usage: result.usage,
    stages: result.stages,
    scenes: result.scenes?.scenes ?? null,
    fragments: result.fragments.map(strip),
    rejected: result.rejected.map(strip),
  };
}

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "work";
}

function firstLine(body: string) {
  const line = body.trim().split(/\n/)[0];
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
