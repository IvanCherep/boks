import { useSyncExternalStore } from "react";
import { linkOnlyCover, linkOnlyFilePath } from "@/lib/boks/link-only";

/**
 * Authors' own Series sections, read from the database (`get_boks_series_shelf_authors`,
 * 20261118170000) rather than registered in code.
 *
 * A page the team marked for the shelf puts its Series there the moment its
 * owner publishes them, in the owner's page order, above the sections in
 * `series-catalogue.ts`. Hiding a work takes it off at once. Pieces registered
 * in code win: this only adds what the code does not know.
 *
 * One small request per page view, made by the feed and the shelf; until it
 * answers (or when it fails) the site is exactly what the code registers.
 * Kept free of the catalogue's imports: `poems.ts` and `series-catalogue.ts`
 * both read it.
 */

export type LiveSeriesPiece = {
  storyId: string;
  format: "poem";
  language: string;
  title: string;
  author: string;
  cover: string;
  coverFocus: string;
  durationSeconds: number;
  scenes: number;
  moments: number;
  premieredOn: string;
  /** The link-only folder of its manifest. */
  token: string;
};

export type LiveSeriesSection = {
  /** `author-<handle>`: never one of the sections in code. */
  id: string;
  handle: string;
  name: string;
  photo: string | null;
  pieces: LiveSeriesPiece[];
};

type Row = {
  handle?: string;
  name?: string;
  photoVersion?: number | null;
  pieces?: {
    bokId?: string;
    title?: string;
    author?: string;
    language?: string;
    token?: string;
    publishedOn?: string;
    card?: { seconds?: number; scenes?: number; moments?: number; focus?: string };
  }[];
}[];

const tokenShape = /^[A-Za-z0-9_-]{22,64}$/;
const handleShape = /^[a-z][a-z0-9_]{2,23}$/i;

/** The answer, checked: nothing from it reaches a URL unless it has the expected shape. */
export function readLiveSeries(rows: unknown): LiveSeriesSection[] {
  if (!Array.isArray(rows)) return [];
  const sections: LiveSeriesSection[] = [];
  for (const row of rows as Row) {
    const handle = String(row?.handle ?? "");
    if (!handleShape.test(handle)) continue;
    const name = String(row?.name ?? "").trim() || `@${handle}`;
    const pieces: LiveSeriesPiece[] = [];
    for (const item of row?.pieces ?? []) {
      const storyId = String(item?.bokId ?? "");
      const token = String(item?.token ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(storyId) || !tokenShape.test(token)) continue;
      const card = item?.card ?? {};
      const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);
      pieces.push({
        storyId,
        format: "poem",
        language: String(item?.language || "ru"),
        title: String(item?.title ?? ""),
        author: String(item?.author ?? name),
        cover: linkOnlyCover(token),
        coverFocus: typeof card.focus === "string" && /^[0-9. %a-z-]{1,40}$/i.test(card.focus) ? card.focus : "50% 40%",
        durationSeconds: count(card.seconds),
        scenes: count(card.scenes),
        moments: count(card.moments),
        premieredOn: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.publishedOn ?? "")) ? String(item!.publishedOn) : "2000-01-01",
        token,
      });
    }
    if (pieces.length === 0) continue;
    const version = Number(row?.photoVersion);
    sections.push({
      id: `author-${handle.toLowerCase().replace(/_/g, "-")}`,
      handle,
      name,
      photo: Number.isInteger(version) && version > 0 ? `/a/${encodeURIComponent(handle)}/photo?v=${version}` : null,
      pieces,
    });
  }
  return sections;
}

// ------------------------------------------------------------------ the store

let sections: readonly LiveSeriesSection[] = [];
let byStory = new Map<string, LiveSeriesPiece>();
let status: "idle" | "loading" | "ready" | "failed" = "idle";
let request: Promise<readonly LiveSeriesSection[]> | null = null;
const listeners = new Set<() => void>();

/** Replaces what is known (the loader, and tests). */
export function setLiveSeries(next: readonly LiveSeriesSection[]) {
  sections = next;
  byStory = new Map(next.flatMap((section) => section.pieces.map((piece) => [piece.storyId, piece] as const)));
  status = "ready";
  for (const listener of listeners) listener();
}

export function liveSeriesSections(): readonly LiveSeriesSection[] {
  return sections;
}

export function liveSeriesPieceFor(storyId: string | null | undefined): LiveSeriesPiece | null {
  return storyId ? (byStory.get(storyId) ?? null) : null;
}

export function liveSeriesManifestFor(storyId: string): string | null {
  const piece = byStory.get(storyId);
  return piece ? linkOnlyFilePath(piece.token, "manifest.json") : null;
}

/** Asks once per page view; a failure is retried by the next caller. */
export function loadLiveSeries(): Promise<readonly LiveSeriesSection[]> {
  if (status === "ready") return Promise.resolve(sections);
  request ??= (async () => {
    status = "loading";
    try {
      const { supabase } = await import("@/lib/boks/supabase-client");
      if (!supabase) {
        setLiveSeries([]);
        return sections;
      }
      const answer = await supabase.rpc("get_boks_series_shelf_authors");
      if (answer.error) throw answer.error;
      setLiveSeries(readLiveSeries(answer.data));
      return sections;
    } catch {
      status = "failed";
      request = null;
      for (const listener of listeners) listener();
      return sections;
    }
  })();
  return request;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders when the sections arrive; `ready` is false until then. */
export function useLiveSeries(): { sections: readonly LiveSeriesSection[]; ready: boolean } {
  const current = useSyncExternalStore(subscribe, () => sections, () => sections);
  const done = useSyncExternalStore(subscribe, () => status === "ready" || status === "failed", () => false);
  return { sections: current, ready: done };
}
