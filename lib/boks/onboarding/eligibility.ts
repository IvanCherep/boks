/**
 * Who meets the reader introduction (docs/onboarding.md). It never opens by
 * itself: a guest who has not met it yet sees an invitation on the cover and
 * opens it when they want to. `?welcome=1` opens it on purpose, for anyone.
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

/** Opens by itself only when asked to in the address: `?welcome=1`. */
export function shouldOpenOnboarding(search: string) {
  return new URLSearchParams(search).get("welcome") === "1";
}

/** The cover invites a guest who has neither finished nor skipped it in this browser. */
export function shouldInviteToOnboarding(input: { signedIn: boolean; record: OnboardingRecord | null }) {
  return !input.signedIn && !input.record;
}
