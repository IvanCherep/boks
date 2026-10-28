import { comparePaired, compareIndependent } from "@/lib/recsys/statistics";
import type { ComparisonResult } from "@/lib/recsys/statistics/types";
import type { StudyKey } from "@/lib/boks/studies/protocol";
import { successfulFind, type SessionMeasurement, type SessionSurvey } from "@/lib/boks/studies/session";
import { ndcgAt, type A3Ranking } from "@/lib/boks/studies/a3";

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

function percent(numerator: number, denominator: number) {
  return denominator ? `${numerator} of ${denominator} (${Math.round((numerator / denominator) * 100)}%)` : "none yet";
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

const summarisers: { [K in StudyKey]: (groups: Map<string, StudyResponseRow[]>, summary: StudySummary) => void } = {
  rg1(groups, summary) {
    const moved: Record<"series" | "text", number[]> = { series: [], text: [] };
    const thought: Record<"series" | "text", number[]> = { series: [], text: [] };
    for (const rows of groups.values()) {
      const answer = rows.find((row) => row.step === "after_reading" && row.answers.phase === "target");
      if (!answer) continue;
      const format = answer.condition === "series" ? "series" : "text";
      const m = scale(answer.answers.moved);
      const t = scale(answer.answers.thought);
      if (m !== null) moved[format].push(m);
      if (t !== null) thought[format].push(t);
    }
    summary.comparisons.push(
      compare("«Произведение меня тронуло», 1–7", moved.text, moved.series, 0.5, "points", ["Text", "Series"]),
      compare("«Произведение заставило задуматься», 1–7", thought.text, thought.series, 0.5, "points", ["Text", "Series"])
    );
  },
  rg2(groups, summary) {
    const satisfaction: { control: number; variant: number }[] = [];
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
      if (feedScore !== null && catalogueScore !== null) satisfaction.push({ control: catalogueScore, variant: feedScore });
      const feedMoved = scale(feed.survey.moved);
      const catalogueMoved = scale(catalogue.survey.moved);
      if (feedMoved !== null && catalogueMoved !== null) moved.push({ control: catalogueMoved, variant: feedMoved });
      success.push({ control: catalogue.success ? 1 : 0, variant: feed.success ? 1 : 0 });
      none += [feed, catalogue].filter((session) => session.measurement.reads.length === 0).length;
    }
    summary.comparisons.push(
      comparePairs("«Насколько вы довольны этим сеансом выбора и чтения?», 1–7", satisfaction, 0.5, "points", ["Catalogue", "Feed"]),
      comparePairs("«Прочитанное меня тронуло», 1–7 (secondary; both sessions with a text)", moved, 0, "points", ["Catalogue", "Feed"]),
      comparePairs("Successful session (secondary)", success, 0, "share", ["Catalogue", "Feed"])
    );
    summary.facts.push({ label: "Sessions with nothing opened (still rated for satisfaction)", value: String(none) });
  },
  a1(groups, summary) {
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
      comparePairs("Chose a whole work minus chose a fragment", pairs, 0.15, "share", ["Fragment", "Whole"]),
      compare("Felt complete, 1–7", closure.fragment, closure.whole, 0, "points", ["Fragment", "Whole"])
    );
    summary.facts.push({ label: "Chose nothing", value: percent(refused, pairs.length) });
  },
  a2(groups, summary) {
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
      comparePairs("Session with a successful find", pairs, 0.1, "share", ["Card + reading screen", "Text in the feed"]),
      comparePairs("Session satisfaction, 1–7 (secondary)", satisfaction, 0, "points", ["Card + reading screen", "Text in the feed"])
    );
  },
  a3(groups, summary) {
    const pairs: { control: number; variant: number }[] = [];
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
      const withProfile = ndcgAt(ranking.withProfile, interest);
      const withoutProfile = ndcgAt(ranking.withoutProfile, interest);
      if (withProfile === null || withoutProfile === null) {
        flat += 1;
        continue;
      }
      pairs.push({ control: withoutProfile, variant: withProfile });
    }
    summary.comparisons.push(
      comparePairs("NDCG@5 of the ten new texts", pairs, 0.05, "score", ["Without profile", "Profile from five boks"])
    );
    summary.facts.push(
      { label: "Profile fixed, ten not all rated yet (can return later)", value: String(incomplete) },
      { label: "Every one of the ten rated 1 (no order is better; left out)", value: String(flat) },
      { label: "Five ratings all at 3 (no profile; both orders the same, kept in)", value: String(noDirection) }
    );
  },
  b1(groups, summary) {
    const pairs: { control: number; variant: number }[] = [];
    const active: number[] = [];
    const passive: number[] = [];
    for (const rows of groups.values()) {
      const own: Record<"active" | "passive", number[]> = { active: [], passive: [] };
      for (const row of rows.filter((entry) => entry.step === "after_reading")) {
        const a = scale(row.answers.intensity);
        const b = scale(row.answers.feeling);
        if (a === null || b === null) continue;
        const role = row.condition === "passive" ? "passive" : "active";
        own[role].push((a + b) / 2);
        (role === "active" ? active : passive).push((a + b) / 2);
      }
      if (own.active.length && own.passive.length) {
        const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
        pairs.push({ control: mean(own.passive), variant: mean(own.active) });
      }
    }
    summary.comparisons.push(
      comparePairs("Emotional intensity, participants in both roles", pairs, 0.5, "points", ["Passive", "Active"]),
      compare("Emotional intensity, every rating", passive, active, 0.5, "points", ["Passive", "Active"])
    );
  },
  b2(groups, summary) {
    const started: Record<"series" | "text", number[]> = { series: [], text: [] };
    let screenedOut = 0;
    for (const rows of groups.values()) {
      const screening = rows.find((row) => row.step === "familiarity");
      if (screening && screening.answers.eligible === false) {
        screenedOut += 1;
        continue;
      }
      const choice = rows.find((row) => row.step === "choice");
      if (!choice) continue;
      const condition = choice.condition === "series" ? "series" : "text";
      started[condition].push(choice.answers.sameAuthor === true && choice.answers.started === true ? 1 : 0);
    }
    summary.comparisons.push(
      compare("Chose and started another text by the author", started.text, started.series, 0.15, "share", ["Text", "Series"])
    );
    summary.facts.push({ label: "Knew every author offered (left out)", value: String(screenedOut) });
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
  options: { includeTeam?: boolean; fragments?: readonly StudyFragmentRow[] } = {}
): StudySummary {
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
  summarisers[key](groups, summary);
  if (key === "b3") {
    summary.fragments = summariseFragments(rows, options.fragments ?? []);
    const algorithm = summary.fragments.byMethod.algorithm;
    summary.facts.push({
      label: "Algorithm fragments accepted (target: 80 of 100)",
      value: algorithm ? `${algorithm.accepted} of ${algorithm.total}, ${algorithm.rated} with three ratings` : "none imported",
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
