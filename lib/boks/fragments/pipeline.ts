/**
 * The fragment pipeline: a long work in, the fragments that read on their own
 * out - possibly few, possibly none. See `docs/fragment-cutter.md`.
 *
 * Stages, cheap and certain first, the language model last and only where
 * the cheap ones point:
 *
 * 1. structure - paragraphs, headings, dialogue; paragraphs too long to cut
 *    around are split at sentence ends (`text.ts`).
 * 2. lexical - TextTiling depth at every gap (`cohesion.ts`).
 * 3. markers - "На другой день", "Meanwhile" at a paragraph's start (`markers.ts`).
 *    Fusion: the three signals become one boundary strength per gap.
 * 4. candidates - every run of whole paragraphs of 1-5 minutes, scored
 *    (`candidates.ts`), the best spread across the work (`chooseDiverse`).
 * 5. scenes (model) - the model marks scenes in the regions around the best
 *    candidates; its scene changes join the fusion and its ratings the score,
 *    and candidates are scored again (`scenes.ts`).
 * 6. refine (model) - the model may move each pooled candidate's edges to
 *    other paragraph boundaries (`refine.ts`).
 * 7. judge (model) - the model retells each and answers a checklist
 *    (`judge.ts`); a fragment the evidence agrees is bad is vetoed.
 * 8. tournament (model) - the survivors are compared in pairs, both orders,
 *    Swiss-style (`tournament.ts`): comparison separates what absolute
 *    scores do not.
 * 9. rank - the algorithm's score, the judge's and the tournament's
 *    combined. Only fragments that pass the bar are kept, so a work that
 *    does not cut well yields fewer fragments or none, with the reason.
 *
 * Without a model, stages 5-8 are skipped and the bar is the algorithm's own.
 * Every fragment, however it was chosen, is `source.slice(start, end)`.
 */

import { readingWordsPerMinute } from "@/components/boks/reader-behavior";
import { createRandom } from "@/lib/recsys/statistics/random";
import { chooseDiverse, scoreCandidates, type FragmentCandidate } from "@/lib/boks/fragments/candidates";
import { measureCohesion } from "@/lib/boks/fragments/cohesion";
import { combineJudgements, judgeScore, judgeTask, readJudgement, type Judgement } from "@/lib/boks/fragments/judge";
import { mapLimited, type LlmCall, type LlmTask, type LlmUsage } from "@/lib/boks/fragments/llm";
import { measureTransitions } from "@/lib/boks/fragments/markers";
import { readRefinement, refineTask, type Refinement } from "@/lib/boks/fragments/refine";
import { mergeScenes, planSceneChunks, readScenes, sceneTask, type SceneMap } from "@/lib/boks/fragments/scenes";
import { pairTask, readPair, scorePair, swissPairs, tournamentShare, type Match } from "@/lib/boks/fragments/tournament";
import { readingMinutes, splitLongParagraphs, splitParagraphs, type Paragraph } from "@/lib/boks/fragments/text";
import { drawWindows, type FragmentWindow } from "@/lib/boks/fragments/windows";
import { seedFor, type FragmentImportRow, type FragmentWork } from "@/lib/boks/fragments";

export type PipelineStage = "structure" | "lexical" | "markers" | "candidates" | "scenes" | "refine" | "judge" | "tournament" | "rank";

export type Strictness = "lenient" | "normal" | "strict";

/**
 * What the judge must not fall below for a fragment to be kept. The scales
 * come from the checklist (`judge.ts`): standalone 2.5 needs more than one of
 * its three signals positive; complete 2, at least one. "normal" was set on
 * the first runs over «Дуэль» and «Степь» with Alice AI, where an approval
 * bar ("standalone ≥ 3 and complete ≥ 3") kept nothing of either and this
 * one kept five of fifteen candidates in each, rejecting the two or three the
 * checklist found cut off or unclear. It is a first calibration, not a fitted
 * one; the admin page lets an editor choose.
 */
export const strictnessBars: Record<Strictness, { standalone: number; complete: number; judge: number }> = {
  lenient: { standalone: 2, complete: 1.5, judge: 0.25 },
  normal: { standalone: 2.5, complete: 2, judge: 0.35 },
  strict: { standalone: 3, complete: 3, judge: 0.5 },
};

export type PipelineProgress = { stage: PipelineStage; done: number; total: number; note?: string };

export type PipelineOptions = {
  /** Most fragments to keep. */
  perWork?: number;
  /** Candidates carried into the model stages; default three per fragment wanted, at most 24. */
  poolSize?: number;
  minMinutes?: number;
  maxMinutes?: number;
  /** Without it the pipeline runs offline. */
  llm?: LlmCall;
  stages?: { scenes?: boolean; refine?: boolean; judge?: boolean; tournament?: boolean };
  /** Scene chunks the model may read; the regions of the weakest candidates go first. */
  maxSceneCalls?: number;
  /** Judgements per fragment, averaged. */
  judgeVotes?: number;
  /** Swiss rounds; each round asks two calls per pair. */
  tournamentRounds?: number;
  concurrency?: number;
  /** How sure the judge must be that a fragment works. */
  strictness?: Strictness;
  /** For the Б3 windows. */
  seed?: number;
  onProgress?: (progress: PipelineProgress) => void;
  signal?: AbortSignal;
};

/** How the fusion weighs each signal: the chance it alone marks a real boundary. */
export const fusionWeights = { structure: 0.95, scene: 0.85, lexical: 0.7, marker: 0.5 };

/**
 * One boundary strength per gap from independent signals, combined as a
 * noisy-OR: the gap is a boundary unless every signal fails to make it one.
 * A heading is nearly certain on its own; a marker or a lexical valley alone
 * is suggestive; two together are stronger than either.
 */
export function fuseBoundaries(
  paragraphs: Paragraph[],
  lexicalDepth: number[],
  markers: number[],
  scenes?: number[],
) {
  const strongest = Math.max(1e-9, ...lexicalDepth.slice(1, paragraphs.length));
  return lexicalDepth.map((depth, gap) => {
    if (gap === 0 || gap === paragraphs.length) return 1;
    const structure = paragraphs[gap].heading || paragraphs[gap - 1].heading ? 1 : 0;
    const lexical = Math.min(1, depth / strongest);
    const signals: [number, number][] = [
      [fusionWeights.structure, structure],
      [fusionWeights.lexical, lexical],
      [fusionWeights.marker, markers[gap] ?? 0],
      [fusionWeights.scene, scenes?.[gap] ?? 0],
    ];
    return 1 - signals.reduce((none, [weight, value]) => none * (1 - weight * value), 1);
  });
}

export type FragmentScores = {
  /** The algorithm's score, then mapped to 0..1 within the pool. */
  algorithm: number;
  algorithmNormalised: number;
  judge: number | null;
  /** Share of tournament points, null when it did not play. */
  tournament: number | null;
  final: number;
};

export type PipelineFragment = {
  rank: number;
  firstParagraph: number;
  lastParagraph: number;
  start: number;
  end: number;
  words: number;
  minutes: number;
  /** Where the offline stages had put it, when the model moved its edges. */
  refinedFrom: { firstParagraph: number; lastParagraph: number; reason: string } | null;
  candidate: FragmentCandidate;
  judgement: Judgement | null;
  scores: FragmentScores;
};

export type RejectedFragment = Omit<PipelineFragment, "rank"> & { reasons: string[] };

export type StageReport = { stage: PipelineStage; ms: number; calls: number; failed: number; note: string };

export type PipelineResult = {
  work: FragmentWork;
  /** ok: as many as wanted; partial: fewer; none: the work did not cut. */
  status: "ok" | "partial" | "none";
  diagnosis: string[];
  fragments: PipelineFragment[];
  rejected: RejectedFragment[];
  windows: FragmentWindow[];
  stages: StageReport[];
  scenes: SceneMap | null;
  stats: { words: number; paragraphs: number; splitParagraphs: number; headings: number; dialogueShare: number; candidates: number };
  usage: LlmUsage & { calls: number };
  modelChecked: boolean;
};

export async function runFragmentPipeline(work: FragmentWork, options: PipelineOptions = {}): Promise<PipelineResult> {
  const {
    perWork = 5,
    minMinutes = 1,
    maxMinutes = 5,
    llm,
    maxSceneCalls = 16,
    judgeVotes = 1,
    tournamentRounds = 3,
    concurrency = 3,
    strictness = "normal",
    seed = 1,
    onProgress,
    signal,
  } = options;
  const poolSize = Math.min(24, Math.max(perWork, options.poolSize ?? perWork * 3));
  const stages = { scenes: true, refine: true, judge: true, tournament: true, ...options.stages };
  const bar = strictnessBars[strictness];
  const useModel = Boolean(llm);
  const source = work.text;
  const reports: StageReport[] = [];
  const usage = { promptTokens: 0, completionTokens: 0, calls: 0 };
  const diagnosis: string[] = [];

  let clock = now();
  const report = (stage: PipelineStage, note: string, calls = 0, failed = 0) => {
    const at = now();
    reports.push({ stage, ms: Math.round(at - clock), calls, failed, note });
    clock = at;
    onProgress?.({ stage, done: 1, total: 1, note });
  };
  const ask = async (task: LlmTask) => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const reply = await llm!(task);
    usage.calls += 1;
    if (reply.usage) {
      usage.promptTokens += reply.usage.promptTokens;
      usage.completionTokens += reply.usage.completionTokens;
    }
    return reply.json;
  };

  // 1. Structure.
  const maxParagraphWords = Math.floor(maxMinutes * readingWordsPerMinute * 0.5);
  const authorParagraphs = splitParagraphs(source);
  const paragraphs = splitLongParagraphs(source, authorParagraphs, maxParagraphWords);
  const words = paragraphs.reduce((sum, paragraph) => sum + paragraph.words, 0);
  const stats = {
    words,
    paragraphs: authorParagraphs.length,
    splitParagraphs: paragraphs.length - authorParagraphs.length,
    headings: paragraphs.filter((paragraph) => paragraph.heading).length,
    dialogueShare: paragraphs.length ? paragraphs.filter((paragraph) => paragraph.dialogue).length / paragraphs.length : 0,
    candidates: 0,
  };
  report("structure", `${authorParagraphs.length} paragraphs, ${words} words` + (stats.splitParagraphs ? `; long paragraphs split into ${stats.splitParagraphs} more pieces` : ""));

  const empty = (reason: string): PipelineResult => ({
    work, status: "none", diagnosis: [...diagnosis, reason], fragments: [], rejected: [], windows: [], stages: reports,
    scenes: null, stats, usage, modelChecked: false,
  });
  if (readingMinutes(words) < minMinutes) return empty(`The whole text reads in ${readingMinutes(words).toFixed(1)} min, under the ${minMinutes}-minute minimum: it is a bok already, not a work to cut.`);

  // 2-3. Lexical cohesion and markers, fused.
  const cohesion = measureCohesion(source, paragraphs);
  report("lexical", `TextTiling over ${paragraphs.length - 1} gaps`);
  const markers = measureTransitions(source, paragraphs);
  const markerCount = markers.filter((value) => value > 0).length;
  let boundaries = fuseBoundaries(paragraphs, cohesion.depth, markers);
  report("markers", `${markerCount} transition markers`);

  // 4. Candidates.
  const scoreAll = (paragraphQuality?: (number | null)[]) =>
    scoreCandidates(source, paragraphs, cohesion, { minMinutes, maxMinutes, boundaries, paragraphQuality, allowHeadingStart: false });
  let candidates = scoreAll();
  stats.candidates = candidates.length;
  if (candidates.length === 0) {
    return empty(`No run of whole paragraphs reads in ${minMinutes}-${maxMinutes} minutes without starting or ending on a title.`);
  }
  report("candidates", `${candidates.length} spans of ${minMinutes}-${maxMinutes} min`);

  // 5. Scenes.
  let scenes: SceneMap | null = null;
  if (useModel && stages.scenes) {
    const chunks = planSceneChunks(paragraphs, chooseDiverse(candidates, poolSize * 2, source.length), { maxChunks: maxSceneCalls });
    let done = 0;
    const answers = await mapLimited(chunks, concurrency, async (chunk) => {
      let answer = null;
      try {
        answer = readScenes(await ask(sceneTask(source, paragraphs, chunk, work)), chunk);
      } catch (error) {
        if (isAbort(error)) throw error;
      }
      onProgress?.({ stage: "scenes", done: ++done, total: chunks.length });
      return answer;
    });
    scenes = mergeScenes(paragraphs.length, chunks, answers);
    boundaries = fuseBoundaries(paragraphs, cohesion.depth, markers, scenes.boundary);
    const seen = scenes.covered;
    // Only spans the model saw whole compete from here: elsewhere a missing
    // scene signal would read as "no scene change", which it is not.
    const rescored = scoreAll(scenes.quality).filter((candidate) => {
      for (let gap = candidate.firstParagraph + 1; gap <= candidate.lastParagraph; gap += 1) if (!seen[gap]) return false;
      return true;
    });
    if (rescored.length > 0) candidates = rescored;
    else diagnosis.push("The scene stage left no candidate inside what it read; ranking on the offline signals.");
    report("scenes", `${scenes.scenes.length} scenes in ${chunks.length} chunks`, chunks.length, scenes.failed);
  }

  const byspan = new Map(candidates.map((candidate) => [`${candidate.firstParagraph}:${candidate.lastParagraph}`, candidate]));
  let pool = chooseDiverse(candidates, useModel ? poolSize : perWork * 2, source.length);

  // 6. Refine.
  const refinedFrom = new Map<FragmentCandidate, Refinement & { original: FragmentCandidate }>();
  if (useModel && stages.refine) {
    let done = 0;
    let failed = 0;
    const refined = await mapLimited(pool, concurrency, async (candidate) => {
      let next = candidate;
      try {
        const refinement = readRefinement(await ask(refineTask(source, paragraphs, candidate, work, { minMinutes, maxMinutes })), paragraphs, candidate, { minMinutes, maxMinutes });
        if (!refinement) failed += 1;
        const moved = refinement && (refinement.first !== candidate.firstParagraph || refinement.last !== candidate.lastParagraph);
        const replacement = moved ? byspan.get(`${refinement.first}:${refinement.last}`) : undefined;
        if (refinement && replacement) {
          next = replacement;
          refinedFrom.set(replacement, { ...refinement, original: candidate });
        }
      } catch (error) {
        if (isAbort(error)) throw error;
        failed += 1;
      }
      onProgress?.({ stage: "refine", done: ++done, total: pool.length });
      return next;
    });
    // Two candidates may have grown into each other: keep the earlier-ranked.
    pool = [];
    for (const candidate of refined) {
      if (!pool.some((other) => candidate.firstParagraph <= other.lastParagraph && other.firstParagraph <= candidate.lastParagraph)) pool.push(candidate);
    }
    report("refine", `${refinedFrom.size} of ${refined.length} moved`, refined.length, failed);
  }

  // 7. Judge.
  const judgements = new Map<FragmentCandidate, Judgement | null>();
  if (useModel && stages.judge) {
    let done = 0;
    let failed = 0;
    await mapLimited(pool, concurrency, async (candidate) => {
      const body = source.slice(candidate.start, candidate.end);
      const votes: Judgement[] = [];
      for (let vote = 0; vote < Math.max(1, judgeVotes); vote += 1) {
        try {
          // A later vote differs only by a marker the model ignores, so the cache does not answer it.
          const task = judgeTask(body, work);
          const judgement = readJudgement(await ask(vote ? { ...task, user: `${task.user}\n<!-- ${vote} -->` } : task));
          if (judgement) votes.push(judgement);
        } catch (error) {
          if (isAbort(error)) throw error;
        }
      }
      if (votes.length === 0) failed += 1;
      judgements.set(candidate, combineJudgements(votes));
      onProgress?.({ stage: "judge", done: ++done, total: pool.length });
    });
    report("judge", `${pool.length - failed} of ${pool.length} judged`, pool.length * Math.max(1, judgeVotes), failed);
  }

  // 8. Tournament, among the fragments nothing has vetoed.
  const judged = useModel && stages.judge;
  const low = Math.min(...pool.map((candidate) => candidate.score));
  const high = Math.max(...pool.map((candidate) => candidate.score));
  const prepared = pool.map((candidate) => {
    const judgement = judgements.get(candidate) ?? null;
    const algorithmNormalised = high > low ? (candidate.score - low) / (high - low) : 0.5;
    const judge = judgement ? judgeScore(judgement) : null;
    const reasons = rejectionReasons(candidate, judgement, judge, judged, bar);
    const preliminary = judge === null ? algorithmNormalised : 0.35 * algorithmNormalised + 0.65 * judge;
    return { candidate, judgement, algorithmNormalised, judge, reasons, preliminary, tournament: null as number | null };
  });

  if (useModel && stages.tournament && tournamentRounds > 0) {
    const entrants = prepared
      .filter((item) => item.reasons.length === 0)
      .sort((a, b) => b.preliminary - a.preliminary)
      .slice(0, Math.min(10, Math.max(6, perWork * 2)));
    if (entrants.length >= 2) {
      const bodies = entrants.map((item) => source.slice(item.candidate.start, item.candidate.end));
      const matches: Match[] = [];
      let calls = 0;
      let failed = 0;
      const rounds = Math.min(tournamentRounds, entrants.length - 1);
      for (let round = 0; round < rounds; round += 1) {
        const pairs = swissPairs(entrants.length, matches);
        if (pairs.length === 0) break;
        const played = await mapLimited(pairs, concurrency, async ([left, right]) => {
          const answer = async (a: number, b: number) => {
            try {
              return readPair(await ask(pairTask(bodies[a], bodies[b], work)));
            } catch (error) {
              if (isAbort(error)) throw error;
              return null;
            }
          };
          const [forward, backward] = await Promise.all([answer(left, right), answer(right, left)]);
          calls += 2;
          if (!forward) failed += 1;
          if (!backward) failed += 1;
          return { left, right, points: scorePair(forward, backward) } satisfies Match;
        });
        matches.push(...played);
        onProgress?.({ stage: "tournament", done: round + 1, total: rounds });
      }
      const shares = tournamentShare(entrants.length, matches);
      entrants.forEach((item, index) => (item.tournament = shares[index]));
      const decided = matches.filter((match) => match.points[0] !== 0.5).length;
      report("tournament", `${entrants.length} fragments, ${matches.length} pairs, ${decided} decided both ways`, calls, failed);
    }
  }

  // 9. Rank and accept.
  const scored = prepared.map((item) => {
    const { candidate, judgement, algorithmNormalised, judge, tournament } = item;
    const final = tournament !== null
      ? 0.2 * algorithmNormalised + 0.3 * (judge ?? algorithmNormalised) + 0.5 * tournament
      : item.preliminary;
    const origin = refinedFrom.get(candidate);
    const entry: Omit<PipelineFragment, "rank"> = {
      firstParagraph: candidate.firstParagraph,
      lastParagraph: candidate.lastParagraph,
      start: candidate.start,
      end: candidate.end,
      words: candidate.words,
      minutes: candidate.minutes,
      refinedFrom: origin ? { firstParagraph: origin.original.firstParagraph, lastParagraph: origin.original.lastParagraph, reason: origin.reason } : null,
      candidate,
      judgement,
      scores: { algorithm: candidate.score, algorithmNormalised, judge, tournament, final },
    };
    return { entry, reasons: item.reasons };
  })
    // Those that played the tournament were the strongest going in; one that
    // lost every match still ranks above one that did not qualify.
    .sort((a, b) => Number(b.entry.scores.tournament !== null) - Number(a.entry.scores.tournament !== null) || b.entry.scores.final - a.entry.scores.final);

  const kept = scored.filter((item) => item.reasons.length === 0).slice(0, perWork);
  const fragments = kept.map((item, index) => ({ ...item.entry, rank: index + 1 }));
  const rejected = scored.filter((item) => !kept.includes(item)).map((item) => ({
    ...item.entry,
    reasons: item.reasons.length ? item.reasons : ["Passed, but the work already has enough better fragments."],
  }));

  if (fragments.length === 0) {
    const counts = new Map<string, number>();
    for (const item of scored) for (const reason of item.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    diagnosis.push(`None of the ${scored.length} best candidates passed:`, ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => `${count} × ${reason}`));
  } else if (fragments.length < perWork) {
    diagnosis.push(`Only ${fragments.length} of the ${scored.length} best candidates passed the bar.`);
  }
  if (useModel && usage.calls > 0 && reports.some((entry) => entry.failed > 0 && entry.failed === entry.calls)) {
    diagnosis.push("A model stage failed on every call; check the model's availability before trusting this order.");
  }

  const windows = drawWindows(source, paragraphs, fragments, createRandom(seedFor(seed, work.sourceTitle)));
  report("rank", `${fragments.length} kept, ${rejected.length} not`);

  return {
    work,
    status: fragments.length === 0 ? "none" : fragments.length < perWork ? "partial" : "ok",
    diagnosis,
    fragments,
    rejected,
    windows,
    stages: reports,
    scenes,
    stats,
    usage,
    modelChecked: judged && judgements.size > 0,
  };
}

/**
 * Why a candidate does not make it. Ending mid-sentence is always fatal. With
 * a judge, the scales from its checklist against the strictness bar; the bar
 * is a veto on agreed evidence, not a demand for a perfect score, because a
 * model asked about one excerpt in isolation leans to "it is incomplete"
 * whatever the excerpt. Without one, the algorithm's own red flags: a
 * fragment that stops mid-conversation, or whose edges sit where nothing
 * marks a boundary.
 */
function rejectionReasons(
  candidate: FragmentCandidate,
  judgement: Judgement | null,
  judge: number | null,
  judged: boolean,
  bar: { standalone: number; complete: number; judge: number },
) {
  const reasons: string[] = [];
  if (candidate.cues.includes("unfinished_sentence")) reasons.push("ends mid-sentence");
  if (judged) {
    if (!judgement || judge === null) return [...reasons, "the model gave no usable judgement"];
    if (judgement.standalone < bar.standalone) reasons.push(`not understandable without the book (standalone ${judgement.standalone.toFixed(1)} < ${bar.standalone})`);
    if (judgement.complete < bar.complete) reasons.push(`does not come to a close (complete ${judgement.complete.toFixed(1)} < ${bar.complete})`);
    if (judge < bar.judge) reasons.push(`judge score ${judge.toFixed(2)} < ${bar.judge}`);
    return reasons;
  }
  if (candidate.cues.includes("ends_mid_dialogue")) reasons.push("ends mid-dialogue");
  if (candidate.boundary < 0.4) reasons.push("weak boundaries at its edges");
  return reasons;
}

/** Rows for Studio → Studies → Б3, as the CLI writes them. */
export function pipelineImportRows(result: PipelineResult): FragmentImportRow[] {
  const { sourceTitle, sourceAuthor, language, text } = result.work;
  const base = { sourceTitle, sourceAuthor, language };
  return [
    ...result.fragments.map((fragment) => ({ ...base, method: "algorithm" as const, body: text.slice(fragment.start, fragment.end), rank: fragment.rank })),
    ...result.windows.map((window) => ({ ...base, method: "window" as const, body: text.slice(window.start, window.end), rank: null })),
  ];
}

function isAbort(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function now() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
