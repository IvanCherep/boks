"use client";

import { useCallback, useState } from "react";
import { initialMetrics } from "@/components/boks/constants";
import { readerSlateSize } from "@/components/boks/reader-behavior";
import { appendNewStories } from "@/components/boks/reader-place";
import type {
  Comment,
  FeedProvenance,
  LoadOptions,
  Metrics,
  RecommendationExperiment,
  Story,
} from "@/components/boks/client-types";
import { LABELING_VERSION } from "@/lib/boks/recommendations/versions";
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

/**
 * Provenance before any feed has been served.
 *
 * It claims nothing: no backend, no fallback reason. Events cannot be recorded
 * against it anyway - there is no boks on screen until a feed arrives.
 */
const pendingProvenance: FeedProvenance = {
  feedId: null,
  servingBackend: "unknown",
  degradedMode: false,
  fallbackReason: null,
  labelingVersion: LABELING_VERSION,
  catalogSize: 0,
  candidateCount: 0,
};

/**
 * Supabase is the only store. A build without its address has nothing to
 * read from, and says so rather than serving a second, unmeasured catalogue.
 */
const supabaseNotConfigured = "boks is not connected to its database in this build (VITE_SUPABASE_URL is missing).";

export function useBoksData() {
  const [stories, setStories] = useState<Story[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [experiment, setExperiment] = useState<RecommendationExperiment | null>(null);
  const [likedStoryIds, setLikedStoryIds] = useState<string[]>([]);
  const [supabaseUserId, setSupabaseUserId] = useState<string | null>(null);
  const [isSupabaseReader, setIsSupabaseReader] = useState(false);
  const [provenance, setProvenance] = useState<FeedProvenance>(pendingProvenance);
  const [status, setStatus] = useState("Loading");
  /**
   * Whether the feed has settled, kept apart from `status`.
   *
   * `status` is a message channel: it carries "Link copied", a copied URL, and
   * every error a reader should read. It was doing double duty as the load
   * phase too, and callers ended up asking questions like "is the status text
   * empty or does it mention boks" to decide whether a feed was legitimately
   * empty. That coupling broke the language empty-state the moment the
   * settled message was "Ready" rather than the string that had been guessed
   * at. A caller that needs the phase should read the phase.
   */
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");

  const runLoad = useCallback(async (options: LoadOptions = {}) => {
    const view = options.view ?? "reader";
    const appending = Boolean(options.append) && view === "reader";
    // Loading more at the end of a feed is not a new feed: the reader is
    // mid-read, and the phase drives the empty-feed screen.
    if (!appending) {
      setStatus("Loading");
      setPhase("loading");
    }

    if (!canUseSupabaseBrowserData()) throw new Error(supabaseNotConfigured);

    // No catch: a reader whose Supabase feed fails must see the failure rather
    // than a second store whose events no comparison can see.
    if (view === "reader") {
      const data = await loadSupabaseReaderFeed({
        limit: options.limit ?? readerSlateSize,
        visitorId: options.visitorId ?? "anonymous",
        sessionId: options.sessionId ?? "",
        reader: options.reader,
        profileSnapshot: options.profileSnapshot,
        readingLanguages: options.readingLanguages,
      });
      if (appending) {
        setStories((current) => appendNewStories(current, data.stories));
        setComments((current) => [...current, ...data.comments]);
        setLikedStoryIds((current) => Array.from(new Set([...current, ...data.likedStoryIds])));
      } else {
        setStories(data.stories);
        setComments(data.comments);
        setLikedStoryIds(data.likedStoryIds);
      }
      setMetrics(data.metrics);
      setExperiment(data.experiment);
      setSupabaseUserId(data.supabaseUserId);
      // Events from here on carry the newest serve's provenance.
      setProvenance(data.provenance);
      setIsSupabaseReader(true);
      setStatus("Ready");
      setPhase("ready");
      return data;
    }

    // view === "admin"
    const supabaseMetrics = await loadSupabaseAdminMetrics(options);
    setStories((supabaseMetrics.stories as Story[]) ?? []);
    setComments([]);
    setMetrics(supabaseMetrics);
    setExperiment(null);
    setLikedStoryIds([]);
    setSupabaseUserId(null);
    setIsSupabaseReader(false);
    setStatus("Ready");
    setPhase("ready");
    return { stories: supabaseMetrics.stories, comments: [], metrics: supabaseMetrics };
  }, []);

  /**
   * A failed load is not an empty one.
   *
   * Callers report the error through `status`; the phase has to record the
   * failure too, or a reader whose feed could not load would be told that
   * nothing exists in their language.
   */
  const load = useCallback(
    async (options: LoadOptions = {}) => {
      try {
        return await runLoad(options);
      } catch (error) {
        setPhase("failed");
        throw error;
      }
    },
    [runLoad]
  );

  return {
    stories,
    comments,
    metrics,
    experiment,
    likedStoryIds,
    supabaseUserId,
    isSupabaseReader,
    provenance,
    status,
    setStatus,
    phase,
    load,
  };
}
