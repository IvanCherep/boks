"use client";

import { useEffect, useState } from "react";

/**
 * How long until this address may ask for another sign-in link.
 *
 * The server enforces one email per address per minute
 * (`auth.email.max_frequency` in `supabase/config.toml`). Before this existed
 * the button stayed pressable through the whole minute and answered a press
 * with a frozen sentence - "Please wait 47 seconds" - that never counted down.
 * A reader with no link in their inbox pressed it repeatedly and learned
 * nothing each time.
 *
 * Two things make the wait honest rather than merely stated:
 *
 *  - it is per address, because the server's limit is per address: changing to
 *    a different email should not inherit someone else's wait;
 *  - it survives a reload, because the server's does. Keeping it in component
 *    state meant a refresh re-enabled the button and the next press was refused
 *    by the server instead, with a different message.
 */

/** Must match `auth.email.max_frequency` in `supabase/config.toml`. */
export const magicLinkCooldownMs = 60_000;

const storageKey = "boks-magic-link-sent-at";

type SentLog = Record<string, number>;

function readLog(): SentLog {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as SentLog) : {};
  } catch {
    // Private browsing, cleared storage, a quota error. The wait is a courtesy;
    // the server still enforces the real limit.
    return {};
  }
}

function writeLog(log: SentLog) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(log));
  } catch {
    // See above.
  }
}

function normalize(email: string) {
  return email.trim().toLowerCase();
}

export function recordMagicLinkSent(email: string, now = Date.now()) {
  const key = normalize(email);
  if (!key) return;

  const log = readLog();
  // Drop addresses whose wait has long passed, so this cannot grow forever.
  const fresh: SentLog = { [key]: now };
  for (const [address, at] of Object.entries(log)) {
    if (address !== key && now - at < magicLinkCooldownMs) fresh[address] = at;
  }
  writeLog(fresh);
}

export function magicLinkCooldownRemainingMs(email: string, now = Date.now()) {
  const sentAt = readLog()[normalize(email)];
  if (!sentAt) return 0;
  return Math.max(0, magicLinkCooldownMs - (now - sentAt));
}

/**
 * Seconds left before this address may be asked again, ticking down to zero.
 *
 * Returns 0 when there is nothing to wait for, and runs no timer in that case.
 */
export function useMagicLinkCooldown(email: string) {
  // One ticking clock rather than a value plus an effect that resets it: the
  // remaining time is derived from the log on every tick, so there is nothing
  // to keep in sync and a reload picks up wherever the wait had got to.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  return Math.ceil(magicLinkCooldownRemainingMs(email, now) / 1000);
}

/** `0:47`, so the wait reads as a clock rather than a number to interpret. */
export function formatCooldown(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  return `0:${String(safe).padStart(2, "0")}`;
}
