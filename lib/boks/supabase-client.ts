import { withUnreachableTimeout } from "@/lib/boks/network-errors";
import { createClient } from "@supabase/supabase-js";
import type { BoksUserContext } from "@/components/boks/client-types";
import { describeMagicLinkRedirectError } from "@/lib/boks/magic-link-errors";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export const supabaseRestUrl = supabaseUrl ? `${supabaseUrl as string}/rest/v1` : null;
export const supabasePublishableApiKey = (supabasePublishableKey as string | undefined) ?? null;

/**
 * Session storage that cannot throw.
 *
 * `localStorage` is not always available even when it exists: a browser with
 * site data blocked, a privacy mode, an in-app browser, and an iOS private
 * window all raise on access rather than returning null. The default storage
 * adapter does not catch that, so the throw surfaces from `getSession()` while
 * the reader is booting - which is one of the ways this app reached a blank
 * screen. Falling back to memory costs the reader their session when they close
 * the tab, and keeps them reading now.
 */
const sessionMemory = new Map<string, string>();

const resilientAuthStorage = {
  getItem(key: string) {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return sessionMemory.get(key) ?? null;
    }
  },
  setItem(key: string, value: string) {
    sessionMemory.set(key, value);
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(key, value);
    } catch {
      // Memory already has it.
    }
  },
  removeItem(key: string) {
    sessionMemory.delete(key);
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(key);
    } catch {
      // Nothing else to do.
    }
  },
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabasePublishableKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        storage: resilientAuthStorage,
      },
    })
  : null;

/**
 * The access token, kept where a `pagehide` handler can reach it without
 * awaiting anything. Reading the session is asynchronous, and a page that is
 * being torn down does not reliably get another microtask.
 */
let cachedAccessToken: string | null = null;
let magicLinkRedirectPromise: Promise<void> | null = null;

if (supabase) {
  void settleBoksMagicLinkRedirect()
    .catch(() => undefined)
    .then(() => supabase.auth.getSession())
    .then((result) => {
      cachedAccessToken = result.data.session?.access_token ?? null;
    });
  supabase.auth.onAuthStateChange((_event, session) => {
    cachedAccessToken = session?.access_token ?? null;
  });
}

export function getCachedAccessToken() {
  return cachedAccessToken;
}

function readHashParams() {
  if (typeof window === "undefined" || !window.location.hash.startsWith("#")) return null;
  return new URLSearchParams(window.location.hash.slice(1));
}

function readSearchParams() {
  if (typeof window === "undefined" || !window.location.search) return null;
  return new URLSearchParams(window.location.search);
}

function clearAuthRedirectFromUrl() {
  if (typeof window === "undefined") return;

  const searchParams = new URLSearchParams(window.location.search);
  const authSearchKeys = ["code", "error", "error_code", "error_description"];
  authSearchKeys.forEach((key) => searchParams.delete(key));

  const search = searchParams.toString();
  const nextUrl = `${window.location.pathname}${search ? `?${search}` : ""}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
}

function clearStoredSupabaseSession() {
  if (typeof window === "undefined" || !supabaseUrl) return;

  try {
    const projectRef = new URL(supabaseUrl as string).hostname.split(".")[0];
    window.localStorage.removeItem(`sb-${projectRef}-auth-token`);
  } catch {
    // The URL is validated by createClient; this guard only keeps cleanup best-effort.
  }
}

/**
 * A sign-in link that did not work: clean the URL and leave a plain-language
 * notice for the page. The session already on this device is left alone. It
 * used to be deleted here, so tapping an old link - a second tap, an email
 * scanner that opened it first, the earlier of two emails - signed out a
 * reader who was signed in.
 */
function rememberUnusableMagicLink(message?: string | null) {
  clearAuthRedirectFromUrl();
  saveMagicLinkRedirectNotice(describeMagicLinkRedirectError(message));
}

/** The session stored on this device is itself broken: drop it as well. */
function forgetBrokenSession(message?: string | null) {
  clearStoredSupabaseSession();
  rememberUnusableMagicLink(message);
}

function isUnusableMagicLinkError(message?: string | null) {
  const normalized = (message ?? "").toLowerCase();
  return (
    normalized.includes("email link is invalid") ||
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found") ||
    normalized.includes("expired") ||
    normalized.includes("invalid jwt") ||
    normalized.includes("unrecognized jwt kid")
  );
}

/**
 * Supabase magic links now use PKCE and return `?code=...`. Older emails may
 * still contain implicit-flow tokens in the hash, so keep a fallback that can
 * explain expired or already-used links without leaving broken tokens in the URL.
 */
export async function settleBoksMagicLinkRedirect() {
  if (!supabase) return;
  if (magicLinkRedirectPromise) return magicLinkRedirectPromise;

  magicLinkRedirectPromise = (async () => {
    const searchParams = readSearchParams();
    const searchError = searchParams?.get("error_description") || searchParams?.get("error");
    if (searchError) {
      rememberUnusableMagicLink(searchError);
      return;
    }

    const code = searchParams?.get("code");
    if (code) {
      try {
        const exchanged = await supabase.auth.exchangeCodeForSession(code);
        if (exchanged.error) throw exchanged.error;
        cachedAccessToken = exchanged.data.session?.access_token ?? null;
      } catch (error) {
        rememberUnusableMagicLink(error instanceof Error ? error.message : null);
      } finally {
        clearAuthRedirectFromUrl();
      }
      return;
    }

    const hashParams = readHashParams();
    if (!hashParams) return;

    const error = hashParams.get("error_description") || hashParams.get("error");
    if (error) {
      rememberUnusableMagicLink(error);
      return;
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    if (!refreshToken) return;

    try {
      if (accessToken) {
        const session = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!session.error) {
          cachedAccessToken = session.data.session?.access_token ?? null;
          return;
        }
      }

      const refreshed = await supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (refreshed.error) throw refreshed.error;
      cachedAccessToken = refreshed.data.session?.access_token ?? null;
    } catch (error) {
      rememberUnusableMagicLink(error instanceof Error ? error.message : null);
    } finally {
      clearAuthRedirectFromUrl();
    }
  })();

  return magicLinkRedirectPromise;
}

export async function getAnonymousSupabaseUserId() {
  if (!supabase) return null;

  await settleBoksMagicLinkRedirect();

  // Bounded, because this is the first thing the app does and a hanging call
  // here is a blank screen for as long as the reader will tolerate one. On a
  // network that blocks the API host it fails in eight seconds with a reason
  // the reader screen can explain.
  const sessionResult = await withUnreachableTimeout(supabase.auth.getSession(), "the boks session");
  if (sessionResult.error) {
    if (!isUnusableMagicLinkError(sessionResult.error.message)) throw sessionResult.error;
    forgetBrokenSession(sessionResult.error.message);
  }
  if (sessionResult.data.session?.user.id) return sessionResult.data.session.user.id;

  const signInResult = await withUnreachableTimeout(
    supabase.auth.signInAnonymously(),
    "signing in as a guest"
  );
  if (signInResult.error) throw signInResult.error;

  return signInResult.data.user?.id ?? null;
}

export async function getCurrentSupabaseUser() {
  if (!supabase) return null;

  await settleBoksMagicLinkRedirect();

  const sessionResult = await withUnreachableTimeout(supabase.auth.getSession(), "the boks session");
  if (sessionResult.error) {
    if (!isUnusableMagicLinkError(sessionResult.error.message)) throw sessionResult.error;
    forgetBrokenSession(sessionResult.error.message);
    return null;
  }

  return sessionResult.data.session?.user ?? null;
}

export async function getCurrentBoksUserContext(): Promise<BoksUserContext | null> {
  if (!supabase) return null;

  const user = await getCurrentSupabaseUser();
  if (!user) return null;

  const result = await supabase.rpc("get_boks_user_context");
  if (result.error) throw result.error;

  const context = result.data as BoksUserContext;
  if (context.isAnonymous || context.handle) return context;

  // A signed-in reader with no @nickname has no profile row, which happens
  // whenever the email link is opened on a device that did not ask for it -
  // asked for on a phone, opened on a laptop - or after the browser cleared
  // its storage. The handle is the only public identity boks has: without a
  // row their comments and any boks they published would have nothing to
  // attribute them to, and every surface would call them "@reader". This is
  // the one seam every surface reads identity through, so the row is created
  // here. The RPC derives the nickname from the email and is idempotent.
  const ensured = await supabase.rpc("ensure_boks_user_profile", { p_display_name: "" });
  if (ensured.error) throw ensured.error;

  return ensured.data as BoksUserContext;
}

type PendingMagicLinkProfile = {
  email: string;
  displayName: string;
  handle: string;
  acceptedTermsVersion: string | null;
  createdAt: string;
};

const pendingMagicLinkProfileKey = "boks-pending-magic-link-profile";
const magicLinkRedirectNoticeKey = "boks-magic-link-redirect-notice";

type MagicLinkErrorContext = {
  flow: "signin" | "signup" | "admin";
};

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

function redirectUrl(path = "/") {
  if (typeof window === "undefined") return undefined;
  return new URL(path, window.location.origin).toString();
}

function savePendingMagicLinkProfile(profile: PendingMagicLinkProfile | null) {
  if (typeof window === "undefined") return;
  if (!profile) {
    window.localStorage.removeItem(pendingMagicLinkProfileKey);
    return;
  }
  window.localStorage.setItem(pendingMagicLinkProfileKey, JSON.stringify(profile));
}

function saveMagicLinkRedirectNotice(message: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(magicLinkRedirectNoticeKey, message);
}

export function consumeBoksMagicLinkRedirectNotice() {
  if (typeof window === "undefined") return "";
  const message = window.sessionStorage.getItem(magicLinkRedirectNoticeKey) ?? "";
  window.sessionStorage.removeItem(magicLinkRedirectNoticeKey);
  return message;
}

function readPendingMagicLinkProfile() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(window.localStorage.getItem(pendingMagicLinkProfileKey) ?? "null") as PendingMagicLinkProfile | null;
  } catch {
    return null;
  }
}

export async function requestBoksMagicLink(input: {
  email: string;
  displayName?: string;
  handle?: string;
  acceptedTermsVersion?: string | null;
  redirectPath?: string;
  shouldCreateUser?: boolean;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const email = normalizedEmail(input.email);
  if (!email) throw new Error("Enter your email.");

  const result = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectUrl(input.redirectPath ?? "/"),
      shouldCreateUser: input.shouldCreateUser ?? true,
    },
  });
  if (result.error) throw result.error;

  if (input.acceptedTermsVersion) {
    savePendingMagicLinkProfile({
      email,
      displayName: input.displayName?.trim() || "Reader",
      handle: input.handle?.trim() || "",
      acceptedTermsVersion: input.acceptedTermsVersion,
      createdAt: new Date().toISOString(),
    });
  }
}

export function explainBoksMagicLinkError(error: unknown, context: MagicLinkErrorContext) {
  const message = error instanceof Error ? error.message : "";
  const normalized = message.toLowerCase();

  if (normalized.includes("signups not allowed for otp")) {
    if (context.flow === "admin") {
      return "This email is not connected to an admin account yet. Sign in with an existing admin email, or grant admin access from the admin panel.";
    }
    return context.flow === "signin"
      ? "No boks account exists for this email yet. Use Sign up - it is free and keeps your reading history connected."
      : "Could not create this account by email link. Try again in a minute.";
  }

  if (
    normalized.includes("error sending magic link email") ||
    normalized.includes("email address not authorized") ||
    normalized.includes("smtp")
  ) {
    return "boks could not send the email right now. Try again in a few minutes.";
  }

  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("email rate limit") ||
    normalized.includes("over email send rate limit")
  ) {
    return "Too many sign-in emails were requested just now. Try again in a few minutes.";
  }

  if (normalized.includes("invalid login")) return "This email could not be signed in.";
  if (normalized.includes("already registered")) return "This email already has an account. Sign in instead.";
  if (
    normalized.includes("invalid refresh token") ||
    normalized.includes("refresh token not found") ||
    normalized.includes("expired") ||
    normalized.includes("invalid jwt") ||
    normalized.includes("unrecognized jwt kid")
  ) {
    return "This sign-in link has expired or was already used. Request a new one - only the newest link works.";
  }

  return message || "Could not send the boks email link.";
}

export async function completePendingBoksMagicLinkProfile(termsVersion: string): Promise<BoksUserContext | null> {
  if (!supabase) return null;

  const user = await getCurrentSupabaseUser();
  if (!user || user.is_anonymous) return null;

  const pending = readPendingMagicLinkProfile();
  if (!pending || normalizedEmail(user.email ?? "") !== normalizedEmail(pending.email)) {
    // No pending record: the link was opened on another device, or storage was
    // cleared. `getCurrentBoksUserContext` provisions the profile in that case.
    return getCurrentBoksUserContext();
  }

  const ensure = await supabase.rpc("ensure_boks_user_profile", {
    p_display_name: pending.displayName || "Reader",
  });
  if (ensure.error) throw ensure.error;

  const ensuredContext = ensure.data as BoksUserContext;
  if (ensuredContext.termsAcceptedAt) {
    // A sign-up draft can outlive the link that created it (for example after
    // signing an existing account in on the same browser). Replaying that
    // draft used to try to rename the real account on every settings open;
    // one taken nickname then prevented history, follows and settings from
    // loading at all. An account that already accepted terms is complete, so
    // the draft has no remaining work and must not mutate it.
    savePendingMagicLinkProfile(null);
    return ensuredContext;
  }

  // The current sign-up form asks only for email and derives a unique handle
  // in `ensure_boks_user_profile`. Older drafts may still carry a requested
  // handle from the retired form; replaying it here can rename an existing
  // account or fail on a name somebody else took. Nickname changes belong to
  // the explicit Settings action, never to opening an email link.
  const accept = await supabase.rpc("accept_boks_terms", {
    p_terms_version: pending.acceptedTermsVersion || termsVersion,
  });
  if (accept.error) throw accept.error;

  savePendingMagicLinkProfile(null);
  return accept.data as BoksUserContext;
}

export async function signOutBoksUser() {
  if (!supabase) return;

  // "Sign out of this device" means this device. The default scope is
  // global, which also ended the reader's sessions on every other device.
  const result = await supabase.auth.signOut({ scope: "local" });
  if (result.error) throw result.error;
}
