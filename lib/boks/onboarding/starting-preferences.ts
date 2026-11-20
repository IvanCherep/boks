/**
 * A reader's starting preferences from the introduction (docs/onboarding.md),
 * applied to the served feed.
 *
 * They are explicit, versioned answers, not behaviour: a chosen classic or a
 * preferred form lifts matching boks a few places, never filters the feed,
 * and only while the reader's own history is thin. Once they have read, their
 * behaviour speaks for itself and the lift fades out. Every lifted entry says
 * so in its explanations, which are stored with the served feed.
 */
import type { RankedStory } from "@/lib/boks/recommendations/feed";

export type StartingPreferences = {
  version: number;
  status: "completed" | "skipped";
  form: "any" | "prose" | "poetry";
  classicNames: string[];
};

/** Places a matching classic moves up; a matching form moves less. */
export const classicLift = 6;
export const formLift = 3;
/** Reading events after which the reader's own history has taken over. */
export const startingPreferenceHorizon = 40;

export function parseStartingPreferences(value: unknown): StartingPreferences | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.status !== "completed" && row.status !== "skipped") return null;
  const form = row.form === "prose" || row.form === "poetry" ? row.form : "any";
  const names = Array.isArray(row.classicNames) ? row.classicNames.filter((name): name is string => typeof name === "string" && name.trim().length > 0).slice(0, 120) : [];
  return { version: Number(row.version) || 1, status: row.status, form, classicNames: names };
}

const normalize = (name: string) => name.toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** How strongly the answers still count: full at first, nothing past the horizon. */
export function startingWeight(readerEvents: number) {
  if (!Number.isFinite(readerEvents) || readerEvents <= 0) return 1;
  return Math.max(0, 1 - readerEvents / startingPreferenceHorizon);
}

/**
 * The feed with matching entries lifted. Stable for everything that does not
 * match; ranks are renumbered. `formOf` answers "prose" or "poetry" for an
 * entry, or null when it is not known.
 */
export function applyStartingPreferences<Entry extends RankedStory>(
  entries: readonly Entry[],
  prefs: StartingPreferences | null,
  options: { readerEvents: number; formOf: (entry: Entry) => "prose" | "poetry" | null }
): Entry[] {
  if (!prefs || prefs.status !== "completed") return [...entries];
  const weight = startingWeight(options.readerEvents);
  if (weight <= 0) return [...entries];
  const classics = new Set(prefs.classicNames.map(normalize));
  if (!classics.size && prefs.form === "any") return [...entries];

  const keyed = entries.map((entry, index) => {
    const reasons: string[] = [];
    let lift = 0;
    if (entry.candidate.authorName && classics.has(normalize(entry.candidate.authorName))) {
      lift += classicLift;
      reasons.push("starting:classic");
    }
    if (prefs.form !== "any" && options.formOf(entry) === prefs.form) {
      lift += formLift;
      reasons.push(`starting:form-${prefs.form}`);
    }
    return { entry, reasons, key: index - lift * weight, index };
  });
  keyed.sort((left, right) => left.key - right.key || left.index - right.index);
  return keyed.map(({ entry, reasons }, rank) => ({
    ...entry,
    rank,
    ...(reasons.length ? { explanations: [...(entry.explanations ?? []), ...reasons] } : {}),
  }));
}
