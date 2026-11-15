/**
 * Guess the author in Studio: how a date reads in the calendar and which of
 * its three texts goes out if nothing changes. The database applies the same
 * rule at publication (`boks_game_publish`); this only says it in advance.
 */

type Candidate = { position: number; available: boolean };
type Day = { publishedAt: string | null; publishedPosition: number | null; chosenPosition: number | null; available: number; candidates: readonly Candidate[] };

export type GameDayStatus = "published" | "manual" | "auto" | "restock";

export function gameDayStatus(day: Day): GameDayStatus {
  if (day.publishedAt) return "published";
  if (!day.available) return "restock";
  const chosen = day.candidates.find((candidate) => candidate.position === day.chosenPosition);
  return chosen?.available ? "manual" : "auto";
}

/** The position that is (or will be) published: the valid choice, else the first available. */
export function gameDayLead(day: Day) {
  if (day.publishedAt) return day.publishedPosition;
  const chosen = day.candidates.find((candidate) => candidate.position === day.chosenPosition && candidate.available);
  if (chosen) return chosen.position;
  return [...day.candidates].filter((candidate) => candidate.available).sort((a, b) => a.position - b.position)[0]?.position ?? null;
}

/** "17 ноября" for a `YYYY-MM-DD` date, read as that calendar day wherever the browser is. */
export function calendarDate(date: string, language: "ru" | "en", withWeekday = false) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  return value.toLocaleDateString(language === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric", month: "long", timeZone: "UTC", ...(withWeekday ? { weekday: "short" } : {}),
  });
}
