"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Story } from "@/components/boks/client-types";
import {
  deleteStudyFragmentBatch,
  importStudyFragments,
  listStudies,
  listStudyFragments,
  loadStudyBoks,
  loadStudyResponses,
  setStudyEnabled,
  setStudyMaterials,
  type StudyAdminRow,
} from "@/components/boks/supabase-browser-data";
import { StudyFormGallery } from "@/components/boks/admin/study-form-gallery";
import { materialBokIds, materialTemplates, parseStudyMaterials, seriesBokIds, type StudyMaterials } from "@/lib/boks/studies/materials";
import { isSeriesBok } from "@/components/boks/studies/study-series";
import { poemManifestFor } from "@/components/boks/poetry/poems";
import { studyConditions, studyDescription, studyPath, type StudyKey } from "@/lib/boks/studies/protocol";
import { studyResponsesCsv, summariseStudy, type StudySummary } from "@/lib/boks/studies/results";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const words = defineMessages({
  loading: "Loading…",
  loadStudiesFailed: "Could not load the studies.",
  view: "View",
  studies: "Studies",
  forms: "Participant forms",
  refresh: "Refresh",
  intro: "Every study starts switched off. Until it is on, its link shows “this study is not running” and nothing can be written. Choose its texts, look at it with Preview (nothing is saved), then switch it on.",
  chooseFirst: (problems: string) => `Choose the study's texts first: ${problems}`,
  switchFailed: "Could not switch the study.",
  teamHypothesis: "team hypothesis",
  runningLabel: (label: string) => `${label} running`,
  running: "Running",
  off: "Off",
  copied: "Copied",
  copyLink: "Copy link",
  preview: "Preview",
  participants: (participants: number, completed: number) => `${participants} participant${participants === 1 ? "" : "s"}, ${completed} finished`,
  answers: (count: number) => ` · ${count} answers`,
  last: (when: string) => ` · last ${when}`,
  textsAndSettings: "Texts and settings",
  notReady: "· not ready",
  fragmentsImported: (count: number) => `Fragments · ${count} imported`,
  results: "Results",
  materialHelp: {
    rg1: "familiarization: a Series piece shown first in both formats. targets: Series pieces; each participant gets one, in their assigned format.",
    rg2: "minutes: each session's length; everyone has a feed session and a catalogue session, in the assigned order. poolSize: texts per session - twice as many are drawn from the participant's own feed and split by alternating ranks, so the two sessions never share a text.",
    a1: "pairs: at least 4 of { whole, fragment } of similar length (±10%), theme and difficulty. choices: a separate pool, at least two of each kind ({ bokId, kind }); each participant sees one of each, unlabelled, and a refusal. Closure is asked after choosing.",
    a2: "setA and setB: comparable lists of the same size, in the order the feed shows them. minutes: each session's length.",
    a3: "targets: the test pool, at least perParticipant + profileSize boks with semantic vectors, by many authors; none is served while the profile forms. profileSize: rated boks that fix the profile (5). perParticipant: new texts rated after it (10). feedPoolSize: how much of the participant's own feed the profile is formed from.",
    b1: "pieces: immersive poems with gesture scenes. perParticipant: how many each participant reads; their roles follow the recorded traces.",
    b2: "setA and setB: two comparable sets of unfamiliar plain texts of the same size, similar genre and length. minutes: each block's length (5); everyone reads one block with music and one in silence.",
    b3: "batch: the imported fragment batch to rate; empty rates every fragment.",
  } as Record<StudyKey, string>,
  bokIds: "Bok ids are the ones in a bok's link (/b/<id>).",
  notJson: "Not JSON.",
  notPublished: (id: string) => `${id} is not a published bok.`,
  notSeries: (id: string, poem: boolean) => `${id} is not ${poem ? "an immersive poem" : "a Series piece"}.`,
  uneven: (index: number, whole: number, fragment: number) => `pairs[${index}]: ${whole} against ${fragment} words differ by more than 10%.`,
  saved: "Saved.",
  saveFailed: "Could not save.",
  materialsJson: "Materials as JSON",
  check: "Check",
  save: "Save",
  switchOffFirst: "Switch the study off to change its texts: running participants would get a different plan.",
  bokLine: (title: string, author: string, count: number) => `${title} — ${author}, ${count} words`,
  unpublished: "not published",
  pasteArray: "Paste a JSON array of fragments.",
  imported: (count: number, batch: string) => `${count} fragments imported into “${batch}”.`,
  importFailed: "Could not import.",
  removed: (count: number, batch: string) => `${count} unrated fragments removed from “${batch}”. Rated ones stay: their answers are data.`,
  removeFailed: "Could not remove.",
  importHelpBefore: "A JSON array from the fragment prototype:",
  importHelpAfter: "The text is stored verbatim. Raters never see the method; same-length windows from the same books are the comparison.",
  batchPlaceholder: "Batch name, e.g. pilot-1",
  batch: "Batch",
  fragmentsJson: "Fragments as JSON",
  import: "Import",
  batchCounts: (algorithm: number, window: number) => `${algorithm} algorithm, ${window} window`,
  removeUnrated: "Remove unrated",
  loadResultsFailed: "Could not load the results.",
  reload: "Reload",
  compute: "Compute",
  includeTeam: "Include the team's own runs",
  summary: (participants: number, completed: number) => `${participants} participants, ${completed} finished`,
  measure: "Measure",
  control: "Control",
  variant: "Variant",
  effect: "Effect",
  interval: "95% interval",
  threshold: "Threshold",
  needs: (count: number) => `needs ${count} an arm`,
  met: " · met",
  notMet: " · not met",
  fragment: "Fragment",
  method: "Method",
  methods: { algorithm: "algorithm", window: "window" },
  ratings: "Ratings",
  yesToBoth: "Yes to both",
  accepted: "Accepted",
  yes: "yes",
  no: "no",
}, {
  ru: {
    loading: "Загрузка…",
    loadStudiesFailed: "Не удалось загрузить исследования.",
    view: "Вид",
    studies: "Исследования",
    forms: "Формы участника",
    refresh: "Обновить",
    intro: "Каждое исследование сначала выключено. Пока оно не включено, его ссылка показывает «это исследование не проводится», и ничего записать нельзя. Выберите тексты, посмотрите его через «Предпросмотр» (ничего не сохраняется), затем включите.",
    chooseFirst: (problems) => `Сначала выберите тексты исследования: ${problems}`,
    switchFailed: "Не удалось переключить исследование.",
    teamHypothesis: "гипотеза команды",
    runningLabel: (label) => `${label} идёт`,
    running: "Идёт",
    off: "Выключено",
    copied: "Скопировано",
    copyLink: "Копировать ссылку",
    preview: "Предпросмотр",
    participants: (participants, completed) =>
      `${participants} ${plural("ru", participants, { one: "участник", few: "участника", many: "участников", other: "участника" })}, завершили ${completed}`,
    answers: (count) => ` · ${count} ${plural("ru", count, { one: "ответ", few: "ответа", many: "ответов", other: "ответа" })}`,
    last: (when) => ` · последний ${when}`,
    textsAndSettings: "Тексты и настройки",
    notReady: "· не готово",
    fragmentsImported: (count) => `Фрагменты · импортировано ${count}`,
    results: "Результаты",
    materialHelp: {
      rg1: "familiarization: произведение серии, которое показывают первым в обоих форматах. targets: произведения серии; каждый участник получает одно в назначенном ему формате.",
      rg2: "minutes: длина каждой сессии; у каждого есть сессия в ленте и сессия в каталоге, в назначенном порядке. poolSize: текстов на сессию; из собственной ленты участника берётся вдвое больше и делится по чередующимся позициям, так что у двух сессий нет общих текстов.",
      a1: "pairs: не меньше 4 пар { whole, fragment } близкой длины (±10%), темы и сложности. choices: отдельный набор, не меньше двух каждого вида ({ bokId, kind }); участнику показываем по одному без меток и вариант отказа. Завершённость спрашиваем после выбора.",
      a2: "setA и setB: сопоставимые списки одного размера, в порядке показа в ленте. minutes: длина каждой сессии.",
      a3: "targets: тестовый пул, не меньше perParticipant + profileSize боков с семантическими векторами, от многих авторов; пока формируется профиль, ни один из них не показывается. profileSize: оценённые боки, которые фиксируют профиль (5). perParticipant: новые тексты, оцениваемые после него (10). feedPoolSize: из какой части собственной ленты участника формируется профиль.",
      b1: "pieces: иммерсивные стихи со сценами жестов. perParticipant: сколько читает каждый участник; роли следуют записанным трекам.",
      b2: "setA и setB: два сопоставимых набора незнакомых обычных текстов одного размера, похожих по жанру и длине. minutes: длина блока (5); каждый читает один блок с музыкой и один в тишине.",
      b3: "batch: импортированная партия фрагментов для оценки; пусто — оцениваются все фрагменты.",
    },
    bokIds: "Id бока — тот, что в его ссылке (/b/<id>).",
    notJson: "Это не JSON.",
    notPublished: (id) => `${id} не опубликованный бок.`,
    notSeries: (id, poem) => `${id} не ${poem ? "иммерсивный стих" : "произведение серии"}.`,
    uneven: (index, whole, fragment) => `pairs[${index}]: ${whole} против ${fragment} слов, разница больше 10%.`,
    saved: "Сохранено.",
    saveFailed: "Не удалось сохранить.",
    materialsJson: "Материалы в JSON",
    check: "Проверить",
    save: "Сохранить",
    switchOffFirst: "Чтобы поменять тексты, выключите исследование: идущие участники получили бы другой план.",
    bokLine: (title, author, count) => `${title} — ${author}, ${count} ${plural("ru", count, { one: "слово", few: "слова", many: "слов", other: "слова" })}`,
    unpublished: "не опубликован",
    pasteArray: "Вставьте JSON-массив фрагментов.",
    imported: (count, batch) =>
      `${count} ${plural("ru", count, { one: "фрагмент импортирован", few: "фрагмента импортировано", many: "фрагментов импортировано", other: "фрагмента импортировано" })} в «${batch}».`,
    importFailed: "Не удалось импортировать.",
    removed: (count, batch) => `Из «${batch}» удалено неоценённых фрагментов: ${count}. Оценённые остаются: их ответы — данные.`,
    removeFailed: "Не удалось удалить.",
    importHelpBefore: "JSON-массив из прототипа фрагментов:",
    importHelpAfter: "Текст сохраняется дословно. Оценщики никогда не видят способ; сравнение идёт с окнами той же длины из тех же книг.",
    batchPlaceholder: "Название партии, например pilot-1",
    batch: "Партия",
    fragmentsJson: "Фрагменты в JSON",
    import: "Импортировать",
    batchCounts: (algorithm, window) => `алгоритм: ${algorithm}, окно: ${window}`,
    removeUnrated: "Удалить неоценённые",
    loadResultsFailed: "Не удалось загрузить результаты.",
    reload: "Пересчитать",
    compute: "Посчитать",
    includeTeam: "Учитывать прогоны команды",
    summary: (participants, completed) =>
      `${participants} ${plural("ru", participants, { one: "участник", few: "участника", many: "участников", other: "участника" })}, завершили ${completed}`,
    measure: "Мера",
    control: "Контроль",
    variant: "Вариант",
    effect: "Эффект",
    interval: "95% интервал",
    threshold: "Порог",
    needs: (count) => `нужно ${count} на вариант`,
    met: " · достигнут",
    notMet: " · не достигнут",
    fragment: "Фрагмент",
    method: "Способ",
    methods: { algorithm: "алгоритм", window: "окно" },
    ratings: "Оценки",
    yesToBoth: "«Да» на оба",
    accepted: "Принят",
    yes: "да",
    no: "нет",
  },
});

/**
 * Studies: the controlled tests behind the thesis hypotheses
 * (`docs/studies.md`).
 *
 * Each study has one switch. Off - the default - its participant page says
 * no study is running and the database refuses every answer; the link can be
 * printed and handed out before it starts. A study can be switched on only
 * with materials its protocol can use. Switching off stops new participants
 * and answers and keeps what was collected.
 *
 * Results are computed here from the raw answers (`lib/boks/studies/results.ts`)
 * with the team's own runs left out unless asked for; the export is the raw
 * answers for any other analysis.
 */
export function AdminStudies() {
  const t = useMessages(words);
  const [view, setView] = useState<"studies" | "forms">("studies");
  const [studies, setStudies] = useState<StudyAdminRow[] | null>(null);
  // null until the first load answers, so "Loading…" follows the language.
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStudies(await listStudies());
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.loadStudiesFailed);
    }
  }, [t]);

  useEffect(() => {
    const handle = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="admin-segmented" aria-label={t.view}>
          <button type="button" aria-pressed={view === "studies"} onClick={() => setView("studies")}>{t.studies}</button>
          <button type="button" aria-pressed={view === "forms"} onClick={() => setView("forms")}>{t.forms}</button>
        </div>
        {view === "studies" && (
          <Button variant="outline" onClick={() => void refresh()}><RefreshCw className="size-4" /> {t.refresh}</Button>
        )}
      </div>
      {view === "forms" ? (
        <StudyFormGallery />
      ) : (
        <>
          <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">{t.intro}</p>
          {status !== "" && <p className="text-sm text-[var(--muted-foreground)]" role="status">{status ?? t.loading}</p>}
          {studies?.map((study) => <StudyPanel key={study.key} study={study} onChange={refresh} />)}
        </>
      )}
    </section>
  );
}

function StudyPanel({ study, onChange }: { study: StudyAdminRow; onChange: () => Promise<void> }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const description = studyDescription(study.key, language);
  const parsed = parseStudyMaterials(study.key, study.materials, language);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? studyPath(study.key) : `${window.location.origin}${studyPath(study.key)}`;

  async function toggle(enabled: boolean) {
    if (enabled && !parsed.ok) {
      setNote(t.chooseFirst(parsed.problems.join(" ")));
      return;
    }
    setBusy(true);
    setNote("");
    try {
      await setStudyEnabled(study.key, enabled);
      await onChange();
    } catch (error) {
      setNote(error instanceof Error ? error.message : t.switchFailed);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNote(url);
    }
  }

  return (
    <article className="panel grid gap-4 p-4" aria-labelledby={`study-${study.key}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="studio-eyebrow">{description.label} · {description.owner === "team" ? t.teamHypothesis : description.owner}</p>
          <h2 id={`study-${study.key}`} className="text-xl font-semibold tracking-normal">{description.title}</h2>
          <p className="mt-1 text-sm">{description.comparison}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description.outcome}</p>
        </div>
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={study.enabled} disabled={busy} onCheckedChange={(checked) => void toggle(checked)} aria-label={t.runningLabel(description.label)} />
          {study.enabled ? t.running : t.off}
        </label>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="rounded bg-[var(--muted)] px-2 py-1">{studyPath(study.key)}</code>
        <Button variant="outline" size="sm" onClick={() => void copy()}><Copy className="size-4" /> {copied ? t.copied : t.copyLink}</Button>
        {studyConditions[study.key].map((condition) => (
          <Button key={condition} variant="outline" size="sm" asChild>
            <a href={`${studyPath(study.key)}?preview=1&condition=${condition}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" /> {t.preview}{studyConditions[study.key].length > 1 ? `: ${condition}` : ""}
            </a>
          </Button>
        ))}
      </div>

      <p className="text-sm text-[var(--muted-foreground)]">
        {t.participants(study.participants, study.completed)}
        {Object.keys(study.byCondition).length > 0 && ` · ${Object.entries(study.byCondition).map(([condition, count]) => `${condition}: ${count}`).join(", ")}`}
        {t.answers(study.responses)}
        {study.lastResponseAt && t.last(new Date(study.lastResponseAt).toLocaleString(language))}
      </p>

      {note && <p className="text-sm text-[var(--muted-foreground)]" role="status">{note}</p>}

      <details>
        <summary className="cursor-pointer text-sm font-medium">{t.textsAndSettings} {parsed.ok ? "" : t.notReady}</summary>
        <MaterialsEditor study={study} onSaved={onChange} />
      </details>

      {study.key === "b3" && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t.fragmentsImported(study.fragments ?? 0)}</summary>
          <FragmentImport onChange={onChange} />
        </details>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium">{t.results}</summary>
        <StudyResults studyKey={study.key} />
      </details>
    </article>
  );
}

function MaterialsEditor({ study, onSaved }: { study: StudyAdminRow; onSaved: () => Promise<void> }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const initial = Object.keys(study.materials).length ? study.materials : materialTemplates[study.key];
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [problems, setProblems] = useState<string[]>([]);
  const [titles, setTitles] = useState<{ id: string; story: Story | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  function parse() {
    try {
      return { raw: JSON.parse(text) as unknown, error: "" };
    } catch (error) {
      return { raw: null, error: error instanceof Error ? error.message : t.notJson };
    }
  }

  async function check() {
    const { raw, error } = parse();
    if (error) {
      setProblems([error]);
      return null;
    }
    const parsed = parseStudyMaterials(study.key, raw, language);
    const ids = materialBokIds(study.key, raw);
    const stories = await loadStudyBoks(ids);
    const byId = new Map(stories.map((story) => [story.id, story]));
    const resolved = ids.map((id) => ({ id, story: byId.get(id) ?? null }));
    setTitles(resolved);
    const unpublished = resolved.filter((entry) => !entry.story).map((entry) => t.notPublished(entry.id));
    // b1 replays gestures, which only the immersive poems have.
    const notSeries = seriesBokIds(study.key, raw)
      .filter((id) => (study.key === "b1" ? !poemManifestFor(id) : !isSeriesBok(id)))
      .map((id) => t.notSeries(id, study.key === "b1"));
    // a1: a pair is comparable only at a similar length - within 10% in words.
    const uneven = study.key === "a1" && parsed.ok
      ? (parsed.materials as StudyMaterials["a1"]).pairs.flatMap((pair, index) => {
          const whole = byId.get(pair.whole)?.wordCount ?? 0;
          const fragment = byId.get(pair.fragment)?.wordCount ?? 0;
          if (!whole || !fragment) return [];
          return Math.abs(whole - fragment) / Math.max(whole, fragment) > 0.1
            ? [t.uneven(index, whole, fragment)]
            : [];
        })
      : [];
    const all = [...parsed.problems, ...unpublished, ...notSeries, ...uneven];
    setProblems(all);
    return all.length ? null : (raw as Record<string, unknown>);
  }

  async function save() {
    setBusy(true);
    setNote("");
    try {
      const materials = await check();
      if (!materials) return;
      await setStudyMaterials(study.key, materials);
      setNote(t.saved);
      await onSaved();
    } catch (error) {
      setNote(error instanceof Error ? error.message : t.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3">
      <p className="text-sm text-[var(--muted-foreground)]">{t.materialHelp[study.key]} {t.bokIds}</p>
      <Textarea className="min-h-56 font-mono text-xs" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} aria-label={t.materialsJson} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void check()}>{t.check}</Button>
        <Button disabled={busy || study.enabled} onClick={() => void save()}>{t.save}</Button>
        {study.enabled && <span className="self-center text-sm text-[var(--muted-foreground)]">{t.switchOffFirst}</span>}
      </div>
      {note && <p className="text-sm" role="status">{note}</p>}
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-[var(--destructive)]">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      )}
      {titles && titles.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {titles.map((entry) => (
            <li key={entry.id}>
              <code className="text-xs">{entry.id.slice(0, 8)}</code>{" "}
              {entry.story ? t.bokLine(entry.story.title, entry.story.authorName, entry.story.wordCount) : t.unpublished}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FragmentImport({ onChange }: { onChange: () => Promise<void> }) {
  const t = useMessages(words);
  const [batch, setBatch] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<Record<string, { algorithm: number; window: number }> | null>(null);

  const loadBatches = useCallback(async () => {
    const rows = await listStudyFragments();
    const counts: Record<string, { algorithm: number; window: number }> = {};
    for (const row of rows) {
      counts[row.batch] ??= { algorithm: 0, window: 0 };
      counts[row.batch][row.method] += 1;
    }
    setBatches(counts);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void loadBatches().catch(() => undefined), 0);
    return () => window.clearTimeout(handle);
  }, [loadBatches]);

  async function submit() {
    setBusy(true);
    setNote("");
    try {
      const rows = JSON.parse(text) as unknown;
      if (!Array.isArray(rows)) throw new Error(t.pasteArray);
      const count = await importStudyFragments(batch, rows as Record<string, unknown>[]);
      setNote(t.imported(count, batch));
      setText("");
      await loadBatches();
      await onChange();
    } catch (error) {
      setNote(error instanceof Error ? error.message : t.importFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    try {
      const removed = await deleteStudyFragmentBatch(name);
      setNote(t.removed(removed, name));
      await loadBatches();
      await onChange();
    } catch (error) {
      setNote(error instanceof Error ? error.message : t.removeFailed);
    }
  }

  return (
    <div className="mt-3 grid gap-3">
      <p className="text-sm text-[var(--muted-foreground)]">
        {t.importHelpBefore} {"{ method: \"algorithm\" | \"window\", sourceTitle, sourceAuthor, language, body, rank }"}.
        {" "}{t.importHelpAfter}
      </p>
      <Input placeholder={t.batchPlaceholder} value={batch} onChange={(event) => setBatch(event.target.value)} aria-label={t.batch} />
      <Textarea className="min-h-40 font-mono text-xs" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} aria-label={t.fragmentsJson} />
      <div><Button disabled={busy || !batch.trim() || !text.trim()} onClick={() => void submit()}>{t.import}</Button></div>
      {note && <p className="text-sm" role="status">{note}</p>}
      {batches && Object.keys(batches).length > 0 && (
        <ul className="grid gap-1 text-sm">
          {Object.entries(batches).map(([name, counts]) => (
            <li key={name} className="flex flex-wrap items-center gap-2">
              <code>{name}</code> {t.batchCounts(counts.algorithm, counts.window)}
              <Button variant="outline" size="sm" onClick={() => void remove(name)}>{t.removeUnrated}</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatValue(value: number, unit: "points" | "share" | "score") {
  if (unit === "score") return value.toFixed(3);
  return unit === "share" ? `${Math.round(value * 1000) / 10}%` : (Math.round(value * 100) / 100).toFixed(2);
}

function formatEffect(value: number, unit: "points" | "share" | "score") {
  const sign = value > 0 ? "+" : "";
  if (unit === "score") return `${sign}${value.toFixed(3)}`;
  return unit === "share" ? `${sign}${Math.round(value * 1000) / 10} pp` : `${sign}${(Math.round(value * 100) / 100).toFixed(2)}`;
}

function StudyResults({ studyKey }: { studyKey: StudyKey }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [includeTeam, setIncludeTeam] = useState(false);
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadStudyResponses>>>([]);

  async function load(team = includeTeam) {
    setStatus(t.loading);
    try {
      const responses = await loadStudyResponses(studyKey);
      const fragments = studyKey === "b3" ? await listStudyFragments() : undefined;
      setRows(responses);
      setSummary(summariseStudy(studyKey, responses, { includeTeam: team, fragments, language }));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.loadResultsFailed);
    }
  }

  function download(kind: "csv" | "json") {
    const body = kind === "csv" ? studyResponsesCsv(rows) : JSON.stringify(rows, null, 2);
    const blob = new Blob([body], { type: kind === "csv" ? "text/csv" : "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `boks-study-${studyKey}-${new Date().toISOString().slice(0, 10)}.${kind}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="mt-3 grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" /> {summary ? t.reload : t.compute}</Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeTeam} onChange={(event) => { setIncludeTeam(event.target.checked); if (summary) void load(event.target.checked); }} />
          {t.includeTeam}
        </label>
        {rows.length > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={() => download("csv")}><Download className="size-4" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={() => download("json")}><Download className="size-4" /> JSON</Button>
          </>
        )}
      </div>
      {status && <p className="text-sm text-[var(--muted-foreground)]">{status}</p>}
      {summary && (
        <>
          <p className="text-sm">
            {t.summary(summary.participants, summary.completed)}
            {Object.keys(summary.byCondition).length > 0 && ` · ${Object.entries(summary.byCondition).map(([condition, count]) => `${condition}: ${count}`).join(", ")}`}
          </p>
          {summary.comparisons.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-1 font-medium">{t.measure}</th>
                    <th className="py-1 text-right font-medium">{t.control}</th>
                    <th className="py-1 text-right font-medium">{t.variant}</th>
                    <th className="py-1 text-right font-medium">{t.effect}</th>
                    <th className="py-1 text-right font-medium">{t.interval}</th>
                    <th className="py-1 text-right font-medium">n</th>
                    <th className="py-1 text-right font-medium">{t.threshold}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.comparisons.map((comparison) => {
                    const result = comparison.result;
                    const insufficient = result.status === "insufficient_data";
                    return (
                      <tr key={comparison.label} className="border-t border-[var(--border)]">
                        <td className="py-2">{comparison.label}</td>
                        <td className="py-2 text-right">{comparison.controlLabel}: {formatValue(result.controlValue, comparison.unit)}</td>
                        <td className="py-2 text-right">{comparison.variantLabel}: {formatValue(result.variantValue, comparison.unit)}</td>
                        <td className="py-2 text-right">{insufficient ? "—" : formatEffect(result.effect, comparison.unit)}</td>
                        <td className="py-2 text-right">{insufficient ? t.needs(result.minimumReaders) : `${formatEffect(result.ci[0], comparison.unit)} … ${formatEffect(result.ci[1], comparison.unit)}`}</td>
                        <td className="py-2 text-right">{result.design === "paired" ? result.readers : `${result.controlReaders} / ${result.variantReaders}`}</td>
                        <td className="py-2 text-right">
                          {formatEffect(comparison.threshold, comparison.unit)}
                          {comparison.meetsThreshold === null ? "" : comparison.meetsThreshold ? t.met : t.notMet}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {summary.facts.map((fact) => <p key={fact.label} className="text-sm"><span className="text-[var(--muted-foreground)]">{fact.label}:</span> {fact.value}</p>)}
          {summary.fragments && summary.fragments.verdicts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="text-left text-[var(--muted-foreground)]"><th className="py-1 font-medium">{t.fragment}</th><th className="py-1 font-medium">{t.method}</th><th className="py-1 text-right font-medium">{t.ratings}</th><th className="py-1 text-right font-medium">{t.yesToBoth}</th><th className="py-1 text-right font-medium">{t.accepted}</th></tr></thead>
                <tbody>
                  {summary.fragments.verdicts.map((verdict) => (
                    <tr key={verdict.fragment.id} className="border-t border-[var(--border)]">
                      <td className="py-1">{verdict.fragment.sourceTitle}{verdict.fragment.rank !== null ? ` #${verdict.fragment.rank}` : ""}</td>
                      <td className="py-1">{t.methods[verdict.fragment.method]}</td>
                      <td className="py-1 text-right">{verdict.ratings}</td>
                      <td className="py-1 text-right">{verdict.bothYes}</td>
                      <td className="py-1 text-right">{verdict.accepted ? t.yes : verdict.ratings >= 3 ? t.no : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
