/**
 * Who meets the reader introduction (docs/onboarding.md): a new guest who
 * opened boks itself, once. Never a returning guest, an account, or anyone who
 * came by a shared bok or author link - those keep the destination they were
 * promised. `?welcome=1` replays it on purpose.
 */

export const onboardingStorageKey = "boks-onboarding";

export type OnboardingRecord = {
  status: "completed" | "skipped";
  /** Answers not yet carried into an account the guest signs in to. */
  adoptPending?: boolean;
  answers?: unknown;
  at: number;
};

export function readOnboardingRecord(storage: Pick<Storage, "getItem"> | null): OnboardingRecord | null {
  try {
    const raw = storage?.getItem(onboardingStorageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as OnboardingRecord;
    return value && (value.status === "completed" || value.status === "skipped") ? value : null;
  } catch {
    return null;
  }
}

export function writeOnboardingRecord(storage: Pick<Storage, "setItem"> | null, record: OnboardingRecord) {
  try {
    storage?.setItem(onboardingStorageKey, JSON.stringify(record));
  } catch {
    // Private mode: the introduction may come back on the next visit.
  }
}

export function shouldOfferOnboarding(input: {
  pathname: string;
  search: string;
  signedIn: boolean;
  record: OnboardingRecord | null;
  /** Boks this browser has already read as a guest. */
  guestReads: number;
  /** The old guest welcome was already shown here: not a new visitor. */
  welcomeSeen: boolean;
}) {
  const params = new URLSearchParams(input.search);
  if (params.get("welcome") === "1") return true;
  if (input.pathname !== "/") return false;
  if (params.has("bok") || params.has("author") || params.has("b")) return false;
  if (input.signedIn || input.record) return false;
  return input.guestReads === 0 && !input.welcomeSeen;
}
