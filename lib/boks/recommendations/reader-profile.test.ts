import { describe, expect, it } from "vitest";
import {
  buildReaderProfile,
  lengthBucketFor,
  negativeWeight,
  positiveWeight,
  recencyWeight,
} from "@/lib/boks/recommendations/reader-profile";
import { emptyReaderBokState, type ReaderBokState, type StoryCandidate } from "@/lib/boks/recommendations/signals";

const now = new Date("2026-09-14T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

function state(over: Partial<ReaderBokState> = {}): ReaderBokState {
  return { ...emptyReaderBokState, eventCount: 2, lastEventAt: daysAgo(1), ...over };
}

function candidate(over: Partial<StoryCandidate> & { id: string }): StoryCandidate {
  return {
    title: "A boks",
    genre: "literary",
    mood: "quiet",
    minutes: 2,
    wordCount: 300,
    createdAt: daysAgo(10),
    authorUserId: "author-1",
    readingShape: "short_prose",
    lineBreakCount: 2,
    authorPublishedCount: 4,
    authorFollowers: 5,
    impressions: 20,
    starts: 15,
    completes: 6,
    skips: 4,
    likes: 2,
    shares: 0,
    comments: 1,
    readSecondsTotal: 400,
    ...over,
  };
}

describe("positiveWeight", () => {
  it("ranks an explicit act above time spent", () => {
    const completed = positiveWeight(state({ completedAt: daysAgo(1) }), false);
    const dwelled = positiveWeight(state({ totalDwellSeconds: 90 }), false);

    // Finishing says something time alone cannot: a distracted reader produces
    // dwell by accident, never a completion.
    expect(completed).toBeGreaterThan(dwelled);
  });

  it("counts following the author as standing evidence", () => {
    expect(positiveWeight(state(), true)).toBeGreaterThan(positiveWeight(state(), false));
  });

  it("caps what dwell and progress alone can contribute", () => {
    const enormous = positiveWeight(state({ totalDwellSeconds: 100_000, maxProgress: 1 }), false);
    expect(enormous).toBeLessThanOrEqual(2.1);
  });
});

describe("negativeWeight", () => {
  it("is cancelled entirely by any explicit positive act", () => {
    const passedOver = state({ seenCount: 4, quickSkipCount: 3, maxProgress: 0.01 });

    expect(negativeWeight(passedOver, false)).toBeGreaterThan(0);
    expect(negativeWeight({ ...passedOver, liked: true }, false)).toBe(0);
    expect(negativeWeight({ ...passedOver, completedAt: daysAgo(2) }, false)).toBe(0);
    // A reader who follows the author is not rejecting them by scrolling past.
    expect(negativeWeight(passedOver, true)).toBe(0);
  });

  it("grows with how emphatically the reader declined", () => {
    const once = negativeWeight(state({ quickSkipCount: 1, seenCount: 0, maxProgress: 0 }), false);
    const thrice = negativeWeight(state({ quickSkipCount: 3, maxProgress: 0 }), false);

    expect(thrice).toBeGreaterThan(once);
  });

  it("says nothing about a boks the reader has never met", () => {
    expect(negativeWeight(emptyReaderBokState, false)).toBe(0);
  });
});

describe("recencyWeight", () => {
  it("decays in steps, and never to zero", () => {
    expect(recencyWeight(daysAgo(1), now)).toBe(1);
    expect(recencyWeight(daysAgo(20), now)).toBe(0.7);
    expect(recencyWeight(daysAgo(60), now)).toBe(0.45);
    expect(recencyWeight(daysAgo(400), now)).toBe(0.2);
    expect(recencyWeight(null, now)).toBe(0.2);
  });
});

describe("lengthBucketFor", () => {
  it("splits by how much of a break a piece asks for", () => {
    expect(lengthBucketFor(1)).toBe("extra_short");
    expect(lengthBucketFor(3)).toBe("short");
    expect(lengthBucketFor(6)).toBe("medium");
    expect(lengthBucketFor(12)).toBe("long");
  });
});

describe("buildReaderProfile", () => {
  it("is empty for a reader with no history", () => {
    const profile = buildReaderProfile({
      reader: { genreAffinity: {}, moodAffinity: {}, completedStoryIds: [], likedStoryIds: [], skippedStoryIds: [] },
      candidates: [candidate({ id: "a" }), candidate({ id: "b" })],
      now,
    });

    expect(profile.authorAffinity).toEqual({});
    expect(profile.personalizationStrength).toBe(0);
    expect(profile.preferredReadMinutes).toBeNull();
  });

  it("separates authors the reader finishes from authors they pass over", () => {
    const profile = buildReaderProfile({
      reader: {
        genreAffinity: {},
        moodAffinity: {},
        completedStoryIds: [],
        likedStoryIds: [],
        skippedStoryIds: [],
        bokState: {
          loved: state({ completedAt: daysAgo(1), liked: true, maxProgress: 1, totalDwellSeconds: 120 }),
          ignored: state({ seenCount: 4, quickSkipCount: 3, maxProgress: 0.01, totalDwellSeconds: 1 }),
        },
      },
      candidates: [
        candidate({ id: "loved", authorUserId: "kept" }),
        candidate({ id: "ignored", authorUserId: "dropped" }),
      ],
      now,
    });

    expect(profile.authorAffinity.kept).toBeGreaterThan(0);
    expect(profile.authorAffinity.dropped).toBeLessThan(0);
  });

  it("damps an author the reader has simply met more often", () => {
    const many: Record<string, ReaderBokState> = {};
    const candidates: StoryCandidate[] = [];
    for (let index = 0; index < 9; index += 1) {
      many[`m-${index}`] = state({ completedAt: daysAgo(1), maxProgress: 1 });
      candidates.push(candidate({ id: `m-${index}`, authorUserId: "prolific" }));
    }
    many.one = state({ completedAt: daysAgo(1), maxProgress: 1 });
    candidates.push(candidate({ id: "one", authorUserId: "rare" }));

    const profile = buildReaderProfile({
      reader: { genreAffinity: {}, moodAffinity: {}, completedStoryIds: [], likedStoryIds: [], skippedStoryIds: [], bokState: many },
      candidates,
      now,
    });

    // Nine reads is worth more than one, but not nine times more: the square
    // root keeps a prolific author from owning the feed.
    expect(profile.authorAffinity.prolific).toBeGreaterThan(profile.authorAffinity.rare);
    expect(profile.authorAffinity.prolific).toBeLessThan(profile.authorAffinity.rare * 9);
  });

  it("discounts old evidence against fresh evidence of the same strength", () => {
    const read = (at: string) => state({ completedAt: at, lastEventAt: at, maxProgress: 1 });
    const build = (at: string) =>
      buildReaderProfile({
        reader: { genreAffinity: {}, moodAffinity: {}, completedStoryIds: [], likedStoryIds: [], skippedStoryIds: [], bokState: { x: read(at) } },
        candidates: [candidate({ id: "x" })],
        now,
      }).personalizationStrength;

    expect(build(daysAgo(1))).toBeGreaterThan(build(daysAgo(200)));
  });

  it("learns a preferred length only from what the reader actually enjoyed", () => {
    const profile = buildReaderProfile({
      reader: {
        genreAffinity: {}, moodAffinity: {}, completedStoryIds: [], likedStoryIds: [], skippedStoryIds: [],
        bokState: {
          long: state({ completedAt: daysAgo(1), maxProgress: 1 }),
          short: state({ seenCount: 3, quickSkipCount: 2, maxProgress: 0 }),
        },
      },
      candidates: [
        candidate({ id: "long", minutes: 10 }),
        candidate({ id: "short", minutes: 1 }),
      ],
      now,
    });

    expect(profile.preferredReadMinutes).toBe(10);
  });
});
