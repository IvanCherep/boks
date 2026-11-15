import { describe, expect, it } from "vitest";
import { ReadingRequestUnavailableError, serveReaderFeed, type FeedTransport } from "@/lib/boks/feed-service";
import type { SupabaseCandidateRow } from "@/lib/boks/supabase-reels";
import {
  activeConditionCount,
  emptyReadingRequest,
  expireReadingRequest,
  isEmptyReadingRequest,
  matchesFacets,
  normalizeReadingRequest,
  preferFacetMatches,
  preferredFacets,
  readingRequestIdleMs,
  strictFacets,
} from "./request";

describe("reading request", () => {
  it("keeps only known values, author groups in a fixed order", () => {
    expect(normalizeReadingRequest({ mood: "angry", format: "poetry", authorGroups: ["contemporary", "x", "classics", "classics"] }))
      .toEqual({ mood: null, format: "poetry", authorGroups: ["classics", "contemporary"] });
    expect(normalizeReadingRequest("nonsense")).toEqual(emptyReadingRequest);
  });

  it("splits into strict facets and a preferred mood", () => {
    const request = normalizeReadingRequest({ mood: "sad", format: "prose", authorGroups: ["classics"] });
    expect(strictFacets(request)).toEqual({ format: ["prose"], author_group: ["classics"] });
    expect(preferredFacets(request)).toEqual({ mood: ["sad"] });
    expect(strictFacets(normalizeReadingRequest({ mood: "fun" }))).toBeNull();
    expect(isEmptyReadingRequest(normalizeReadingRequest({}))).toBe(true);
  });

  it("counts kinds of condition, two author groups once", () => {
    expect(activeConditionCount(normalizeReadingRequest({ mood: "fun", authorGroups: ["classics", "contemporary"] }))).toBe(2);
  });

  it("matches when every named facet shares a value; an unlabelled facet never matches", () => {
    expect(matchesFacets({ mood: ["sad", "think"] }, { mood: ["think"] })).toBe(true);
    expect(matchesFacets({ mood: [] }, { mood: ["think"] })).toBe(false);
    expect(matchesFacets({}, { mood: ["think"] })).toBe(false);
    expect(matchesFacets({}, null)).toBe(true);
  });

  it("puts preferred boks first in their own order and renumbers ranks", () => {
    const entries = [{ id: "a", rank: 0 }, { id: "b", rank: 1 }, { id: "c", rank: 2 }, { id: "d", rank: 3 }];
    const facets: Record<string, Record<string, string[]>> = { b: { mood: ["sad"] }, d: { mood: ["think", "sad"] } };
    const ordered = preferFacetMatches(entries, (entry) => facets[entry.id], { mood: ["sad"] });
    expect(ordered.map((entry) => entry.id)).toEqual(["b", "d", "a", "c"]);
    expect(ordered.map((entry) => entry.rank)).toEqual([0, 1, 2, 3]);
    expect(preferFacetMatches(entries, () => undefined, null)).toEqual(entries);
  });

  it("is forgotten after 30 minutes without activity", () => {
    const request = normalizeReadingRequest({ mood: "fun" });
    expect(expireReadingRequest(request, 1000, 1000 + readingRequestIdleMs - 1)).toEqual(request);
    expect(expireReadingRequest(request, 1000, 1000 + readingRequestIdleMs)).toEqual(emptyReadingRequest);
    expect(expireReadingRequest(request, null)).toEqual(emptyReadingRequest);
  });
});

function row(index: number, facets: Record<string, string[]>): SupabaseCandidateRow {
  return {
    id: `0000000${index}-0000-4000-8000-00000000000${index}`,
    title: `Bok ${index}`, genre: "drama", mood: "calm", minutes: 3, wordCount: 500,
    createdAt: new Date(Date.UTC(2026, 9, 1 + index)).toISOString(), body: "text",
    authorName: `Author ${index}`, authorHandle: `a${index}`,
    impressions: 10, starts: 5, completes: 2, skips: 1, likes: 0, shares: 0, comments: 0, readSecondsTotal: 60,
    facets,
  };
}

function transport(calls: { name: string; body: Record<string, unknown> }[], options: { failCandidates?: boolean } = {}): FeedTransport {
  const rows = [row(1, { mood: ["fun"] }), row(2, { mood: [] }), row(3, { mood: ["sad"] }), row(4, {}), row(5, { mood: ["sad", "think"] })];
  return {
    async rpc<Result>(name: string, body: Record<string, unknown> = {}) {
      calls.push({ name, body });
      if (name === "get_active_recommendation_experiment") {
        return { key: "k", controlAlgorithmId: "recency", arms: [{ algorithmId: "recency", weight: 100 }], minimumReadersPerArm: 10 } as Result;
      }
      if (name === "get_recommendation_candidates") {
        if (options.failCandidates) throw Object.assign(new Error("down"), { code: "PGRST000" });
        return rows as Result;
      }
      if (name === "record_recommendation_assignment") return { experimentKey: "k", algorithmId: "recency", userSegment: "general" } as Result;
      if (name === "record_served_feed") return "feed-1" as Result;
      throw new Error(`Unexpected RPC: ${name}`);
    },
    async publishedReels() { return []; },
    async publishedCount() { return 5; },
  };
}

const base = { userId: "8f1b1c8e-2f1a-4f0e-9a1a-9f2c3d4e5f60", sessionId: "s", limit: 5, servingBackend: "worker" as const, now: new Date("2026-11-16T10:00:00Z") };

describe("a feed served under a reading request", () => {
  it("sends strict facets, the mood and the bok on screen to retrieval, and records the request", async () => {
    const calls: { name: string; body: Record<string, unknown> }[] = [];
    const readingRequest = normalizeReadingRequest({ mood: "sad", format: "poetry", authorGroups: ["classics"] });
    const served = await serveReaderFeed(transport(calls), { ...base, readingRequest, excludeBokId: "b0000000-0000-4000-8000-000000000000" });
    const candidates = calls.find((call) => call.name === "get_recommendation_candidates")!.body;
    expect(candidates).toMatchObject({
      p_facets: { format: ["poetry"], author_group: ["classics"] },
      p_prefer: { mood: ["sad"] },
      p_exclude: "b0000000-0000-4000-8000-000000000000",
    });
    const sad = served.entries.slice(0, 2).map((entry) => entry.candidate.title).sort();
    expect(sad).toEqual(["Bok 3", "Bok 5"]);
    expect(served.entries.map((entry) => entry.rank)).toEqual([0, 1, 2, 3, 4]);
    const recorded = calls.find((call) => call.name === "record_served_feed")!.body as { p_feed: Record<string, unknown>; p_items: { reelId: string; deliveredRank: number }[] };
    expect(recorded.p_feed.readingRequest).toEqual(readingRequest);
    expect(recorded.p_items.map((item) => item.reelId)).toEqual(served.entries.map((entry) => entry.candidate.id));
  });

  it("calls retrieval with the old two arguments when there is no request", async () => {
    const calls: { name: string; body: Record<string, unknown> }[] = [];
    await serveReaderFeed(transport(calls), base);
    expect(Object.keys(calls.find((call) => call.name === "get_recommendation_candidates")!.body).sort()).toEqual(["p_languages", "p_limit"]);
    expect((calls.find((call) => call.name === "record_served_feed")!.body as { p_feed: Record<string, unknown> }).p_feed).not.toHaveProperty("readingRequest");
  });

  it("refuses strict conditions it cannot honour on the degraded path", async () => {
    await expect(serveReaderFeed(transport([], { failCandidates: true }), { ...base, readingRequest: normalizeReadingRequest({ format: "prose" }) }))
      .rejects.toBeInstanceOf(ReadingRequestUnavailableError);
  });
});
