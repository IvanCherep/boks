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
export function shortTimeAgo(value: string, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "";

  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;

  return `${Math.round(days / 365)}y`;
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
