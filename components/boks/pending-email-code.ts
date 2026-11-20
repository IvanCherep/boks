"use client";

/**
 * The step "enter the code we sent", kept across a reload.
 *
 * On a phone the reader leaves for the mail app to fetch the code, and the
 * browser - an in-app one in VK or Telegram most of all - often reloads the
 * tab on the way back. The panel's state went with it: the reader came back to
 * an empty email field, asked for a second code or gave up. On 2026-11-20 three
 * of four new sign-ups stopped exactly there, one after asking twice.
 *
 * So the address and where it was asked from are written down when the code
 * is sent, and the panel opens on the code again until it is used, the reader
 * picks another address, or the code is too old to work.
 *
 * Closing the panel is a choice, not an accident: after it the page no longer
 * opens the panel by itself, but opening it again still shows the code.
 */

/** A little under the code's own hour (`auth.email.otp_expiry`), so it never offers a dead code. */
export const pendingEmailCodeMs = 55 * 60_000;

const storageKey = "boks-pending-email-code";

export type PendingEmailCode = {
  email: string;
  surface: "reader" | "author";
  reason: "manual" | "notice" | "required";
  intent: "general" | "like" | "comment" | "follow";
  sentAt: number;
  /** The reader closed the panel after the code was sent. */
  dismissed?: boolean;
};

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function savePendingEmailCode(pending: Omit<PendingEmailCode, "sentAt" | "dismissed">, now = Date.now()) {
  try {
    storage()?.setItem(storageKey, JSON.stringify({ ...pending, sentAt: now }));
  } catch {
    // Private browsing or a full quota: the code still works, it just will not survive a reload.
  }
}

/** The code still worth asking for, on this surface. */
export function readPendingEmailCode(surface: PendingEmailCode["surface"], now = Date.now()): PendingEmailCode | null {
  try {
    const raw = storage()?.getItem(storageKey);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Partial<PendingEmailCode>;
    const fresh = typeof pending.sentAt === "number" && now - pending.sentAt >= 0 && now - pending.sentAt < pendingEmailCodeMs;
    if (!fresh || typeof pending.email !== "string" || !pending.email.includes("@")) {
      clearPendingEmailCode();
      return null;
    }
    if (pending.surface !== surface) return null;
    return {
      email: pending.email,
      surface,
      reason: pending.reason === "notice" || pending.reason === "required" ? pending.reason : "manual",
      intent: pending.intent === "like" || pending.intent === "comment" || pending.intent === "follow" ? pending.intent : "general",
      sentAt: pending.sentAt!,
      dismissed: pending.dismissed === true,
    };
  } catch {
    return null;
  }
}

export function dismissPendingEmailCode() {
  try {
    const raw = storage()?.getItem(storageKey);
    if (!raw) return;
    storage()?.setItem(storageKey, JSON.stringify({ ...JSON.parse(raw), dismissed: true }));
  } catch {
    // See savePendingEmailCode.
  }
}

export function clearPendingEmailCode() {
  try {
    storage()?.removeItem(storageKey);
  } catch {
    // See savePendingEmailCode.
  }
}
