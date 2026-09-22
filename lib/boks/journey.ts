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

export type JourneyLanding = "home" | "shared_bok";

export type JourneyAttribution = {
  landing: JourneyLanding;
  /** The host that sent the visitor, or null for a direct visit. */
  referrerHost: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

/** boks's own hosts: a referrer from one of them is navigation, not a source. */
const ownHosts = new Set(["tryboks.com", "read.tryboks.workers.dev", "localhost", "127.0.0.1"]);

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
 */
export function journeyAttribution(href: string, referrer: string): JourneyAttribution {
  let params = new URLSearchParams();
  try {
    params = new URL(href).searchParams;
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
    landing: shared ? "shared_bok" : "home",
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
 */
export function signupReason(input: { reason?: string | null; intent?: string | null; mode?: string | null }): SignupReason {
  if (input.reason === "required") return "limit";
  if (input.intent === "like" || input.intent === "comment" || input.intent === "follow") return input.intent;
  if (input.reason === "notice") return "notice";
  if (input.mode === "signin") return "signin";
  return "manual";
}

type JourneyEvent =
  | { event: "visit"; attribution: JourneyAttribution }
  | { event: "signup_prompt" | "signup_request"; reason: SignupReason };

/** Sends one step. Never throws, never waits on the caller. */
export function recordJourneyEvent(step: JourneyEvent, context: { visitorId?: string; sessionId?: string }) {
  if (!supabase) return;
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
    })
    .then(
      () => undefined,
      () => undefined
    );
}
