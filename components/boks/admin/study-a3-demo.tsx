"use client";

import { useEffect, useMemo, useState } from "react";
import type { Story } from "@/components/boks/client-types";
import { loadStudyA3Candidates } from "@/components/boks/supabase-browser-data";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { galleryProfileIds, galleryTargetIds } from "@/components/boks/studies/study-gallery-examples";
import { rankA3, type A3Candidate } from "@/lib/boks/studies/a3";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages({
  eyebrow: "A3 · how the comparison works",
  title: "One pool. Two recommendation orders.",
  note: "Demonstration ratings, not study results. The production ranker computes both lists from one snapshot; changing a rating changes only the profile. Nothing is saved.",
  profile: "1. Five ratings form the profile",
  pool: "2. The same ten new texts for both versions",
  without: "Without a reader profile",
  with: "With the five-rating profile",
  withoutBody: "The algorithm's existing signals, without personal taste.",
  withBody: "The same algorithm and signals, plus semantic similarity to the profile.",
  test: "3. An independent check",
  testBody: "The participant rates all ten texts one at a time, in random order. Neither predicted list is shown. Count texts rated 4 or 5 in each top five; compare the shares within each participant.",
  measure: "Primary: Precision@5. Target: +10 percentage points on average; the 95% paired interval must be above zero. NDCG@5 is secondary.",
  loading: "Loading the catalogue's semantic vectors…",
  failed: "The comparison could not be loaded. Reload to try again.",
  missing: "The demonstration needs a semantic vector for every one of its fifteen texts. No synthetic ranking is substituted.",
  noProfile: "These ratings have no direction. Both versions use the same order.",
  rating: (title: string, value: number) => `${title}: ${value} of 5`,
  top: "First five recommendations",
}, { ru: {
  eyebrow: "А3 · как устроено сравнение",
  title: "Один набор. Два порядка рекомендаций.",
  note: "Оценки для демонстрации, не результаты исследования. Рабочий алгоритм строит оба списка по одному снимку данных; при смене оценки меняется только профиль. Ответы не сохраняются.",
  profile: "1. Пять оценок формируют профиль",
  pool: "2. Те же десять новых текстов для обоих вариантов",
  without: "Без профиля читателя",
  with: "С профилем по пяти оценкам",
  withoutBody: "Обычные сигналы алгоритма без личных предпочтений.",
  withBody: "Тот же алгоритм и сигналы, плюс смысловая близость к профилю.",
  test: "3. Независимая проверка",
  testBody: "Участник оценивает все десять текстов по одному, в случайном порядке. Оба предсказанных списка скрыты. Считаем тексты с оценкой 4 или 5 в каждой первой пятёрке и сравниваем доли у одного участника.",
  measure: "Основная метрика: Precision@5. Цель: в среднем +10 п.п., нижняя граница 95% парного интервала выше нуля. NDCG@5 считаем дополнительно.",
  loading: "Загружаем смысловые векторы произведений…",
  failed: "Не удалось загрузить сравнение. Обновите страницу, чтобы повторить.",
  missing: "Для демонстрации нужны смысловые векторы всех пятнадцати текстов. Выдуманный порядок вместо них не показываем.",
  noProfile: "В этих оценках нет направления предпочтений. Оба варианта дают один порядок.",
  rating: (title, value) => `${title}: ${value} из 5`,
  top: "Первые пять рекомендаций",
} });

/** Admin-only, read-only demonstration using the exact rankA3 used by the study. */
export function StudyA3Demo({ stories, language }: { stories: Map<string, Story>; language: "ru" | "en" }) {
  const t = messages[language];
  const [candidates, setCandidates] = useState<A3Candidate[] | null>(null);
  const [error, setError] = useState(false);
  const [ratings, setRatings] = useState([5, 1, 4, 5, 2]);
  const [now] = useState(() => new Date());
  useEffect(() => {
    let cancelled = false;
    loadStudyA3Candidates(null, [...galleryProfileIds, ...galleryTargetIds]).then(
      (rows) => { if (!cancelled) setCandidates(rows); },
      () => { if (!cancelled) setError(true); },
    );
    return () => { cancelled = true; };
  }, []);
  const complete = candidates?.length === 15 && candidates.every((entry) => entry.embedding?.length);
  const ranking = useMemo(() => complete && candidates ? rankA3({
    participantId: "study-gallery-a3-example", candidates, targets: galleryTargetIds, now,
    profile: galleryProfileIds.map((bokId, index) => ({ bokId, interest: ratings[index] })),
  }) : null, [candidates, complete, now, ratings]);

  const list = (ids: string[]) => <ol className="study-a3-demo__ranking">
    {ids.slice(0, 5).map((id) => {
      const story = stories.get(id);
      const art = getBokArtwork({ id });
      return <li key={id}>{art && <img src={art} alt="" />}<span><strong>{story?.title}</strong><small>{story?.authorName}</small></span></li>;
    })}
  </ol>;
  return <section className="study-a3-demo" data-study-demo="a3">
    <header><p className="study-a3-demo__eyebrow">{t.eyebrow}</p><h3>{t.title}</h3><p>{t.note}</p></header>
    <section className="study-a3-demo__profile"><h4>{t.profile}</h4><div className="study-a3-demo__ratings">
      {galleryProfileIds.map((id, index) => {
        const story = stories.get(id);
        return <div key={id}><img src={getBokArtwork({ id }) ?? undefined} alt="" /><strong>{story?.title}</strong>
          <div role="group" aria-label={story?.title}>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={t.rating(story?.title ?? "", value)} aria-pressed={ratings[index] === value}
            onClick={() => setRatings((current) => current.map((old, at) => at === index ? value : old))}>{value}</button>)}</div>
        </div>;
      })}
    </div></section>
    <section><h4>{t.pool}</h4><div className="study-a3-demo__pool">{galleryTargetIds.map((id) => <span key={id}>{stories.get(id)?.title}</span>)}</div></section>
    {error ? <p role="alert">{t.failed}</p> : !candidates ? <p role="status">{t.loading}</p> : !ranking ? <p role="alert">{t.missing}</p> : <>
      {!ranking.hasProfile && <p>{t.noProfile}</p>}
      <div className="study-a3-demo__columns">
        <section data-study-ranking="without"><h4>{t.without}</h4><p>{t.withoutBody}</p><small>{t.top}</small>{list(ranking.withoutProfile)}</section>
        <section data-study-ranking="with"><h4>{t.with}</h4><p>{t.withBody}</p><small>{t.top}</small>{list(ranking.withProfile)}</section>
      </div>
    </>}
    <footer><h4>{t.test}</h4><p>{t.testBody}</p><p>{t.measure}</p></footer>
  </section>;
}
