import type { GuestDayBok, GuestDayDevice, GuestFunnel } from "@/components/boks/client-types";
import { countryFlag } from "@/components/boks/admin/country-label";

/**
 * Words for one day opened up in the Guests tab: what each device did, said
 * the way a person would say it. Kept out of the component because the
 * wording carries rules - "left" is not "finished", a page closed is not a
 * swipe, and a device with no country is the dev server, not a stranger.
 */

export function duration(seconds: number | null | undefined) {
  const total = Math.max(0, Math.round(seconds ?? 0));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

const leftByLabels: Record<string, string> = {
  swipe: "swiped on",
  button: "next button",
  keyboard: "arrow key",
  exit: "closed the page",
};

const touchLabels: Record<string, string> = {
  tap: "tapped",
  scroll: "scrolled",
  swipe: "swiped",
  key: "used keys",
};

/** "14 s · tapped · swiped on", or "3 s · no touch". */
export function bokSummary(bok: GuestDayBok) {
  const parts = [duration(bok.seconds)];
  parts.push(bok.touch ? touchLabels[bok.touch] ?? bok.touch : bok.leftBy && bok.leftBy !== "exit" ? "" : "no touch");
  if (bok.finished) parts.push("finished");
  else if (bok.leftBy) parts.push(leftByLabels[bok.leftBy] ?? bok.leftBy);
  if (bok.liked) parts.push("liked");
  if (bok.shared) parts.push("shared");
  return parts.filter(Boolean).join(" · ");
}

/** The furthest a device got that day - one word for a row, and for the day's tally. */
export type DeviceOutcome = "nothing" | "looked" | "touched" | "finished";

export function deviceOutcome(device: GuestDayDevice): DeviceOutcome {
  if (device.boks.some((bok) => bok.finished)) return "finished";
  if (device.boks.some((bok) => bok.touch || (bok.leftBy && bok.leftBy !== "exit"))) return "touched";
  if (device.boks.length > 0) return "looked";
  return "nothing";
}

export const outcomeLabels: Record<DeviceOutcome, string> = {
  nothing: "No bok shown",
  looked: "Looked, never touched",
  touched: "Touched, did not finish",
  finished: "Finished a bok",
};

const landingLabels: Record<string, string> = {
  home: "home page",
  shared_bok: "shared bok",
  series: "series shelf",
};

/** "shared bok “Invictus” · via t.me · link “Telegram post”". */
export function visitSummary(visit: GuestDayDevice["visits"][number]) {
  const parts = [
    visit.bok ? `${landingLabels[visit.landing] ?? visit.landing} “${visit.bok}”` : landingLabels[visit.landing] ?? visit.landing,
    visit.referrer ? `via ${visit.referrer}` : "direct",
  ];
  if (visit.link) parts.push(`link “${visit.link}”`);
  if (visit.campaign) parts.push(`utm ${visit.campaign}`);
  return parts.join(" · ");
}

/** A country for a row; "none" is a device the Worker never saw. */
export function countryShort(code: string | null) {
  if (!code || code === "none") return "No country (dev server?)";
  return `${countryFlag(code)} ${code}`.trim();
}

/** "🇷🇸 3 · 🇩🇪 1 · no country 12". */
export function dayCountries(countries: NonNullable<GuestFunnel["daily"][number]["countries"]>) {
  return countries
    .map((row) => (row.country === "none" ? `no country ${row.devices}` : `${countryShort(row.country)} ${row.devices}`))
    .join(" · ");
}
