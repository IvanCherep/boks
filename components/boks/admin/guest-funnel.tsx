"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GuestFunnel } from "@/components/boks/client-types";
import { loadGuestFunnel, markTeamDevice, unmarkTeamDevice } from "@/components/boks/supabase-browser-data";
import { countryLabel } from "@/components/boks/admin/country-label";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { biggestDrop, funnelSteps, percent } from "@/components/boks/admin/guest-funnel-steps";
import { dayCountries, duration } from "@/components/boks/admin/guest-day-format";
import { GuestDayPanel } from "@/components/boks/admin/guest-day";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const windows = [7, 14, 30] as const;

/**
 * Remembered per admin browser: a filter you set yesterday should still be set.
 * The Links tab reads the same filter, so one country is hidden everywhere.
 */
const hiddenCountriesKey = "boks-guests-hidden-countries";

export function readHiddenCountries(): string[] {
  try {
    const raw = window.localStorage.getItem(hiddenCountriesKey);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === "string") : [];
  } catch {
    return [];
  }
}

function saveHiddenCountries(codes: string[]) {
  try {
    window.localStorage.setItem(hiddenCountriesKey, JSON.stringify(codes));
  } catch {
    // A filter that does not persist is still a filter.
  }
}

const ruDevices = (n: number) => plural("ru", n, { one: "устройство", few: "устройства", many: "устройств", other: "устройства" });

const words = defineMessages(
  {
    reasons: {
      limit: "Hit the 15-bok limit",
      like: "Tried to like",
      comment: "Tried to comment",
      follow: "Tried to follow",
      notice: "Guest notice",
      manual: "Tapped the account button",
      signin: "Chose sign in",
      unknown: "Unknown",
    } as Record<string, string>,
    landing: {
      home: "The home page",
      shared_bok: "A shared bok link",
      series: "The series shelf",
    } as Record<string, string>,
    loading: "Loading…",
    couldNotLoad: "Could not load the guest funnel.",
    markedTeam: "This browser is now counted as the team's.",
    unmarkedTeam: "This browser is counted as a visitor again.",
    couldNotUpdate: "Could not update this browser.",
    period: "Guest measurement period",
    lastDays: (n: number) => `Last ${n} days`,
    includeTeam: "Include team",
    refresh: "Refresh",
    funnelLabel: "Guest devices from arrival to account",
    lostMost: "Where guests are lost most:",
    drop: (from: string, to: string, share: string, count: number, before: number) =>
      ` between “${from}” and “${to}” - ${share} make it (${count} of ${before}).`,
    whereTheyAre: "Where they are",
    whereHint: "By device’s last location. Select a country to exclude it from all measurements.",
    unknown: "Unknown",
    hideCountry: "Hide this country from every measurement",
    devices: (n: number) => `${n} devices`,
    countryUnavailable: "Country unavailable · ",
    countryRow: (share: string, guests: number, readers: number, accounts: number) =>
      `${share} of devices · ${guests} guests · ${readers} read a bok · ${accounts} with an account`,
    hidden: "Hidden:",
    teamDetails: "Team devices & measurement filters",
    teamTitle: "Telling the team from visitors.",
    teamText: (devices: number, marked: number) =>
      ` A device ever used by an admin account is the team's and is left out automatically (${devices} so far, ${marked} marked by hand). A browser the team reads in without signing in as an admin cannot be recognised that way - mark it here from that browser, or hide its country above.`,
    markBrowser: "Mark this browser as the team's",
    unmark: "Unmark it",
    arrivingToAccount: "From arriving to an account",
    step: "Step",
    devicesColumn: "Devices",
    ofBefore: "Of the step before",
    ofAllGuests: "Of all guests",
    cameBack: (n: number, minutes: number) =>
      `${n} guest devices came back on another day. Median reading time of a guest who started: ${minutes} min.`,
    howMuch: "How much guests read",
    nothingFinished: "Nothing finished",
    boksRange: (range: string) => `${range} boks`,
    fifteenPlus: "15 or more",
    limit: (hit: number, requested: number, converted: number) =>
      `The 15-bok limit: ${hit} hit it, ${requested} asked for a link, ${converted} created an account.`,
    wall: "Which wall they met",
    reason: "Reason",
    shown: "Shown",
    askedLink: "Asked for a link",
    noPrompts: "No sign-up prompts recorded yet.",
    landedOn: "Landed on",
    cameFrom: "Came from",
    direct: "Direct / unknown",
    campaign: "Campaign (utm)",
    nothingYet: "Nothing recorded yet.",
    dayByDay: "Day by day",
    dayHint: "Guest devices each day: shown a bok, touched one (tap, scroll, swipe), moved on to another, finished one. Click a day to see every device, where it came from and what it did.",
    dayUtc: "Day (UTC)",
    guestDevices: "Guest devices",
    newTitle: "First seen that day - including devices that arrived and left before any bok loaded, so it can be more than the guest devices that read",
    new: "New",
    shownBok: "Shown a bok",
    touched: "Touched",
    movedOn: "Moved on",
    finishedBok: "Finished a bok",
    medianTime: "Median time",
    where: "Where",
    sawSignup: "Saw sign-up",
    newAccounts: "New accounts",
    today: "today",
    touchedNote: (since: string) =>
      `“Touched” counts taps and scrolls from ${since}; moving on to another bok counts on every day. “No country” is a device the Worker never saw - in practice the local dev server, which writes to the same tables.`,
    readWithCare: (since: string) =>
      `Read with care. A device is not a person: a cleared browser or a second phone counts again, and the team's own testing is in these numbers. Sign-up prompts, link requests and visit sources are recorded from ${since} onwards, so those steps undercount earlier days. “Finished” is only reliable from 21 September, when finishing a short poem started being recorded correctly.`,
    hands: {
      shown: "Shown a bok",
      touched: "Touched one: tap, scroll or swipe",
      tapped: "Tapped",
      scrolled: "Scrolled the text",
      swiped: "Swiped to another bok",
    },
    didTouch: "Did they touch it",
    ofShown: "Of those shown a bok",
    handsNote: (swipes: number, touched: number, shown: number, since: string | null) =>
      `${swipes} swipes to another bok in all; ${touched} of ${shown} boks shown were touched. Taps and scrolls count the first touch on each bok and are recorded ${since ? `from ${since}` : "from now on"}; swipes cover the whole window.`,
  },
  {
    ru: {
      reasons: {
        limit: "Упёрлись в лимит 15 боков",
        like: "Хотели поставить лайк",
        comment: "Хотели прокомментировать",
        follow: "Хотели подписаться",
        notice: "Уведомление для гостя",
        manual: "Нажали кнопку аккаунта",
        signin: "Выбрали вход",
        unknown: "Неизвестно",
      },
      landing: {
        home: "Главная страница",
        shared_bok: "Ссылка на бок",
        series: "Полка серий",
      },
      loading: "Загрузка…",
      couldNotLoad: "Не удалось загрузить воронку гостей.",
      markedTeam: "Этот браузер теперь считается браузером команды.",
      unmarkedTeam: "Этот браузер снова считается посетителем.",
      couldNotUpdate: "Не удалось обновить этот браузер.",
      period: "Период измерения гостей",
      lastDays: (n: number) => `Последние ${n} ${plural("ru", n, { one: "день", few: "дня", many: "дней", other: "дня" })}`,
      includeTeam: "С командой",
      refresh: "Обновить",
      funnelLabel: "Устройства гостей от прихода до аккаунта",
      lostMost: "Где теряется больше всего гостей:",
      drop: (from: string, to: string, share: string, count: number, before: number) =>
        ` между «${from}» и «${to}»: доходят ${share} (${count} из ${before}).`,
      whereTheyAre: "Где они",
      whereHint: "По последнему местоположению устройства. Выберите страну, чтобы исключить её из всех измерений.",
      unknown: "Неизвестно",
      hideCountry: "Скрыть эту страну из всех измерений",
      devices: (n: number) => `${n} ${ruDevices(n)}`,
      countryUnavailable: "Страна недоступна · ",
      countryRow: (share: string, guests: number, readers: number, accounts: number) =>
        `${share} устройств · гостей: ${guests} · прочли бок: ${readers} · с аккаунтом: ${accounts}`,
      hidden: "Скрыты:",
      teamDetails: "Устройства команды и фильтры измерений",
      teamTitle: "Как отличить команду от посетителей.",
      teamText: (devices: number, marked: number) =>
        ` Устройство, на котором хоть раз входили в аккаунт администратора, считается устройством команды и исключается автоматически (пока ${devices}, вручную отмечено ${marked}). Браузер, в котором команда читает без входа администратора, так не распознать: отметьте его здесь из этого браузера или скройте его страну выше.`,
      markBrowser: "Отметить этот браузер как браузер команды",
      unmark: "Снять отметку",
      arrivingToAccount: "От прихода до аккаунта",
      step: "Шаг",
      devicesColumn: "Устройства",
      ofBefore: "От предыдущего шага",
      ofAllGuests: "От всех гостей",
      cameBack: (n: number, minutes: number) =>
        `${n} ${plural("ru", n, { one: "устройство гостя вернулось", few: "устройства гостей вернулись", many: "устройств гостей вернулись", other: "устройства гостей вернулись" })} в другой день. Медианное время чтения гостя, который начал читать: ${minutes} мин.`,
      howMuch: "Сколько читают гости",
      nothingFinished: "Ничего не дочитали",
      boksRange: (range: string) => `${range} ${range.endsWith("2") ? "бока" : "боков"}`,
      fifteenPlus: "15 и больше",
      limit: (hit: number, requested: number, converted: number) =>
        `Лимит 15 боков: упёрлись ${hit}, запросили ссылку ${requested}, создали аккаунт ${converted}.`,
      wall: "В какую стену упёрлись",
      reason: "Причина",
      shown: "Показано",
      askedLink: "Запросили ссылку",
      noPrompts: "Предложений зарегистрироваться пока не записано.",
      landedOn: "Попали на",
      cameFrom: "Откуда пришли",
      direct: "Напрямую / неизвестно",
      campaign: "Кампания (utm)",
      nothingYet: "Пока ничего не записано.",
      dayByDay: "По дням",
      dayHint: "Устройства гостей за каждый день: увидели бок, коснулись его (тап, прокрутка, свайп), перешли к следующему, дочитали. Нажмите на день, чтобы увидеть каждое устройство, откуда оно пришло и что делало.",
      dayUtc: "День (UTC)",
      guestDevices: "Устройства гостей",
      newTitle: "Впервые замечены в этот день, включая устройства, которые пришли и ушли до загрузки бока, поэтому их может быть больше, чем читавших",
      new: "Новые",
      shownBok: "Увидели бок",
      touched: "Коснулись",
      movedOn: "Перешли дальше",
      finishedBok: "Дочитали бок",
      medianTime: "Медианное время",
      where: "Где",
      sawSignup: "Видели регистрацию",
      newAccounts: "Новые аккаунты",
      today: "сегодня",
      touchedNote: (since: string) =>
        `«Коснулись» считает тапы и прокрутки с ${since}; переход к другому боку считается за все дни. «Без страны» значит, что Worker устройство не видел: на практике это локальный dev-сервер, который пишет в те же таблицы.`,
      readWithCare: (since: string) =>
        `Читайте с осторожностью. Устройство не человек: очищенный браузер или второй телефон считаются заново, а тестирование самой команды тоже в этих числах. Предложения зарегистрироваться, запросы ссылок и источники визитов записываются с ${since}, поэтому за более ранние дни эти шаги занижены. «Дочитали» надёжно только с 21 сентября, когда дочитывание коротких стихов стало записываться правильно.`,
      hands: {
        shown: "Увидели бок",
        touched: "Коснулись: тап, прокрутка или свайп",
        tapped: "Тапнули",
        scrolled: "Прокрутили текст",
        swiped: "Свайпнули к другому боку",
      },
      didTouch: "Касались ли его",
      ofShown: "От увидевших бок",
      handsNote: (swipes: number, touched: number, shown: number, since: string | null) =>
        `Всего свайпов к другому боку: ${swipes}; из ${shown} показанных боков касались ${touched}. Тапы и прокрутки считают первое касание каждого бока и записываются ${since ? `с ${since}` : "с этого момента"}; свайпы покрывают всё окно.`,
    },
  }
);

/**
 * The people who do not sign up, and where they stop.
 *
 * Built for one question: "we bring people, why does nobody register?". So the
 * page is a funnel first - from arriving to reading to meeting the sign-up to
 * asking for a link to having an account - with the step that loses the most
 * named in a sentence, and then the pieces that explain it: how much guests
 * read, which wall they met, and where they came from.
 *
 * Counted by **device**, not by person or by anonymous user: a guest's
 * anonymous user is abandoned when they sign up, while the device id carries
 * across, which is the only way a conversion can be seen at all. A person on
 * two devices is two here, and a cleared browser is a new one.
 */
export function GuestFunnelPanel() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [days, setDays] = useState<(typeof windows)[number]>(14);
  const [includeTeam, setIncludeTeam] = useState(false);
  const [hiddenCountries, setHiddenCountries] = useState<string[]>([]);
  const [filtersRead, setFiltersRead] = useState(false);
  const [data, setData] = useState<GuestFunnel | null>(null);
  const [status, setStatus] = useState(() => words[currentUiLanguage()].loading);
  const [busy, setBusy] = useState(false);
  const [teamNote, setTeamNote] = useState("");
  const [openDay, setOpenDay] = useState<string | null>(null);

  const refresh = useCallback(async (window: number, team: boolean, hidden: string[]) => {
    setBusy(true);
    try {
      setData(await loadGuestFunnel(window, { includeTeam: team, hideCountries: hidden }));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotLoad);
    } finally {
      setBusy(false);
    }
  }, []);

  // The stored filter is read once, before the first load, so the first
  // numbers on screen are already the filtered ones.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setHiddenCountries(readHiddenCountries());
      setFiltersRead(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  // Off the render path, like the other admin tables.
  useEffect(() => {
    if (!filtersRead) return;
    const handle = window.setTimeout(() => refresh(days, includeTeam, hiddenCountries).catch(() => undefined), 0);
    return () => window.clearTimeout(handle);
  }, [days, includeTeam, hiddenCountries, filtersRead, refresh]);

  function toggleCountry(code: string) {
    if (code === "unknown") return;
    setHiddenCountries((current) => {
      const next = current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code];
      saveHiddenCountries(next);
      return next;
    });
  }

  async function markThisBrowser(mark: boolean) {
    const visitorId = getBrowserId("boks-reader");
    try {
      if (mark) await markTeamDevice(visitorId, "marked from the Guests tab");
      else await unmarkTeamDevice(visitorId);
      setTeamNote(mark ? t.markedTeam : t.unmarkedTeam);
      await refresh(days, includeTeam, hiddenCountries);
    } catch (error) {
      setTeamNote(error instanceof Error ? error.message : t.couldNotUpdate);
    }
  }

  const steps = data ? funnelSteps(data.funnel, language) : [];
  const drop = biggestDrop(steps);

  return (
    <section className="studio-guests">
      <div className="studio-filter-line">
        <select className="field-control" aria-label={t.period} value={days} onChange={(event) => setDays(Number(event.target.value) as typeof days)}>
          {windows.map(window => <option key={window} value={window}>{t.lastDays(window)}</option>)}
        </select>
        <label className="studio-team-filter"><input type="checkbox" checked={includeTeam} onChange={(event) => setIncludeTeam(event.target.checked)} /> {t.includeTeam}</label>
      </div>
      <Button variant="ghost" onClick={() => void refresh(days, includeTeam, hiddenCountries)} disabled={busy}><RefreshCw className="size-4" /> {t.refresh}</Button>
      {status && <p className="p-6 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}

      {data && (
        <div className="grid gap-6">
          <div className="studio-funnel" aria-label={t.funnelLabel}>
            {steps.map((step) => <div key={step.key}>
              <i aria-hidden="true" style={{ width: `${Math.min(100, (step.ofAll ?? 0) * 100)}%` }} />
              <span>{step.label}</span><strong>{step.count}</strong>
            </div>)}
          </div>
          {drop && (
            <p className="studio-hint">
              <strong>{t.lostMost}</strong>
              {t.drop(drop.from.label.toLowerCase(), drop.to.label.toLowerCase(), percent(drop.to.ofPrevious), drop.to.count, drop.from.count)}
            </p>
          )}

          <div>
            <h3 className="text-sm font-semibold">{t.whereTheyAre}</h3>
            <p className="studio-meta">{t.whereHint}</p>
            <div className="studio-countries">
              {data.countries.map((row) => {
                const total = data.countries.reduce((sum, entry) => sum + entry.devices, 0);
                return <div className="studio-country-row" key={row.country}>
                  {row.country === "unknown" ? <strong>{t.unknown}</strong> : <button type="button" onClick={() => toggleCountry(row.country)} title={t.hideCountry}>{countryLabel(row.country)}</button>}
                  <strong>{t.devices(row.devices)}</strong>
                  <p>{row.country === "unknown" ? t.countryUnavailable : ""}{t.countryRow(percent(total ? row.devices / total : null), row.guests, row.readers, row.accounts)}</p>
                </div>;
              })}
            </div>
            {hiddenCountries.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[var(--muted-foreground)]">{t.hidden}</span>
                {hiddenCountries.map((code) => (
                  <button key={code} type="button" className="admin-chip" onClick={() => toggleCountry(code)}>
                    {countryLabel(code)} ✕
                  </button>
                ))}
              </p>
            )}
          </div>

          <details className="studio-details"><summary>{t.teamDetails} <span aria-hidden="true">+</span></summary><div className="studio-details-body">
            <p>
              <strong>{t.teamTitle}</strong>
              {t.teamText(data.team.devices, data.team.marked)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void markThisBrowser(true)}>
                {t.markBrowser}
              </Button>
              <Button variant="ghost" onClick={() => void markThisBrowser(false)}>
                {t.unmark}
              </Button>
            </div>
            {teamNote && <p className="mt-2 text-[var(--muted-foreground)]">{teamNote}</p>}
          </div></details>

          <div>
            <h3 className="text-sm font-semibold">{t.arrivingToAccount}</h3>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted-foreground)]">
                  <th className="py-1 font-medium">{t.step}</th>
                  <th className="py-1 text-right font-medium">{t.devicesColumn}</th>
                  <th className="py-1 text-right font-medium">{t.ofBefore}</th>
                  <th className="py-1 text-right font-medium">{t.ofAllGuests}</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((step) => (
                  <tr key={step.key} className="border-t border-[var(--border)]">
                    <td className="py-2">{step.label}</td>
                    <td className="py-2 text-right tabular-nums">{step.count}</td>
                    <td className="py-2 text-right tabular-nums">{percent(step.ofPrevious)}</td>
                    <td className="py-2 text-right tabular-nums">{percent(step.ofAll)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {t.cameBack(data.funnel.cameBack, data.medianGuestMinutes ?? 0)}
            </p>
          </div>

          {data.hands && <GuestHands hands={data.hands} />}

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold">{t.howMuch}</h3>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {[
                    [t.nothingFinished, data.readsPerGuest.none],
                    [t.boksRange("1-2"), data.readsPerGuest.oneOrTwo],
                    [t.boksRange("3-9"), data.readsPerGuest.threeToNine],
                    [t.boksRange("10-14"), data.readsPerGuest.tenToFourteen],
                    [t.fifteenPlus, data.readsPerGuest.fifteenPlus],
                  ].map(([label, count]) => (
                    <tr key={label as string} className="border-t border-[var(--border)]">
                      <td className="py-2">{label}</td>
                      <td className="py-2 text-right tabular-nums">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                {t.limit(data.limit.hit, data.limit.requested, data.limit.converted)}
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold">{t.wall}</h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-1 font-medium">{t.reason}</th>
                    <th className="py-1 text-right font-medium">{t.shown}</th>
                    <th className="py-1 text-right font-medium">{t.askedLink}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.prompts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-2 text-[var(--muted-foreground)]">
                        {t.noPrompts}
                      </td>
                    </tr>
                  )}
                  {data.prompts.map((row) => (
                    <tr key={row.reason} className="border-t border-[var(--border)]">
                      <td className="py-2">{t.reasons[row.reason] ?? row.reason}</td>
                      <td className="py-2 text-right tabular-nums">{row.prompts}</td>
                      <td className="py-2 text-right tabular-nums">
                        {row.requests}
                        {row.prompts > 0 ? ` (${percent(row.requests / row.prompts)})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              { title: t.landedOn, rows: data.sources.landing, labels: t.landing },
              { title: t.cameFrom, rows: data.sources.referrer, labels: { direct: t.direct } as Record<string, string> },
              { title: t.campaign, rows: data.sources.campaign, labels: {} as Record<string, string> },
            ].map((block) => (
              <div key={block.title}>
                <h3 className="text-sm font-semibold">{block.title}</h3>
                <table className="mt-2 w-full text-sm">
                  <tbody>
                    {block.rows.length === 0 && (
                      <tr>
                        <td className="py-2 text-[var(--muted-foreground)]">{t.nothingYet}</td>
                      </tr>
                    )}
                    {block.rows.map((row) => (
                      <tr key={row.value} className="border-t border-[var(--border)]">
                        <td className="py-2 break-all">{block.labels[row.value] ?? row.value}</td>
                        <td className="py-2 text-right tabular-nums">{row.visits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <div>
            <h3 className="text-sm font-semibold">{t.dayByDay}</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t.dayHint}
            </p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-1 font-medium">{t.dayUtc}</th>
                    <th className="py-1 text-right font-medium">{t.guestDevices}</th>
                    <th
                      className="py-1 text-right font-medium"
                      title={t.newTitle}
                    >
                      {t.new}
                    </th>
                    <th className="py-1 text-right font-medium">{t.shownBok}</th>
                    <th className="py-1 text-right font-medium">{t.touched}</th>
                    <th className="py-1 text-right font-medium">{t.movedOn}</th>
                    <th className="py-1 text-right font-medium">{t.finishedBok}</th>
                    <th className="py-1 text-right font-medium">{t.medianTime}</th>
                    <th className="py-1 pl-4 font-medium">{t.where}</th>
                    <th className="py-1 text-right font-medium">{t.sawSignup}</th>
                    <th className="py-1 text-right font-medium">{t.askedLink}</th>
                    <th className="py-1 text-right font-medium">{t.newAccounts}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((row) => (
                    <tr
                      key={row.day}
                      className={`border-t border-[var(--border)]${openDay === row.day ? " bg-[var(--muted)]" : ""}`}
                    >
                      <td className="py-2">
                        <button
                          type="button"
                          className="author-account-link"
                          aria-expanded={openDay === row.day}
                          onClick={() => setOpenDay(openDay === row.day ? null : row.day)}
                        >
                          {row.day}
                        </button>
                      </td>
                      <td className="py-2 text-right tabular-nums">{row.guests}</td>
                      <td className="py-2 text-right tabular-nums">{row.newGuests}</td>
                      <td className="py-2 text-right tabular-nums">{row.shown ?? "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.touched ?? "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.swiped ?? "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.readers}</td>
                      <td className="py-2 text-right tabular-nums">{row.medianSeconds == null ? "-" : duration(row.medianSeconds, language)}</td>
                      <td className="py-2 pl-4">{row.countries?.length ? dayCountries(row.countries, language) : "-"}</td>
                      <td className="py-2 text-right tabular-nums">{row.prompts}</td>
                      <td className="py-2 text-right tabular-nums">{row.requests}</td>
                      <td className="py-2 text-right tabular-nums">{row.newAccounts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {openDay && (
              <div className="mt-3">
                <GuestDayPanel day={openDay} includeTeam={includeTeam} hiddenCountries={hiddenCountries} />
              </div>
            )}
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              {t.touchedNote(data.hands?.since ? new Date(data.hands.since).toLocaleDateString(language) : t.today)}
            </p>
          </div>

          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            {t.readWithCare(data.journeySince ? new Date(data.journeySince).toLocaleDateString(language) : t.today)}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Did guests touch a bok at all - the question between "arrived" and
 * "finished" that `start`, a timer, cannot answer. A page nobody taps is a
 * different problem from a page people try and leave.
 */
function GuestHands({ hands }: { hands: NonNullable<GuestFunnel["hands"]> }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const of = (count: number) => percent(hands.shown ? count / hands.shown : null);
  const rows: [string, number][] = [
    [t.hands.shown, hands.shown],
    [t.hands.touched, hands.touched],
    [t.hands.tapped, hands.tapped],
    [t.hands.scrolled, hands.scrolled],
    [t.hands.swiped, hands.swiped],
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold">{t.didTouch}</h3>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--muted-foreground)]">
            <th className="py-1 font-medium">{t.guestDevices}</th>
            <th className="py-1 text-right font-medium">{t.devicesColumn}</th>
            <th className="py-1 text-right font-medium">{t.ofShown}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, count]) => (
            <tr key={label} className="border-t border-[var(--border)]">
              <td className="py-2">{label}</td>
              <td className="py-2 text-right tabular-nums">{count}</td>
              <td className="py-2 text-right tabular-nums">{of(count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
        {t.handsNote(hands.swipes, hands.boksTouched, hands.boksShown, hands.since ? new Date(hands.since).toLocaleDateString(language) : null)}
      </p>
    </div>
  );
}
