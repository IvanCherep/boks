import { comparePaired, compareIndependent } from "@/lib/recsys/statistics";
import type { ComparisonResult } from "@/lib/recsys/statistics/types";
import type { StudyKey } from "@/lib/boks/studies/protocol";
import { successfulFind, type SessionMeasurement, type SessionSurvey } from "@/lib/boks/studies/session";
import { ndcgAt, precisionAt, type A3Ranking } from "@/lib/boks/studies/a3";
import { defineMessages } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * Raw study responses into the numbers each hypothesis is judged by.
 *
 * The database returns rows; every rate, mean and interval is computed here,
 * once, the way the recommendation lab does it. One value per participant is
 * the analysis unit throughout. The thresholds are the ones the hypotheses
 * state; whether one is met is read from the effect, and the interval is
 * printed beside it so a pilot's width is visible rather than hidden behind a
 * verdict.
 */

export type StudyResponseRow = {
  id: number;
  participantId: string;
  participantCondition: string;
  participantSeed: number;
  participantCompletedAt: string | null;
  /** An admin's own run: left out unless asked for. */
  team: boolean;
  step: string;
  reelId: string | null;
  fragmentId: string | null;
  condition: string | null;
  answers: Record<string, unknown>;
  clientSeconds: number | null;
  createdAt: string;
};

export type StudyFragmentRow = {
  id: string;
  batch: string;
  method: "algorithm" | "window";
  sourceTitle: string;
  sourceAuthor: string;
  language: string;
  rank: number | null;
  wordCount: number;
  createdAt: string;
};

export type StudyComparison = {
  label: string;
  /** What the hypothesis needs from the effect. */
  threshold: number;
  /** points: a 1–7 or 1–5 scale; share: a proportion; score: a 0–1 metric such as NDCG, to three places. */
  unit: "points" | "share" | "score";
  controlLabel: string;
  variantLabel: string;
  result: ComparisonResult;
  /** Null while the sample is below the minimum. */
  meetsThreshold: boolean | null;
};

export type FragmentVerdict = {
  fragment: StudyFragmentRow;
  ratings: number;
  /** Raters answering «yes» to both questions. */
  bothYes: number;
  /** At least two of three raters said yes to both. */
  accepted: boolean;
};

export type StudySummary = {
  key: StudyKey;
  participants: number;
  completed: number;
  byCondition: Record<string, number>;
  comparisons: StudyComparison[];
  /** Plain counts worth reading beside the comparisons. */
  facts: { label: string; value: string }[];
  fragments?: { verdicts: FragmentVerdict[]; byMethod: Record<string, { rated: number; accepted: number; total: number }> };
};

/**
 * The admin's words for the comparisons and facts. The participants' own
 * questions are quoted in Russian in both languages, as they were asked.
 */
const resultWords = defineMessages({
  text: "Text",
  series: "Series",
  catalogue: "Catalogue",
  feed: "Feed",
  fragment: "Fragment",
  whole: "Whole",
  cards: "Card + reading screen",
  inline: "Text in the feed",
  withoutProfile: "Without profile",
  withProfile: "Profile from five boks",
  passive: "Passive",
  active: "Active",
  movedSecondary: "«Прочитанное меня тронуло», 1–7 (secondary; both sessions with a text)",
  successfulSecondary: "Successful session (secondary)",
  nothingOpened: "Sessions with nothing opened (still rated for satisfaction)",
  choseWholeMinusFragment: "Chose a whole work minus chose a fragment",
  feltComplete: "Felt complete, 1–7",
  choseNothing: "Chose nothing",
  successfulFind: "Session with a successful find",
  satisfactionSecondary: "Session satisfaction, 1–7 (secondary)",
  ndcg: "NDCG@5 of the ten new texts (secondary)",
  precision: "Precision@5: share of texts rated 4–5 in the top five",
  strongBoth: "Share answering 6 or 7 to both questions",
  satisfiedShare: "Share satisfied with the session (6 or 7)",
  meanSecondary: (question: string) => `${question} (secondary, mean)`,
  immersedShare: "Highly immersed: 6 or 7, participants in both roles",
  music: "Music",
  silence: "Silence",
  enjoyedShare: "Share enjoying the reading (6 or 7), paired",
  distractionSecondary: "«Насколько вас что-то отвлекало от чтения?», 1–7 (secondary, mean)",
  oneBlockOnly: "Answered after one block only (left out)",
  incomplete: "Profile fixed, ten not all rated yet (can return later)",
  flat: "Every one of the ten rated 1 (no order is better; left out)",
  noDirection: "Five ratings all at 3 (no profile; both orders the same, kept in)",
  immersionBoth: "Immersion, participants in both roles",
  immersionEvery: "Immersion, every rating",
  fragmentsAccepted: "Algorithm fragments accepted (target: 80 of 100)",
  acceptedValue: (accepted: number, total: number, rated: number) => `${accepted} of ${total}, ${rated} with three ratings`,
  noneImported: "none imported",
  percent: (numerator: number, denominator: number, share: number) => `${numerator} of ${denominator} (${share}%)`,
  noneYet: "none yet",
}, {
  ru: {
    text: "Текст",
    series: "Series",
    catalogue: "Каталог",
    feed: "Лента",
    fragment: "Фрагмент",
    whole: "Целое",
    cards: "Карточка + экран чтения",
    inline: "Текст в ленте",
    withoutProfile: "Без профиля",
    withProfile: "Профиль по пяти бокам",
    passive: "Пассивно",
    active: "Активно",
    movedSecondary: "«Прочитанное меня тронуло», 1–7 (вторичная; обе сессии с текстом)",
    successfulSecondary: "Успешная сессия (вторичная)",
    nothingOpened: "Сессии, где ничего не открыли (удовлетворённость всё равно оценена)",
    choseWholeMinusFragment: "Выбрали целое произведение минус выбрали фрагмент",
    feltComplete: "Ощущение завершённости, 1–7",
    choseNothing: "Ничего не выбрали",
    successfulFind: "Сессия с успешной находкой",
    satisfactionSecondary: "Удовлетворённость сессией, 1–7 (вторичная)",
    ndcg: "NDCG@5 десяти новых текстов (вторичная)",
    precision: "Precision@5: доля текстов с интересом 4–5 в первой пятёрке",
    strongBoth: "Доля ответивших 6 или 7 на оба вопроса",
    satisfiedShare: "Доля довольных сессией (6 или 7)",
    meanSecondary: (question) => `${question} (вторичная, среднее)`,
    immersedShare: "Высокое погружение: 6 или 7, участники в обеих ролях",
    music: "Музыка",
    silence: "Тишина",
    enjoyedShare: "Доля получивших удовольствие от чтения (6 или 7), парно",
    distractionSecondary: "«Насколько вас что-то отвлекало от чтения?», 1–7 (вторичная, среднее)",
    oneBlockOnly: "Ответили только после одного блока (исключены)",
    incomplete: "Профиль зафиксирован, десять оценены не все (можно вернуться позже)",
    flat: "Все десять оценены на 1 (ни один порядок не лучше; исключены)",
    noDirection: "Все пять оценок равны 3 (профиля нет; оба порядка одинаковы, оставлены)",
    immersionBoth: "Погружение, участники в обеих ролях",
    immersionEvery: "Погружение, все оценки",
    fragmentsAccepted: "Принятые фрагменты алгоритма (цель: 80 из 100)",
    acceptedValue: (accepted, total, rated) => `${accepted} из ${total}, с тремя оценками ${rated}`,
    noneImported: "ничего не импортировано",
    percent: (numerator, denominator, share) => `${numerator} из ${denominator} (${share}%)`,
    noneYet: "пока нет",
  },
});

type ResultWords = (typeof resultWords)["en"];

/** Pilot-sized: 24 participants is about 12 an arm. */
const minimumReaders = 5;

function compare(
  label: string,
  control: number[],
  variant: number[],
  threshold: number,
  unit: StudyComparison["unit"],
  names: [string, string]
): StudyComparison {
  const result = compareIndependent(control, variant, { metric: label, minimumReaders, power: "none" });
  return {
    label,
    threshold,
    unit,
    controlLabel: names[0],
    variantLabel: names[1],
    result,
    meetsThreshold: result.status === "insufficient_data" ? null : result.effect >= threshold,
  };
}

function comparePairs(
  label: string,
  pairs: { control: number; variant: number }[],
  threshold: number,
  unit: StudyComparison["unit"],
  names: [string, string]
): StudyComparison {
  const result = comparePaired(pairs, { metric: label, minimumReaders, power: "none" });
  return {
    label,
    threshold,
    unit,
    controlLabel: names[0],
    variantLabel: names[1],
    result,
    meetsThreshold: result.status === "insufficient_data" ? null : result.effect >= threshold,
  };
}

const scale = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function byParticipant(rows: readonly StudyResponseRow[]) {
  const groups = new Map<string, StudyResponseRow[]>();
  for (const row of rows) {
    const list = groups.get(row.participantId) ?? [];
    list.push(row);
    groups.set(row.participantId, list);
  }
  return groups;
}

function percent(numerator: number, denominator: number, w: ResultWords) {
  return denominator ? w.percent(numerator, denominator, Math.round((numerator / denominator) * 100)) : w.noneYet;
}

/** Session measurement and its survey, paired by `answers.index`. */
export function sessionsOf(rows: readonly StudyResponseRow[]) {
  const sessions = new Map<number, { measurement?: SessionMeasurement; survey?: SessionSurvey }>();
  for (const row of rows) {
    if (row.step !== "session" && row.step !== "session_survey") continue;
    const index = Number(row.answers.index ?? 0);
    const entry = sessions.get(index) ?? {};
    if (row.step === "session") entry.measurement = row.answers.measurement as SessionMeasurement;
    else entry.survey = row.answers.survey as SessionSurvey;
    sessions.set(index, entry);
  }
  return [...sessions.entries()]
    .sort(([a], [b]) => a - b)
    .filter((entry): entry is [number, { measurement: SessionMeasurement; survey: SessionSurvey }] =>
      Boolean(entry[1].measurement && entry[1].survey))
    .map(([, value]) => ({ ...value, success: successfulFind(value.measurement, value.survey) !== null }));
}

/** a3: the first interest rating of each text shown after the profile was fixed. */
export function a3TestInterest(rows: readonly StudyResponseRow[]) {
  const interest: Record<string, number> = {};
  for (const row of rows) {
    if (row.step !== "interest" || row.answers.phase !== "test" || !row.reelId) continue;
    const value = scale(row.answers.interest);
    if (value !== null && interest[row.reelId] === undefined) interest[row.reelId] = value;
  }
  return interest;
}

const summarisers: { [K in StudyKey]: (groups: Map<string, StudyResponseRow[]>, summary: StudySummary, w: ResultWords) => void } = {
  rg1(groups, summary, w) {
    const moved: Record<"series" | "text", number[]> = { series: [], text: [] };
    const thought: Record<"series" | "text", number[]> = { series: [], text: [] };
    const strong: Record<"series" | "text", number[]> = { series: [], text: [] };
    for (const rows of groups.values()) {
      const answer = rows.find((row) => row.step === "after_reading" && row.answers.phase === "target");
      if (!answer) continue;
      const format = answer.condition === "series" ? "series" : "text";
      const m = scale(answer.answers.moved);
      const t = scale(answer.answers.thought);
      if (m !== null) moved[format].push(m);
      if (t !== null) thought[format].push(t);
      if (m !== null && t !== null) strong[format].push(m >= 6 && t >= 6 ? 1 : 0);
    }
    summary.comparisons.push(
      compare(w.strongBoth, strong.text, strong.series, 0.1, "share", [w.text, w.series]),
      compare(w.meanSecondary("«Произведение меня тронуло», 1–7"), moved.text, moved.series, 0, "points", [w.text, w.series]),
      compare(w.meanSecondary("«Произведение заставило задуматься», 1–7"), thought.text, thought.series, 0, "points", [w.text, w.series])
    );
  },
  rg2(groups, summary, w) {
    const satisfaction: { control: number; variant: number }[] = [];
    const satisfied: { control: number; variant: number }[] = [];
    const moved: { control: number; variant: number }[] = [];
    const success: { control: number; variant: number }[] = [];
    let none = 0;
    for (const rows of groups.values()) {
      const sessions = sessionsOf(rows);
      const feed = sessions.find((session) => session.measurement.interface === "feed");
      const catalogue = sessions.find((session) => session.measurement.interface === "catalogue");
      if (!feed || !catalogue) continue;
      const feedScore = scale(feed.survey.sessionSatisfaction);
      const catalogueScore = scale(catalogue.survey.sessionSatisfaction);
      if (feedScore !== null && catalogueScore !== null) {
        satisfaction.push({ control: catalogueScore, variant: feedScore });
        satisfied.push({ control: catalogueScore >= 6 ? 1 : 0, variant: feedScore >= 6 ? 1 : 0 });
      }
      const feedMoved = scale(feed.survey.moved);
      const catalogueMoved = scale(catalogue.survey.moved);
      if (feedMoved !== null && catalogueMoved !== null) moved.push({ control: catalogueMoved, variant: feedMoved });
      success.push({ control: catalogue.success ? 1 : 0, variant: feed.success ? 1 : 0 });
      none += [feed, catalogue].filter((session) => session.measurement.reads.length === 0).length;
    }
    summary.comparisons.push(
      comparePairs(w.satisfiedShare, satisfied, 0.1, "share", [w.catalogue, w.feed]),
      comparePairs(w.meanSecondary("«Насколько вы довольны этим сеансом выбора и чтения?», 1–7"), satisfaction, 0, "points", [w.catalogue, w.feed]),
      comparePairs(w.movedSecondary, moved, 0, "points", [w.catalogue, w.feed]),
      comparePairs(w.successfulSecondary, success, 0, "share", [w.catalogue, w.feed])
    );
    summary.facts.push({ label: w.nothingOpened, value: String(none) });
  },
  a1(groups, summary, w) {
    const pairs: { control: number; variant: number }[] = [];
    let refused = 0;
    const closure: Record<"whole" | "fragment", number[]> = { whole: [], fragment: [] };
    for (const rows of groups.values()) {
      for (const row of rows.filter((entry) => entry.step === "after_reading")) {
        const value = scale(row.answers.closure);
        if (value !== null) closure[row.answers.kind === "fragment" ? "fragment" : "whole"].push(value);
      }
      const choice = rows.find((row) => row.step === "choice");
      if (!choice) continue;
      const kind = choice.answers.kind;
      // Every participant is in the denominator; a refusal is neither kind.
      pairs.push({ control: kind === "fragment" ? 1 : 0, variant: kind === "whole" ? 1 : 0 });
      if (!kind) refused += 1;
    }
    summary.comparisons.push(
      comparePairs(w.choseWholeMinusFragment, pairs, 0.15, "share", [w.fragment, w.whole]),
      compare(w.feltComplete, closure.fragment, closure.whole, 0, "points", [w.fragment, w.whole])
    );
    summary.facts.push({ label: w.choseNothing, value: percent(refused, pairs.length, w) });
  },
  a2(groups, summary, w) {
    const pairs: { control: number; variant: number }[] = [];
    const satisfaction: { control: number; variant: number }[] = [];
    for (const rows of groups.values()) {
      const sessions = sessionsOf(rows);
      const inline = sessions.find((session) => session.measurement.interface === "inline");
      const cards = sessions.find((session) => session.measurement.interface === "cards");
      if (inline && cards) {
        pairs.push({ control: cards.success ? 1 : 0, variant: inline.success ? 1 : 0 });
        const inlineScore = scale(inline.survey.sessionSatisfaction);
        const cardsScore = scale(cards.survey.sessionSatisfaction);
        if (inlineScore !== null && cardsScore !== null) satisfaction.push({ control: cardsScore, variant: inlineScore });
      }
    }
    summary.comparisons.push(
      comparePairs(w.successfulFind, pairs, 0.1, "share", [w.cards, w.inline]),
      comparePairs(w.satisfactionSecondary, satisfaction, 0, "points", [w.cards, w.inline])
    );
  },
  a3(groups, summary, w) {
    const pairs: { control: number; variant: number }[] = [];
    const precision: { control: number; variant: number }[] = [];
    let flat = 0;
    let incomplete = 0;
    let noDirection = 0;
    for (const rows of groups.values()) {
      const ranking = rows.find((row) => row.step === "ranking")?.answers as A3Ranking | undefined;
      if (!ranking) continue;
      const interest = a3TestInterest(rows);
      const targets = ranking.withProfile;
      if (targets.some((id) => interest[id] === undefined)) {
        incomplete += 1;
        continue;
      }
      if (!ranking.hasProfile) noDirection += 1;
      precision.push({ control: precisionAt(ranking.withoutProfile, interest), variant: precisionAt(ranking.withProfile, interest) });
      const withProfile = ndcgAt(ranking.withProfile, interest);
      const withoutProfile = ndcgAt(ranking.withoutProfile, interest);
      if (withProfile === null || withoutProfile === null) {
        flat += 1;
        continue;
      }
      pairs.push({ control: withoutProfile, variant: withProfile });
    }
    summary.comparisons.push(
      comparePairs(w.precision, precision, 0.1, "share", [w.withoutProfile, w.withProfile]),
      comparePairs(w.ndcg, pairs, 0, "score", [w.withoutProfile, w.withProfile])
    );
    summary.facts.push(
      { label: w.incomplete, value: String(incomplete) },
      { label: w.flat, value: String(flat) },
      { label: w.noDirection, value: String(noDirection) }
    );
  },
  b1(groups, summary, w) {
    const pairs: { control: number; variant: number }[] = [];
    const highPairs: { control: number; variant: number }[] = [];
    const active: number[] = [];
    const passive: number[] = [];
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    for (const rows of groups.values()) {
      const own: Record<"active" | "passive", number[]> = { active: [], passive: [] };
      for (const row of rows.filter((entry) => entry.step === "after_reading")) {
        const immersion = scale(row.answers.immersion);
        if (immersion === null) continue;
        const role = row.condition === "passive" ? "passive" : "active";
        own[role].push(immersion);
        (role === "active" ? active : passive).push(immersion);
      }
      if (own.active.length && own.passive.length) {
        pairs.push({ control: mean(own.passive), variant: mean(own.active) });
        highPairs.push({ control: mean(own.passive.map((value) => (value >= 6 ? 1 : 0))), variant: mean(own.active.map((value) => (value >= 6 ? 1 : 0))) });
      }
    }
    summary.comparisons.push(
      comparePairs(w.immersedShare, highPairs, 0.1, "share", [w.passive, w.active]),
      comparePairs(w.meanSecondary(w.immersionBoth), pairs, 0, "points", [w.passive, w.active]),
      compare(w.meanSecondary(w.immersionEvery), passive, active, 0, "points", [w.passive, w.active])
    );
  },
  b2(groups, summary, w) {
    const enjoyed: { control: number; variant: number }[] = [];
    const enjoyment: { control: number; variant: number }[] = [];
    const distraction: { control: number; variant: number }[] = [];
    let unpaired = 0;
    for (const rows of groups.values()) {
      const blocks: Partial<Record<"music" | "silence", Record<string, unknown>>> = {};
      for (const row of rows) {
        const mode = row.answers.mode;
        if (row.step !== "session_survey" || (mode !== "music" && mode !== "silence") || blocks[mode]) continue;
        blocks[mode] = row.answers;
      }
      const music = blocks.music;
      const silence = blocks.silence;
      if (!music || !silence) {
        if (music || silence) unpaired += 1;
        continue;
      }
      const withMusic = scale(music.enjoyment);
      const inSilence = scale(silence.enjoyment);
      if (withMusic !== null && inSilence !== null) {
        enjoyment.push({ control: inSilence, variant: withMusic });
        enjoyed.push({ control: inSilence >= 6 ? 1 : 0, variant: withMusic >= 6 ? 1 : 0 });
      }
      const distractedMusic = scale(music.distraction);
      const distractedSilence = scale(silence.distraction);
      if (distractedMusic !== null && distractedSilence !== null) distraction.push({ control: distractedSilence, variant: distractedMusic });
    }
    summary.comparisons.push(
      comparePairs(w.enjoyedShare, enjoyed, 0.1, "share", [w.silence, w.music]),
      comparePairs(w.meanSecondary("«Насколько вам понравился сам процесс чтения?», 1–7"), enjoyment, 0, "points", [w.silence, w.music]),
      comparePairs(w.distractionSecondary, distraction, 0, "points", [w.silence, w.music])
    );
    summary.facts.push({ label: w.oneBlockOnly, value: String(unpaired) });
  },
  b3() {
    // Fragments are summarised with their rows; see `summariseFragments`.
  },
};

export function summariseFragments(rows: readonly StudyResponseRow[], fragments: readonly StudyFragmentRow[]) {
  const ratings = new Map<string, { ratings: number; bothYes: number }>();
  for (const row of rows) {
    if (row.step !== "fragment_rating" || !row.fragmentId) continue;
    const entry = ratings.get(row.fragmentId) ?? { ratings: 0, bothYes: 0 };
    entry.ratings += 1;
    if (row.answers.standalone === "yes" && row.answers.complete === "yes") entry.bothYes += 1;
    ratings.set(row.fragmentId, entry);
  }
  const verdicts: FragmentVerdict[] = fragments.map((fragment) => {
    const entry = ratings.get(fragment.id) ?? { ratings: 0, bothYes: 0 };
    return { fragment, ...entry, accepted: entry.bothYes >= 2 };
  });
  const byMethod: Record<string, { rated: number; accepted: number; total: number }> = {};
  for (const verdict of verdicts) {
    const entry = byMethod[verdict.fragment.method] ?? { rated: 0, accepted: 0, total: 0 };
    entry.total += 1;
    if (verdict.ratings >= 3) entry.rated += 1;
    if (verdict.accepted) entry.accepted += 1;
    byMethod[verdict.fragment.method] = entry;
  }
  return { verdicts, byMethod };
}

export function summariseStudy(
  key: StudyKey,
  allRows: readonly StudyResponseRow[],
  options: { includeTeam?: boolean; fragments?: readonly StudyFragmentRow[]; language?: UiLanguage } = {}
): StudySummary {
  const w = resultWords[options.language ?? "en"];
  const rows = options.includeTeam ? allRows : allRows.filter((row) => !row.team);
  const groups = byParticipant(rows);
  const byCondition: Record<string, number> = {};
  let completed = 0;
  for (const list of groups.values()) {
    byCondition[list[0].participantCondition] = (byCondition[list[0].participantCondition] ?? 0) + 1;
    if (list[0].participantCompletedAt) completed += 1;
  }
  const summary: StudySummary = {
    key,
    participants: groups.size,
    completed,
    byCondition,
    comparisons: [],
    facts: [],
  };
  summarisers[key](groups, summary, w);
  if (key === "b3") {
    summary.fragments = summariseFragments(rows, options.fragments ?? []);
    const algorithm = summary.fragments.byMethod.algorithm;
    summary.facts.push({
      label: w.fragmentsAccepted,
      value: algorithm ? w.acceptedValue(algorithm.accepted, algorithm.total, algorithm.rated) : w.noneImported,
    });
  }
  return summary;
}

/** Flat rows for a spreadsheet: one line per response, answers as JSON. */
export function studyResponsesCsv(rows: readonly StudyResponseRow[]) {
  const header = ["id", "participant", "participant_condition", "seed", "team", "step", "condition", "bok", "fragment", "answers", "client_seconds", "created_at"];
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [
    header.join(","),
    ...rows.map((row) =>
      [row.id, row.participantId, row.participantCondition, row.participantSeed, row.team, row.step, row.condition, row.reelId, row.fragmentId, row.answers, row.clientSeconds, row.createdAt]
        .map(cell)
        .join(",")
    ),
  ].join("\n");
}
