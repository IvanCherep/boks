/**
 * The seven study protocols behind the thesis hypotheses: their keys, the
 * conditions the server assigns, and the names of the steps a participant's
 * answers are stored under.
 *
 * The condition lists mirror `public.boks_study_conditions` in
 * `20261026100000_boks_studies.sql`; `protocol.test.ts` reads the migration and
 * holds the two to the same lists. How each protocol runs is in
 * `docs/studies.md`.
 */

export const studyKeys = ["rg1", "rg2", "a1", "a2", "b1", "b2", "b3"] as const;
export type StudyKey = (typeof studyKeys)[number];

export function isStudyKey(value: unknown): value is StudyKey {
  return typeof value === "string" && (studyKeys as readonly string[]).includes(value);
}

export const studyConditions = {
  rg1: ["series", "text"],
  rg2: ["feed", "catalogue"],
  a1: ["whole_first", "fragment_first"],
  // First session's interface and set; the second session gets the other of both.
  a2: ["inline_a", "inline_b", "cards_a", "cards_b"],
  b1: ["yoked"],
  b2: ["series", "text"],
  b3: ["rater"],
} as const satisfies Record<StudyKey, readonly string[]>;

export type StudyCondition<K extends StudyKey = StudyKey> = (typeof studyConditions)[K][number];

/** Every `step` a response is stored under. */
export const studySteps = [
  // Before reading: which of these texts or authors the participant knows.
  "familiarity",
  // Two scale questions after a text (rg1, a1, b1).
  "after_reading",
  // The next text chosen from a showcase, or none (a1, b2).
  "choice",
  // Ten minutes in an interface: what was opened and read (rg2, a2).
  "session",
  // The questions after such a session.
  "session_survey",
  // b1: the active participant's gesture timings, replayed to a passive one.
  "trace",
  // b3: the two questions after a fragment.
  "fragment_rating",
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
    outcome: "«Произведение меня тронуло» and «заставило задуматься», 1–7: both at least +0.5.",
    design: "between",
  },
  rg2: {
    key: "rg2",
    label: "РГ2",
    owner: "team",
    title: "The value of the personal feed",
    comparison: "The personal feed against a catalogue of the same texts with search and filters; ten minutes.",
    outcome: "Successful session: a new text read within 10 minutes and the choice rated 4–5/5. At least +15 pp.",
    design: "between",
  },
  a1: {
    key: "a1",
    label: "А1",
    owner: "Andrey",
    title: "A whole work or a fragment",
    comparison: "Each participant reads both kinds, order at random; then chooses freely among new texts of both kinds, or none.",
    outcome: "Share choosing a whole work minus share choosing a fragment, among everyone: at least +15 pp.",
    design: "within",
  },
  a2: {
    key: "a2",
    label: "А2",
    owner: "Andrey",
    title: "Reading straight in the feed",
    comparison: "Text in the feed against a card with a separate reading screen; the same texts in the same order.",
    outcome: "Ten-minute sessions with a successful find: at least +10 pp, paired by participant.",
    design: "within",
  },
  b1: {
    key: "b1",
    label: "Б1",
    owner: "Ivan",
    title: "What interaction adds",
    comparison: "An active Series scene against a passive one replaying the same events at the same moments.",
    outcome: "Mean emotional intensity of two questions, 1–7: at least +0.5.",
    design: "within",
  },
  b2: {
    key: "b2",
    label: "Б2",
    owner: "Ivan",
    title: "Series as a way into an author",
    comparison: "A first meeting with an unknown author through Series or through the plain text of the same piece.",
    outcome: "Share choosing and starting another plain text by the same author: at least +15 pp.",
    design: "between",
  },
  b3: {
    key: "b3",
    label: "Б3",
    owner: "Ivan",
    title: "Fragments that stand on their own",
    comparison: "Fragments cut by the algorithm (and same-length windows, blind), each rated by three readers.",
    outcome: "At least 80 of 100 algorithm fragments with «yes» to both questions from two of three readers.",
    design: "rating",
  },
};

/** The study page's address. Plain, so a printed QR code stays short. */
export function studyPath(key: StudyKey) {
  return `/study/${key}`;
}
