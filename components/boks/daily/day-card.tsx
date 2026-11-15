"use client";

import { ChevronRight, X } from "lucide-react";
import "@/app/daily.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { longDate, ordinal, weekdayNames } from "@/lib/boks/daily/days";
import { Envelope } from "./envelope";
import type { DailyArrival } from "./data";
import { welcomeMessages } from "./welcome-messages";
import { useEscape } from "./use-escape";

/** Stop a press here from reaching the reader underneath (it would turn the page). */
export const keepToSelf = {
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
  onPointerUp: (event: React.PointerEvent) => event.stopPropagation(),
  onTouchStart: (event: React.TouchEvent) => event.stopPropagation(),
  onTouchEnd: (event: React.TouchEvent) => event.stopPropagation(),
  onWheel: (event: React.WheelEvent) => event.stopPropagation(),
};

/** Monday to Sunday: the days the account came, today ringed, a dot for a letter opened. */
export function WeekStrip({ week, today }: { week: DailyArrival["week"]; today: string }) {
  const language = useUiLanguage();
  const names = weekdayNames(language);
  return <ol className="day-week" aria-label={useMessages(welcomeMessages).week}>
    {week.map((day, index) => <li key={day.date} className={`${day.visited ? "is-visited" : ""}${day.date === today ? " is-today" : ""}${day.date > today ? " is-ahead" : ""}`}
      style={{ "--day-delay": `${index * 55}ms` } as React.CSSProperties}>
      <small>{names[index]}</small>
      <span>{Number(day.date.slice(8, 10))}</span>
      <i aria-hidden="true" className={day.letter ? "has-letter" : ""} />
    </li>)}
  </ol>;
}

/**
 * The first bok of an account's day: a greeting, which day with boks this is,
 * the week, and the two things the day holds - the letter and the game.
 * Shown once a day across devices; Settings keeps all of it afterwards.
 */
export function DayCard({ arrival, handle, gameNew, onLetter, onGame, onClose }: {
  arrival: DailyArrival;
  handle: string;
  gameNew: boolean;
  onLetter: () => void;
  onGame: () => void;
  onClose: () => void;
}) {
  const words = useMessages(welcomeMessages);
  const language = useUiLanguage();
  const first = arrival.total <= 1;
  useEscape(onClose);
  return <aside className="day-card" role="dialog" aria-label={(first ? words.firstDay(handle) : words.newDay(handle)).replace("\n", " ")} {...keepToSelf}>
    <button type="button" className="day-card__close" aria-label={words.notNow} onClick={onClose}><X size={20} /></button>
    <p className="day-card__eyebrow">{longDate(arrival.date, language)}</p>
    <h2 className="day-card__title" translate="no">{first ? words.firstDay(handle) : words.newDay(handle)}</h2>
    {first
      ? <p className="day-card__lead">{words.firstDayLead}</p>
      : <p className="day-card__count"><strong>{words.dayCount(ordinal(arrival.total, language))}</strong>{arrival.streak > 1 && <span>{words.inARow(arrival.streak)}</span>}</p>}
    <WeekStrip week={arrival.week} today={arrival.date} />
    <div className="day-card__tiles">
      <button type="button" className={`day-tile day-tile--letter${arrival.letterOpened ? "" : " is-new"}`} onClick={onLetter}>
        <span className="day-tile__art" aria-hidden="true"><Envelope state={arrival.letterOpened ? "open" : "sealed"} size="small" /></span>
        <span><strong>{arrival.letterOpened ? words.letterSeenTitle : words.letterTitle}</strong><small>{arrival.letterOpened ? words.letterSeenLead : words.letterLead}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
      <button type="button" className={`day-tile day-tile--game${gameNew ? " is-new" : ""}`} onClick={onGame}>
        <span className="day-tile__art day-tile__art--game" aria-hidden="true">?</span>
        <span><strong>{words.gameTitle}</strong><small>{gameNew ? words.gameLead : words.gameDoneLead}</small></span>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
    <button type="button" className="day-card__read" onClick={onClose}>{words.read}</button>
  </aside>;
}
