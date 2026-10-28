import type { StudyKey } from "@/lib/boks/studies/protocol";
import { defineMessages } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * What each protocol is given to read: bok ids, chosen by the team in Studio.
 *
 * Stored as JSON in `boks_studies.materials`; the database checks only that it
 * is an object. The rules a protocol needs to run are here, so the Studio
 * editor refuses materials the participant page could not use, and the
 * participant page reads them through the same parser.
 */

export type Rg1Materials = {
  /** Shown first, in both formats, so neither is new at the test. */
  familiarization: string;
  /** Series pieces; each participant gets one, in their assigned format. */
  targets: string[];
};

export type Rg2Materials = {
  /** Each session's length; every participant has two. */
  minutes: number;
  /** Texts per session. Twice as many are drawn from the participant's own feed and split between the two. */
  poolSize: number;
};

export type A1Materials = {
  /** A complete short work and a fragment of large prose of similar length, theme and difficulty. */
  pairs: { whole: string; fragment: string }[];
  /** New texts offered for the free choice, without saying which kind each is. */
  choices: { bokId: string; kind: "whole" | "fragment" }[];
};

export type A2Materials = {
  minutes: number;
  /** Two comparable sets; each participant reads one per interface. */
  setA: string[];
  setB: string[];
};

export type A3Materials = {
  /**
   * The test pool: texts the ten after the profile are drawn from. None is
   * served while the profile forms, and texts by the authors of the profile's
   * five are left out, so the ten are new and by other authors.
   */
  targets: string[];
  /** Rated boks that make the profile. The hypothesis says five. */
  profileSize: number;
  /** New texts rated after the profile is fixed. The hypothesis says ten. */
  perParticipant: number;
  /** How many texts of the participant's own feed the profile is formed from. */
  feedPoolSize: number;
};

export type B1Materials = {
  /** Immersive poems with gesture scenes. */
  pieces: string[];
  perParticipant: number;
};

export type B2Materials = {
  /** Each block's length; every participant has one with music and one in silence. */
  minutes: number;
  /** Two comparable sets of plain texts, unfamiliar, of similar genre and length; one per block. */
  setA: string[];
  setB: string[];
};

export type B3Materials = {
  /** The fragment batch to rate; empty rates every imported fragment. */
  batch: string;
};

export type StudyMaterials = {
  rg1: Rg1Materials;
  rg2: Rg2Materials;
  a1: A1Materials;
  a2: A2Materials;
  a3: A3Materials;
  b1: B1Materials;
  b2: B2Materials;
  b3: B3Materials;
};

export type ParsedMaterials<K extends StudyKey> =
  | { ok: true; materials: StudyMaterials[K]; problems: [] }
  | { ok: false; materials: null; problems: string[] };

/** What a new study's editor starts from: the shape, with nothing chosen. */
export const materialTemplates: { [K in StudyKey]: StudyMaterials[K] } = {
  rg1: { familiarization: "", targets: [] },
  rg2: { minutes: 10, poolSize: 30 },
  a1: { pairs: [], choices: [] },
  a2: { minutes: 10, setA: [], setB: [] },
  a3: { targets: [], profileSize: 5, perParticipant: 10, feedPoolSize: 40 },
  b1: { pieces: [], perParticipant: 2 },
  b2: { minutes: 5, setA: [], setB: [] },
  b3: { batch: "" },
};

/** The editor's problems, in the interface's language; field paths are JSON and stay as they are. */
const problemWords = defineMessages({
  object: (path: string) => `${path} must be an object.`,
  bokId: (path: string) => `${path} must be a bok id.`,
  repeats: (path: string) => `${path} repeats a bok.`,
  text: (path: string) => `${path} must be text.`,
  number: (path: string, min: number, max: number) => `${path} must be a number from ${min} to ${max}.`,
  list: (path: string) => `${path} must be a list.`,
  atLeast: (path: string, minimum: number) => `${path} needs at least ${minimum}.`,
  familiarizationTarget: "The familiarization piece cannot also be a target.",
  choiceKind: (index: number) => `choices[${index}].kind must be "whole" or "fragment".`,
  twoOfEach: "choices needs at least two of each kind.",
  choiceUsed: "A choice must be a text the pairs do not use.",
  setsShare: "setA and setB must not share a bok.",
  setsSize: "setA and setB should be the same size.",
  perParticipant: "perParticipant is larger than the number of pieces.",
  batch: "batch is lower-case letters, digits, - and _.",
}, {
  ru: {
    object: (path) => `${path} должен быть объектом.`,
    bokId: (path) => `${path} должен быть id бока.`,
    repeats: (path) => `${path}: бок повторяется.`,
    text: (path) => `${path} должен быть текстом.`,
    number: (path, min, max) => `${path} должен быть числом от ${min} до ${max}.`,
    list: (path) => `${path} должен быть списком.`,
    atLeast: (path, minimum) => `${path}: нужно не меньше ${minimum}.`,
    familiarizationTarget: "Произведение для знакомства не может быть ещё и целевым.",
    choiceKind: (index) => `choices[${index}].kind должен быть "whole" или "fragment".`,
    twoOfEach: "В choices нужно не меньше двух каждого вида.",
    choiceUsed: "Текст для выбора не должен использоваться в pairs.",
    setsShare: "У setA и setB не должно быть общих боков.",
    setsSize: "setA и setB должны быть одного размера.",
    perParticipant: "perParticipant больше числа произведений.",
    batch: "batch: только строчные латинские буквы, цифры, - и _.",
  },
});

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reader = {
  problems: string[];
  t: (typeof problemWords)["en"];
  object(value: unknown, path: string): Record<string, unknown>;
  id(value: unknown, path: string): string;
  ids(value: unknown, path: string, minimum: number): string[];
  text(value: unknown, path: string): string;
  number(value: unknown, path: string, min: number, max: number, fallback: number): number;
  list(value: unknown, path: string, minimum: number): unknown[];
};

function reader(t: Reader["t"]): Reader {
  const problems: string[] = [];
  return {
    problems,
    t,
    object(value, path) {
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
      problems.push(t.object(path));
      return {};
    },
    id(value, path) {
      const id = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (!uuidPattern.test(id)) problems.push(t.bokId(path));
      return id;
    },
    ids(value, path, minimum) {
      const list = this.list(value, path, minimum);
      const ids = list.map((item, index) => this.id(item, `${path}[${index}]`));
      if (new Set(ids).size !== ids.length) problems.push(t.repeats(path));
      return ids;
    },
    text(value, path) {
      if (typeof value === "string") return value.trim();
      if (value !== undefined) problems.push(t.text(path));
      return "";
    },
    number(value, path, min, max, fallback) {
      if (value === undefined) return fallback;
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        problems.push(t.number(path, min, max));
        return fallback;
      }
      return value;
    },
    list(value, path, minimum) {
      if (!Array.isArray(value)) {
        problems.push(t.list(path));
        return [];
      }
      if (value.length < minimum) problems.push(t.atLeast(path, minimum));
      return value;
    },
  };
}

const parsers: { [K in StudyKey]: (raw: Record<string, unknown>, read: Reader) => StudyMaterials[K] } = {
  rg1(raw, read) {
    const familiarization = read.id(raw.familiarization, "familiarization");
    const targets = read.ids(raw.targets, "targets", 1);
    if (targets.includes(familiarization)) read.problems.push(read.t.familiarizationTarget);
    return { familiarization, targets };
  },
  rg2(raw, read) {
    return {
      minutes: read.number(raw.minutes, "minutes", 1, 30, 10),
      poolSize: read.number(raw.poolSize, "poolSize", 10, 60, 30),
    };
  },
  a1(raw, read) {
    const pairs = read.list(raw.pairs, "pairs", 4).map((pair, index) => {
      const item = read.object(pair, `pairs[${index}]`);
      return { whole: read.id(item.whole, `pairs[${index}].whole`), fragment: read.id(item.fragment, `pairs[${index}].fragment`) };
    });
    const choices = read.list(raw.choices, "choices", 4).map((choice, index) => {
      const item = read.object(choice, `choices[${index}]`);
      const kind: "whole" | "fragment" | null = item.kind === "whole" || item.kind === "fragment" ? item.kind : null;
      if (!kind) read.problems.push(read.t.choiceKind(index));
      return { bokId: read.id(item.bokId, `choices[${index}].bokId`), kind: kind ?? "whole" };
    });
    if (choices.filter((choice) => choice.kind === "whole").length < 2 || choices.filter((choice) => choice.kind === "fragment").length < 2) {
      read.problems.push(read.t.twoOfEach);
    }
    const read_ = new Set(pairs.flatMap((pair) => [pair.whole, pair.fragment]));
    if (choices.some((choice) => read_.has(choice.bokId))) read.problems.push(read.t.choiceUsed);
    return { pairs, choices };
  },
  a2(raw, read) {
    const setA = read.ids(raw.setA, "setA", 3);
    const setB = read.ids(raw.setB, "setB", 3);
    if (setA.some((id) => setB.includes(id))) read.problems.push(read.t.setsShare);
    if (setA.length !== setB.length) read.problems.push(read.t.setsSize);
    return { minutes: read.number(raw.minutes, "minutes", 1, 30, 10), setA, setB };
  },
  a3(raw, read) {
    const profileSize = read.number(raw.profileSize, "profileSize", 3, 10, 5);
    const perParticipant = read.number(raw.perParticipant, "perParticipant", 5, 20, 10);
    // Room for the authors of the profile's five to be left out.
    const targets = read.ids(raw.targets, "targets", perParticipant + profileSize);
    return { targets, profileSize, perParticipant, feedPoolSize: read.number(raw.feedPoolSize, "feedPoolSize", 10, 80, 40) };
  },
  b1(raw, read) {
    const pieces = read.ids(raw.pieces, "pieces", 1);
    const perParticipant = read.number(raw.perParticipant, "perParticipant", 1, 6, 2);
    if (pieces.length && perParticipant > pieces.length) read.problems.push(read.t.perParticipant);
    return { pieces, perParticipant };
  },
  b2(raw, read) {
    const setA = read.ids(raw.setA, "setA", 3);
    const setB = read.ids(raw.setB, "setB", 3);
    if (setA.some((id) => setB.includes(id))) read.problems.push(read.t.setsShare);
    if (setA.length !== setB.length) read.problems.push(read.t.setsSize);
    return { minutes: read.number(raw.minutes, "minutes", 1, 15, 5), setA, setB };
  },
  b3(raw, read) {
    const batch = read.text(raw.batch, "batch").toLowerCase();
    if (batch && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(batch)) read.problems.push(read.t.batch);
    return { batch };
  },
};

export function parseStudyMaterials<K extends StudyKey>(key: K, raw: unknown, language: UiLanguage = "en"): ParsedMaterials<K> {
  const read = reader(problemWords[language]);
  const materials = parsers[key](read.object(raw, "materials"), read) as StudyMaterials[K];
  if (read.problems.length) return { ok: false, materials: null, problems: read.problems };
  return { ok: true, materials, problems: [] };
}

/** Every bok id the materials name, to look titles up and to check they are published. */
export function materialBokIds(key: StudyKey, raw: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string" && uuidPattern.test(value.trim())) ids.add(value.trim().toLowerCase());
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  if (key !== "b3") visit(raw);
  return [...ids];
}

/** The ids a protocol plays as Series; each must be a poem or a finished cinema piece. */
export function seriesBokIds(key: StudyKey, raw: unknown): string[] {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
  if (key === "rg1") return [...(typeof value.familiarization === "string" ? [value.familiarization] : []), ...ids(value.targets)];
  if (key === "b1") return ids(value.pieces);
  return [];
}
