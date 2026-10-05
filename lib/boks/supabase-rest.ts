import type { FeedTransport } from "@/lib/boks/feed-service";
import { publishedReelColumns, type SupabaseReelRow } from "@/lib/boks/supabase-reels";

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
  /** Aborts every call, e.g. when the reader's own request goes away. */
  signal?: AbortSignal;
  /**
   * Upper bound on one call. The browser gives the Worker 4 s for the whole
   * feed, so a database call that has not answered in 3 s is already too late
   * to help it.
   */
  timeoutMs?: number;
};

export const defaultSupabaseRestTimeoutMs = 3000;

/**
 * The PostgREST filter for a reader's languages, or nothing.
 *
 * Mirrors `get_recommendation_candidates`: no languages named means no
 * filter; otherwise only the named ones, so an undetermined piece is left out.
 */
export function languageFilterParam(languages: readonly string[] | undefined) {
  const codes = (languages ?? []).filter((code) => /^[a-z]{2,3}$/.test(code)).slice(0, 10);
  return codes.length ? `&language=in.(${codes.join(",")})` : "";
}

export function createSupabaseRestTransport(options: SupabaseRestOptions): FeedTransport {
  const headers = {
    apikey: options.apiKey,
    Authorization: `Bearer ${options.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  async function request(path: string, init: RequestInit = {}) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? defaultSupabaseRestTimeoutMs);
    const response = await fetch(`${options.restUrl}${path}`, {
      ...init,
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
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

    async publishedReels(limit: number, languages?: readonly string[]) {
      const response = await request(
        `/published_boks?select=${publishedReelColumns}${languageFilterParam(languages)}` +
          `&order=created_at.desc&limit=${limit}`
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
  if (token.length > 16_384) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const claims = JSON.parse(atob(padded)) as { sub?: string };
    const subject = claims.sub ?? "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(subject)
      ? subject
      : null;
  } catch {
    return null;
  }
}
