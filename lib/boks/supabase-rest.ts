import type { FeedTransport } from "@/lib/boks/feed-service";
import type { SupabaseReelRow } from "@/lib/boks/supabase-reels";

/**
 * A PostgREST transport that runs anywhere `fetch` does.
 *
 * The Worker talks to Supabase through this rather than through supabase-js so
 * that it holds no elevated credentials and no session state: it forwards the
 * reader's own access token, and row-level security applies exactly as it does
 * in the browser.
 */

export class SupabaseRestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "SupabaseRestError";
    this.status = status;
    this.code = code;
  }

  /** True when Supabase rejected the reader's token, not the request. */
  get isAuthFailure() {
    return this.status === 401 || this.status === 403;
  }
}

export type SupabaseRestOptions = {
  restUrl: string;
  apiKey: string;
  accessToken: string;
};

const reelColumns = "id,title,author_name,author_handle,author_user_id,hook,text,genre,mood,minutes,word_count,created_at";

export function createSupabaseRestTransport(options: SupabaseRestOptions): FeedTransport {
  const headers = {
    apikey: options.apiKey,
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${options.restUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { message?: string; code?: string }
        | null;
      throw new SupabaseRestError(
        `${path} -> ${body?.message ?? `Supabase request failed (${response.status}).`}`,
        response.status,
        body?.code ?? String(response.status)
      );
    }

    return response;
  }

  return {
    async rpc<Result>(name: string, body: Record<string, unknown> = {}) {
      const response = await request(`/rpc/${name}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const text = await response.text();
      return (text ? JSON.parse(text) : null) as Result;
    },

    async publishedReels(limit: number) {
      const response = await request(
        `/published_boks?select=${reelColumns}&order=created_at.desc&limit=${limit}`
      );
      return (await response.json()) as SupabaseReelRow[];
    },

    async publishedCount() {
      const response = await request(`/published_boks?select=id&limit=1`, {
        headers: { Prefer: "count=exact" },
      });
      // PostgREST reports the exact count in the range header: `0-0/39`.
      const total = response.headers.get("content-range")?.split("/")[1];
      const parsed = Number(total);
      if (!Number.isFinite(parsed)) throw new Error("Supabase did not return a catalog count.");
      return parsed;
    },
  };
}

/**
 * The reader id carried by a Supabase access token.
 *
 * Read, not trusted: the id decides which arm the reader is hashed into, while
 * every read and write still goes through PostgREST, which verifies the
 * signature. A forged token therefore buys a wrong hash bucket and nothing else
 * — and its requests fail, which the caller surfaces as a 401.
 */
export function readerIdFromAccessToken(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const claims = JSON.parse(atob(padded)) as { sub?: string };
    return claims.sub ?? null;
  } catch {
    return null;
  }
}
