/**
 * A visitor's path to an account, as the client sees it.
 *
 * The founder can bring people to boks and few of them sign up, and the reading
 * events cannot say why: the moments that decide it - where someone came from,
 * when they were asked to sign up, whether they asked for a link - are not
 * reading moments. These helpers capture exactly those, for
 * `record_boks_journey_event` and the admin console's Guests tab.
 *
 * Everything here is best-effort by design. A lost analytics event costs one
 * row; an analytics call that throws costs a reader.
 */

import { supabase } from "@/lib/boks/supabase-client";
import { analyticsAllowed } from "@/lib/boks/analytics-gate";
import { bokIdFrom, linkCodeFrom } from "@/lib/boks/tracked-links";

export type JourneyLanding = "home" | "shared_bok" | "series";

export type JourneyAttribution = {
  landing: JourneyLanding;
  /** The bok a shared link opened, or null when the visit landed on a page. */
  landingBokId: string | null;
  /** The tracked link's code (`?link=`); the database keeps only codes an admin created. */
  linkCode: string | null;
  /** The host that sent the visitor, or null for a direct visit. */
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};


/** boks's own hosts: a referrer from one of them is navigation, not a source. */
const ownHosts = new Set(["tryboks.ru", "www.tryboks.ru", "tryboks.com", "www.tryboks.com", "read.tryboks.workers.dev", "localhost", "127.0.0.1"]);

function hostOf(value: string | null | undefined) {
  if (!value) return null;
  try {
    const host = new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Where this visit came from, read before anything strips the address bar.
 *
 * A shared link arrives as `/b/<id>`, which redirects to `/?bok=<id>` - and a
 * redirect loses the original referrer, so the `/b` page passes it along as
 * `ref` and marks the landing with `from=share`. Either signal, or the `bok`
 * parameter itself, means the visitor came through a shared bok.
 *
 * `link` is a tracked link's code (`lib/boks/tracked-links.ts`), and the `/b`
 * page carries it across the redirect too.
 */
export function journeyAttribution(href: string, referrer: string): JourneyAttribution {
  let params = new URLSearchParams();
  let pathname = "/";
  try {
    const url = new URL(href);
    params = url.searchParams;
    pathname = url.pathname;
  } catch {
    // A malformed address is still a visit; it just has no source.
  }

  const passedOn = hostOf(params.get("ref"));
  const fromReferrer = hostOf(referrer);
  const referrerHost = [passedOn, fromReferrer].find((host) => host && !ownHosts.has(host)) ?? null;
  const shared = params.get("from") === "share" || params.has("bok");
  const utm = (name: string) => {
    const value = params.get(name)?.trim();
    return value ? value.slice(0, 120) : null;
  };

  return {
    landing: shared ? "shared_bok" : pathname.replace(/\/+$/, "") === "/series" ? "series" : "home",
    landingBokId: bokIdFrom(params.get("bok")),
    linkCode: linkCodeFrom(params.get("link")),
    referrerHost,
    utmSource: utm("utm_source"),
    utmMedium: utm("utm_medium"),
    utmCampaign: utm("utm_campaign"),
  };
}

export type SignupReason = "limit" | "like" | "comment" | "follow" | "notice" | "manual" | "signin";

/**
 * Why the account panel opened, as one word for the funnel.
 *
 * The panel knows two things - a `reason` (manual, notice, required) and an
 * `intent` (general, like, comment, follow) - and the question the console
 * asks is simpler: which wall did this guest hit.
 *
 * It used to know a third, whether the reader had picked Sign up or Sign in,
 * and that produced a `signin` reason. There is no such choice any more: one
 * address, and an account if there is not one. The value stays in the type
 * because rows recorded under it are still in the table.
 */
export function signupReason(input: { reason?: string | null; intent?: string | null }): SignupReason {
  if (input.reason === "required") return "limit";
  if (input.intent === "like" || input.intent === "comment" || input.intent === "follow") return input.intent;
  if (input.reason === "notice") return "notice";
  return "manual";
}

type JourneyEvent =
  | { event: "visit"; attribution: JourneyAttribution; country?: string | null }
  | { event: "signup_prompt" | "signup_request"; reason: SignupReason };

/**
 * The visitor's country, from our own Worker (`/api/geo`), which reads the
 * header Cloudflare adds. The browser cannot know this itself. Bounded and
 * silent: a visit without a country is still a visit.
 */
export async function fetchVisitorCountry(timeoutMs = 2500): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("/api/geo", { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { country?: unknown };
    return typeof body.country === "string" && /^[A-Z]{2}$/.test(body.country) ? body.country : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Sends one step. Never throws, never waits on the caller. */
export function recordJourneyEvent(step: JourneyEvent, context: { visitorId?: string; sessionId?: string }) {
  // Not from the dev server or a test browser: see `analytics-gate.ts`.
  if (!supabase || !analyticsAllowed()) return;
  const attribution = step.event === "visit" ? step.attribution : null;
  void supabase
    .rpc("record_boks_journey_event", {
      p_event: step.event,
      p_visitor_id: context.visitorId ?? null,
      p_session_id: context.sessionId ?? null,
      p_reason: step.event === "visit" ? null : step.reason,
      p_landing: attribution?.landing ?? null,
      p_referrer_host: attribution?.referrerHost ?? null,
      p_utm_source: attribution?.utmSource ?? null,
      p_utm_medium: attribution?.utmMedium ?? null,
      p_utm_campaign: attribution?.utmCampaign ?? null,
      p_country: step.event === "visit" ? step.country ?? null : null,
      p_landing_bok: attribution?.landingBokId ?? null,
      p_link_code: attribution?.linkCode ?? null,
    })
    .then(
      () => undefined,
      () => undefined
    );
}
