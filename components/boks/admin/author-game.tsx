"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, RefreshCw } from "lucide-react";
import "@/app/daily.css";
import { Button } from "@/components/ui/button";
import { formatReaderBody } from "@/components/boks/reader-text";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { calendarDate } from "@/lib/boks/daily/game-day";
import { optionLabels } from "@/lib/boks/daily/passage";
import { readableBoksError } from "@/lib/boks/errors";
import { defineMessages, plural } from "@/lib/i18n/messages";
import {
  chooseGameCandidate,
  gameDayLead,
  gameDayStatus,
  loadGameCalendar,
  loadGameDay,
  replaceGameCandidate,
  type GameCandidate,
  type GameDay,
  type GameDayStatus,
} from "@/components/boks/daily/data";

/**
 * Studio → Guess the author. The coming seven days, each stocked with three
 * short catalogue texts (`boks_game_fill`). Nothing has to be done: at 00:00
 * Moscow the editor's choice goes out, else the first available text. An
 * editor reads any candidate in full, replaces one in its place, or chooses
 * one for the day. Opening a text is never a choice.
 */
const words = defineMessages(
  {
    title: "Guess the author",
    lead: "The next seven days",
    refresh: "Refresh",
    status: { published: "Published", manual: "Chosen by hand", auto: "Automatic choice", restock: "Needs stock" } as Record<GameDayStatus, string>,
    texts: (count: number) => `${count} ${count === 1 ? "text" : "texts"}`,
    today: "today",
    candidates: (count: number) => `Candidates · ${count}`,
    goesOutAuto: "Goes out automatically",
    goesOutChosen: "Chosen for this day",
    wentOut: "Published",
    unavailable: "No longer available",
    openText: "Open text",
    ruleNote: "Without a choice, the first available text goes out at 00:00 Moscow time.",
    preview: "Preview",
    options: "Answer options",
    correct: "the right answer",
    replace: "Replace text",
    chooseFor: (date: string) => `Choose for ${date}`,
    chosen: "Chosen for this day",
    backToAuto: "Return to automatic choice",
    choiceCleared: "The chosen text was replaced. Choose the new one, or leave the automatic choice.",
    chooseNew: "Choose the new text",
    keepAuto: "Leave automatic",
    published: (answers: number, right: number) => `${answers} ${answers === 1 ? "answer" : "answers"} · ${right} right`,
    locked: "Published: the text and the order of the names no longer change.",
    restockNote: "The catalogue has no short text left for this day. Add short catalogue texts (two minutes or less, with a named author); the day fills itself.",
    failed: "Could not load the game calendar.",
    words: (count: number) => `${count} words`,
    choose: "Choose a date",
  },
  {
    ru: {
      title: "Угадай автора",
      lead: "Ближайшие 7 дней",
      refresh: "Обновить",
      status: { published: "Опубликован", manual: "Выбрано вручную", auto: "Автовыбор", restock: "Нужно пополнить" },
      texts: (count: number) => `${count} ${plural("ru", count, { one: "текст", few: "текста", many: "текстов", other: "текста" })}`,
      today: "сегодня",
      candidates: (count: number) => `Кандидаты · ${count}`,
      goesOutAuto: "Выйдет автоматически",
      goesOutChosen: "Выбрано на этот день",
      wentOut: "Опубликован",
      unavailable: "Больше недоступен",
      openText: "Открыть текст",
      ruleNote: "При отсутствии выбора в 00:00 по Москве выйдет первый доступный текст.",
      preview: "Предпросмотр",
      options: "Варианты ответа",
      correct: "правильный ответ",
      replace: "Заменить текст",
      chooseFor: (date: string) => `Выбрать на ${date}`,
      chosen: "Выбрано на этот день",
      backToAuto: "Вернуть автовыбор",
      choiceCleared: "Выбранный текст заменён. Выберите новый или оставьте автовыбор.",
      chooseNew: "Выбрать новый текст",
      keepAuto: "Оставить автовыбор",
      published: (answers: number, right: number) => `${answers} ${plural("ru", answers, { one: "ответ", few: "ответа", many: "ответов", other: "ответа" })} · верно ${right}`,
      locked: "Выпуск опубликован: текст и порядок имён больше не меняются.",
      restockNote: "В каталоге не осталось короткого текста на этот день. Добавьте короткие тексты каталога (до двух минут, с указанным автором), и день заполнится сам.",
      failed: "Не удалось загрузить календарь игры.",
      words: (count: number) => `${count} ${plural("ru", count, { one: "слово", few: "слова", many: "слов", other: "слова" })}`,
      choose: "Выберите дату",
    },
  },
);

export function AuthorGameStudio() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [days, setDays] = useState<GameDay[] | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [day, setDay] = useState<GameDay | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cleared, setCleared] = useState(false);

  const loadCalendar = useCallback(async (keep: string | null) => {
    setError("");
    try {
      const calendar = await loadGameCalendar(7);
      setDays(calendar.days);
      const next = keep ?? calendar.days.find((entry) => !entry.publishedAt)?.date ?? calendar.days[0]?.date ?? null;
      setDate(next);
    } catch (failure) {
      setError(readableBoksError(failure, t.failed));
    }
  }, [t.failed]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCalendar(null), 0);
    return () => window.clearTimeout(timer);
  }, [loadCalendar]);

  useEffect(() => {
    if (!date) return;
    let active = true;
    void loadGameDay(date).then((next) => {
      if (!active) return;
      setDay(next);
      setCleared(false);
      setPosition((current) => current && next.candidates.some((candidate) => candidate.position === current) ? current : gameDayLead(next));
    }, (failure) => active && setError(readableBoksError(failure, t.failed)));
    return () => { active = false; };
  }, [date, t.failed]);

  function adopt(next: GameDay) {
    setDay(next);
    setDays((current) => current?.map((entry) => entry.date === next.date ? { ...next, candidates: next.candidates.map((candidate) => ({ ...candidate, text: undefined })) } : entry) ?? null);
  }

  async function act(run: () => Promise<GameDay>) {
    setBusy(true);
    setError("");
    try {
      const next = await run();
      adopt(next);
      setCleared(Boolean(next.choiceCleared));
    } catch (failure) {
      setError(readableBoksError(failure, t.failed));
    } finally {
      setBusy(false);
    }
  }

  const selected = day?.candidates.find((candidate) => candidate.position === position) ?? null;
  const status = day ? gameDayStatus(day) : null;
  const lead = day ? gameDayLead(day) : null;
  const editable = Boolean(day && !day.publishedAt);
  const dayLabel = date ? calendarDate(date, language) : "";

  return <section className="game-studio" aria-label={t.title}>
    <div className="game-studio__calendar">
      <header><p>{t.lead}</p></header>
      {!days && !error && <p className="game-studio__muted" role="status">…</p>}
      {days?.map((entry) => {
        const entryStatus = gameDayStatus(entry);
        return <button key={entry.date} type="button" className={`game-studio__day${entry.date === date ? " is-selected" : ""} is-${entryStatus}`} aria-pressed={entry.date === date} onClick={() => setDate(entry.date)}>
          <strong>{calendarDate(entry.date, language)}{entry.today && <small>{t.today}</small>}</strong>
          <span>{t.status[entryStatus]}{entryStatus !== "published" && entryStatus !== "restock" && <small>{t.texts(entry.available)}</small>}</span>
          <ChevronRight aria-hidden="true" />
        </button>;
      })}
      <Button variant="outline" onClick={() => void loadCalendar(date)} disabled={busy}><RefreshCw className="size-4" /> {t.refresh}</Button>
    </div>

    <div className="game-studio__day-panel">
      {error && <p className="game-studio__error" role="alert">{error}</p>}
      {!day && !error && <p className="game-studio__muted">{days ? t.choose : ""}</p>}
      {day && <>
        <header className="game-studio__day-head">
          <h2>{dayLabel}</h2>
          <p>{t.candidates(day.candidates.length)}{status && <span className={`game-studio__badge is-${status}`}>{t.status[status]}</span>}</p>
        </header>
        {day.published && <p className="game-studio__locked">{t.locked} {t.published(day.published.answers, day.published.correctAnswers)}</p>}
        {status === "restock" && <p className="game-studio__error">{t.restockNote}</p>}
        <div className="game-studio__candidates">
          {day.candidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate}
            selected={candidate.position === position}
            tag={candidate.position === lead ? (day.publishedAt ? t.wentOut : status === "manual" ? t.goesOutChosen : t.goesOutAuto) : null}
            labels={{ openText: t.openText, unavailable: t.unavailable, words: t.words }}
            onOpen={() => setPosition(candidate.position)} />)}
        </div>
        {!day.publishedAt && <p className="game-studio__muted">{t.ruleNote}</p>}
        {cleared && editable && <div className="game-studio__notice" role="status">
          <p>{t.choiceCleared}</p>
          <div><Button onClick={() => position && void act(() => chooseGameCandidate(day.date, position))} disabled={busy}>{t.chooseNew}</Button><Button variant="outline" onClick={() => setCleared(false)}>{t.keepAuto}</Button></div>
        </div>}
      </>}
    </div>

    <div className="game-studio__preview">
      {day && selected && <CandidatePreview key={`${day.date}-${selected.id}`} candidate={selected} heading={t.preview} optionsLabel={t.options} correctLabel={t.correct} />}
      {day && selected && editable && <div className="game-studio__actions">
        <Button variant="outline" onClick={() => void act(() => replaceGameCandidate(day.date, selected.position))} disabled={busy}>{t.replace}</Button>
        {day.chosenPosition === selected.position && status === "manual"
          ? <><span className="game-studio__chosen"><Check aria-hidden="true" /> {t.chosen}</span><Button variant="outline" onClick={() => void act(() => chooseGameCandidate(day.date, null))} disabled={busy}>{t.backToAuto}</Button></>
          : <Button onClick={() => void act(() => chooseGameCandidate(day.date, selected.position))} disabled={busy || !selected.available}>{t.chooseFor(dayLabel)}</Button>}
      </div>}
    </div>
  </section>;
}

function CandidateCard({ candidate, selected, tag, labels, onOpen }: {
  candidate: GameCandidate;
  selected: boolean;
  tag: string | null;
  labels: { openText: string; unavailable: string; words: (count: number) => string };
  onOpen: () => void;
}) {
  return <button type="button" className={`game-studio__candidate${selected ? " is-selected" : ""}${candidate.available ? "" : " is-unavailable"}`} aria-pressed={selected} onClick={onOpen}>
    <span>
      <strong translate="no">{candidate.authorName ?? "—"}</strong>
      <em translate="no">{candidate.title ?? "—"}</em>
      {!candidate.available ? <small className="is-warning">{labels.unavailable}</small> : tag ? <small className="is-tag">{tag}</small> : candidate.words ? <small>{labels.words(candidate.words)}</small> : null}
    </span>
    <span className="game-studio__open">{labels.openText}<ChevronRight aria-hidden="true" /></span>
  </button>;
}

function CandidatePreview({ candidate, heading, optionsLabel, correctLabel }: {
  candidate: GameCandidate;
  heading: string;
  optionsLabel: string;
  correctLabel: string;
}) {
  const blocks = useMemo(() => formatReaderBody(candidate.text ?? ""), [candidate.text]);
  const labels = optionLabels(candidate.options);
  return <div className="game-studio__preview-body">
    <h3>{heading}</h3>
    <article className="game-studio__paper">
      <p className="daily-caps" translate="no">{candidate.authorName}</p>
      <div className={`story-copy${blocks[0]?.kind !== "verse" ? " story-copy--prose" : ""}`} lang="und" translate="no">
        {blocks.map((block, index) => <p key={index} className={block.kind === "verse" ? "story-verse" : ""}>{block.lines.join("\n")}</p>)}
      </div>
    </article>
    <h4>{optionsLabel}</h4>
    <ul className="game-studio__options">
      {labels.map((label, index) => <li key={index} className={index === candidate.correct ? "is-correct" : ""}>
        <i aria-hidden="true" /><span translate="no">{label}</span>
        {index === candidate.correct && <><Check aria-hidden="true" /><span className="sr-only">{correctLabel}</span></>}
      </li>)}
    </ul>
  </div>;
}
