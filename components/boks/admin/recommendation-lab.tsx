"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  RecommendationDataQuality,
  RecommendationLabPayload,
  SlatePositionRow,
} from "@/components/boks/client-types";
import { secondsLabel } from "@/components/boks/client-format";
import { ExperimentEditor } from "@/components/boks/admin/experiment-editor";
import { MetricBars, type MetricBarRow } from "@/components/boks/admin/metric-bars";
import { SampleSizePanel } from "@/components/boks/admin/sample-size-panel";
import { MetricNote } from "@/components/boks/admin/metric-note";
import { PositionEffects } from "@/components/boks/admin/position-effects";
import { readerOutcomesToCsv, readerOutcomesReadme } from "@/lib/recsys/aggregate";
import { MetricTile } from "@/components/boks/shared-ui";
import {
  loadRecommendationCandidates,
  loadRecommendationLab,
  loadSlatePositionEffects,
  saveActiveExperimentConfig,
} from "@/components/boks/supabase-browser-data";
import {
  defaultExperimentConfig,
  describeRecommendationStrategies,
  emptyRecommendationLab,
  findComparison,
  measureStrategyDivergence,
  type ArmSummary,
  type DivergenceReport,
  type RecommendationExperimentConfig,
  type RecommendationLabReport,
} from "@/lib/boks/recommendations";
import {
  collapseToReaders,
  formatReaderDifference,
  formatReaderValue,
  readerMetric,
  type AlgorithmComparison,
  type ReaderMetricId,
} from "@/lib/recsys/aggregate";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

type LabMetricId = "active_seconds" | "boks_opened" | "completion_rate" | "skip_rate";

const labMetricOptions: { id: LabMetricId & ReaderMetricId }[] = [
  { id: "active_seconds" },
  { id: "boks_opened" },
  { id: "completion_rate" },
  { id: "skip_rate" },
];

const readersRu = (n: number) => `${n} ${plural("ru", n, { one: "читатель", few: "читателя", many: "читателей", other: "читателя" })}`;

const words = defineMessages({
  metrics: {
    active_seconds: { label: "Active reading seconds", help: "Foreground reading seconds per reader in this period." },
    boks_opened: { label: "Distinct boks opened", help: "Distinct boks each reader opened in this period." },
    completion_rate: { label: "Completion rate", help: "Completions over starts, per reader. Includes readers with at least five starts." },
    skip_rate: { label: "Skip rate", help: "Skips divided by starts plus skips, per reader. Lower is better." },
  } as Record<LabMetricId, { label: string; help: string }>,
  loading: "Loading recommendation results...",
  noReads: "No attributed reads yet. Ask testers to read from the feed, then refresh.",
  loadFailed: "Could not load recommendation results.",
  readerCount: (n: number, control: boolean) => `${n} reader${n === 1 ? "" : "s"}${control ? " · control" : ""}`,
  needsMore: (n: number) => `needs ${n} more readers`,
  pooledCaption: (label: string, days: number) => `${label} pooled over each arm's events, last ${days} days. Dimmed arms hold too few readers to compare.`,
  medianCaption: (label: string, days: number) => `Median ${label.toLowerCase()} per reader, last ${days} days. Dimmed arms hold too few readers to compare.`,
  saved: "Saved. New readers are assigned with the updated split.",
  experiments: "Experiments",
  eyebrow: (view: "comparison" | "traffic" | "quality") => `Research / ${view === "traffic" ? "traffic split" : view === "quality" ? "data quality" : "comparison"}`,
  comparison: "Comparison",
  trafficSplit: "Traffic split",
  dataQuality: "Data quality",
  liveNow: "Live now",
  activeAlgorithms: (n: number) => n === 1 ? "One active algorithm" : `${n} active algorithms`,
  readersMeasuredTile: "readers measured",
  secondsUnit: "s",
  sessionsTile: "sessions",
  period: "Experiment period",
  lastDays: (n: number) => `Last ${n} days`,
  refresh: "Refresh",
  indistinguishable: "These algorithms are not distinguishable yet",
  weak: "These algorithms only partly differ",
  usable: "These algorithms produce different feeds",
  registeredScope: "Only one arm is live, so this compares every registered algorithm, parked ones included - what a split would have to work with, not what readers are getting.",
  catalogConstraint: "Everything below is still measured honestly - it just cannot separate arms that are serving the same boks. Catalog size is the constraint, not sample size.",
  workspace: "Experiment workspace",
  trafficHint: "Configure the active algorithms",
  comparisonHint: "Measured reading and sample readiness",
  qualityHint: "Attribution and clock diagnostics",
  compareOn: "Compare on",
  challenger: "Challenger",
  controlMissing: (control: string) => `The control, ${control}, has no readers in this window, so no arm can be compared. Give the control a weight in the traffic split, or pick a live control.`,
  oneReaderNote: (n: number) => `One reader is one observation. Each arm needs ${n} eligible readers before an estimate is shown.`,
  quality: "Quality",
  exportRows: "Export reader rows · CSV",
  measurementDetails: "Measurement details & sample size",
  readersMeasured: "Readers measured",
  sessions: "Sessions",
  activeReading: "Active reading",
  eventsWithFeed: "Events with a feed",
  readersInBoth: "Readers in both arms",
  noteLabel: "What this experiment measures and on whom",
  noteIs: "A comparison between the ranking algorithms serving the feed, computed on readers - one reader is one observation, whatever they did.",
  noteHow: "Every reader is assigned to one arm and stays in it. Their events are totalled over the window into one value per metric, and the two arms' reader-level values are compared as a difference in means, with a percentile bootstrap interval and a permutation test on that same difference. “Events with a feed” is the share of events carrying the id of the slate that produced them, which is what makes a serve reconstructible.",
  noteNot: "Not a comparison over impressions. Events inside one reader are correlated, so a test over events reports significance that is not there - this console used to do exactly that and called three readers a strong signal. Readers who appear in both arms are removed rather than folded in, and counted above so the removal is visible.",
  colAlgorithm: "Algorithm",
  colReaders: "Readers",
  colSessions: "Sessions",
  colMedianRead: "Median read",
  colMedianBoks: "Median boks",
  colCompletion: "Completion",
  colSkip: "Skip",
  colReaction: "Reaction",
  controlSuffix: " · control",
  noAttributed: "No algorithm-attributed reads in this window.",
  pooledNote: "The four rates in this table are pooled over each arm's events, so a reader who reads twice as much counts twice. They describe the arm; they are never the basis of a verdict. Every verdict above is computed per reader.",
  experimentLine: (key: string, control: string) => `Experiment ${key} · control ${control}.`,
  exportComparison: "Export comparison",
  exportDiagnostics: "Export diagnostics",
  assignmentNote: "Readers never choose an algorithm. This decides how they are assigned, and the assignment stays stable for each reader so one tester never bounces between variants.",
  differenceInMeans: "Difference in reader means",
  moreReaders: "More readers needed",
  insufficient: "Insufficient data",
  readersSplit: (control: number, variant: number, name: string) => `${control} readers in control · ${variant} in ${name}.`,
  shortfall: (minimum: number, shortfall: number) => `At least ${minimum} per arm. The smaller arm needs ${shortfall} more ${shortfall === 1 ? "reader" : "readers"} before a difference or interval can be estimated.`,
  intervalLabel: (from: string, to: string) => `95% interval: ${from} to ${to}`,
  inconclusive: "Inconclusive",
  better: "Better than control",
  worse: "Worse than control",
  crossesZero: "95% interval crosses zero.",
  excludesZero: "95% interval excludes zero.",
  crossedExcluded: (n: number) => `${n} readers who appeared in both arms are excluded.`,
  statisticalDetail: "Statistical detail",
  permutationP: (p: number) => `Permutation p = ${p}`,
  controlValues: "Control:",
  challengerValues: "Challenger:",
  powerSample: (readers: number, spread: number) => `${readers} readers per arm, spread ${spread}.`,
  powerNone: "Nothing this sample could show would be reliable — not even a tripling. You are not currently running an experiment.",
  powerBelow: "Nothing below",
  powerVisible: (target: number, power: number) => ` is visible at this size. A ${target}% difference would be detected ${power}% of the time`,
  powerNeeded: (n: number) => `, and would need about ${n} readers per arm to be reliable`,
  checks: {
    eventsWithoutFeed: ["Events with no served feed", "Cannot be reconstructed."],
    eventsUnattributed: ["Events on no algorithm", "Not in any arm."],
    degradedFeeds: ["Degraded feeds", "Ranked without behaviour, or outside the Worker."],
    emptyFeeds: ["Empty feeds", "A serve with nothing in it."],
    algorithmMismatch: ["Algorithm mismatch", "Event and feed disagree on the arm."],
    rankNotInFeed: ["Bok outside its feed", "A read of something never served."],
    eventsBeforeFeed: ["Events before their feed", "Clock or attribution fault."],
    duplicateOutcomes: ["Duplicate outcomes", "Two verdicts for one read."],
    clampedReadingTime: ["Clamped reading time", "Hit the 24-hour ceiling."],
    outcomesWithoutTime: ["Outcomes with no time", "A read that took zero seconds."],
    eventsWithoutAssignment: ["Readers with no assignment", "Events with no stored arm."],
  } as Record<QualityCheck, [string, string]>,
  checksNeedAttention: (n: number) => `${n} checks need attention`,
  resolveGaps: "Resolve attribution gaps before comparing arms.",
  qualitySummary: (events: number, feeds: number, days: number) => `${events} reader events and ${feeds} served feeds in the last ${days} days. Anything above zero below is a reason to distrust a comparison, not a number to optimise.`,
  feedsByBackend: "Feeds by backend:",
  labellingVersions: ". Labelling versions:",
  none: "none",
}, { ru: {
  metrics: {
    active_seconds: { label: "Секунды активного чтения", help: "Секунды чтения на переднем плане на читателя за период." },
    boks_opened: { label: "Открыто разных боков", help: "Сколько разных боков открыл каждый читатель за период." },
    completion_rate: { label: "Доля дочитываний", help: "Дочитывания к началам, на читателя. Учитываются читатели минимум с пятью началами." },
    skip_rate: { label: "Доля пропусков", help: "Пропуски, делённые на начала плюс пропуски, на читателя. Меньше лучше." },
  },
  loading: "Загружаем результаты рекомендаций...",
  noReads: "Атрибутированных чтений пока нет. Попросите тестировщиков почитать ленту и обновите.",
  loadFailed: "Не удалось загрузить результаты рекомендаций.",
  readerCount: (n: number, control: boolean) => `${readersRu(n)}${control ? " · контроль" : ""}`,
  needsMore: (n: number) => `нужно ещё ${readersRu(n)}`,
  pooledCaption: (label: string, days: number) => `${label} по всем событиям варианта за последние ${days} дн. Приглушённые варианты пока слишком малы для сравнения.`,
  medianCaption: (label: string, days: number) => `Медиана на читателя: ${label.toLowerCase()}, последние ${days} дн. Приглушённые варианты пока слишком малы для сравнения.`,
  saved: "Сохранено. Новые читатели распределяются по обновлённой схеме.",
  experiments: "Эксперименты",
  eyebrow: (view: "comparison" | "traffic" | "quality") => `Исследования / ${view === "traffic" ? "распределение трафика" : view === "quality" ? "качество данных" : "сравнение"}`,
  comparison: "Сравнение",
  trafficSplit: "Распределение трафика",
  dataQuality: "Качество данных",
  liveNow: "Сейчас работает",
  activeAlgorithms: (n: number) => n === 1 ? "Один активный алгоритм" : `${n} ${plural("ru", n, { one: "активный алгоритм", few: "активных алгоритма", many: "активных алгоритмов", other: "активного алгоритма" })}`,
  readersMeasuredTile: "читателей измерено",
  secondsUnit: " с",
  sessionsTile: "сессии",
  period: "Период эксперимента",
  lastDays: (n: number) => `Последние ${n} дней`,
  refresh: "Обновить",
  indistinguishable: "Эти алгоритмы пока неразличимы",
  weak: "Эти алгоритмы различаются лишь отчасти",
  usable: "Эти алгоритмы дают разные ленты",
  registeredScope: "Активен только один вариант, поэтому здесь сравниваются все зарегистрированные алгоритмы, включая поставленные на паузу: это то, с чем пришлось бы работать распределению, а не то, что получают читатели.",
  catalogConstraint: "Всё ниже по-прежнему измерено честно, просто нельзя разделить варианты, которые показывают одни и те же боки. Ограничение в размере каталога, а не выборки.",
  workspace: "Рабочая область эксперимента",
  trafficHint: "Настроить активные алгоритмы",
  comparisonHint: "Измеренное чтение и готовность выборки",
  qualityHint: "Диагностика атрибуции и часов",
  compareOn: "Сравнивать по",
  challenger: "Претендент",
  controlMissing: (control: string) => `У контрольного варианта ${control} нет читателей в этом окне, поэтому сравнивать не с чем. Дайте контролю вес в распределении трафика или выберите активный контроль.`,
  oneReaderNote: (n: number) => `Один читатель — одно наблюдение. Каждому варианту нужно ${readersRu(n)} в выборке, прежде чем показать оценку.`,
  quality: "Качество",
  exportRows: "Выгрузить строки читателей · CSV",
  measurementDetails: "Подробности измерений и размер выборки",
  readersMeasured: "Читателей измерено",
  sessions: "Сессии",
  activeReading: "Активное чтение",
  eventsWithFeed: "События с лентой",
  readersInBoth: "Читатели в обоих вариантах",
  noteLabel: "Что измеряет этот эксперимент и на ком",
  noteIs: "Сравнение алгоритмов ранжирования, которые формируют ленту, посчитанное по читателям: один читатель — одно наблюдение, что бы он ни делал.",
  noteHow: "Каждый читатель попадает в один вариант и остаётся в нём. Его события за окно сводятся в одно значение на метрику, и значения двух вариантов на уровне читателей сравниваются как разность средних, с перцентильным бутстреп-интервалом и перестановочным тестом на ту же разность. «События с лентой» — доля событий, несущих id выдачи, которая их породила: именно это позволяет восстановить показ.",
  noteNot: "Это не сравнение по показам. События одного читателя связаны между собой, поэтому тест по событиям находит значимость там, где её нет: эта консоль раньше так и делала и называла трёх читателей сильным сигналом. Читатели, попавшие в оба варианта, исключаются, а не смешиваются, и их число показано выше, чтобы исключение было видно.",
  colAlgorithm: "Алгоритм",
  colReaders: "Читатели",
  colSessions: "Сессии",
  colMedianRead: "Медиана чтения",
  colMedianBoks: "Медиана боков",
  colCompletion: "Дочитывания",
  colSkip: "Пропуски",
  colReaction: "Реакции",
  controlSuffix: " · контроль",
  noAttributed: "В этом окне нет чтений, привязанных к алгоритму.",
  pooledNote: "Четыре доли в таблице посчитаны по всем событиям варианта, так что читатель, который читает вдвое больше, учитывается дважды. Они описывают вариант, но никогда не служат основой вывода. Каждый вывод выше посчитан по читателям.",
  experimentLine: (key: string, control: string) => `Эксперимент ${key} · контроль ${control}.`,
  exportComparison: "Выгрузить сравнение",
  exportDiagnostics: "Выгрузить диагностику",
  assignmentNote: "Читатели никогда не выбирают алгоритм. Здесь решается, как их распределять, и распределение остаётся стабильным для каждого читателя, чтобы тестировщик не прыгал между вариантами.",
  differenceInMeans: "Разность средних по читателям",
  moreReaders: "Нужно больше читателей",
  insufficient: "Недостаточно данных",
  readersSplit: (control: number, variant: number, name: string) => `В контроле ${readersRu(control)} · в ${name}: ${variant}.`,
  shortfall: (minimum: number, shortfall: number) => `Минимум ${minimum} на вариант. Меньшему варианту нужно ещё ${readersRu(shortfall)}, прежде чем можно оценить разность или интервал.`,
  intervalLabel: (from: string, to: string) => `95% доверительный интервал: от ${from} до ${to}`,
  inconclusive: "Без вывода",
  better: "Лучше контроля",
  worse: "Хуже контроля",
  crossesZero: "95% доверительный интервал пересекает ноль.",
  excludesZero: "95% доверительный интервал не включает ноль.",
  crossedExcluded: (n: number) => `Исключено читателей, попавших в оба варианта: ${n}.`,
  statisticalDetail: "Статистические подробности",
  permutationP: (p: number) => `p-значение перестановочного теста = ${p}`,
  controlValues: "Контроль:",
  challengerValues: "Претендент:",
  powerSample: (readers: number, spread: number) => `${readersRu(readers)} на вариант, разброс ${spread}.`,
  powerNone: "Ничто из того, что может показать эта выборка, не будет надёжным, даже утроение. Сейчас вы фактически не ведёте эксперимент.",
  powerBelow: "Ничего меньше",
  powerVisible: (target: number, power: number) => ` при таком размере не видно. Разницу в ${target}% удастся обнаружить в ${power}% случаев`,
  powerNeeded: (n: number) => `, а для надёжности нужно около ${readersRu(n)} на вариант`,
  checks: {
    eventsWithoutFeed: ["События без показанной ленты", "Их нельзя восстановить."],
    eventsUnattributed: ["События без алгоритма", "Не относятся ни к одному варианту."],
    degradedFeeds: ["Деградированные ленты", "Ранжированы без поведения или вне Worker."],
    emptyFeeds: ["Пустые ленты", "Показ, в котором ничего нет."],
    algorithmMismatch: ["Расхождение алгоритма", "Событие и лента указывают разные варианты."],
    rankNotInFeed: ["Бок вне своей ленты", "Чтение того, что не показывали."],
    eventsBeforeFeed: ["События раньше своей ленты", "Сбой часов или атрибуции."],
    duplicateOutcomes: ["Повторные исходы", "Два вердикта на одно чтение."],
    clampedReadingTime: ["Обрезанное время чтения", "Упёрлось в потолок 24 часа."],
    outcomesWithoutTime: ["Исходы без времени", "Чтение заняло ноль секунд."],
    eventsWithoutAssignment: ["Читатели без распределения", "События без сохранённого варианта."],
  },
  checksNeedAttention: (n: number) => `${n} ${plural("ru", n, { one: "проверка требует", few: "проверки требуют", many: "проверок требуют", other: "проверки требуют" })} внимания`,
  resolveGaps: "Закройте пробелы в атрибуции, прежде чем сравнивать варианты.",
  qualitySummary: (events: number, feeds: number, days: number) => `Событий читателей: ${events}, показанных лент: ${feeds} за последние ${days} дн. Любое значение выше нуля ниже — повод не доверять сравнению, а не число для оптимизации.`,
  feedsByBackend: "Ленты по бэкенду:",
  labellingVersions: ". Версии разметки:",
  none: "нет",
} });

type QualityCheck =
  | "eventsWithoutFeed" | "eventsUnattributed" | "degradedFeeds" | "emptyFeeds" | "algorithmMismatch" | "rankNotInFeed"
  | "eventsBeforeFeed" | "duplicateOutcomes" | "clampedReadingTime" | "outcomesWithoutTime" | "eventsWithoutAssignment";

// The status line starts as "loading" in whichever language is showing.
const loading = Symbol("loading");

const emptyLab: RecommendationLabPayload = {
  experiment: defaultExperimentConfig,
  report: emptyRecommendationLab,
  outcomes: [],
  assignments: [],
  topStories: [],
  dataQuality: null,
  available: true,
  notice: "",
};

/**
 * Side-by-side comparison of the algorithms that have served traffic.
 *
 * Two rules govern everything on this screen. The analysis unit is the reader,
 * stated on the page rather than implied. And no number is shown without what
 * it was computed from — sample size, interval, and what this sample could have
 * detected if it were real.
 */
export function RecommendationLab() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [view, setView] = useState<"overview" | "comparison" | "traffic" | "quality">("overview");
  const [loaded, setLoaded] = useState(false);
  const [experimentNotice, setExperimentNotice] = useState("");
  const [lab, setLab] = useState<RecommendationLabPayload>(emptyLab);
  const [metric, setMetric] = useState<ReaderMetricId>("active_seconds");
  const [days, setDays] = useState(30);
  const [challenger, setChallenger] = useState("");
  const [status, setStatus] = useState<string | typeof loading>(loading);
  const [busy, setBusy] = useState(false);
  const [positions, setPositions] = useState<SlatePositionRow[]>([]);
  const [divergence, setDivergence] = useState<DivergenceReport | null>(null);
  // Whether the divergence check compared the live arms or, with one live arm,
  // every registered algorithm - the banner must say which.
  const [divergenceScope, setDivergenceScope] = useState<"live" | "registered">("live");
  // Only the newest request may write. Switching the window from 90 to 7 days
  // while the 90-day load is still running otherwise lets the slower, older
  // answer land last and label itself "7 days".
  const latestRequest = useRef(0);

  const refresh = useCallback(async (nextDays: number) => {
    const request = ++latestRequest.current;
    const isCurrent = () => request === latestRequest.current;
    setBusy(true);
    try {
      const payload = await loadRecommendationLab(nextDays, language);
      // Loaded beside the lab rather than inside it: it is an aggregate over
      // events, not part of the reader-level comparison, and keeping them
      // separate stops one becoming a denominator for the other.
      const nextPositions = await loadSlatePositionEffects(nextDays, payload.experiment.key);
      if (!isCurrent()) return;
      setPositions(nextPositions);
      setLab(payload);
      setLoaded(true);

      // Before reading any comparison, check the algorithms are even producing
      // different feeds on the catalog as it stands today.
      try {
        const candidates = await loadRecommendationCandidates(400);
        const liveArms = payload.experiment.arms.filter((arm) => arm.weight > 0).map((arm) => arm.algorithmId);
        const report = measureStrategyDivergence({
          candidates,
          algorithmIds: liveArms.length > 1 ? liveArms : undefined,
          language,
        });
        if (!isCurrent()) return;
        setDivergence(report);
        setDivergenceScope(liveArms.length > 1 ? "live" : "registered");
      } catch {
        if (isCurrent()) setDivergence(null);
      }

      if (!isCurrent()) return;
      setStatus(
        payload.available
          ? payload.report.arms.length
            ? ""
            : words[currentUiLanguage()].noReads
          : payload.notice
      );
    } catch (error) {
      if (isCurrent()) setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].loadFailed);
    } finally {
      if (isCurrent()) setBusy(false);
    }
  }, [language]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(days).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [days, refresh]);

  const report = lab.report;
  const definition = readerMetric(metric);
  const metricLabel = (id: ReaderMetricId) => (id in t.metrics ? t.metrics[id as LabMetricId].label : readerMetric(id, language).label);
  const selectedHelp = metric in t.metrics ? t.metrics[metric as LabMetricId].help : "";
  const variantArms = report.arms.filter((arm) => !arm.isControl);
  const selectedArm = variantArms.find((arm) => arm.algorithmId === challenger) ?? variantArms[0];

  // Readiness is per metric: a rate leaves out readers with fewer than five
  // starts, so an arm can hold enough readers for reading time and still too
  // few for completion rate.
  const metricSeries = useMemo(() => collapseToReaders(lab.outcomes, metric), [lab.outcomes, metric]);
  const controlArm = report.arms.find((arm) => arm.isControl);
  const barRows: MetricBarRow[] = report.arms.map((arm) => {
    const readers = metricSeries.valuesByAlgorithm[arm.algorithmId]?.length ?? 0;
    const ready = readers >= report.minimumReadersPerArm;
    return {
      id: arm.algorithmId,
      label: arm.algorithmName,
      sublabel: t.readerCount(readers, arm.isControl),
      value: armValue(arm, metric),
      unit: definition.unit === "rate" ? "%" : definition.unit === "seconds" ? t.secondsUnit : "",
      note: ready ? undefined : t.needsMore(report.minimumReadersPerArm - readers),
      muted: !ready,
    };
  });
  const barCaption =
    definition.unit === "rate"
      ? t.pooledCaption(metricLabel(metric), days)
      : t.medianCaption(metricLabel(metric), days);

  function exportLab() {
    const payload = {
      exportedAt: new Date().toISOString(),
      windowDays: days,
      experiment: lab.experiment,
      strategies: describeRecommendationStrategies(),
      report: lab.report,
      dataQuality: lab.dataQuality,
      assignments: lab.assignments,
      topStories: lab.topStories,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `boks-recommendation-lab-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The rows the comparison was computed from, so it can be recomputed
   * elsewhere. Two files: the table, and a note saying what the table is and
   * which mistake not to make with it.
   */
  function exportOutcomes() {
    const readers = new Set(lab.outcomes.map((row) => row.userId)).size;
    const stamp = new Date().toISOString().slice(0, 10);

    const files: Array<[string, string, string]> = [
      [`boks-reader-outcomes-${stamp}.csv`, readerOutcomesToCsv(lab.outcomes), "text/csv"],
      [
        `boks-reader-outcomes-${stamp}.txt`,
        readerOutcomesReadme({
          windowDays: days,
          experimentKey: lab.experiment.key,
          controlAlgorithmId: lab.report.controlAlgorithmId,
          rows: lab.outcomes.length,
          readers,
        }),
        "text/plain",
      ],
    ];

    for (const [name, body, type] of files) {
      const url = URL.createObjectURL(new Blob([body], { type }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    }
  }

  async function saveExperiment(config: RecommendationExperimentConfig) {
    await saveActiveExperimentConfig(config);
    setExperimentNotice(t.saved);
    await refresh(days);
  }

  const liveArms = lab.experiment.arms.filter(arm => arm.weight > 0);
  const weightTotal = liveArms.reduce((sum, arm) => sum + arm.weight, 0);
  const names = describeRecommendationStrategies(language);
  const navigate = (next: typeof view) => { setView(next); window.scrollTo({ top: 0, behavior: "instant" }); };

  return (
    <section className="studio-lab" data-studio-detail={view !== "overview" ? "true" : undefined}>
      {view !== "overview" && <header className="studio-subview-heading"><button type="button" className="studio-text-link" onClick={() => navigate("overview")}><ArrowLeft size={17} /> {t.experiments}</button><p className="studio-eyebrow">{t.eyebrow(view)}</p><h1>{view === "comparison" ? t.comparison : view === "traffic" ? t.trafficSplit : t.dataQuality}</h1></header>}
      {view === "overview" && loaded && <>
        <div className="studio-live-verdict">
          <p className="studio-eyebrow">{t.liveNow}</p>
          <h2>{t.activeAlgorithms(liveArms.length)}</h2>
          <p>{liveArms.map(arm => `${names.find(strategy => strategy.id === arm.algorithmId)?.name ?? arm.algorithmId} · ${weightTotal ? Math.round(arm.weight / weightTotal * 100) : 0}%`).join(" / ")}</p>
        </div>
        <div className="studio-metric-pair"><MetricTile label={t.readersMeasuredTile} value={report.totals.readers} /><MetricTile label={t.sessionsTile} value={report.totals.sessions} /></div>
      </>}
      {view !== "traffic" && <div className="studio-filter-line">
        <select aria-label={t.period} className="field-control" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>{t.lastDays(7)}</option><option value={30}>{t.lastDays(30)}</option><option value={90}>{t.lastDays(90)}</option>
        </select>
        <Button variant="ghost" onClick={() => refresh(days)} disabled={busy}><RefreshCw className="size-4" /> {t.refresh}</Button>
      </div>}

      {status && (
        <p className={`px-4 pt-4 text-sm ${lab.available ? "text-[var(--muted-foreground)]" : "text-[var(--destructive)]"}`}>
          {status === loading ? t.loading : status}
        </p>
      )}

      <div className="grid gap-5">
        {divergence && view === "overview" && (
          <div className={`divergence divergence--${divergence.verdict}`}>
            <p className="text-sm font-semibold">
              {divergence.verdict === "indistinguishable"
                ? t.indistinguishable
                : divergence.verdict === "weak"
                  ? t.weak
                  : t.usable}
            </p>
            {divergenceScope === "registered" && (
              <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                {t.registeredScope}
              </p>
            )}
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{divergence.summary}</p>
            {divergence.verdict !== "usable" && (
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                {t.catalogConstraint}
              </p>
            )}
          </div>
        )}

        {view === "overview" && <nav className="studio-link-rows" aria-label={t.workspace}>
          <button type="button" onClick={() => navigate("traffic")}><span><strong>{t.trafficSplit}</strong><small>{t.trafficHint}</small></span><ArrowRight /></button>
          <button type="button" onClick={() => navigate("comparison")}><span><strong>{t.comparison}</strong><small>{t.comparisonHint}</small></span><ArrowRight /></button>
          <button type="button" onClick={() => navigate("quality")}><span><strong>{t.dataQuality}</strong><small>{t.qualityHint}</small></span><ArrowRight /></button>
        </nav>}
        {view === "comparison" && <>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="grid gap-1 text-sm font-medium">
              {t.compareOn}
              <select
                className="field-control w-[240px]"
                value={metric}
                onChange={(event) => setMetric(event.target.value as ReaderMetricId)}
              >
                {labMetricOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {metricLabel(option.id)}
                  </option>
                ))}
              </select>
            </label>
            <p className="max-w-md text-sm text-[var(--muted-foreground)]">{selectedHelp}</p>
          </div>

          {variantArms.length > 1 && <label className="studio-field">{t.challenger}<select value={selectedArm?.algorithmId ?? ""} onChange={(event) => setChallenger(event.target.value)}>{variantArms.map((arm) => <option value={arm.algorithmId} key={arm.algorithmId}>{arm.algorithmName}</option>)}</select></label>}
          {selectedArm && <ComparisonReadout comparison={findComparison(report, selectedArm.algorithmId, metric)} report={report} arm={selectedArm} />}
          <MetricBars
            rows={barRows.filter((row) => row.id === controlArm?.algorithmId || row.id === selectedArm?.algorithmId)}
            lowerIsBetter={definition.lowerIsBetter}
            caption={barCaption}
          />
        </div>

        {variantArms.length > 0 && !controlArm && (
          <p className="text-sm leading-6 text-[var(--destructive)]">
            {t.controlMissing(report.controlAlgorithmId)}
          </p>
        )}

        <p className="studio-hint">{t.oneReaderNote(report.minimumReadersPerArm)}</p>
        <div className="studio-inline"><Button variant="outline" onClick={() => navigate("traffic")}>{t.trafficSplit}</Button><Button variant="outline" onClick={() => navigate("quality")}>{t.quality}</Button></div>
        <Button variant="ghost" onClick={exportOutcomes} disabled={!lab.outcomes.length}><Download className="size-4" /> {t.exportRows}</Button>
        <details className="studio-details"><summary>{t.measurementDetails} <span>＋</span></summary><div className="studio-details-body">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricTile label={t.readersMeasured} value={report.totals.readers} />
          <MetricTile label={t.sessions} value={report.totals.sessions} />
          <MetricTile label={t.activeReading} value={secondsLabel(report.totals.activeSeconds, language)} />
          <MetricTile
            label={t.eventsWithFeed}
            value={`${percent(report.totals.attributedEvents, report.totals.events)}%`}
          />
          <MetricTile label={t.readersInBoth} value={report.totals.crossedReaders} />
        </div>

        <MetricNote
          label={t.noteLabel}
          is={<>{t.noteIs}</>}
          how={<>{t.noteHow}</>}
          not={<>{t.noteNot}</>}
        />

        <div className="experiment-table">
          <div className="experiment-row experiment-head">
            <span>{t.colAlgorithm}</span>
            <span>{t.colReaders}</span>
            <span>{t.colSessions}</span>
            <span>{t.colMedianRead}</span>
            <span>{t.colMedianBoks}</span>
            <span>{t.colCompletion}</span>
            <span>{t.colSkip}</span>
            <span>{t.colReaction}</span>
          </div>
          {report.arms.length ? (
            report.arms.map((arm) => (
              <div className="experiment-row" key={arm.algorithmId}>
                <span>
                  <strong>{arm.algorithmName}</strong>
                  <small>
                    {arm.algorithmId}
                    {arm.isControl ? t.controlSuffix : ""}
                  </small>
                </span>
                <span>{arm.readers}</span>
                <span>{arm.sessions}</span>
                <span>{secondsLabel(arm.medianActiveSeconds, language)}</span>
                <span>{arm.medianBoksOpened}</span>
                <span>{arm.completionRate}%</span>
                <span>{arm.skipRate}%</span>
                <span>{arm.reactionRate}%</span>
              </div>
            ))
          ) : (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              {t.noAttributed}
            </div>
          )}
        </div>
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
          {t.pooledNote}
        </p>

        <SampleSizePanel
          curve={report.sampleSize}
          cohorts={report.cohorts}
          minimumReadersPerArm={report.minimumReadersPerArm}
        />

        <PositionEffects rows={positions} />
        <p className="studio-meta">{t.experimentLine(lab.experiment.key, report.controlAlgorithmId)}</p>
        <Button variant="outline" onClick={exportLab}><Download className="size-4" /> {t.exportComparison}</Button>
        </div></details>

        </>}

        {view === "quality" && <><DataQualityPanel quality={lab.dataQuality} /><Button variant="outline" onClick={exportLab}><Download /> {t.exportDiagnostics}</Button></>}

        {view === "traffic" && <div className="grid gap-3">
          <div>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t.assignmentNote}
            </p>
          </div>
          <ExperimentEditor
            key={`${lab.experiment.key}:${lab.experiment.updatedAt ?? "initial"}`}
            config={lab.experiment}
            disabled={!lab.available || busy}
            onSave={saveExperiment}
            notice={experimentNotice}
          />
        </div>}
      </div>
    </section>
  );
}

/**
 * One arm against the control, on one metric.
 *
 * Deliberately wordy and deliberately colourless. An interval that spans zero
 * is reported as inconclusive and never as "no difference", and a sample too
 * small to see the effect says so in the same breath as the estimate.
 */
function ComparisonReadout({
  comparison,
  report,
  arm,
}: {
  comparison: AlgorithmComparison | undefined;
  report: RecommendationLabReport;
  arm: ArmSummary;
}) {
  const t = useMessages(words);
  const language = useUiLanguage();
  if (!comparison) return null;

  const shortfall = report.minimumReadersPerArm - Math.min(comparison.controlReaders, comparison.variantReaders);

  if (comparison.status === "insufficient_data") return <section className="studio-comparison-result"><p className="studio-eyebrow">{t.differenceInMeans}</p><h2>{t.moreReaders}</h2><span className="studio-status">{t.insufficient}</span><p>{t.readersSplit(comparison.controlReaders, comparison.variantReaders, arm.algorithmName)}</p><p className="studio-meta">{t.shortfall(report.minimumReadersPerArm, shortfall)}</p></section>;
  const lower = Math.min(comparison.ci[0], 0);
  const upper = Math.max(comparison.ci[1], 0);
  const span = upper - lower || 1;
  const position = (value: number) => 8 + (value - lower) / span * 84;
  return <section className="studio-comparison-result">
    <div className="studio-interval" aria-label={t.intervalLabel(formatReaderDifference(comparison.metricId, comparison.ci[0], language), formatReaderDifference(comparison.metricId, comparison.ci[1], language))}><span className="studio-interval-zero" style={{ left: `${position(0)}%` }}>0</span><i style={{ left: `${position(comparison.ci[0])}%`, width: `${(comparison.ci[1] - comparison.ci[0]) / span * 84}%` }} /><b style={{ left: `${position(comparison.effect)}%` }} /><span className="studio-interval-left">{formatReaderDifference(comparison.metricId, comparison.ci[0], language)}</span><span className="studio-interval-right">{formatReaderDifference(comparison.metricId, comparison.ci[1], language)}</span></div>
    <p className="studio-eyebrow">{t.differenceInMeans}</p><h2>{formatReaderDifference(comparison.metricId, comparison.effect, language)}</h2><span className="studio-status">{comparison.status === "inconclusive" ? t.inconclusive : comparison.status === "positive" ? t.better : t.worse}</span>
    <p>{comparison.status === "inconclusive" ? t.crossesZero : t.excludesZero}<br />{t.readersSplit(comparison.controlReaders, comparison.variantReaders, arm.algorithmName)}</p>
    {comparison.crossedReaders > 0 && <p className="studio-meta">{t.crossedExcluded(comparison.crossedReaders)}</p>}
    {comparison.power && <PowerLine comparison={comparison} />}
    <details className="studio-details"><summary>{t.statisticalDetail} <span>＋</span></summary><div className="studio-details-body">{typeof comparison.pValue === "number" && <p>{t.permutationP(comparison.pValue)}</p>}{comparison.perReaderValues && <p className="studio-meta">{t.controlValues} {comparison.perReaderValues.control.map((value) => formatReaderValue(comparison.metricId, value, language)).join(", ")}<br />{t.challengerValues} {comparison.perReaderValues.variant.map((value) => formatReaderValue(comparison.metricId, value, language)).join(", ")}</p>}</div></details>
  </section>;
}

/** What this sample could have detected, phrased as a refusal where it must be. */
function PowerLine({ comparison }: { comparison: AlgorithmComparison }) {
  const t = useMessages(words);
  const power = comparison.power;
  if (!power) return null;

  return (
    <p className="text-sm leading-6 text-[var(--muted-foreground)]">
      {t.powerSample(power.readersPerArm, power.coefficientOfVariation)}{" "}
      {power.minimumDetectableEffect === null ? (
        <>{t.powerNone}</>
      ) : (
        <>
          {t.powerBelow}{" "}
          <strong>+{Math.round(power.minimumDetectableEffect * 100)}%</strong>
          {t.powerVisible(Math.round(power.targetEffect * 100), Math.round(power.powerForTargetEffect * 100))}
          {power.readersNeededForTargetEffect
            ? t.powerNeeded(power.readersNeededForTargetEffect)
            : ""}
          .
        </>
      )}
    </p>
  );
}

/**
 * The conditions that decide whether anything above can be believed.
 *
 * Every counter here was previously invisible, and invisible is how broken
 * numbers get trusted.
 */
function DataQualityPanel({ quality }: { quality: RecommendationDataQuality | null }) {
  const t = useMessages(words);
  if (!quality) return null;

  const checks = (Object.keys(t.checks) as QualityCheck[]).map((id) => ({
    label: t.checks[id][0],
    value: quality[id],
    help: t.checks[id][1],
  }));

  return (
    <div className="studio-quality">
      <div className="studio-quality-heading"><span className={`studio-status ${checks.some((check) => check.value > 0) ? "is-alert" : ""}`}>{t.checksNeedAttention(checks.filter((check) => check.value > 0).length)}</span><p>{t.resolveGaps}</p></div>
      <div>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t.qualitySummary(quality.events, quality.feeds, quality.windowDays)}
        </p>
      </div>
      <div>
        {checks.map((check) => <div key={check.label} className="studio-quality-row"><span>{check.label}<small>{check.help}</small></span><strong className={check.value > 0 ? "is-alert" : ""}>{check.value}</strong></div>)}
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        {t.feedsByBackend}{" "}
        {Object.entries(quality.feedsByBackend)
          .map(([backend, count]) => `${backend} ${count}`)
          .join(" · ") || t.none}
        {t.labellingVersions}{" "}
        {Object.entries(quality.labelingVersions)
          .map(([version, count]) => `${version} ${count}`)
          .join(" · ") || t.none}
        .
      </p>
    </div>
  );
}

function armValue(arm: ArmSummary, metric: ReaderMetricId) {
  if (metric === "active_seconds") return arm.medianActiveSeconds;
  if (metric === "boks_opened") return arm.medianBoksOpened;
  if (metric === "completion_rate") return arm.completionRate;
  if (metric === "skip_rate") return arm.skipRate;
  return 0;
}

function percent(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
