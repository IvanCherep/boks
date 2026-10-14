import type { UiLanguage } from "@/lib/i18n/ui-language";

export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function estimateMinutes(text: string) {
  const words = wordCount(text);
  // An empty story is zero minutes, not one. The old floor of 1 made a blank
  // compose form claim a reading time before anything had been written.
  if (!words) return 0;
  // 238 words a minute, the figure the database uses. They have to agree: the
  // author is shown one number and the 15-minute rule is checked against
  // another otherwise.
  return Math.max(1, Math.min(15, Math.ceil(words / 238)));
}

export function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0);
}

export function secondsLabel(value: unknown) {
  const seconds = numberValue(value);
  if (!seconds) return "0s";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/**
 * How long ago, in the shortest honest form.
 *
 * Comments on a boks are a conversation, and a conversation needs a sense of
 * when. Absolute timestamps are noise at this density; "3h" is what a reader
 * actually wants to know.
 */
const timeUnits: Record<UiLanguage, Record<"now" | "m" | "h" | "d" | "w" | "mo" | "y", string>> = {
  en: { now: "now", m: "m", h: "h", d: "d", w: "w", mo: "mo", y: "y" },
  ru: { now: "сейчас", m: " мин", h: " ч", d: " д", w: " нед", mo: " мес", y: " г" },
};

export function shortTimeAgo(value: string, now = Date.now(), language: UiLanguage = "en") {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "";
  const unit = timeUnits[language];

  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return unit.now;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}${unit.m}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}${unit.h}`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}${unit.d}`;

  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}${unit.w}`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}${unit.mo}`;

  return `${Math.round(days / 365)}${unit.y}`;
}

/**
 * A thousands separator that does not depend on the reader's locale.
 *
 * `Number.prototype.toLocaleString` formats with whatever locale the runtime
 * has, and the server's is not the browser's. Rendering it inside server-side
 * markup produces a hydration mismatch, which React answers by throwing away
 * the server tree and re-rendering the whole page on the client.
 */
export function groupDigits(value: number) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * The like count on the rail, reconciled with this reader's own like.
 *
 * `total` comes from the server and includes the reader's like if they had
 * liked the boks when the feed loaded (`likedOnServer`). Tapping the heart
 * changes `likedNow` at once, so the number moves with the heart instead of a
 * second later - and it does not jump when the reload lands, because the
 * reload moves `total` and `likedOnServer` together.
 */
export function displayedLikeCount(total: number, likedOnServer: boolean, likedNow: boolean) {
  return Math.max(0, total - (likedOnServer ? 1 : 0) + (likedNow ? 1 : 0));
}

/**
 * A count short enough for the rail: `999`, `1.2k`, `12k`, `1.5m`.
 *
 * Zero is printed, not hidden - the rail shows its counts always, so a boks
 * nobody has liked yet says so rather than looking as though it has no count.
 */
export function formatCompactCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(Math.round(value));
  const [divisor, suffix] = value < 1_000_000 ? [1000, "k"] : [1_000_000, "m"];
  const scaled = value / divisor;
  // One decimal below ten ("1.2k"), none above ("12k"), and never "1.0k".
  const rounded = scaled < 10 ? Math.floor(scaled * 10) / 10 : Math.floor(scaled);
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}${suffix}`;
}
