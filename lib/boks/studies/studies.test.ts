import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { a1InstrumentVersion, a2InstrumentVersion, studyConditions, studyKeys } from "@/lib/boks/studies/protocol";
import { materialBokIds, materialTemplates, parseStudyMaterials } from "@/lib/boks/studies/materials";
import { planA1, planA2, planB1, planB2, planRg1, planRg2 } from "@/lib/boks/studies/plan";
import { ndcgAt, planA3Targets, profileVector, rankA3, type A3Candidate } from "@/lib/boks/studies/a3";
import { easyChoice, successfulFind, type SessionMeasurement } from "@/lib/boks/studies/session";
import { studyResponsesCsv, summariseStudy, type StudyResponseRow } from "@/lib/boks/studies/results";
import { createTraceRecorder, dueSamples, isGestureTrace, type GestureTrace } from "@/lib/boks/studies/gesture-trace";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("study protocol", () => {
  it("assigns the conditions the database assigns", () => {
    // The latest migration that defines the list is the one in force.
    const latest = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
      .filter((sql) => sql.includes("function public.boks_study_conditions"))
      .at(-1)!;
    const migration = latest;
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
      expect(plan.choices.filter((choice) => choice.kind === "whole")).toHaveLength(1);
      expect(plan.choices.filter((choice) => choice.kind === "fragment")).toHaveLength(1);
      expect(plan.choices.every((choice) => !plan.reads.some((read) => read.bokId === choice.bokId))).toBe(true);
    }
  });

  it("swaps both interface and set in a2's second session", () => {
    const plan = planA2({ minutes: 10, setA: [id(1)], setB: [id(2)] }, "cards_b");
    expect(plan.sessions.map((session) => [session.interface, session.set])).toEqual([["cards", "b"], ["inline", "a"]]);
  });

  it("splits rg2's slate into two sessions with different texts, in the condition's order", () => {
    const slate = Array.from({ length: 10 }, (_, n) => id(n + 1));
    for (let seed = 1; seed < 30; seed += 1) {
      const plan = planRg2(slate, "catalogue_first", seed, 4);
      expect(plan.sessions.map((session) => session.interface)).toEqual(["catalogue", "feed"]);
      const [first, second] = plan.sessions.map((session) => session.bokIds);
      expect(first).toHaveLength(4);
      expect(second).toHaveLength(4);
      expect(first.some((bok) => second.includes(bok))).toBe(false);
      expect(planRg2(slate, "catalogue_first", seed, 4)).toEqual(plan);
    }
    expect(planRg2(slate, "feed_first", 3, 5).sessions[0].interface).toBe("feed");
  });

  it("takes as many b1 pieces as asked", () => {
    expect(planB1({ pieces: [id(1), id(2), id(3)], perParticipant: 2 }, 3).pieces).toHaveLength(2);
  });

  it("gives b2's second block the other mode and the other set", () => {
    const materials = { minutes: 5, setA: [id(1), id(2), id(3)], setB: [id(4), id(5), id(6)] };
    const plan = planB2(materials, "silence_b");
    expect(plan.blocks.map((block) => [block.mode, block.set])).toEqual([["silence", "b"], ["music", "a"]]);
    expect(plan.blocks[0].bokIds).toEqual(materials.setB);
    expect(planB2(materials, "music_a").blocks[1]).toEqual({ mode: "silence", set: "b", bokIds: materials.setB });
  });
});

describe("a3: recommendations from five boks", () => {
  const materials = { targets: Array.from({ length: 16 }, (_, n) => id(100 + n)), profileSize: 5, perParticipant: 10, feedPoolSize: 40 };
  const authorOf = (bok: string) => `Author ${Number(bok.slice(-3)) % 8}`;

  it("draws ten new texts by other authors, the same for the same seed", () => {
    const rated = [{ bokId: id(100), author: "Author 4" }, { bokId: id(1), author: "author 1" }];
    const targets = planA3Targets(materials, 9, rated, authorOf);
    expect(targets).toEqual(planA3Targets(materials, 9, rated, authorOf));
    expect(targets).not.toContain(id(100));
    expect(targets.some((bok) => ["Author 4", "Author 1"].includes(authorOf(bok)))).toBe(false);
    expect(targets.length).toBeLessThanOrEqual(10);
  });

  it("has no profile when the five ratings carry no direction", () => {
    expect(profileVector([{ embedding: [1, 0], interest: 3 }, { embedding: [0, 1], interest: 3 }], [0, 0])).toBeNull();
    expect(profileVector([{ embedding: [1, 0], interest: 5 }, { embedding: [0, 1], interest: 1 }], [0.5, 0.5])).toEqual([2, -2]);
  });

  it("computes NDCG@5 with interest minus one as the gain", () => {
    const interest = { a: 5, b: 1, c: 3, d: 1, e: 1, f: 2 };
    expect(ndcgAt(["a", "c", "f", "b", "d", "e"], interest)).toBeCloseTo(1, 6);
    const worse = ndcgAt(["b", "d", "e", "f", "c", "a"], interest)!;
    expect(worse).toBeGreaterThan(0);
    expect(worse).toBeLessThan(0.5);
    expect(ndcgAt(["a", "b"], { a: 1, b: 1 })).toBeNull();
  });

  it("moves texts like the ones rated high up the order, and changes nothing else", () => {
    const candidate = (n: number, embedding: number[]): A3Candidate => ({
      id: id(n), title: `T${n}`, genre: "", mood: "", minutes: 3, wordCount: 400, createdAt: "2026-10-01T00:00:00Z",
      authorName: `Author ${n}`, impressions: 10, starts: 5, completes: 3, skips: 2, likes: 0, shares: 0, comments: 0,
      readSecondsTotal: 300, hasEmbedding: true, embedding,
    });
    const liked = [1, 0, 0];
    const disliked = [0, 1, 0];
    const profile = [
      { bokId: id(1), interest: 5 }, { bokId: id(2), interest: 5 }, { bokId: id(3), interest: 1 },
      { bokId: id(4), interest: 1 }, { bokId: id(5), interest: 3 },
    ];
    const near = [11, 12, 13];
    const far = [14, 15, 16];
    const candidates = [
      candidate(1, liked), candidate(2, [0.9, 0.1, 0]), candidate(3, disliked), candidate(4, [0.1, 0.9, 0]), candidate(5, [0, 0, 1]),
      ...near.map((n) => candidate(n, [0.95, 0.05, 0.1])),
      ...far.map((n) => candidate(n, [0.05, 0.95, 0.1])),
    ];
    const targets = [...far, ...near].map(id);
    const now = new Date("2026-11-01T00:00:00Z");
    const ranking = rankA3({ participantId: "p1", profile, candidates, targets, now });
    expect(ranking.hasProfile).toBe(true);
    expect(ranking.withProfile.slice(0, 3).sort()).toEqual(near.map(id).sort());
    expect(new Set(ranking.withoutProfile)).toEqual(new Set(targets));
    // Same input, same orders: the analysis can rank again from the snapshot.
    expect(rankA3({ participantId: "p1", profile, candidates, targets, now })).toEqual(ranking);
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

  it("A2 measures easy choosing without requiring a finished read, and distinguishes a refusal from missing data", () => {
    const measured = { ...measurement, interface: "cards" as const, shown: [id(1)], reads: [] };
    const survey = { instrumentVersion: a2InstrumentVersion, chosenBokId: id(1), choiceEase: 6, perBok: {}, satisfaction: null };
    expect(easyChoice(measured, survey)).toBe(true);
    expect(easyChoice(measured, { ...survey, choiceEase: 5 })).toBe(false);
    expect(easyChoice(measured, { ...survey, chosenBokId: null, choiceEase: 7 })).toBe(false);
    expect(easyChoice(measured, { ...survey, chosenBokId: id(2) })).toBeNull();
    expect(easyChoice(measured, { ...survey, instrumentVersion: undefined })).toBeNull();
    expect(easyChoice(measured, { ...survey, choiceEase: 8 })).toBeNull();
    expect(easyChoice(measured, { ...survey, chosenBokId: undefined })).toBeNull();
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

  it("compares rg1's share answering 6 or 7 to both between formats and leaves the team out", () => {
    const rows: StudyResponseRow[] = [];
    for (let n = 1; n <= 12; n += 1) {
      const series = n % 2 === 0;
      rows.push(row(n, {
        participantCondition: series ? "series" : "text",
        condition: series ? "series" : "text",
        answers: { phase: "target", moved: series ? 6 : 4, thought: series ? 6 : 5 },
      }));
    }
    rows.push(row(99, { team: true, answers: { phase: "target", moved: 1, thought: 1 } }));
    const summary = summariseStudy("rg1", rows);
    expect(summary.participants).toBe(12);
    // Every series reader answered 6 to both, no text reader did: +100 pp.
    expect(summary.comparisons[0].unit).toBe("share");
    expect(summary.comparisons[0].result.effect).toBe(1);
    expect(summary.comparisons[0].meetsThreshold).toBe(true);
    // The means stay as secondary measures.
    expect(summary.comparisons[1].result.effect).toBe(2);
    expect(summary.comparisons[2].result.effect).toBe(1);
  });

  it("pairs rg2's feed and catalogue sessions within each participant", () => {
    const rows: StudyResponseRow[] = [];
    const measurement = (kind: "feed" | "catalogue"): SessionMeasurement => ({
      interface: kind, minutes: 10, offered: [], reads: [], endedBy: "timer", elapsedSeconds: 600,
    });
    for (let n = 1; n <= 6; n += 1) {
      for (const [index, kind] of (["feed", "catalogue"] as const).entries()) {
        rows.push(row(n, { step: "session", condition: kind, participantCondition: "feed_first", answers: { index, measurement: measurement(kind) } }));
        rows.push(row(n, { step: "session_survey", condition: kind, participantCondition: "feed_first", answers: {
          index, survey: { perBok: {}, satisfaction: null, moved: null, sessionSatisfaction: kind === "feed" ? 6 : 5 },
        } }));
      }
    }
    const summary = summariseStudy("rg2", rows);
    expect(summary.comparisons[0].result.effect).toBe(1);
    expect(summary.comparisons[0].meetsThreshold).toBe(true);
    expect(summary.facts[0].value).toBe("12");
  });

  it("judges b1 by the paired share immersed 6 or 7, active against automatic", () => {
    const rows: StudyResponseRow[] = [];
    for (let n = 1; n <= 6; n += 1) {
      rows.push(row(n, { step: "after_reading", condition: "active", participantCondition: "yoked", answers: { immersion: 6 } }));
      rows.push(row(n, { step: "after_reading", condition: "passive", participantCondition: "yoked", answers: { immersion: n % 2 ? 7 : 4 } }));
    }
    const summary = summariseStudy("b1", rows);
    expect(summary.comparisons[0].unit).toBe("share");
    expect(summary.comparisons[0].result.effect).toBeCloseTo(0.5);
  });

  it("pairs b2's music and silence blocks within each participant", () => {
    const rows: StudyResponseRow[] = [];
    for (let n = 1; n <= 6; n += 1) {
      rows.push(row(n, { step: "session_survey", condition: "music", participantCondition: "music_a", answers: { index: 0, mode: "music", enjoyment: 6, distraction: 2 } }));
      rows.push(row(n, { step: "session_survey", condition: "silence", participantCondition: "music_a", answers: { index: 1, mode: "silence", enjoyment: n <= 3 ? 6 : 5, distraction: 2 } }));
    }
    rows.push(row(7, { step: "session_survey", condition: "music", participantCondition: "music_b", answers: { index: 0, mode: "music", enjoyment: 7, distraction: 1 } }));
    const summary = summariseStudy("b2", rows);
    expect(summary.comparisons[0].result.effect).toBeCloseTo(0.5);
    expect(summary.comparisons[0].meetsThreshold).toBe(true);
    expect(summary.facts[0].value).toBe("1");
  });

  it("judges a3 by the paired Precision@5 of the two stored orders, NDCG@5 beside it", () => {
    const targets = ["a", "b", "c", "d", "e", "f"].map((letter, n) => id(200 + n));
    const rows: StudyResponseRow[] = [];
    for (let n = 1; n <= 6; n += 1) {
      rows.push(row(n, { step: "ranking", reelId: null, participantCondition: "profile", answers: {
        withProfile: targets, withoutProfile: [...targets].reverse(), hasProfile: true, targets,
      } }));
      targets.forEach((bok, position) => rows.push(row(n, { step: "interest", reelId: bok, answers: { phase: "test", interest: 5 - Math.min(position, 4) } })));
    }
    // An unfinished participant is counted, not compared.
    rows.push(row(7, { step: "ranking", reelId: null, answers: { withProfile: targets, withoutProfile: targets, hasProfile: true, targets } }));
    const summary = summariseStudy("a3", rows);
    // Top five with the profile: 5, 4, 3, 2, 1 → 2 of 5 interesting; without: 1, 1, 2, 3, 4 → 1 of 5.
    expect(summary.comparisons[0].unit).toBe("share");
    expect(summary.comparisons[0].result.effect).toBeCloseTo(0.2, 6);
    expect(summary.comparisons[0].meetsThreshold).toBe(true);
    expect(summary.comparisons[1].result.effect).toBeGreaterThan(0.05);
    expect(summary.facts[0].value).toBe("1");
  });

  it("counts a1 refusals in the denominator", () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) =>
      row(n, { step: "choice", answers: { instrumentVersion: a1InstrumentVersion, kind: n <= 3 ? "whole" : n === 4 ? "fragment" : null } })
    );
    rows.push(row(7, { step: "choice", answers: { kind: "whole" } }));
    const summary = summariseStudy("a1", rows);
    expect(summary.comparisons[0].result.effect).toBeCloseTo(2 / 6, 4);
    expect(summary.facts[0].value).toBe("2 of 6 (33%)");
    expect(summary.facts[1].value).toBe("1");
  });

  it("compares A2 cards minus full texts on choice and ease, keeps refusals, and excludes old or invalid instruments", () => {
    const rows: StudyResponseRow[] = [];
    for (let n = 1; n <= 8; n += 1) {
      for (const [index, kind] of (["cards", "inline"] as const).entries()) {
        const measurement: SessionMeasurement = {
          interface: kind, minutes: 10, offered: [id(100), id(101)], shown: [id(100)],
          reads: [], endedBy: "participant", elapsedSeconds: 120,
        };
        // Four card successes, two inline successes; #6 refused, even with ease 7.
        const survey = { instrumentVersion: a2InstrumentVersion, chosenBokId: n === 6 ? null : n === 8 ? id(101) : id(100),
          choiceEase: n === 6 || n <= (kind === "cards" ? 4 : 2) ? 7 : 5, perBok: {}, satisfaction: 4 };
        const version = n === 7 ? {} : { instrumentVersion: a2InstrumentVersion };
        rows.push(row(n, { step: "session", answers: { ...version, index, measurement } }));
        rows.push(row(n, { step: "session_survey", answers: { ...version, index, survey } }));
      }
    }
    const summary = summariseStudy("a2", rows);
    expect(summary.comparisons[0].result.effect).toBeCloseTo(2 / 6, 4);
    expect(summary.comparisons[0].controlLabel).toBe("Full texts in the feed");
    expect(summary.comparisons[0].variantLabel).toBe("Card + reading screen");
    expect(summary.facts.map((fact) => fact.value)).toEqual(["2", "1", "1"]);
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
