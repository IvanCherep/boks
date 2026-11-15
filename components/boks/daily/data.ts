"use client";

import { supabase } from "@/lib/boks/supabase-client";
import { deviceTimeZone, tidyPassage } from "@/lib/boks/daily/passage";
export { gameDayLead, gameDayStatus, type GameDayStatus } from "@/lib/boks/daily/game-day";

/**
 * Line of the day and Guess the author: every call is an RPC from
 * `20261117100000_boks_lines.sql`, `20261117110000_boks_reader_days.sql` and
 * `20261117120000_boks_author_game.sql`. The database decides
 * who may send, which line a letter carries and whether an answer counts;
 * nothing here is trusted.
 */

export type DailyLetter = {
  date: string;
  openedAt: string;
  source: "reader" | "editorial";
  /** The sender's @handle; null for an editorial letter or a sender whose account is gone. */
  senderHandle: string | null;
  /** False once the bok is no longer published; the words are then withheld. */
  available: boolean;
  passage: string | null;
  bokId: string | null;
  title: string | null;
  authorName: string | null;
};

export type SavedLine = {
  id: string;
  savedAt: string;
  available: boolean;
  passage: string | null;
  bokId: string | null;
  title: string | null;
  authorName: string | null;
};

export type AuthorGameResult = {
  choice: number | null;
  revealed: boolean;
  correct: boolean;
  correctIndex: number;
  authorName: string;
  title: string | null;
  bokId: string | null;
  counts: [number, number, number];
};

export type AuthorGame =
  | { date: string; status: "none" }
  | { date: string; status: "open" | "answered"; text: string; words: number; options: [string, string, string]; result: AuthorGameResult | null };

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

/** Today as a day the account came, for the day card (`get_daily_arrival`). */
export type DailyArrival = {
  date: string;
  cardSeen: boolean;
  total: number;
  streak: number;
  week: { date: string; visited: boolean; letter: boolean }[];
  letterOpened: boolean;
};

export type MyDays = { month: string; total: number; streak: number; since: string | null; days: { date: string; letter: boolean }[] };

export async function loadDailyArrival() {
  return unwrap<DailyArrival>(await client().rpc("get_daily_arrival", { p_time_zone: deviceTimeZone() }));
}

export async function markDailyCardSeen(date: string) {
  unwrap(await client().rpc("mark_daily_card_seen", { p_day: date }));
}

export async function loadMyDays(month: string) {
  return unwrap<MyDays>(await client().rpc("get_my_days", { p_month: month }));
}

/** Today's letter: the one already opened, or a new one. Null only with an empty catalogue. */
export async function openDailyLetter() {
  return unwrap<DailyLetter | null>(await client().rpc("open_daily_letter", { p_time_zone: deviceTimeZone() }));
}

export async function loadMyDailyLetters(before: string | null = null, limit = 30) {
  return unwrap<DailyLetter[]>(await client().rpc("get_my_daily_letters", { p_before: before, p_limit: limit })) ?? [];
}

/** Into tomorrow's letters of random readers. */
export async function shareLine(bokId: string, passage: string) {
  return unwrap<{ id: string; created: boolean }>(await client().rpc("share_line", { p_bok_id: bokId, p_passage: tidyPassage(passage) }));
}

/** To one person: its own link, which opens as a letter from the sender. */
export async function createLineLink(bokId: string, passage: string) {
  return unwrap<{ code: string; created: boolean }>(await client().rpc("create_line_link", { p_bok_id: bokId, p_passage: tidyPassage(passage) }));
}

/** A line sent by link, as the letter from its sender it is. */
export async function loadLineLink(code: string) {
  return unwrap<(DailyLetter & { code: string }) | null>(await client().rpc("get_line_link", { p_code: code }));
}

/** Only this shape is ever looked up. */
export const lineCodePattern = /^[0-9a-f]{16}$/;

export async function saveLine(bokId: string, passage: string) {
  return unwrap<{ id: string; created: boolean }>(await client().rpc("save_line", { p_bok_id: bokId, p_passage: tidyPassage(passage) }));
}

export async function deleteSavedLine(id: string) {
  unwrap(await client().rpc("delete_saved_line", { p_id: id }));
}

export async function loadSavedLines(before: string | null = null, limit = 30) {
  return unwrap<SavedLine[]>(await client().rpc("get_saved_lines", { p_before: before, p_limit: limit })) ?? [];
}

/** Whether today's text waits for this reader, without the text itself. */
export async function loadAuthorGameStatus() {
  return unwrap<"none" | "open" | "answered">(await client().rpc("get_author_game_status"));
}

export async function loadAuthorGame() {
  return unwrap<AuthorGame>(await client().rpc("get_author_game"));
}

/** `choice` null reveals the answer without guessing. */
export async function answerAuthorGame(date: string, choice: number | null) {
  return unwrap<AuthorGameResult>(await client().rpc("answer_author_game", { p_date: date, p_choice: choice }));
}

// Studio

export type GameCandidate = {
  id: string;
  position: 1 | 2 | 3;
  bokId: string | null;
  title: string | null;
  authorName: string | null;
  available: boolean;
  options: [string, string, string];
  correct: number;
  words: number | null;
  replacedAt: string | null;
  text?: string | null;
};

export type GameDay = {
  date: string;
  today: boolean;
  chosenPosition: number | null;
  publishedAt: string | null;
  publishedPosition: number | null;
  published: {
    bokId: string | null; title: string | null; authorName: string;
    options: [string, string, string]; correct: number; answers: number; correctAnswers: number;
  } | null;
  available: number;
  candidates: GameCandidate[];
  /** Only after a replacement: the replaced text had been chosen. */
  choiceCleared?: boolean;
};

export async function loadGameCalendar(days = 7) {
  return unwrap<{ today: string; days: GameDay[] }>(await client().rpc("studio_author_game_calendar", { p_days: days }));
}

export async function loadGameDay(date: string) {
  return unwrap<GameDay>(await client().rpc("studio_author_game_day", { p_date: date }));
}

export async function chooseGameCandidate(date: string, position: number | null) {
  return unwrap<GameDay>(await client().rpc("studio_author_game_choose", { p_date: date, p_position: position }));
}

export async function replaceGameCandidate(date: string, position: number) {
  return unwrap<GameDay>(await client().rpc("studio_author_game_replace", { p_date: date, p_position: position }));
}
