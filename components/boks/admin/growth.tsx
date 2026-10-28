"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoksGrowth } from "@/components/boks/client-types";
import { loadBoksGrowth } from "@/components/boks/supabase-browser-data";
import { TimeSeriesBars } from "@/components/boks/admin/metric-bars";
import { RetentionTriangle } from "@/components/boks/admin/retention-triangle";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

const words = defineMessages(
  {
    loading: "Loading...",
    missingFunction: "This Supabase project does not have the growth function yet. Apply supabase/migrations/20260912200000_boks_growth_and_cohorts.sql.",
    couldNotLoad: "Could not load growth.",
    readersAllTime: "readers, all time",
    accountsAllTime: "accounts, all time",
    minutesRead: "minutes read",
    boksRead: "boks read",
    arriving: "Are readers arriving?",
    newPerWeek: (weeks: number) => `New readers per week · last ${weeks} weeks`,
    period: "Growth period",
    lastWeeks: (weeks: number) => `Last ${weeks} weeks`,
    refresh: "Refresh",
    comeBack: "Do they come back?",
    arrivalWeek: "Arrival week",
    readers: "Readers",
    weekShort: (offset: number) => `W${offset}`,
    noCohorts: "No reader cohorts yet.",
    cohortNote: "Returning readers, with the arrival cohort beside them. Weeks that have not elapsed stay blank.",
    daySeven: "Returned on day 7",
    daySevenShare: (share: number, eligible: number) => `${share}% of ${eligible} who first read 7–90 days ago`,
    daySevenNone: "nobody first read 7–90 days ago yet",
    details: "Reading, activation & supply",
    today: "Readers today",
    thisWeek: (n: number) => `${n} this week`,
    thisMonth: "Readers this month",
    readToday: (share: number) => `${share}% of them read today`,
    published: "Published boks",
    publishedNote: "The catalogue readers draw from",
    signups: "Accounts created per week",
    minutes: "Minutes read per week",
    minuteUnit: "m",
    active: "Active readers per week",
    sessions: "Reading sessions per week",
    finished: "Boks read per week",
    first30: "First 30 days",
    arrived: "Arrived",
    last30: "last 30 days",
    readOne: "Read at least one",
    readThree: "Read three or more",
    signedUp: "Created an account",
    publishedPerWeek: "Boks published per week",
    fullRates: "Full cohort rates",
    ratesNote: "Each rate uses its arrival cohort as the denominator. All reading time comes from foreground activity.",
    ofArrivals: (share: number) => `${share}% of arrivals`,
  },
  {
    ru: {
      loading: "Загрузка...",
      missingFunction: "В этом проекте Supabase ещё нет функции роста. Примените supabase/migrations/20260912200000_boks_growth_and_cohorts.sql.",
      couldNotLoad: "Не удалось загрузить рост.",
      readersAllTime: "читателей за всё время",
      accountsAllTime: "аккаунтов за всё время",
      minutesRead: "минут прочитано",
      boksRead: "боков прочитано",
      arriving: "Приходят ли читатели?",
      newPerWeek: (weeks: number) => `Новые читатели по неделям · последние ${weeks} ${plural("ru", weeks, { one: "неделя", few: "недели", many: "недель", other: "недели" })}`,
      period: "Период роста",
      lastWeeks: (weeks: number) => `Последние ${weeks} ${plural("ru", weeks, { one: "неделя", few: "недели", many: "недель", other: "недели" })}`,
      refresh: "Обновить",
      comeBack: "Возвращаются ли они?",
      arrivalWeek: "Неделя прихода",
      readers: "Читатели",
      weekShort: (offset: number) => `Н${offset}`,
      noCohorts: "Когорт читателей пока нет.",
      cohortNote: "Вернувшиеся читатели рядом с когортой прихода. Недели, которые ещё не прошли, остаются пустыми.",
      daySeven: "Вернулись на 7-й день",
      daySevenShare: (share: number, eligible: number) => `${share}% из ${eligible}, впервые читавших 7–90 дней назад`,
      daySevenNone: "пока никто не читал впервые 7–90 дней назад",
      details: "Чтение, активация и предложение",
      today: "Читателей сегодня",
      thisWeek: (n: number) => `${n} на этой неделе`,
      thisMonth: "Читателей в этом месяце",
      readToday: (share: number) => `${share}% из них читали сегодня`,
      published: "Опубликовано боков",
      publishedNote: "Каталог, из которого читают",
      signups: "Новые аккаунты по неделям",
      minutes: "Минуты чтения по неделям",
      minuteUnit: " мин",
      active: "Активные читатели по неделям",
      sessions: "Сессии чтения по неделям",
      finished: "Прочитанные боки по неделям",
      first30: "Первые 30 дней",
      arrived: "Пришли",
      last30: "последние 30 дней",
      readOne: "Прочитали хотя бы один",
      readThree: "Прочитали три и больше",
      signedUp: "Создали аккаунт",
      publishedPerWeek: "Опубликованные боки по неделям",
      fullRates: "Полные показатели когорт",
      ratesNote: "Каждый показатель делится на свою когорту прихода. Всё время чтения берётся из активности на экране.",
      ofArrivals: (share: number) => `${share}% пришедших`,
    },
  }
);

/**
 * The trajectory. What someone from outside asks first: are readers arriving,
 * do they come back, and is the catalog keeping up with them.
 *
 * Everything plotted weekly here is a count or a total. Those are honest at any
 * sample size. Rates are shown only where their denominator is printed beside
 * them, because a percentage off a dozen readers moves several points when one
 * person changes their mind.
 */
export function AdminGrowth() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [growth, setGrowth] = useState<BoksGrowth | null>(null);
  const [weeks, setWeeks] = useState(8);
  const [status, setStatus] = useState(() => words[currentUiLanguage()].loading);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (nextWeeks: number) => {
    setBusy(true);
    try {
      const payload = await loadBoksGrowth(nextWeeks);
      setGrowth(payload);
      setStatus(payload ? "" : words[currentUiLanguage()].missingFunction);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotLoad);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(weeks).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [weeks, refresh]);

  const weekly = growth?.weekly ?? [];
  const points = (key: "newReaders" | "activeReaders" | "signups" | "minutes" | "sessions" | "boksFinished" | "boksPublished") =>
    weekly.map((row) => ({ label: shortWeek(row.week, language), value: row[key] }));

  const activation = growth?.activation;
  const stickiness = growth?.stickiness;
  const totals = growth?.totals;
  const stickinessRatio = stickiness?.monthly ? Math.round((stickiness.daily / stickiness.monthly) * 100) : 0;

  return <div className="studio-growth">
    {status && <p className="studio-notice" role="status">{status}</p>}
    {growth && <>
      <section className="studio-metric-pair"><Tile label={t.readersAllTime} value={totals?.readers ?? 0} note="" /><Tile label={t.accountsAllTime} value={totals?.accounts ?? 0} note="" /><Tile label={t.minutesRead} value={totals?.minutes ?? 0} note="" /><Tile label={t.boksRead} value={totals?.boksFinished ?? 0} note="" /></section>
      <section className="studio-editorial-section"><h2>{t.arriving}</h2><TimeSeriesBars points={points("newReaders")} caption={t.newPerWeek(weeks)} /><div className="studio-filter-line"><select aria-label={t.period} className="field-control" value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}><option value={8}>{t.lastWeeks(8)}</option><option value={12}>{t.lastWeeks(12)}</option><option value={26}>{t.lastWeeks(26)}</option></select><Button variant="ghost" onClick={() => refresh(weeks)} disabled={busy}><RefreshCw /> {t.refresh}</Button></div></section>
      <section className="studio-editorial-section"><h2>{t.comeBack}</h2>{growth.cohorts.length ? <table className="studio-retention"><thead><tr><th>{t.arrivalWeek}</th><th>{t.readers}</th>{[1,2,3].map(offset=><th key={offset}>{t.weekShort(offset)}</th>)}</tr></thead><tbody>{growth.cohorts.map(cohort=><tr key={cohort.week}><td>{shortWeek(cohort.week, language)}</td><td>{cohort.size}</td>{[1,2,3].map(offset=><td key={offset}>{cohort.retained.find(entry=>entry.offset===offset)?.readers ?? "—"}</td>)}</tr>)}</tbody></table> : <p className="studio-meta">{t.noCohorts}</p>}<p className="studio-meta">{t.cohortNote}</p>{growth.daySeven && <div className="studio-metric-pair"><Tile label={t.daySeven} value={growth.daySeven.returned} note={growth.daySeven.eligible ? t.daySevenShare(Math.round((growth.daySeven.returned / growth.daySeven.eligible) * 100), growth.daySeven.eligible) : t.daySevenNone} /></div>}</section>
      <details className="studio-details"><summary>{t.details} <span>＋</span></summary><div className="studio-details-body">
        <div className="studio-metric-pair"><Tile label={t.today} value={stickiness?.daily ?? 0} note={t.thisWeek(stickiness?.weekly ?? 0)} /><Tile label={t.thisMonth} value={stickiness?.monthly ?? 0} note={t.readToday(stickinessRatio)} /><Tile label={t.published} value={totals?.publishedBoks ?? 0} note={t.publishedNote} /></div>
        <TimeSeriesBars points={points("signups")} caption={t.signups} /><TimeSeriesBars points={points("minutes")} caption={t.minutes} unit={t.minuteUnit} /><TimeSeriesBars points={points("activeReaders")} caption={t.active} /><TimeSeriesBars points={points("sessions")} caption={t.sessions} /><TimeSeriesBars points={points("boksFinished")} caption={t.finished} />
        <h3>{t.first30}</h3><div className="studio-metric-pair"><Tile label={t.arrived} value={activation?.newReaders ?? 0} note={t.last30} /><Tile label={t.readOne} value={activation?.finishedOne ?? 0} note={share(t, activation?.finishedOne,activation?.newReaders)} /><Tile label={t.readThree} value={activation?.finishedThree ?? 0} note={share(t, activation?.finishedThree,activation?.newReaders)} /><Tile label={t.signedUp} value={activation?.signedUp ?? 0} note={share(t, activation?.signedUp,activation?.newReaders)} /></div>
        <TimeSeriesBars points={points("boksPublished")} caption={t.publishedPerWeek} /><h3>{t.fullRates}</h3><RetentionTriangle cohorts={growth.cohorts} /><p className="studio-meta">{t.ratesNote}</p>
      </div></details>
    </>}
  </div>;
}

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="metric-tile">
      <p>{label}</p>
      <strong>{value}</strong>
      {note && <small className="mt-1 block text-xs text-[var(--muted-foreground)]">{note}</small>}
    </div>
  );
}

function share(t: (typeof words)["en"], part: number | undefined, whole: number | undefined) {
  if (!whole || part === undefined) return "";
  return t.ofArrivals(Math.round((part / whole) * 100));
}

function shortWeek(week: string, language: UiLanguage) {
  const date = new Date(`${week}T00:00:00Z`);
  return date.toLocaleDateString(language, { month: "short", day: "numeric" });
}
