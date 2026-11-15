/**
 * My days and the guest's way to an account: the calendar and schedule
 * rules, kept pure so both are tested without a browser.
 */

/** A guest reads this many boks; the next one asks for an account. */
export const guestBokLimit = 10;
/** Between the welcome and the limit, a reminder every this many boks. */
export const guestReminderEvery = 2;

export type GuestReminder = "letter" | "game" | "progress" | "last";

/**
 * Which reminder a guest who has just read `count` boks is due, if any:
 * one every two boks (2, 4, 6, 8), each with its own reason, never twice.
 */
export function guestReminderFor(count: number, shown: ReadonlySet<number>): { count: number; kind: GuestReminder } | null {
  if (count <= 0 || count >= guestBokLimit || count % guestReminderEvery !== 0 || shown.has(count)) return null;
  const left = guestBokLimit - count;
  if (left <= guestReminderEvery) return { count, kind: "last" };
  const order: GuestReminder[] = ["letter", "game", "progress"];
  return { count, kind: order[(count / guestReminderEvery - 1) % order.length] };
}

/** "3-й" / "3rd". */
export function ordinal(value: number, language: "ru" | "en") {
  if (language === "ru") return `${value}-й`;
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[value % 10] ?? "th"}`;
}

function utc(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Monday-first weeks covering the month of `month` (`YYYY-MM-01`); cells outside it are null. */
export function monthGrid(month: string) {
  const first = utc(month.slice(0, 7) + "-01");
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/** The first day of the month before or after. */
export function shiftMonth(month: string, by: number) {
  const first = utc(month.slice(0, 7) + "-01");
  return iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + by, 1)));
}

/** Short weekday names, Monday first, in the interface language. */
export function weekdayNames(language: "ru" | "en") {
  const monday = Date.UTC(2024, 0, 1);
  return Array.from({ length: 7 }, (_, index) => new Date(monday + index * 86_400_000)
    .toLocaleDateString(language === "ru" ? "ru-RU" : "en-GB", { weekday: "short", timeZone: "UTC" })
    .replace(".", ""));
}

/** "Saturday, 15 November" / "суббота, 15 ноября". */
export function longDate(date: string, language: "ru" | "en") {
  return utc(date).toLocaleDateString(language === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** "15.11": the date a postmark carries. */
export function stampDate(date: string) {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}`;
}

/** "November 2026" / "ноябрь 2026". */
export function monthTitle(month: string, language: "ru" | "en") {
  return utc(month).toLocaleDateString(language === "ru" ? "ru-RU" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
