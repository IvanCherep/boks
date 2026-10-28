import type { StudyKey } from "@/lib/boks/studies/protocol";

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
  pieces: {
    /** The Series piece the author is met through. */
    series: string;
    author: string;
    /** Other plain texts by the same author for the showcase. */
    sameAuthor: string[];
    /** Plain texts by other authors for the showcase. */
    others: string[];
  }[];
  /** Authors listed beside the real ones in the screening question. */
  distractorAuthors: string[];
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
  b2: { pieces: [], distractorAuthors: [] },
  b3: { batch: "" },
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reader = {
  problems: string[];
  object(value: unknown, path: string): Record<string, unknown>;
  id(value: unknown, path: string): string;
  ids(value: unknown, path: string, minimum: number): string[];
  text(value: unknown, path: string): string;
  number(value: unknown, path: string, min: number, max: number, fallback: number): number;
  list(value: unknown, path: string, minimum: number): unknown[];
};

function reader(): Reader {
  const problems: string[] = [];
  return {
    problems,
    object(value, path) {
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
      problems.push(`${path} must be an object.`);
      return {};
    },
    id(value, path) {
      const id = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (!uuidPattern.test(id)) problems.push(`${path} must be a bok id.`);
      return id;
    },
    ids(value, path, minimum) {
      const list = this.list(value, path, minimum);
      const ids = list.map((item, index) => this.id(item, `${path}[${index}]`));
      if (new Set(ids).size !== ids.length) problems.push(`${path} repeats a bok.`);
      return ids;
    },
    text(value, path) {
      if (typeof value === "string") return value.trim();
      if (value !== undefined) problems.push(`${path} must be text.`);
      return "";
    },
    number(value, path, min, max, fallback) {
      if (value === undefined) return fallback;
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        problems.push(`${path} must be a number from ${min} to ${max}.`);
        return fallback;
      }
      return value;
    },
    list(value, path, minimum) {
      if (!Array.isArray(value)) {
        problems.push(`${path} must be a list.`);
        return [];
      }
      if (value.length < minimum) problems.push(`${path} needs at least ${minimum}.`);
      return value;
    },
  };
}

const parsers: { [K in StudyKey]: (raw: Record<string, unknown>, read: Reader) => StudyMaterials[K] } = {
  rg1(raw, read) {
    const familiarization = read.id(raw.familiarization, "familiarization");
    const targets = read.ids(raw.targets, "targets", 1);
    if (targets.includes(familiarization)) read.problems.push("The familiarization piece cannot also be a target.");
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
      if (!kind) read.problems.push(`choices[${index}].kind must be "whole" or "fragment".`);
      return { bokId: read.id(item.bokId, `choices[${index}].bokId`), kind: kind ?? "whole" };
    });
    if (choices.filter((choice) => choice.kind === "whole").length < 2 || choices.filter((choice) => choice.kind === "fragment").length < 2) {
      read.problems.push("choices needs at least two of each kind.");
    }
    const read_ = new Set(pairs.flatMap((pair) => [pair.whole, pair.fragment]));
    if (choices.some((choice) => read_.has(choice.bokId))) read.problems.push("A choice must be a text the pairs do not use.");
    return { pairs, choices };
  },
  a2(raw, read) {
    const setA = read.ids(raw.setA, "setA", 3);
    const setB = read.ids(raw.setB, "setB", 3);
    if (setA.some((id) => setB.includes(id))) read.problems.push("setA and setB must not share a bok.");
    if (setA.length !== setB.length) read.problems.push("setA and setB should be the same size.");
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
    if (pieces.length && perParticipant > pieces.length) read.problems.push("perParticipant is larger than the number of pieces.");
    return { pieces, perParticipant };
  },
  b2(raw, read) {
    const pieces = read.list(raw.pieces, "pieces", 1).map((piece, index) => {
      const item = read.object(piece, `pieces[${index}]`);
      const author = read.text(item.author, `pieces[${index}].author`);
      if (!author) read.problems.push(`pieces[${index}].author is needed for the screening question.`);
      return {
        series: read.id(item.series, `pieces[${index}].series`),
        author,
        sameAuthor: read.ids(item.sameAuthor, `pieces[${index}].sameAuthor`, 1),
        others: read.ids(item.others, `pieces[${index}].others`, 2),
      };
    });
    const distractorAuthors = read.list(raw.distractorAuthors ?? [], "distractorAuthors", 0)
      .map((name, index) => read.text(name, `distractorAuthors[${index}]`))
      .filter(Boolean);
    return { pieces, distractorAuthors };
  },
  b3(raw, read) {
    const batch = read.text(raw.batch, "batch").toLowerCase();
    if (batch && !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(batch)) read.problems.push("batch is lower-case letters, digits, - and _.");
    return { batch };
  },
};

export function parseStudyMaterials<K extends StudyKey>(key: K, raw: unknown): ParsedMaterials<K> {
  const read = reader();
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
  if (key === "b2") {
    return (Array.isArray(value.pieces) ? value.pieces : [])
      .map((piece) => (piece && typeof piece === "object" ? (piece as Record<string, unknown>).series : null))
      .filter((id): id is string => typeof id === "string");
  }
  return [];
}
