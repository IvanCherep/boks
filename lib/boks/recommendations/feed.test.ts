import { describe, expect, it } from "vitest";
import { buildReaderFeed } from "@/lib/boks/recommendations/feed";
import { listRecommendationStrategies } from "@/lib/boks/recommendations/registry";
import type { StoryCandidate } from "@/lib/boks/recommendations/signals";
import type { RecommendationExperimentConfig } from "@/lib/boks/recommendations/experiments";

const now = new Date("2026-09-12T12:00:00.000Z");

function candidate(overrides: Partial<StoryCandidate> & { id: string }): StoryCandidate {
  return {
    title: `Story ${overrides.id}`,
    genre: "literary",
    mood: "quiet",
    minutes: 6,
    wordCount: 1200,
    createdAt: "2026-09-01T00:00:00.000Z",
    impressions: 0,
    starts: 0,
    completes: 0,
    skips: 0,
    likes: 0,
    shares: 0,
    comments: 0,
    readSecondsTotal: 0,
    ...overrides,
  };
}

function singleArm(algorithmId: string): RecommendationExperimentConfig {
  return {
    key: "test",
    controlAlgorithmId: "balanced",
    arms: [{ algorithmId, weight: 100 }],
    minimumImpressionsPerArm: 10,
  };
}

const finisher = candidate({
  id: "finisher",
  impressions: 200,
  starts: 100,
  completes: 90,
  skips: 4,
  likes: 5,
  readSecondsTotal: 90 * 300,
});

const reactor = candidate({
  id: "reactor",
  impressions: 200,
  starts: 100,
  completes: 40,
  skips: 30,
  likes: 60,
  comments: 30,
  shares: 20,
  readSecondsTotal: 40 * 120,
});

const untested = candidate({ id: "untested", createdAt: "2026-09-12T06:00:00.000Z" });

describe("buildReaderFeed", () => {
  it("ranks the most-finished story first under completion_first", () => {
    const feed = buildReaderFeed({
      visitorId: "reader-1",
      candidates: [reactor, untested, finisher],
      experimentConfig: singleArm("completion_first"),
      now,
    });

    expect(feed.experiment.algorithmId).toBe("completion_first");
    expect(feed.entries[0].candidate.id).toBe("finisher");
  });

  it("ranks the most-reacted story first under reaction_first", () => {
    const feed = buildReaderFeed({
      visitorId: "reader-1",
      candidates: [finisher, untested, reactor],
      experimentConfig: singleArm("reaction_first"),
      now,
    });

    expect(feed.entries[0].candidate.id).toBe("reactor");
  });

  it("ranks the under-tested story first under discovery", () => {
    const feed = buildReaderFeed({
      visitorId: "reader-1",
      candidates: [finisher, reactor, untested],
      experimentConfig: singleArm("discovery"),
      now,
    });

    expect(feed.entries[0].candidate.id).toBe("untested");
  });

  it("ranks the newest story first under recency", () => {
    const feed = buildReaderFeed({
      visitorId: "reader-1",
      candidates: [finisher, reactor, untested],
      experimentConfig: singleArm("recency"),
      now,
    });

    expect(feed.entries[0].candidate.id).toBe("untested");
  });

  it("follows reader taste under taste_match", () => {
    const mystery = candidate({ id: "mystery", genre: "mystery", mood: "tense" });
    const feed = buildReaderFeed({
      visitorId: "reader-1",
      candidates: [finisher, mystery],
      reader: {
        genreAffinity: { mystery: 12 },
        moodAffinity: { tense: 12 },
        completedStoryIds: [],
        likedStoryIds: [],
        skippedStoryIds: [],
      },
      experimentConfig: singleArm("taste_match"),
      now,
    });

    expect(feed.entries[0].candidate.id).toBe("mystery");
  });

  it("pushes already-skipped boks down in every strategy", () => {
    for (const strategy of listRecommendationStrategies()) {
      const feed = buildReaderFeed({
        visitorId: "reader-1",
        candidates: [finisher, untested],
        reader: {
          genreAffinity: {},
          moodAffinity: {},
          completedStoryIds: [],
          likedStoryIds: [],
          skippedStoryIds: [finisher.id, untested.id].slice(0, 1),
        },
        experimentConfig: singleArm(strategy.id),
        now,
      });

      expect(feed.entries.at(-1)?.candidate.id, `strategy ${strategy.id}`).toBe("finisher");
    }
  });

  it("assigns stable zero-based ranks", () => {
    const feed = buildReaderFeed({
      visitorId: "reader-1",
      candidates: [finisher, reactor, untested],
      experimentConfig: singleArm("balanced"),
      now,
    });

    expect(feed.entries.map((entry) => entry.rank)).toEqual([0, 1, 2]);
  });

  it("honours the limit", () => {
    const feed = buildReaderFeed({
      visitorId: "reader-1",
      candidates: [finisher, reactor, untested],
      experimentConfig: singleArm("balanced"),
      limit: 2,
      now,
    });

    expect(feed.entries).toHaveLength(2);
  });

  it("is deterministic for the same visitor", () => {
    const first = buildReaderFeed({ visitorId: "reader-7", candidates: [finisher, reactor, untested], now });
    const second = buildReaderFeed({ visitorId: "reader-7", candidates: [untested, finisher, reactor], now });

    expect(first.experiment.algorithmId).toBe(second.experiment.algorithmId);
    expect(first.entries.map((entry) => entry.candidate.id)).toEqual(second.entries.map((entry) => entry.candidate.id));
  });

  it("returns an empty feed for an empty catalog without throwing", () => {
    const feed = buildReaderFeed({ visitorId: "reader-1", candidates: [], now });
    expect(feed.entries).toEqual([]);
    expect(feed.experiment.algorithmId).toBeTruthy();
  });
});
