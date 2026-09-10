"use client";

import { initialMetrics } from "@/components/boks/constants";
import type { Metrics, RecommendationExperiment, Story } from "@/components/boks/client-types";
import { getAnonymousSupabaseUserId, isSupabaseConfigured, supabase } from "@/lib/boks/supabase-client";

type SupabaseReelRow = {
  id: string;
  title: string;
  author_name: string;
  author_handle: string;
  hook: string;
  text: string;
  genre: string;
  mood: string;
  minutes: number;
  created_at: string;
};

type SupabaseLikeRow = {
  reel_id: string;
};

export type SupabaseReaderPayload = {
  stories: Story[];
  comments: [];
  metrics: Metrics;
  experiment: RecommendationExperiment;
  likedStoryIds: string[];
  supabaseUserId: string | null;
};

export function canUseSupabaseBrowserData() {
  return isSupabaseConfigured && Boolean(supabase);
}

export async function loadSupabaseReaderFeed(limit: number): Promise<SupabaseReaderPayload> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const userId = await getAnonymousSupabaseUserId();
  if (!userId) throw new Error("Could not create anonymous Supabase user.");

  const reelsResult = await supabase
    .from("reels")
    .select("id,title,author_name,author_handle,hook,text,genre,mood,minutes,created_at")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (reelsResult.error) throw reelsResult.error;

  const reelRows = (reelsResult.data ?? []) as SupabaseReelRow[];
  const reelIds = reelRows.map((reel) => reel.id);
  const likedStoryIds = await loadLikedStoryIds(userId, reelIds);
  const likedSet = new Set(likedStoryIds);

  const stories = reelRows.map((reel) => ({
    id: reel.id,
    title: reel.title,
    authorName: reel.author_name,
    authorHandle: reel.author_handle,
    hook: reel.hook,
    body: reel.text,
    genre: reel.genre,
    mood: reel.mood,
    minutes: reel.minutes,
    likes: likedSet.has(reel.id) ? 1 : 0,
    shares: 0,
    starts: 0,
    completes: 0,
    commentsCount: 0,
    avgSeconds: 0,
  }));

  return {
    stories,
    comments: [],
    metrics: {
      ...initialMetrics,
      funnel: {
        totalStories: stories.length,
      },
      stories,
    },
    experiment: {
      algorithmId: "supabase_recent",
      algorithmName: "Supabase recent",
      userSegment: "anonymous",
      source: "assigned",
    },
    likedStoryIds,
    supabaseUserId: userId,
  };
}

export async function loadSupabaseAdminMetrics(options: {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: string;
}): Promise<Metrics> {
  if (!supabase) throw new Error("Supabase is not configured.");

  await getAnonymousSupabaseUserId();

  const result = await supabase.rpc("get_boks_admin_snapshot", {
    p_limit: options.limit ?? 100,
    p_offset: options.offset ?? 0,
    p_query: options.q ?? "",
    p_sort: options.sort ?? "signal",
  });

  if (result.error) throw result.error;

  return (result.data ?? initialMetrics) as Metrics;
}

async function loadLikedStoryIds(userId: string, reelIds: string[]) {
  if (!supabase || !reelIds.length) return [];

  const likesResult = await supabase
    .from("likes")
    .select("reel_id")
    .eq("user_id", userId)
    .in("reel_id", reelIds);

  if (likesResult.error) throw likesResult.error;

  return ((likesResult.data ?? []) as SupabaseLikeRow[]).map((like) => like.reel_id);
}

export async function recordSupabaseView(userId: string | null, storyId: string) {
  if (!supabase || !userId) return;

  const result = await supabase.from("views").insert({
    user_id: userId,
    reel_id: storyId,
  });

  if (result.error) throw result.error;
}

export async function setSupabaseLike(userId: string | null, storyId: string, liked: boolean) {
  if (!supabase || !userId) return;

  const result = liked
    ? await supabase.from("likes").upsert(
        {
          user_id: userId,
          reel_id: storyId,
        },
        { onConflict: "user_id,reel_id" }
      )
    : await supabase.from("likes").delete().eq("user_id", userId).eq("reel_id", storyId);

  if (result.error) throw result.error;
}
