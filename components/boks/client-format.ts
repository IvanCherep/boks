export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function estimateMinutes(text: string) {
  return Math.max(1, Math.min(15, Math.ceil(wordCount(text) / 220)));
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

export function storySignal(story: Record<string, number | string>) {
  if ("signal" in story) return numberValue(story.signal);

  return (
    numberValue(story.completes) * 4 +
    numberValue(story.likes) * 5 +
    numberValue(story.shares) * 4 +
    numberValue(story.commentsCount ?? story.comments) * 6 -
    Math.max(0, numberValue(story.starts) - numberValue(story.completes))
  );
}
