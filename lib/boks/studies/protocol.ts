/**
 * The eight study protocols behind the thesis hypotheses: their keys, the
 * conditions the server assigns, and the names of the steps a participant's
 * answers are stored under.
 *
 * The condition lists mirror `public.boks_study_conditions` in the latest
 * migration that defines it; `studies.test.ts` reads it and holds the two to
 * the same lists. How each protocol runs is in
 * `docs/studies.md`.
 */

import type { UiLanguage } from "@/lib/i18n/ui-language";

export const studyKeys = ["rg1", "rg2", "a1", "a2", "a3", "b1", "b2", "b3"] as const;
export type StudyKey = (typeof studyKeys)[number];

/** A wording or sequence change must not silently pool earlier instruments. */
export const a1InstrumentVersion = "a1-post-reading-liking-v3";
export const a2InstrumentVersion = "a2-choice-ease-v2";

export function isStudyKey(value: unknown): value is StudyKey {
  return typeof value === "string" && (studyKeys as readonly string[]).includes(value);
}

export const studyConditions = {
  rg1: ["series", "text"],
  // Both interfaces for everyone; the condition is which comes first.
  rg2: ["feed_first", "catalogue_first"],
  a1: ["whole_first", "fragment_first"],
  // First session's interface and set; the second session gets the other of both.
  a2: ["inline_a", "inline_b", "cards_a", "cards_b"],
  // One protocol for everyone: the comparison is offline, with and without the profile.
  a3: ["profile"],
  b1: ["yoked"],
  // First block's mode and set; the second block gets the other of both.
  b2: ["music_a", "music_b", "silence_a", "silence_b"],
  b3: ["rater"],
} as const satisfies Record<StudyKey, readonly string[]>;

export type StudyCondition<K extends StudyKey = StudyKey> = (typeof studyConditions)[K][number];

/** Every `step` a response is stored under. */
export const studySteps = [
  // Before reading: which of these texts or authors the participant knows.
  "familiarity",
  // Scale questions after a text (rg1, a1, b1).
  "after_reading",
  // A choice from a showcase (retained for earlier A1 instruments).
  "choice",
  // Minutes in an interface: what was opened and read (rg2, a2, and b2's five-minute blocks).
  "session",
  // The questions after such a session or block.
  "session_survey",
  // b1: the active participant's gesture timings, replayed to a passive one.
  "trace",
  // b3: the two questions after a fragment.
  "fragment_rating",
  // a3: interest in a text, 1..5, asked on leaving it.
  "interest",
  // a3: the profile fixed after five ratings and both versions' order of the ten that follow.
  "ranking",
] as const;
export type StudyStep = (typeof studySteps)[number];

export type StudyDescription = {
  key: StudyKey;
  /** The hypothesis label in the presentation. */
  label: string;
  owner: "team" | "Andrey" | "Ivan";
  title: string;
  /** What is compared, in one line. */
  comparison: string;
  /** The primary outcome and the threshold the hypothesis states. */
  outcome: string;
  /** Who is compared to whom. */
  design: "between" | "within" | "rating";
};

export const studyDescriptions: Record<StudyKey, StudyDescription> = {
  rg1: {
    key: "rg1",
    label: "РГ1",
    owner: "team",
    title: "The value of Boks Series",
    comparison: "Series against the same text read plainly; format assigned at random, one piece per participant.",
    outcome: "Share answering 6 or 7 to both «Произведение меня тронуло» and «заставило задуматься», 1–7: at least +10 pp, 95% interval above 0.",
    design: "between",
  },
  rg2: {
    key: "rg2",
    label: "РГ2",
    owner: "team",
    title: "The value of the personal feed",
    comparison: "Each participant: ten minutes in the personal feed of full texts and ten in a catalogue with search and filters, order at random, different texts.",
    outcome: "Share satisfied with the session (6 or 7 to «Насколько вы довольны этим сеансом выбора и чтения?», 1–7): feed minus catalogue at least +10 pp, paired, 95% interval above 0.",
    design: "within",
  },
  a1: {
    key: "a1",
    label: "А1",
    owner: "Andrey",
    title: "A whole work or a fragment",
    comparison: "Four texts from two matched pairs: two whole works and two coherent excerpts. Rates liking after each; order is counterbalanced. Closure and context questions come after all four ratings.",
    outcome: "Share of liking ratings at 6 or 7 out of 7: whole works minus excerpts at least +15 pp, paired by participant, 95% interval above 0.",
    design: "within",
  },
  a2: {
    key: "a2",
    label: "А2",
    owner: "Andrey",
    title: "Choosing from cards or full texts",
    comparison: "Two ten-minute sessions: illustrated cards opening a reading screen, and full texts in the feed. Interface order and two comparable text sets are counterbalanced.",
    outcome: "Chose a text and rated ease of choosing 6 or 7 out of 7: cards minus full texts at least +10 pp, paired, 95% interval above 0.",
    design: "within",
  },
  a3: {
    key: "a3",
    label: "А3",
    owner: "Andrey",
    title: "Recommendations from five boks",
    comparison: "The same algorithm orders the same ten new texts offline, with a profile from the first five rated boks and without it.",
    outcome: "Precision@5, the share of texts rated 4–5 of 5 in the top five: at least +10 pp on average, 95% interval above 0. NDCG@5 as a secondary measure.",
    design: "within",
  },
  b1: {
    key: "b1",
    label: "Б1",
    owner: "Ivan",
    title: "Immersion from two actions",
    comparison: "Series with the reader's two interactive actions against automatic playback repeating a recorded session's effects and pauses at the same moments.",
    outcome: "Share answering 6 or 7 to «Насколько сильно вы были погружены в произведение?», 1–7: at least +10 pp, 95% interval above 0.",
    design: "within",
  },
  b2: {
    key: "b2",
    label: "Б2",
    owner: "Ivan",
    title: "Music and the enjoyment of reading",
    comparison: "Each participant reads two comparable sets of plain texts, five minutes with the quiet boks reading music and five in silence; order and sets at random.",
    outcome: "Share answering 6 or 7 to «Насколько вам понравился сам процесс чтения?», 1–7: music minus silence at least +10 pp, paired, 95% interval above 0.",
    design: "within",
  },
  b3: {
    key: "b3",
    label: "Б3",
    owner: "Ivan",
    title: "Fragments that stand on their own",
    comparison: "Fragments cut by the algorithm (and same-length windows, blind), each rated by three readers.",
    outcome: "At least 80% of algorithm fragments with «yes» to both questions from two of three readers, and at least +10 pp over random windows of the same length.",
    design: "rating",
  },
};

/** The admin's Russian for each study; labels, keys and the quoted participant questions stay. */
const russianDescriptions: Record<StudyKey, Pick<StudyDescription, "title" | "comparison" | "outcome">> = {
  rg1: {
    title: "Ценность Boks Series",
    comparison: "Series против того же текста простым чтением; формат назначается случайно, одно произведение на участника.",
    outcome: "Доля ответивших 6 или 7 на оба вопроса «Произведение меня тронуло» и «заставило задуматься», 1–7: не меньше +10 п. п., 95% интервал выше 0.",
  },
  rg2: {
    title: "Ценность персональной ленты",
    comparison: "Каждый участник: десять минут в персональной ленте полных текстов и десять в каталоге с поиском и фильтрами, порядок случайный, тексты разные.",
    outcome: "Доля довольных сессией (6 или 7 на «Насколько вы довольны этим сеансом выбора и чтения?», 1–7): лента минус каталог не меньше +10 п. п., парно, 95% интервал выше 0.",
  },
  a1: {
    title: "Целое произведение или фрагмент",
    comparison: "Четыре текста из двух сопоставимых пар: два целых произведения и два связных фрагмента. После каждого - оценка впечатления; порядок чередуем. Завершённость и понятность спрашиваем после всех четырёх оценок.",
    outcome: "Доля оценок 6 или 7 из 7 на вопрос «Насколько вам понравился этот текст?»: целые минус фрагменты не меньше +15 п. п., парно по участникам, 95% интервал выше 0.",
  },
  a2: {
    title: "Выбор по карточкам или полным текстам",
    comparison: "Две сессии по десять минут: карточки с иллюстрациями и переходом к чтению против полных текстов в ленте. Порядок режимов и два сопоставимых набора текстов чередуем между участниками.",
    outcome: "Выбрали текст и оценили лёгкость выбора на 6 или 7 из 7: карточки минус полные тексты не меньше +10 п. п., парно, 95% интервал выше 0.",
  },
  a3: {
    title: "Рекомендации по пяти бокам",
    comparison: "Один и тот же алгоритм офлайн упорядочивает те же десять новых текстов: с профилем по первым пяти оценённым бокам и без него.",
    outcome: "Precision@5 — доля текстов с интересом 4–5 из 5 в первой пятёрке: в среднем не меньше +10 п. п., 95% интервал выше 0. NDCG@5 — дополнительно.",
  },
  b1: {
    title: "Погружение от двух действий",
    comparison: "Series с двумя интерактивными действиями читателя против автоматического воспроизведения, которое повторяет эффекты и паузы записанного сеанса в те же моменты.",
    outcome: "Доля ответивших 6 или 7 на «Насколько сильно вы были погружены в произведение?», 1–7: не меньше +10 п. п., 95% интервал выше 0.",
  },
  b2: {
    title: "Музыка и удовольствие от чтения",
    comparison: "Каждый участник читает два сопоставимых набора обычных текстов: пять минут с тихой фоновой музыкой boks и пять в тишине; порядок и наборы случайные.",
    outcome: "Доля ответивших 6 или 7 на «Насколько вам понравился сам процесс чтения?», 1–7: музыка минус тишина не меньше +10 п. п., парно, 95% интервал выше 0.",
  },
  b3: {
    title: "Фрагменты, которые держатся сами",
    comparison: "Фрагменты, нарезанные алгоритмом (и окна той же длины, вслепую), каждый оценивают три читателя.",
    outcome: "Не меньше 80% фрагментов алгоритма с «да» на оба вопроса от двух из трёх читателей и не меньше +10 п. п. к случайным отрывкам той же длины.",
  },
};

/** A study's description in the interface's language; `studyDescriptions` is the English. */
export function studyDescription(key: StudyKey, language: UiLanguage = "en"): StudyDescription {
  const english = studyDescriptions[key];
  return language === "ru" ? { ...english, ...russianDescriptions[key] } : english;
}

/** The study page's address. Plain, so a printed QR code stays short. */
export function studyPath(key: StudyKey) {
  return `/study/${key}`;
}
