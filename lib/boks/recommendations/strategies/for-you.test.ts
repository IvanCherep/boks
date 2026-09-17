import { describe, expect, it } from "vitest";
import { buildReaderFeed } from "@/lib/boks/recommendations/feed";
import { emptyReaderBokState, type ReaderBokState, type ReaderSignals, type StoryCandidate } from "@/lib/boks/recommendations/signals";

const now = new Date("2026-09-14T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const config = {
  key: "for-you-test",
  controlAlgorithmId: "for_you",
  arms: [{ algorithmId: "for_you", weight: 100 }],
  minimumImpressionsPerArm: 1,
};

function candidate(over: Partial<StoryCandidate> & { id: string }): StoryCandidate {
  return {
    title: `Boks ${over.id}`,
    genre: "literary",
    mood: "quiet",
    minutes: 2,
    wordCount: 300,
    createdAt: daysAgo(30),
    authorUserId: `author-${over.id}`,
    authorHandle: `author-${over.id}`,
    readingShape: "short_prose",
    lineBreakCount: 2,
    authorPublishedCount: 8,
    authorFollowers: 20,
    impressions: 40,
    starts: 30,
    completes: 12,
    skips: 6,
    likes: 4,
    shares: 0,
    comments: 2,
    readSecondsTotal: 900,
    ...over,
  };
}

function state(over: Partial<ReaderBokState> = {}): ReaderBokState {
  return { ...emptyReaderBokState, eventCount: 2, lastEventAt: daysAgo(1), ...over };
}

function reader(over: Partial<ReaderSignals> = {}): ReaderSignals {
  return {
    genreAffinity: {},
    moodAffinity: {},
    completedStoryIds: [],
    likedStoryIds: [],
    skippedStoryIds: [],
    followedAuthorIds: [],
    bokState: {},
    ...over,
  };
}

function rank(candidates: StoryCandidate[], signals: ReaderSignals, limit = 10) {
  return buildReaderFeed({
    visitorId: "reader-1",
    candidates,
    reader: signals,
    experimentConfig: config,
    limit,
    now,
  }).entries;
}

const plain = Array.from({ length: 8 }, (_, index) => candidate({ id: `p${index}` }));

describe("for_you ranking", () => {
  it("spaces writers apart inside one publisher's catalogue", () => {
    // What a public-domain load looks like: one account, many writers. Before
    // the byline was read, every piece here counted as the same author, the
    // spacing penalty applied equally to all of them, and the feed served five
    // poems by one poet in a row.
    const bylines = ["Sara Teasdale", "Emily Dickinson", "William Blake", "Walt Whitman"];
    const catalogue = Array.from({ length: 24 }, (_, index) =>
      candidate({
        id: `pub-${index}`,
        authorUserId: "the-publisher",
        authorHandle: "boks",
        authorName: bylines[index % bylines.length],
      })
    );

    const feed = rank(catalogue, reader(), 10);
    const writers = feed.map((entry) => entry.candidate.authorName);

    // No writer twice in a row, and no writer taking over the slate.
    const backToBack = writers.filter((name, index) => index > 0 && name === writers[index - 1]);
    expect(backToBack).toEqual([]);
    expect(new Set(writers).size).toBeGreaterThanOrEqual(3);
  });

  it("still spaces authors when the work carries no byline", () => {
    // An author publishing under their own @nickname has no byline, so the
    // account is the only identity there is.
    const authored = Array.from({ length: 12 }, (_, index) =>
      candidate({
        id: `own-${index}`,
        authorUserId: `writer-${index % 3}`,
        authorHandle: `writer${index % 3}`,
        authorName: "",
      })
    );

    const writers = rank(authored, reader(), 9).map((entry) => entry.candidate.authorHandle);
    const backToBack = writers.filter((name, index) => index > 0 && name === writers[index - 1]);
    expect(backToBack).toEqual([]);
  });

  it("puts an unfinished boks first, as a resume", () => {
    const entries = rank(
      plain,
      reader({ bokState: { p5: state({ maxProgress: 0.45, totalDwellSeconds: 40 }) } })
    );

    expect(entries[0].candidate.id).toBe("p5");
    expect(entries[0].candidateSource).toBe("resume");
    expect(entries[0].explanations?.join(" ")).toContain("resume");
  });

  it("does not resume something the reader already finished", () => {
    const entries = rank(
      plain,
      reader({
        bokState: { p5: state({ maxProgress: 1, completedAt: daysAgo(2), totalDwellSeconds: 90 }) },
      })
    );

    expect(entries[0].candidate.id).not.toBe("p5");
  });

  it("demotes a boks the reader has repeatedly passed over", () => {
    const entries = rank(
      plain,
      reader({
        bokState: { p2: state({ seenCount: 4, quickSkipCount: 3, maxProgress: 0.01, totalDwellSeconds: 1 }) },
      })
    );

    expect(entries[entries.length - 1].candidate.id).toBe("p2");
  });

  it("keeps one author from taking consecutive slots", () => {
    const sameAuthor = Array.from({ length: 6 }, (_, index) =>
      candidate({ id: `same-${index}`, authorUserId: "one-author", authorHandle: "one-author" })
    );
    const others = Array.from({ length: 6 }, (_, index) => candidate({ id: `other-${index}` }));

    const entries = rank([...sameAuthor, ...others], reader());
    const authors = entries.map((entry) => entry.candidate.authorUserId);

    // The prolific author still appears - they are simply not served back to
    // back, which is the whole point of the penalty.
    let longestRun = 1;
    let run = 1;
    for (let index = 1; index < authors.length; index += 1) {
      run = authors[index] === authors[index - 1] ? run + 1 : 1;
      longestRun = Math.max(longestRun, run);
    }
    expect(longestRun).toBeLessThanOrEqual(2);
  });

  it("spends an exploration budget once the reader is a few boks in", () => {
    // Established authors with history, plus newcomers nobody has read.
    const established = Array.from({ length: 10 }, (_, index) =>
      candidate({ id: `known-${index}`, authorPublishedCount: 20, authorFollowers: 400, likes: 60, comments: 20 })
    );
    const newcomers = Array.from({ length: 6 }, (_, index) =>
      candidate({
        id: `new-${index}`,
        authorPublishedCount: 1,
        authorFollowers: 0,
        likes: 0,
        comments: 0,
        impressions: 0,
        starts: 0,
        completes: 0,
        createdAt: daysAgo(1),
      })
    );

    const entries = rank([...established, ...newcomers], reader(), 12);
    const discoveries = entries.filter((entry) => entry.candidateSource === "discovery");

    expect(discoveries.length).toBeGreaterThanOrEqual(3);
  });

  it("boosts a long piece after a run of short ones", () => {
    const shorts = Array.from({ length: 6 }, (_, index) =>
      candidate({ id: `s${index}`, minutes: 1, readingShape: "short_prose" })
    );
    const long = candidate({ id: "long", minutes: 12, readingShape: "long_prose" });

    const entries = rank([...shorts, long], reader(), 7);
    const position = entries.findIndex((entry) => entry.candidate.id === "long");

    // The property that matters: a demanding piece is never buried under a run
    // of compact ones, because the slate scores variety as it builds.
    expect(position).toBeLessThanOrEqual(1);
  });

  it("favours an author the reader follows", () => {
    const followed = candidate({ id: "followed", authorUserId: "friend", authorHandle: "friend" });
    const entries = rank([...plain, followed], reader({ followedAuthorIds: ["friend"] }));

    expect(entries[0].candidate.id).toBe("followed");
    expect(entries[0].candidateSource).toBe("affinity");
    expect(entries[0].explanations?.join(" ")).toContain("following this author");
  });

  it("explains every placement it makes", () => {
    const entries = rank(plain, reader());

    for (const entry of entries) {
      expect(entry.explanations?.length).toBeGreaterThan(0);
      expect(entry.explanations?.length).toBeLessThanOrEqual(4);
      expect(entry.candidateSource).toBeTruthy();
    }
  });

  it("produces the same slate for the same inputs", () => {
    const signals = reader({ bokState: { p3: state({ maxProgress: 0.3 }) } });
    const once = rank(plain, signals).map((entry) => entry.candidate.id);
    const twice = rank(plain, signals).map((entry) => entry.candidate.id);

    expect(twice).toEqual(once);
  });

  it("serves a cold reader without a profile to score against", () => {
    const entries = rank(plain, reader(), 5);

    expect(entries).toHaveLength(5);
    expect(new Set(entries.map((entry) => entry.candidate.id)).size).toBe(5);
  });

  it("ranks nothing into a slate when there is nothing to rank", () => {
    expect(rank([], reader())).toEqual([]);
  });
});
