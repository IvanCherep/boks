"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import "@/app/daily.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { calendarDate } from "@/lib/boks/daily/game-day";
import { monthGrid, monthTitle, shiftMonth, weekdayNames } from "@/lib/boks/daily/days";
import { loadMyDays, type MyDays } from "./data";
import { welcomeMessages } from "./welcome-messages";

/** You → Settings → My days: every day the account came, a month at a time. */
export function MyDaysPage({ today }: { today: string }) {
  const words = useMessages(welcomeMessages);
  const language = useUiLanguage();
  const [month, setMonth] = useState(today.slice(0, 7) + "-01");
  const [data, setData] = useState<MyDays | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadMyDays(month).then((next) => { if (active) { setData(next); setFailed(false); } }, () => active && setFailed(true));
    return () => { active = false; };
  }, [month]);

  const visited = new Map((data?.days ?? []).map((day) => [day.date, day]));
  const names = weekdayNames(language);
  const firstMonth = data?.since ? data.since.slice(0, 7) + "-01" : month;
  return <div className="my-days">
    <h1 className="social-display">{words.myDays}</h1>
    {data && <div className="my-days__stats">
      <p><strong>{data.total}</strong><span>{words.daysTotal(data.total)}</span></p>
      {data.streak > 1 && <p><strong>{data.streak}</strong><span>{words.streakNow(data.streak)}</span></p>}
      {data.since && <small>{words.since(calendarDate(data.since, language))}</small>}
    </div>}
    <div className="my-days__month">
      <header>
        <button type="button" aria-label={words.previousMonth} onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= firstMonth}><ChevronLeft /></button>
        <h2>{monthTitle(month, language)}</h2>
        <button type="button" aria-label={words.nextMonth} onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= today.slice(0, 7) + "-01"}><ChevronRight /></button>
      </header>
      <div className="my-days__grid" role="grid">
        {names.map((name) => <span key={name} className="my-days__weekday" role="columnheader">{name}</span>)}
        {monthGrid(month).flat().map((date, index) => {
          if (!date) return <span key={`empty-${index}`} />;
          const day = visited.get(date);
          return <span key={date} role="gridcell" className={`my-days__day${day ? " is-visited" : ""}${date === today ? " is-today" : ""}${date > today ? " is-ahead" : ""}`}
            aria-label={`${calendarDate(date, language)}${day ? ` · ${words.legendDay}` : ""}${day?.letter ? ` · ${words.legendLetter}` : ""}`}>
            {Number(date.slice(8, 10))}{day?.letter && <i aria-hidden="true" />}
          </span>;
        })}
      </div>
      <p className="my-days__legend"><span><b className="is-visited" />{words.legendDay}</span><span><b className="is-letter" />{words.legendLetter}</span></p>
    </div>
    {failed && <p className="social-note" role="alert">{words.loadFailed}</p>}
  </div>;
}
