import type { GuestDayBok, GuestDayDevice, GuestFunnel } from "@/components/boks/client-types";
import { countryFlag } from "@/components/boks/admin/country-label";
import { currentUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * Words for one day opened up in the Guests tab: what each device did, said
 * the way a person would say it. Kept out of the component because the
 * wording carries rules - "left" is not "finished", a page closed is not a
 * swipe, and a device with no country is the dev server, not a stranger.
 */

const words = defineMessages(
  {
    seconds: (n: number) => `${n} s`,
    minutes: (n: number) => `${n} min`,
    leftBy: { swipe: "swiped on", button: "next button", keyboard: "arrow key", exit: "closed the page" } as Record<string, string>,
    touch: { tap: "tapped", scroll: "scrolled", swipe: "swiped", key: "used keys" } as Record<string, string>,
    noTouch: "no touch",
    finished: "finished",
    liked: "liked",
    shared: "shared",
    outcomes: {
      nothing: "No bok shown",
      looked: "Looked, never touched",
      touched: "Touched, did not finish",
      finished: "Finished a bok",
    } as Record<DeviceOutcome, string>,
    landing: { home: "home page", shared_bok: "shared bok", series: "series shelf" } as Record<string, string>,
    via: (referrer: string) => `via ${referrer}`,
    direct: "direct",
    link: (name: string) => `link “${name}”`,
    noCountry: "No country (dev server?)",
    noCountryCount: (devices: number) => `no country ${devices}`,
  },
  {
    ru: {
      seconds: (n: number) => `${n} с`,
      minutes: (n: number) => `${n} мин`,
      leftBy: { swipe: "свайпнул дальше", button: "кнопка «дальше»", keyboard: "клавиша-стрелка", exit: "закрыл страницу" },
      touch: { tap: "тапнул", scroll: "прокрутил", swipe: "свайпнул", key: "клавиши" },
      noTouch: "без касаний",
      finished: "дочитал",
      liked: "лайк",
      shared: "поделился",
      outcomes: {
        nothing: "Боков не показано",
        looked: "Смотрел, не касался",
        touched: "Касался, не дочитал",
        finished: "Дочитал бок",
      },
      landing: { home: "главная", shared_bok: "бок по ссылке", series: "полка серий" },
      via: (referrer: string) => `через ${referrer}`,
      direct: "напрямую",
      link: (name: string) => `ссылка «${name}»`,
      noCountry: "Без страны (dev-сервер?)",
      noCountryCount: (devices: number) => `без страны ${devices}`,
    },
  }
);

export function duration(seconds: number | null | undefined, language: UiLanguage = currentUiLanguage()) {
  const t = words[language];
  const total = Math.max(0, Math.round(seconds ?? 0));
  if (total < 60) return t.seconds(total);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${t.minutes(minutes)} ${t.seconds(rest)}` : t.minutes(minutes);
}

/** "14 s · tapped · swiped on", or "3 s · no touch". */
export function bokSummary(bok: GuestDayBok, language: UiLanguage = currentUiLanguage()) {
  const t = words[language];
  const parts = [duration(bok.seconds, language)];
  parts.push(bok.touch ? t.touch[bok.touch] ?? bok.touch : bok.leftBy && bok.leftBy !== "exit" ? "" : t.noTouch);
  if (bok.finished) parts.push(t.finished);
  else if (bok.leftBy) parts.push(t.leftBy[bok.leftBy] ?? bok.leftBy);
  if (bok.liked) parts.push(t.liked);
  if (bok.shared) parts.push(t.shared);
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

export function outcomeLabel(outcome: DeviceOutcome, language: UiLanguage = currentUiLanguage()) {
  return words[language].outcomes[outcome];
}

/** "shared bok “Invictus” · via t.me · link “Telegram post”". */
export function visitSummary(visit: GuestDayDevice["visits"][number], language: UiLanguage = currentUiLanguage()) {
  const t = words[language];
  const landing = t.landing[visit.landing] ?? visit.landing;
  const parts = [
    visit.bok ? `${landing} ${language === "ru" ? `«${visit.bok}»` : `“${visit.bok}”`}` : landing,
    visit.referrer ? t.via(visit.referrer) : t.direct,
  ];
  if (visit.link) parts.push(t.link(visit.link));
  if (visit.campaign) parts.push(`utm ${visit.campaign}`);
  return parts.join(" · ");
}

/** A country for a row; "none" is a device the Worker never saw. */
export function countryShort(code: string | null, language: UiLanguage = currentUiLanguage()) {
  if (!code || code === "none") return words[language].noCountry;
  return `${countryFlag(code)} ${code}`.trim();
}

/** "🇷🇸 3 · 🇩🇪 1 · no country 12". */
export function dayCountries(
  countries: NonNullable<GuestFunnel["daily"][number]["countries"]>,
  language: UiLanguage = currentUiLanguage()
) {
  return countries
    .map((row) => (row.country === "none" ? words[language].noCountryCount(row.devices) : `${countryShort(row.country, language)} ${row.devices}`))
    .join(" · ");
}
