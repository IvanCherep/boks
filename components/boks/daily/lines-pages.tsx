"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import "@/app/daily.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { calendarDate } from "@/lib/boks/daily/game-day";
import { readableBoksError } from "@/lib/boks/errors";
import { Postmark } from "./postmark";
import { deleteSavedLine, loadMyDailyLetters, loadSavedLines, type DailyLetter, type SavedLine } from "./data";
import { dailyMessages } from "./messages";

const pageSize = 30;

/**
 * You → Settings → Received lines: every letter this account opened, newest
 * first. A letter opens again as it was; one whose work was taken down stays
 * in the list, marked unavailable, without its words.
 */
export function ReceivedLines({ todayWaiting, onOpenToday, onOpenLetter }: {
  todayWaiting: boolean;
  onOpenToday: () => void;
  onOpenLetter: (letter: DailyLetter) => void;
}) {
  const words = useMessages(dailyMessages);
  const language = useUiLanguage();
  const [letters, setLetters] = useState<DailyLetter[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (before: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await loadMyDailyLetters(before, pageSize);
      setLetters((current) => before && current ? [...current, ...page] : page);
      setMore(page.length === pageSize);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <div className="daily-lines">
    <h1 className="social-display">{words.receivedLines}</h1>
    {todayWaiting && <button type="button" className="daily-today-card" onClick={onOpenToday}>
      <Postmark caption={words.todayStamp} sealed />
      <span><strong>{words.aLineArrived}</strong><small>{words.todayLetterCard}</small></span>
      <ChevronRight aria-hidden="true" />
    </button>}
    {letters?.map((letter) => <button key={letter.date} type="button" className={`daily-line-row${letter.available ? "" : " is-unavailable"}`} onClick={() => onOpenLetter(letter)}>
      <span>
        {letter.available && letter.passage
          ? <em lang="und" translate="no">{letter.passage}</em>
          : <em className="daily-line-row__gone">{words.unavailableLine}</em>}
        {letter.available && letter.authorName && <small className="daily-caps" translate="no">{letter.authorName}</small>}
        <span className="daily-line-row__meta"><i translate="no">{letter.source === "editorial" ? words.fromEditors : letter.senderHandle ? `@${letter.senderHandle}` : words.fromReader}</i><time dateTime={letter.date}>{calendarDate(letter.date, language)}</time></span>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>)}
    {letters && !letters.length && !todayWaiting && <p className="social-note daily-empty">{words.receivedEmpty}</p>}
    {failed && <p className="social-note" role="alert">{words.loadFailed} <button type="button" className="daily-link" onClick={() => void load(null)}>{words.tryAgain}</button></p>}
    {more && letters && <button type="button" className="daily-link daily-more" disabled={loading} onClick={() => void load(letters.at(-1)!.date)}>{words.showMore}</button>}
    {!letters && !failed && <p className="social-note" role="status">…</p>}
  </div>;
}

/** You → Settings → Saved lines: lines the reader kept, each opening its work there. */
export function SavedLines({ onOpenPassage, onStatus }: {
  onOpenPassage: (bokId: string, passage: string) => void;
  onStatus: (message: string) => void;
}) {
  const words = useMessages(dailyMessages);
  const language = useUiLanguage();
  const [items, setItems] = useState<SavedLine[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async (before: string | null) => {
    setLoading(true);
    setFailed(false);
    try {
      const page = await loadSavedLines(before, pageSize);
      setItems((current) => before && current ? [...current, ...page] : page);
      setMore(page.length === pageSize);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(null), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function remove(id: string) {
    setRemoving(id);
    try {
      await deleteSavedLine(id);
      setItems((current) => current?.filter((item) => item.id !== id) ?? null);
      onStatus(words.removed);
    } catch (error) {
      onStatus(readableBoksError(error, words.loadFailed));
    } finally {
      setRemoving(null);
    }
  }

  return <div className="daily-lines">
    <h1 className="social-display">{words.savedLines}</h1>
    {items?.map((item) => <div key={item.id} className={`daily-line-row daily-line-row--saved${item.available ? "" : " is-unavailable"}`}>
      <button type="button" disabled={!item.available || !item.bokId || !item.passage} onClick={() => item.bokId && item.passage && onOpenPassage(item.bokId, item.passage)}>
        {item.available && item.passage ? <em lang="und" translate="no">{item.passage}</em> : <em className="daily-line-row__gone">{words.unavailableLine}</em>}
        {item.available && <small className="daily-caps" translate="no">{[item.authorName, item.title].filter(Boolean).join(" · ")}</small>}
        <span className="daily-line-row__meta"><time dateTime={item.savedAt}>{calendarDate(item.savedAt.slice(0, 10), language)}</time></span>
      </button>
      <button type="button" className="daily-link daily-line-row__remove" disabled={removing === item.id} onClick={() => void remove(item.id)}>{words.remove}</button>
    </div>)}
    {items && !items.length && <p className="social-note daily-empty">{words.savedEmpty}</p>}
    {failed && <p className="social-note" role="alert">{words.loadFailed} <button type="button" className="daily-link" onClick={() => void load(null)}>{words.tryAgain}</button></p>}
    {more && items && <button type="button" className="daily-link daily-more" disabled={loading} onClick={() => void load(items.at(-1)!.savedAt)}>{words.showMore}</button>}
    {!items && !failed && <p className="social-note" role="status">…</p>}
  </div>;
}
