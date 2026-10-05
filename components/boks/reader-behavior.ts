import { randomBoksId } from "@/lib/boks/browser-id";
import { initialProfile } from "@/components/boks/constants";
import type { ReadOutcome, ReaderProfile, Story } from "@/components/boks/client-types";
import type { ReaderSignals } from "@/lib/boks/recommendations/signals";

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

/**
 * Seconds a typical reader would need for this boks.
 *
 * The floor was 20 seconds, which is longer than most of this catalogue takes
 * to read: a quatrain is 30 words, about eight seconds, and the floor made it
 * impossible to finish one. It is 12 now - still enough that a flick cannot
 * clear the thresholds below, no longer a claim that every poem takes twenty
 * seconds.
 */
export function expectedReadingSeconds(story: Pick<Story, "wordCount" | "minutes">) {
  const words = story.wordCount > 0 ? story.wordCount : Math.max(1, story.minutes) * 220;
  return Math.max(12, Math.round((words / readingWordsPerMinute) * 60));
}

/**
 * Was this boks read, or passed over?
 *
 * `activeSeconds` is foreground-only time, so this judges attention rather than
 * how long a tab happened to be open.
 *
 * **`scrollable` is the fact that was missing, and its absence broke poetry.**
 * A piece that fits the screen has no end to scroll to, so the reader's
 * progress stays 0 however carefully they read - which left only the strictest
 * branch, 70% of the expected time, and with the old 20-second floor that was
 * 14 seconds for a quatrain. Measured on production before this change: 37
 * skips to 4 completes in a day, and those skips averaged **9 seconds of
 * foreground attention at 38% progress** - people reading, recorded as people
 * leaving. Two thirds of this catalogue is verse.
 *
 * `progress` deliberately keeps its old meaning ("how far down did they get"),
 * because the ranker pays for prior progress and treats a part-read piece as
 * something to resume. Telling it that every short poem was read to the end
 * would push flicked poems to the top of the feed instead.
 */
export function inferReadOutcome(
  story: Story,
  activeSeconds: number,
  progress: number,
  options: { scrollable?: boolean } = {}
): ReadOutcome {
  const expectedSeconds = expectedReadingSeconds(story);
  const scrollable = options.scrollable ?? true;

  // Too little time for the length of the piece, whatever the scroll says.
  if (activeSeconds < Math.max(5, expectedSeconds * 0.25)) return "skip";

  // Nothing to scroll: the whole text was on screen, so attention is the only
  // evidence there is - and it is enough.
  if (!scrollable) return activeSeconds >= expectedSeconds * 0.4 ? "complete" : "skip";

  // Reached the end and spent a plausible amount of time getting there.
  if (progress >= 0.85 && activeSeconds >= expectedSeconds * 0.4) return "complete";

  // Stayed long enough that they read most of it without reaching the very end.
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

/**
 * Ids issued while storage refused to keep them, so the same page asks once
 * and gets the same answer for the rest of its life.
 */
const memoryBrowserIds = new Map<string, string>();

/**
 * A stable label for this browser. Storage can refuse - blocked site data,
 * some private windows and in-app browsers throw on any access - and a throw
 * here used to take the whole reader down while it booted. The id is then
 * only stable for this page, which is the most that browser allows.
 */
export function getBrowserId(key: string) {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
  } catch {
    // Fall through to an id for this page.
  }
  const remembered = memoryBrowserIds.get(key);
  if (remembered) return remembered;
  const id = `${key}-${randomBoksId()}`;
  memoryBrowserIds.set(key, id);
  writeStorage(key, id);
  return id;
}

/** A write that may be refused. Nothing that calls it is worth a crash. */
function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked or full storage. The in-memory state still holds for this page.
  }
}

/**
 * What the ranker is told about the reader, from the locally kept profile.
 * One definition, because the first feed request reads it before React has
 * rendered the profile into state.
 */
export function readerSignalsFromProfile(profile: ReaderProfile): ReaderSignals {
  return {
    genreAffinity: profile.genreScore,
    moodAffinity: profile.moodScore,
    completedStoryIds: profile.completed,
    likedStoryIds: profile.liked,
    skippedStoryIds: profile.skipped,
  };
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
  if (typeof window === "undefined") return;
  writeStorage("boks-profile", JSON.stringify(profile));
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
  writeStorage(anonymousReadStateKey, JSON.stringify({ storyIds: storyIds.slice(-300) }));
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
  writeStorage(anonymousNoticeStateKey, JSON.stringify(state));
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
