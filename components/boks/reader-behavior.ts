import { initialProfile } from "@/components/boks/constants";
import type { ReadOutcome, ReaderProfile, Story } from "@/components/boks/client-types";

export function inferReadOutcome(story: Story, elapsedSeconds: number, progress: number): ReadOutcome {
  const estimatedSeconds = story.minutes * 60;
  if (elapsedSeconds < 6) return "skip";

  const reachedEnd = progress >= 0.82 && elapsedSeconds >= 8;
  const gaveEnoughTime = elapsedSeconds >= Math.min(75, Math.max(14, estimatedSeconds * 0.2));
  const showedEngagement = progress >= 0.45 && elapsedSeconds >= 10;

  return reachedEnd || gaveEnoughTime || showedEngagement ? "complete" : "skip";
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
