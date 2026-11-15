"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadAuthorGameStatus, loadDailyArrival, markDailyCardSeen, type DailyArrival } from "./data";

/** The day whose card this account closed here, so a mark the server missed does not bring it back. */
function closedKey(userId: string) {
  return `boks-day-card-closed:${userId}`;
}

function readClosedDay(userId: string) {
  try {
    return window.localStorage.getItem(closedKey(userId));
  } catch {
    return null;
  }
}

function rememberClosedDay(userId: string, date: string) {
  try {
    window.localStorage.setItem(closedKey(userId), date);
  } catch {
    // Private mode: the server still knows the card was seen.
  }
}

/**
 * The reader's day, one source for the reader and Settings: today as a day the
 * account came (`get_daily_arrival`: the day card, the week, whether the
 * letter is open) and whether today's game still waits (guests too,
 * `get_author_game_status`). Asked once identity is known; kept current as
 * the reader opens the letter or answers. Every returned function is stable.
 */
export function useDailyAccount({ identitySettled, userId }: { identitySettled: boolean; userId: string | null }) {
  const [arrival, setArrival] = useState<DailyArrival | null>(null);
  const [cardClosed, setCardClosed] = useState(false);
  const [gameNew, setGameNew] = useState(false);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    if (!identitySettled) return;
    let active = true;
    if (userId) {
      void loadDailyArrival().then((next) => {
        if (!active) return;
        setArrival(next);
        setCardClosed(next.cardSeen || readClosedDay(userId) === next.date);
      }, () => undefined);
    }
    void loadAuthorGameStatus().then((status) => { if (active) setGameNew(status === "open"); }, () => undefined);
    return () => { active = false; };
  }, [identitySettled, userId]);

  /** The card is on screen: not again today, on any device. Once per day, however often it is called. */
  const cardShown = useCallback((date: string) => {
    if (!userId || shownFor.current === `${userId}:${date}`) return;
    shownFor.current = `${userId}:${date}`;
    rememberClosedDay(userId, date);
    void markDailyCardSeen(date).catch(() => undefined);
  }, [userId]);
  const closeCard = useCallback(() => setCardClosed(true), []);
  const letterOpened = useCallback((date: string) => {
    setArrival((current) => current && current.date === date ? {
      ...current,
      letterOpened: true,
      week: current.week.map((day) => day.date === date ? { ...day, letter: true } : day),
    } : current);
  }, []);
  const gameAnswered = useCallback(() => setGameNew(false), []);

  const signedIn = Boolean(userId);
  return {
    arrival: signedIn ? arrival : null,
    cardPending: Boolean(signedIn && arrival && !cardClosed),
    gameNew,
    cardShown,
    closeCard,
    letterOpened,
    gameAnswered,
  };
}
