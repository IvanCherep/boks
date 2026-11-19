"use client";

import { X } from "lucide-react";
import "@/app/daily.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { longDate, ordinal, stampDate, weekdayNames } from "@/lib/boks/daily/days";
import type { DailyArrival } from "./data";
import { Postmark } from "./postmark";
import { useEscape } from "./use-escape";
import { welcomeMessages } from "./welcome-messages";

/** Stop a press here from reaching the reader underneath (it would turn the page). */
export const keepToSelf = {
  onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
  onPointerUp: (event: React.PointerEvent) => event.stopPropagation(),
  onTouchStart: (event: React.TouchEvent) => event.stopPropagation(),
  onTouchEnd: (event: React.TouchEvent) => event.stopPropagation(),
  onWheel: (event: React.WheelEvent) => event.stopPropagation(),
};

/** Monday to Sunday in numerals: a dot under the days the account came, today underlined. */
export function WeekStrip({ week, today }: { week: DailyArrival["week"]; today: string }) {
  const language = useUiLanguage();
  const names = weekdayNames(language);
  return <ol className="day-week" aria-label={useMessages(welcomeMessages).week}>
    {week.map((day, index) => <li key={day.date}
      className={`${day.visited ? "is-visited" : ""}${day.date === today ? " is-today" : ""}${day.date > today ? " is-ahead" : ""}`}
      style={{ "--i": index } as React.CSSProperties}>
      <small>{names[index]}</small>
      <span>{Number(day.date.slice(8, 10))}</span>
      <i aria-hidden="true" />
    </li>)}
  </ol>;
}

/**
 * The first bok of an account's day: the date, which day with boks this is,
 * the week, and what the day holds - the letter and the game - as two lines
 * of a page, not as buttons. Once a day across devices.
 */
export function DayCard({ arrival, gameNew, gameToday = true, onLetter, onGame, onClose }: {
  arrival: DailyArrival;
  gameNew: boolean;
  /** False when there is no issue today: the row would otherwise say "Answered" to someone who never played. */
  gameToday?: boolean;
  onLetter: () => void;
  onGame: () => void;
  onClose: () => void;
}) {
  const words = useMessages(welcomeMessages);
  const language = useUiLanguage();
  const first = arrival.total <= 1;
  useEscape(onClose);
  return <aside className="day-card" role="dialog" aria-label={first ? words.firstDay : words.newDay} {...keepToSelf}>
    <button type="button" className="day-card__close" aria-label={words.notNow} onClick={onClose}><X size={20} /></button>
    <p className="day-card__eyebrow">{longDate(arrival.date, language)}</p>
    <h2 className="day-card__title">{first ? words.firstDay : words.newDay}</h2>
    <p className="day-card__lead">{first
      ? words.firstDayLead
      : <>{words.dayCount(ordinal(arrival.total, language))}{arrival.streak > 1 && <span> · {words.inARow(arrival.streak)}</span>}</>}</p>
    <WeekStrip week={arrival.week} today={arrival.date} />
    <ul className="day-rows">
      <li style={{ "--i": 0 } as React.CSSProperties}>
        <button type="button" className="day-row" onClick={onLetter}>
          <Postmark caption={stampDate(arrival.date)} sealed={!arrival.letterOpened} />
          <span className="day-row__text"><strong>{words.letter}</strong><small>{arrival.letterOpened ? words.letterOpened : words.letterSealed}</small></span>
          <span className="day-row__action">{arrival.letterOpened ? words.reread : words.open}</span>
        </button>
      </li>
      {gameToday && <li style={{ "--i": 1 } as React.CSSProperties}>
        <button type="button" className="day-row" onClick={onGame}>
          <span className="day-row__glyph" aria-hidden="true">?</span>
          <span className="day-row__text"><strong>{words.gameTitle}</strong><small>{gameNew ? words.gameWaiting : words.gameDone}</small></span>
          <span className="day-row__action">{gameNew ? words.play : words.results}</span>
        </button>
      </li>}
    </ul>
    <button type="button" className="day-card__read" onClick={onClose}>{words.read}</button>
  </aside>;
}
