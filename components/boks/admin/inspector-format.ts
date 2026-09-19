import type { AdminPersonDetail } from "@/components/boks/client-types";

/**
 * Reading minutes per day for the last 30 days, oldest first. The server sends
 * only days that had reading; a chart needs the empty days too, or a reader
 * who read on two days a fortnight apart looks like one who read two days
 * running.
 */
export function lastThirtyDays(activity: AdminPersonDetail["activity"], today = new Date()) {
  const byDay = new Map(activity.map((entry) => [entry.day, entry]));
  const days: { day: string; minutes: number; boks: number }[] = [];
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    const day = date.toISOString().slice(0, 10);
    const entry = byDay.get(day);
    days.push({ day, minutes: entry?.minutes ?? 0, boks: entry?.boks ?? 0 });
  }
  return days;
}
