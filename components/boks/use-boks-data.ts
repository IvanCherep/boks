"use client";

import { useCallback, useState } from "react";
import { initialMetrics } from "@/components/boks/constants";
import type { Comment, LoadOptions, Metrics, RecommendationExperiment, Story } from "@/components/boks/client-types";
import {
  canUseSupabaseBrowserData,
  loadSupabaseAdminMetrics,
  loadSupabaseReaderFeed,
} from "@/components/boks/supabase-browser-data";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title?: string;
          description: string;
          inputSchema: object;
          annotations?: Record<string, boolean>;
          execute: (input: unknown) => unknown | Promise<unknown>;
        },
        options?: { signal?: AbortSignal }
      ) => void | Promise<void>;
    };
  }
}

export function useBoksData() {
  const [stories, setStories] = useState<Story[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [experiment, setExperiment] = useState<RecommendationExperiment | null>(null);
  const [likedStoryIds, setLikedStoryIds] = useState<string[]>([]);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [isSupabaseReader, setIsSupabaseReader] = useState(false);
  const [status, setStatus] = useState("Loading");

  const load = useCallback(async (options: LoadOptions = {}) => {
    setStatus("Loading");
    const view = options.view ?? "reader";

    if (canUseSupabaseBrowserData() && view === "reader") {
      const data = await loadSupabaseReaderFeed(options.limit ?? 80);
      setStories(data.stories);
      setComments(data.comments);
      setMetrics(data.metrics);
      setExperiment(data.experiment);
      setLikedStoryIds(data.likedStoryIds);
      setSupabaseUserId(data.supabaseUserId);
      setIsSupabaseReader(true);
      setStatus("Ready");
      return data;
    }

    if (canUseSupabaseBrowserData() && view === "admin") {
      const supabaseMetrics = await loadSupabaseAdminMetrics(options);
      setStories((supabaseMetrics.stories as Story[]) ?? []);
      setComments([]);
      setMetrics(supabaseMetrics);
      setExperiment(null);
      setLikedStoryIds([]);
      setSupabaseUserId(null);
      setIsSupabaseReader(false);
      setStatus("Ready");
      return { stories: supabaseMetrics.stories, comments: [], metrics: supabaseMetrics };
    }

    setIsSupabaseReader(false);
    const params = new URLSearchParams({
      view,
      limit: String(options.limit ?? (view === "admin" ? 100 : 80)),
    });
    if (options.offset) params.set("offset", String(options.offset));
    if (options.q?.trim()) params.set("q", options.q.trim());
    if (options.sort) params.set("sort", options.sort);
    if (options.visitorId) params.set("visitorId", options.visitorId);
    if (options.algorithm) params.set("algorithm", options.algorithm);

    const response = await fetch(`/api/boks?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load boks.");
    setStories(data.stories ?? []);
    setComments(data.comments ?? []);
    setMetrics(data.metrics);
    setExperiment(data.experiment ?? null);
    setLikedStoryIds([]);
    setSupabaseUserId(null);
    setStatus("Ready");
    return data;
  }, []);

  return {
    stories,
    comments,
    metrics,
    experiment,
    likedStoryIds,
    supabaseUserId,
    isSupabaseReader,
    status,
    setStatus,
    load,
  };
}
