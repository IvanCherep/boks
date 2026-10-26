import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { studyConditions, studyKeys } from "@/lib/boks/studies/protocol";
import { materialBokIds, materialTemplates, parseStudyMaterials } from "@/lib/boks/studies/materials";
import { b2PieceFor, b2Showcase, planA1, planA2, planB1, planB2, planRg1 } from "@/lib/boks/studies/plan";
import { successfulFind, type SessionMeasurement } from "@/lib/boks/studies/session";
import { studyResponsesCsv, summariseStudy, type StudyResponseRow } from "@/lib/boks/studies/results";
import { createTraceRecorder, dueSamples, isGestureTrace, type GestureTrace } from "@/lib/boks/studies/gesture-trace";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("study protocol", () => {
  it("assigns the conditions the database assigns", () => {
    const migration = readFileSync("supabase/migrations/20261026100000_boks_studies.sql", "utf8");
    for (const key of studyKeys) {
      const line = migration.match(new RegExp(`when '${key}' then array\\[([^\\]]*)\\]`));
      expect(line, key).not.toBeNull();
      const conditions = [...line![1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
      expect(conditions, key).toEqual([...studyConditions[key]]);
    }
  });
});

describe("study materials", () => {
  it("refuses an empty template, so a study cannot run without its texts", () => {
    for (const key of studyKeys.filter((key) => key !== "rg2" && key !== "b3")) {
      expect(parseStudyMaterials(key, materialTemplates[key]).ok, key).toBe(false);
    }
    expect(parseStudyMaterials("rg2", materialTemplates.rg2).ok).toBe(true);
  });

  it("names what is wrong", () => {
    const parsed = parseStudyMaterials("a2", { setA: [id(1), id(2), id(3)], setB: [id(3), id(4), "nope"] });
    expect(parsed.ok).toBe(false);
    expect(parsed.problems).toContain("setB[2] must be a bok id.");
    expect(parsed.problems).toContain("setA and setB must not share a bok.");
  });

  it("accepts a complete a1 set and lists its boks", () => {
    const raw = {
      pairs: [1, 2, 3, 4].map((n) => ({ whole: id(n), fragment: id(n + 10) })),
      choices: [
        { bokId: id(21), kind: "whole" }, { bokId: id(22), kind: "whole" },
        { bokId: id(23), kind: "fragment" }, { bokId: id(24), kind: "fragment" },
      ],
    };
    expect(parseStudyMaterials("a1", raw).ok).toBe(true);
    expect(materialBokIds("a1", raw)).toHaveLength(12);
  });
});

describe("study plans", () => {
  it("is the same plan for the same seed", () => {
    const materials = { familiarization: id(1), targets: [id(2), id(3), id(4)] };
    expect(planRg1(materials, "series", 7)).toEqual(planRg1(materials, "series", 7));
    expect(planRg1(materials, "text", 7).target.format).toBe("text");
    expect(planRg1(materials, "series", 7).familiarization.formats.sort()).toEqual(["series", "text"]);
  });

  it("gives a1 one whole work and one fragment from different pairs, in the condition's order", () => {
    const materials = {
      pairs: [1, 2, 3, 4].map((n) => ({ whole: id(n), fragment: id(n + 10) })),
      choices: [
        ...[21, 22, 23].map((n) => ({ bokId: id(n), kind: "whole" as const })),
        ...[24, 25, 26].map((n) => ({ bokId: id(n), kind: "fragment" as const })),
      ],
    };
    for (let seed = 1; seed < 50; seed += 1) {
      const plan = planA1(materials, "fragment_first", seed);
      expect(plan.reads.map((read) => read.kind)).toEqual(["fragment", "whole"]);
      const wholePair = materials.pairs.findIndex((pair) => pair.whole === plan.reads[1].bokId);
      const fragmentPair = materials.pairs.findIndex((pair) => pair.fragment === plan.reads[0].bokId);
      expect(wholePair).not.toBe(fragmentPair);
      expect(plan.choices.filter((choice) => choice.kind === "whole")).toHaveLength(2);
      expect(plan.choices.filter((choice) => choice.kind === "fragment")).toHaveLength(2);
    }
  });

  it("swaps both interface and set in a2's second session", () => {
    const plan = planA2({ minutes: 10, setA: [id(1)], setB: [id(2)] }, "cards_b");
    expect(plan.sessions.map((session) => [session.interface, session.set])).toEqual([["cards", "b"], ["inline", "a"]]);
  });

  it("takes as many b1 pieces as asked", () => {
    expect(planB1({ pieces: [id(1), id(2), id(3)], perParticipant: 2 }, 3).pieces).toHaveLength(2);
  });

  it("meets b2's author through a piece whose author is unknown, and offers exactly one other text by them", () => {
    const materials = {
      pieces: [
        { series: id(1), author: "Edgar Allan Poe", sameAuthor: [id(2), id(3)], others: [id(4), id(5), id(6)] },
        { series: id(7), author: "Emily Dickinson", sameAuthor: [id(8)], others: [id(9), id(10)] },
      ],
      distractorAuthors: ["Robert Burns"],
    };
    const plan = planB2(materials, 11);
    expect(plan.screeningAuthors.sort()).toEqual(["Edgar Allan Poe", "Emily Dickinson", "Robert Burns"]);
    expect(b2PieceFor(materials, plan, ["edgar allan poe"])?.author).toBe("Emily Dickinson");
    expect(b2PieceFor(materials, plan, ["Edgar Allan Poe", "Emily Dickinson"])).toBeNull();
    const showcase = b2Showcase(materials.pieces[0], 11);
    expect(showcase.filter((entry) => entry.sameAuthor)).toHaveLength(1);
    expect(showcase).toHaveLength(4);
  });
});

describe("successful session", () => {
  const measurement: SessionMeasurement = {
    interface: "feed",
    minutes: 10,
    offered: [id(1), id(2)],
    reads: [
      { bokId: id(1), openedAt: 20, activeSeconds: 40, progress: 1, scrollable: true, outcome: "complete" },
      { bokId: id(2), openedAt: 90, activeSeconds: 5, progress: 0.1, scrollable: true, outcome: "skip" },
    ],
    endedBy: "timer",
    elapsedSeconds: 600,
  };

  it("needs a new text, read by both accounts, and a satisfied choice", () => {
    const survey = { perBok: { [id(1)]: { readBefore: "no" as const, finished: "yes" as const } }, satisfaction: 4 };
    expect(successfulFind(measurement, survey)).toBe(id(1));
    expect(successfulFind(measurement, { ...survey, satisfaction: 3 })).toBeNull();
    expect(successfulFind(measurement, { ...survey, perBok: { [id(1)]: { readBefore: "yes", finished: "yes" } } })).toBeNull();
    expect(successfulFind(measurement, { ...survey, perBok: { [id(1)]: { readBefore: "no", finished: "part" } } })).toBeNull();
  });
});

describe("study results", () => {
  let nextId = 0;
  const row = (participant: number, partial: Partial<StudyResponseRow>): StudyResponseRow => ({
    id: (nextId += 1),
    participantId: id(participant),
    participantCondition: "series",
    participantSeed: participant,
    participantCompletedAt: "2026-11-01T10:00:00Z",
    team: false,
    step: "after_reading",
    reelId: id(100),
    fragmentId: null,
    condition: "series",
    answers: {},
    clientSeconds: 60,
    createdAt: "2026-11-01T10:00:00Z",
    ...partial,
  });

  it("compares rg1's two scales between formats and leaves the team out", () => {
    const rows: StudyResponseRow[] = [];
    for (let n = 1; n <= 12; n += 1) {
      const series = n % 2 === 0;
      rows.push(row(n, {
        participantCondition: series ? "series" : "text",
        condition: series ? "series" : "text",
        answers: { phase: "target", moved: series ? 6 : 4, thought: series ? 5 : 5 },
      }));
    }
    rows.push(row(99, { team: true, answers: { phase: "target", moved: 1, thought: 1 } }));
    const summary = summariseStudy("rg1", rows);
    expect(summary.participants).toBe(12);
    expect(summary.comparisons[0].result.effect).toBe(2);
    expect(summary.comparisons[0].meetsThreshold).toBe(true);
    expect(summary.comparisons[1].meetsThreshold).toBe(false);
  });

  it("counts a1 refusals in the denominator", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) =>
      row(n, { step: "choice", answers: { kind: n <= 3 ? "whole" : n === 4 ? "fragment" : null } })
    );
    const summary = summariseStudy("a1", rows);
    expect(summary.comparisons[0].result.effect).toBeCloseTo(2 / 6, 4);
    expect(summary.facts[0].value).toBe("2 of 6 (33%)");
  });

  it("accepts a b3 fragment on two of three yeses to both questions", () => {
    const fragment = { id: id(500), batch: "b", method: "algorithm" as const, sourceTitle: "", sourceAuthor: "", language: "ru", rank: 1, wordCount: 100, createdAt: "" };
    const rows = [
      row(1, { step: "fragment_rating", fragmentId: id(500), answers: { standalone: "yes", complete: "yes" } }),
      row(2, { step: "fragment_rating", fragmentId: id(500), answers: { standalone: "yes", complete: "unsure" } }),
      row(3, { step: "fragment_rating", fragmentId: id(500), answers: { standalone: "yes", complete: "yes" } }),
    ];
    const summary = summariseStudy("b3", rows, { fragments: [fragment] });
    expect(summary.fragments?.verdicts[0]).toMatchObject({ ratings: 3, bothYes: 2, accepted: true });
    expect(summary.fragments?.byMethod.algorithm).toEqual({ rated: 1, accepted: 1, total: 1 });
  });

  it("quotes answers in the CSV", () => {
    const csv = studyResponsesCsv([row(1, { answers: { note: "a, \"b\"" } })]);
    expect(csv.split("\n")[1]).toContain('"{""note"":""a, \\""b\\""""}"');
  });
});

describe("b1 gesture trace", () => {
  it("keeps every press and release, thins the moves, and counts what happened while paused", () => {
    const recorder = createTraceRecorder(60_000);
    recorder.add("down", 1000, 0.2, 0.3, { now: 0, paused: false });
    recorder.add("move", 1010, 0.25, 0.3, { now: 10, paused: false });
    recorder.add("move", 1020, 0.3, 0.3, { now: 20, paused: false });
    recorder.add("move", 1050, 0.4, 0.3, { now: 50, paused: false });
    recorder.add("up", 1060, 1.4, -0.2, { now: 60, paused: true });
    const trace = recorder.trace();
    expect(trace.samples.map((sample) => sample[1])).toEqual(["down", "move", "move", "up"]);
    expect(trace.samples.at(-1)).toEqual([1060, "up", 1, 0]);
    expect(trace.pausedSamples).toBe(1);
    expect(isGestureTrace(trace)).toBe(true);
  });

  it("replays samples as the recording's clock passes them, and lets go on a seek back", () => {
    const trace = { version: 1 as const, durationMs: 10_000, pausedSamples: 0, samples: [
      [1000, "down", 0.5, 0.5], [1500, "move", 0.6, 0.5], [2000, "up", 0.6, 0.5], [5000, "down", 0.1, 0.1],
    ] as GestureTrace["samples"] };
    const first = dueSamples(trace, 0, 0, 1600);
    expect(first.due.map((sample) => sample[1])).toEqual(["down", "move"]);
    const second = dueSamples(trace, first.cursor, 1600, 2100);
    expect(second.due.map((sample) => sample[1])).toEqual(["up"]);
    const back = dueSamples(trace, second.cursor, 2100, 1200);
    expect(back).toMatchObject({ due: [], cursor: 1, released: true });
    expect(dueSamples(trace, back.cursor, 1200, 6000).due).toHaveLength(3);
  });
});
