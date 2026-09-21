"use client";

/**
 * When to ask a reader what they think.
 *
 * Three moments, and they are chosen rather than sprinkled: after the third
 * bok, because by then they know what the thing is and have not yet decided
 * whether to stay; after the tenth, because that is a reader who came back;
 * after the thirtieth, because that is a reader with an opinion worth acting
 * on. Anything more often is nagging, and a reader who is nagged stops reading
 * the box at all.
 *
 * "Read" means a bok the reader actually read - the same `complete` outcome the
 * ranking is built on, not a bok that crossed the screen. The count lives on
 * the device, because a guest has nowhere else to keep it and because losing it
 * costs nothing: the worst case is being asked once more than intended.
 */

export const feedbackMilestones = [3, 10, 30] as const;

export type FeedbackSurface = "settings" | "after_3" | "after_10" | "after_30";

export type FeedbackState = {
  /** Boks actually read on this device. */
  reads: number;
  /** Milestones already offered, so none is offered twice. */
  prompted: number[];
};

export const emptyFeedbackState: FeedbackState = { reads: 0, prompted: [] };

const storageKey = "boks-feedback-state";

export function surfaceForMilestone(milestone: number): FeedbackSurface {
  return milestone === 3 ? "after_3" : milestone === 10 ? "after_10" : "after_30";
}

/** One more bok read. */
export function countRead(state: FeedbackState): FeedbackState {
  return { ...state, reads: Math.max(0, state.reads) + 1 };
}

/**
 * The milestone to offer now, or null.
 *
 * The highest one reached rather than the earliest unoffered: a reader who
 * arrives with the count already past three - a second device, a cleared
 * browser, a long first sitting - should be asked once, about where they are,
 * not walked through three prompts in a row.
 */
export function dueMilestone(state: FeedbackState): number | null {
  const reached = feedbackMilestones.filter(
    (milestone) => state.reads >= milestone && !state.prompted.includes(milestone)
  );
  return reached.length ? reached[reached.length - 1] : null;
}

/** Records that a milestone was offered, whether or not anything was sent. */
export function markPrompted(state: FeedbackState, milestone: number): FeedbackState {
  const prompted = state.prompted.includes(milestone) ? state.prompted : [...state.prompted, milestone];
  // Everything below it too: a reader asked at ten is not then asked at three.
  const covered = feedbackMilestones.filter((entry) => entry <= milestone);
  return { ...state, prompted: [...new Set([...prompted, ...covered])] };
}

export function readFeedbackState(): FeedbackState {
  if (typeof window === "undefined") return emptyFeedbackState;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return emptyFeedbackState;
    const parsed = JSON.parse(raw) as Partial<FeedbackState>;
    return {
      reads: Number.isFinite(parsed.reads) ? Math.max(0, Number(parsed.reads)) : 0,
      prompted: Array.isArray(parsed.prompted)
        ? parsed.prompted.map(Number).filter((value) => feedbackMilestones.includes(value as 3 | 10 | 30))
        : [],
    };
  } catch {
    // Private windows and cleared storage both land here, and neither is worth
    // a broken reader.
    return emptyFeedbackState;
  }
}

export function saveFeedbackState(state: FeedbackState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Nothing to do: the prompt is a courtesy, not a feature to fail loudly.
  }
}
