import { initialProfile } from "@/components/boks/constants";
import type { ReadOutcome, ReaderProfile, Story } from "@/components/boks/client-types";

const anonymousReadStateKey = "boks-anonymous-read-state";
const anonymousNoticeStateKey = "boks-anonymous-notice-state";

export const anonymousReadLimits = {
  firstNotice: 5,
  secondNotice: 10,
  requiredSignup: 15,
};

/**
 * How long a boks has to stay on screen before it counts toward a guest's
 * limit. Every boks opened used to count on arrival, so a guest flicking
 * through fifteen titles in half a minute met "You have read 15 boks" having
 * read none of them.
 */
export const guestReadDwellMs = 8000;

export type AnonymousReadState = {
  storyIds: string[];
};

/**
 * Average adult reading speed for prose, in words per minute.
 *
 * Deliberately a fixed constant rather than each reader's own measured speed.
 * If "completed" depended on a per-reader speed that shifts as samples
 * accumulate, finish rate would stop being comparable between readers and would
 * drift for the same reader over time - moving the instrument while measuring
 * with it. Per-reader speed is reported separately, as a property of the
 * reader, and never feeds back into this label.
 */
export const readingWordsPerMinute = 238;

/** Seconds a typical reader would need for this boks. */
export function expectedReadingSeconds(story: Pick<Story, "wordCount" | "minutes">) {
  const words = story.wordCount > 0 ? story.wordCount : Math.max(1, story.minutes) * 220;
  return Math.max(20, Math.round((words / readingWordsPerMinute) * 60));
}

/**
 * Was this boks read, or passed over?
 *
 * `activeSeconds` is foreground-only time, so this judges attention rather than
 * how long a tab happened to be open.
 */
export function inferReadOutcome(story: Story, activeSeconds: number, progress: number): ReadOutcome {
  const expectedSeconds = expectedReadingSeconds(story);

  // Too little time for the length of the piece, whatever the scroll says.
  if (activeSeconds < Math.max(5, expectedSeconds * 0.25)) return "skip";

  // Reached the end and spent a plausible amount of time getting there.
  if (progress >= 0.85 && activeSeconds >= expectedSeconds * 0.4) return "complete";

  // Stayed long enough that they read most of it, even without scrolling to the
  // very end - short boks often fit on one screen and never scroll at all.
  return activeSeconds >= expectedSeconds * 0.7 ? "complete" : "skip";
}

/**
 * Forgets what this browser learned about the reader.
 *
 * Signing out has to take the reading profile with it. It shapes the feed and
 * lists what has already been read, so leaving it behind on a borrowed phone
 * hands the next person your taste and your history - and quietly ranks their
 * feed with it. The visitor id is reissued for the same reason: a new person is
 * not the previous one.
 */
export function clearLocalReaderState() {
  if (typeof window === "undefined") return;
  try {
    for (const key of [
      "boks-profile",
      anonymousReadStateKey,
      anonymousNoticeStateKey,
      "boks-pending-magic-link-profile",
      "boks-reader",
    ]) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage can refuse in a private window. Nothing here is load-bearing.
  }
}

export function getBrowserId(key: string) {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = `${key}-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, id);
  return id;
}

export function readProfile() {
  if (typeof window === "undefined") return initialProfile;
  try {
    return { ...initialProfile, ...JSON.parse(window.localStorage.getItem("boks-profile") ?? "{}") };
  } catch {
    return initialProfile;
  }
}

export function saveProfile(profile: ReaderProfile) {
  window.localStorage.setItem("boks-profile", JSON.stringify(profile));
}

export function readAnonymousReadState(): AnonymousReadState {
  if (typeof window === "undefined") return { storyIds: [] };
  try {
    return { storyIds: [], ...JSON.parse(window.localStorage.getItem(anonymousReadStateKey) ?? "{}") };
  } catch {
    return { storyIds: [] };
  }
}

export function recordAnonymousBoksRead(storyId: string) {
  if (typeof window === "undefined") return 0;
  const current = readAnonymousReadState();
  const storyIds = current.storyIds.includes(storyId) ? current.storyIds : [...current.storyIds, storyId];
  window.localStorage.setItem(anonymousReadStateKey, JSON.stringify({ storyIds: storyIds.slice(-300) }));
  return storyIds.length;
}

export function getAnonymousBoksReadCount() {
  return readAnonymousReadState().storyIds.length;
}

export function readAnonymousNoticeState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(anonymousNoticeStateKey) ?? "{}");
  } catch {
    return {};
  }
}

export function saveAnonymousNoticeState(state: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(anonymousNoticeStateKey, JSON.stringify(state));
}

export function profileBump(profile: ReaderProfile, story: Story, event: "complete" | "like" | "skip") {
  const weight = event === "skip" ? -2 : event === "like" ? 4 : 3;
  const next = {
    completed: profile.completed,
    liked: profile.liked,
    skipped: profile.skipped,
    genreScore: { ...profile.genreScore },
    moodScore: { ...profile.moodScore },
  };

  next.genreScore[story.genre] = (next.genreScore[story.genre] ?? 0) + weight;
  next.moodScore[story.mood] = (next.moodScore[story.mood] ?? 0) + weight;
  if (event === "complete" && !next.completed.includes(story.id)) {
    next.completed = [...next.completed, story.id].slice(-120);
  }
  if (event === "like" && !next.liked.includes(story.id)) {
    next.liked = [...next.liked, story.id].slice(-120);
  }
  if (event === "skip" && !next.skipped.includes(story.id)) {
    next.skipped = [...next.skipped, story.id].slice(-160);
  }
  return next;
}

/**
 * How many boks one slate carries.
 *
 * It was 80, which is also what the response weighed: the whole slate ships
 * with full texts, so a feed was ~600 KB, and building it was most of the
 * Worker's CPU and of the database's work per reader. Almost none of it was
 * read - a session is a handful of boks.
 *
 * 30 is the compromise: deep enough that a long sitting never reaches the end
 * before the next slate is fetched (asked for 5 boks from the end,
 * `shouldLoadMore`), and about a third of the payload, CPU and egress per
 * reader. Raising it costs all three again; lowering it risks a reader
 * outrunning the prefetch on a slow network.
 */
export const readerSlateSize = 30;
