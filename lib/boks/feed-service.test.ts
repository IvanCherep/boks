import { describe, expect, it } from "vitest";
import { describeErrorCode, serveReaderFeed, type FeedTransport } from "@/lib/boks/feed-service";
import type { SupabaseCandidateRow, SupabaseReelRow } from "@/lib/boks/supabase-reels";

const readerId = "8f1b1c8e-2f1a-4f0e-9a1a-9f2c3d4e5f60";

function candidateRow(index: number, overrides: Partial<SupabaseCandidateRow> = {}): SupabaseCandidateRow {
  return {
    id: `0000000${index}-0000-4000-8000-00000000000${index}`,
    title: `Boks ${index}`,
    genre: index % 2 ? "drama" : "comedy",
    mood: index % 3 ? "calm" : "tense",
    minutes: 1,
    wordCount: 300 + index * 40,
    createdAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
    body: `Body ${index}`,
    authorName: `Author ${index}`,
    authorHandle: `author${index}`,
    impressions: 40 + index * 7,
    starts: 30 + index * 5,
    completes: 10 + index * 3,
    skips: 5 + index,
    likes: index * 2,
    shares: index,
    comments: index % 4,
    readSecondsTotal: 300 + index * 90,
    ...overrides,
  };
}

const rows = Array.from({ length: 8 }, (_, index) => candidateRow(index + 1));

type Call = { name: string; body: Record<string, unknown> };

function createTransport(options: {
  calls?: Call[];
  failRpc?: Record<string, Error>;
  reels?: SupabaseReelRow[];
  count?: number;
  failCount?: boolean;
  /** The arm the fake database holds for this reader. */
  storedArm?: string;
  reelCalls?: { limit: number; languages?: readonly string[] }[];
}): FeedTransport {
  const calls = options.calls ?? [];
  return {
    async rpc<Result>(name: string, body: Record<string, unknown> = {}) {
      calls.push({ name, body });
      const failure = options.failRpc?.[name];
      if (failure) throw failure;

      if (name === "get_active_recommendation_experiment") {
        return {
          key: "boks-feed-v1",
          controlAlgorithmId: "balanced",
          arms: [
            { algorithmId: "balanced", weight: 50 },
            { algorithmId: "recency", weight: 50 },
          ],
          minimumReadersPerArm: 10,
        } as Result;
      }
      if (name === "get_recommendation_candidates") return rows as Result;
      if (name === "record_recommendation_assignment") {
        return {
          experimentKey: "boks-feed-v1",
          algorithmId: options.storedArm ?? "recency",
          userSegment: "general",
        } as Result;
      }
      if (name === "record_served_feed") return "feed-1" as Result;
      throw new Error(`Unexpected RPC: ${name}`);
    },
    async publishedReels(limit: number, languages?: readonly string[]) {
      options.reelCalls?.push({ limit, languages });
      return options.reels ?? [];
    },
    async publishedCount() {
      if (options.failCount) throw new Error("count failed");
      return options.count ?? 39;
    },
  };
}

const baseRequest = {
  userId: readerId,
  sessionId: "session-1",
  limit: 5,
  servingBackend: "worker" as const,
  now: new Date("2026-09-13T10:00:00Z"),
};

describe("serveReaderFeed", () => {
  /**
   * ADR-001 moved ranking to the Worker without a production shadow-run. This
   * is the assertion that replaces it: because ranking is pure, identical
   * inputs must produce an identical slate whichever path assembles it.
   */
  it("produces an identical slate through the Worker and the browser path", async () => {
    const worker = await serveReaderFeed(createTransport({}), baseRequest);
    const browser = await serveReaderFeed(createTransport({}), {
      ...baseRequest,
      servingBackend: "browser",
    });

    expect(browser.entries.map((entry) => entry.candidate.id)).toEqual(
      worker.entries.map((entry) => entry.candidate.id)
    );
    expect(browser.entries.map((entry) => entry.score)).toEqual(
      worker.entries.map((entry) => entry.score)
    );
    expect(browser.experiment).toEqual(worker.experiment);
  });

  it("labels the browser path as degraded, and the Worker path as not", async () => {
    const worker = await serveReaderFeed(createTransport({}), baseRequest);
    const browser = await serveReaderFeed(createTransport({}), {
      ...baseRequest,
      servingBackend: "browser",
    });

    expect(worker.degradedMode).toBe(false);
    expect(browser.degradedMode).toBe(true);
    expect(browser.servingBackend).toBe("browser");
  });

  it("records one provenance row per served slot, in delivered order", async () => {
    const calls: Call[] = [];
    const served = await serveReaderFeed(createTransport({ calls }), baseRequest);

    const write = calls.find((call) => call.name === "record_served_feed");
    const items = write?.body.p_items as { reelId: string; deliveredRank: number }[];
    const feed = write?.body.p_feed as Record<string, unknown>;

    expect(served.feedId).toBe("feed-1");
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.deliveredRank)).toEqual([0, 1, 2, 3, 4]);
    expect(items.map((item) => item.reelId)).toEqual(
      served.entries.map((entry) => entry.candidate.id)
    );
    expect(feed.servingBackend).toBe("worker");
    expect(feed.sessionId).toBe("session-1");
    expect(feed.catalogSize).toBe(39);
    expect(feed.candidateCount).toBe(8);
  });

  it("stores the reader profile the ranking actually saw", async () => {
    const calls: Call[] = [];
    await serveReaderFeed(createTransport({ calls }), {
      ...baseRequest,
      profileSnapshot: { genreAffinity: { drama: 6 } },
    });

    const feed = calls.find((call) => call.name === "record_served_feed")?.body.p_feed as Record<
      string,
      unknown
    >;
    const snapshot = feed.profileSnapshot as Record<string, unknown>;

    // What the client sent, plus the server-side half the ranking actually
    // used. Replay needs both or it cannot reconstruct the slate.
    expect(snapshot.genreAffinity).toEqual({ drama: 6 });
    expect(snapshot.followedAuthorIds).toEqual([]);
    expect(Object.keys(snapshot.bokState as object)).toHaveLength(8);
  });

  it("serves the reader even when provenance cannot be written", async () => {
    const served = await serveReaderFeed(
      createTransport({ failRpc: { record_served_feed: new Error("insert failed") } }),
      baseRequest
    );

    // The reader reads; the event simply arrives without a feed, which the
    // data-quality panel counts.
    expect(served.entries.length).toBeGreaterThan(0);
    expect(served.feedId).toBeNull();
  });

  it("takes the stored arm over the one it proposed", async () => {
    const served = await serveReaderFeed(createTransport({}), baseRequest);

    // The fake database always answers `recency`, whatever the hash proposed.
    expect(served.experiment.algorithmId).toBe("recency");
    expect(served.experiment.source).toBe("assigned");
  });

  it("keeps serving on a locally proposed arm when the assignment write fails", async () => {
    const served = await serveReaderFeed(
      createTransport({
        failRpc: { record_recommendation_assignment: new Error("unmigrated") },
      }),
      baseRequest
    );

    expect(["balanced", "recency"]).toContain(served.experiment.algorithmId);
    expect(served.entries.length).toBeGreaterThan(0);
  });

  it("falls back to published reels when the rollup RPC is missing, and says so", async () => {
    const reels: SupabaseReelRow[] = rows.slice(0, 3).map((row) => ({
      id: row.id,
      title: row.title,
      author_name: row.authorName,
      author_handle: row.authorHandle,
      text: row.body,
      genre: row.genre,
      mood: row.mood,
      minutes: row.minutes,
      word_count: row.wordCount,
      created_at: row.createdAt,
    }));

    const served = await serveReaderFeed(
      createTransport({
        reels,
        failRpc: { get_recommendation_candidates: new Error("function does not exist") },
      }),
      baseRequest
    );

    expect(served.degradedMode).toBe(true);
    expect(served.fallbackReason).toContain("candidate_rollups_unavailable");
    expect(served.candidateCount).toBe(3);
    // With no behavioural rollups every quality signal is a constant, so the
    // only defensible arm is the recency baseline - and the serve is filed
    // outside the live experiment rather than credited to the reader's arm.
    expect(served.experiment.experimentKey).toBe("boks-feed-unmigrated");
    expect(served.experiment.algorithmId).toBe("recency");
    expect(served.experiment.source).toBe("fallback");
  });

  it("refuses to degrade when the reader's token was rejected", async () => {
    const rejected = Object.assign(new Error("JWT expired"), { isAuthFailure: true });

    await expect(
      serveReaderFeed(
        createTransport({ failRpc: { get_recommendation_candidates: rejected } }),
        baseRequest
      )
    ).rejects.toThrow("JWT expired");
  });

  it("returns the delivered reels in delivered order", async () => {
    const served = await serveReaderFeed(createTransport({}), baseRequest);

    expect(served.reels.map((reel) => reel.id)).toEqual(
      served.entries.map((entry) => entry.candidate.id)
    );
    expect(served.reels).toHaveLength(5);
  });

  it("does not honour a stored arm the active experiment no longer sends traffic to", async () => {
    // `completion_first` is a registered strategy, but this experiment parks
    // it; a reader stored there must be ranked - and credited - as assigned now.
    const parked = await serveReaderFeed(createTransport({ storedArm: "completion_first" }), baseRequest);
    expect(["balanced", "recency"]).toContain(parked.experiment.algorithmId);
    expect(parked.experiment.source).toBe("fallback");

    // The RPC's default for an empty id, and a strategy this build lacks.
    for (const storedArm of ["unassigned", "retired_strategy"]) {
      const served = await serveReaderFeed(createTransport({ storedArm }), baseRequest);
      expect(["balanced", "recency"]).toContain(served.experiment.algorithmId);
      expect(served.experiment.source).toBe("fallback");
    }
  });

  it("applies the reader's languages on the degraded path too", async () => {
    const reelCalls: { limit: number; languages?: readonly string[] }[] = [];
    await serveReaderFeed(
      createTransport({
        reelCalls,
        failRpc: { get_recommendation_candidates: new Error("statement timeout") },
      }),
      { ...baseRequest, readingLanguages: ["ru"] }
    );
    expect(reelCalls).toEqual([{ limit: 200, languages: ["ru"] }]);
  });

  it("never returns database text as the fallback reason", async () => {
    const served = await serveReaderFeed(
      createTransport({
        failRpc: {
          get_recommendation_candidates: Object.assign(
            new Error('relation "secret_table" does not exist at character 42'),
            { code: "42P01" }
          ),
        },
      }),
      baseRequest
    );
    expect(served.fallbackReason).toBe("candidate_rollups_unavailable: 42P01");
  });

  it("falls back to the offered candidates when the catalog count fails", async () => {
    const served = await serveReaderFeed(createTransport({ failCount: true }), baseRequest);
    expect(served.catalogSize).toBe(rows.length);
  });
});

describe("describeErrorCode", () => {
  it("keeps a short code and drops everything else", () => {
    expect(describeErrorCode({ code: "PGRST202", message: "x" })).toBe("PGRST202");
    expect(describeErrorCode({ code: 'drop table"; --' })).toBe("unknown");
    expect(describeErrorCode(new Error("free text"))).toBe("unknown");
    expect(describeErrorCode(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("timeout");
  });
});
