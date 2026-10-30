import { createRandom, shuffle } from "@/lib/recsys/statistics/random";
import type {
  A1Materials,
  A2Materials,
  B1Materials,
  B2Materials,
  Rg1Materials,
} from "@/lib/boks/studies/materials";

/**
 * A participant's plan: which texts, in which order, in which format.
 *
 * The server assigns the condition and a seed; everything random after that
 * is drawn here from the seed, so the plan is the same on a reload and can be
 * rebuilt in the analysis from the seed and the materials of the day. Nothing
 * here touches the network or the clock.
 */

export type StudyFormat = "series" | "text";

export type Rg1Plan = {
  /** The familiarization piece in both formats, in this order. */
  familiarization: { bokId: string; formats: StudyFormat[] };
  target: { bokId: string; format: StudyFormat };
};

export function planRg1(materials: Rg1Materials, condition: string, seed: number): Rg1Plan {
  const next = createRandom(seed);
  const formats: StudyFormat[] = next() < 0.5 ? ["series", "text"] : ["text", "series"];
  const target = materials.targets[Math.floor(next() * materials.targets.length)];
  return {
    familiarization: { bokId: materials.familiarization, formats },
    target: { bokId: target, format: condition === "series" ? "series" : "text" },
  };
}

export type A1Plan = {
  reads: { bokId: string; kind: "whole" | "fragment"; pair: number }[];
};

/**
 * Two randomly drawn matched pairs, both members of each read once. ABBA or
 * BAAB balances each kind over early and late positions; the condition names
 * the first kind. The seed fixes both the pairs and their order on a reload.
 */
export function planA1(materials: A1Materials, condition: string, seed: number): A1Plan {
  const next = createRandom(seed);
  const pairs = shuffle(materials.pairs.map((texts, pair) => ({ ...texts, pair })), next).slice(0, 2);
  const kinds = condition === "fragment_first"
    ? ["fragment", "whole", "whole", "fragment"] as const
    : ["whole", "fragment", "fragment", "whole"] as const;
  return {
    reads: kinds.map((kind, index) => {
      const pair = pairs[Math.floor(index / 2)];
      return { bokId: pair[kind], kind, pair: pair.pair };
    }),
  };
}

export type Rg2Plan = {
  /** Both sessions, in the order the condition names; the texts of one are never in the other. */
  sessions: { interface: "feed" | "catalogue"; bokIds: string[] }[];
};

/**
 * rg2 splits the participant's own served slate between the two sessions by
 * alternating ranks, so each half is as personal as the other, and the seed
 * says which half the feed gets. The feed shows its half in ranked order; the
 * catalogue lists its half alphabetically.
 */
export function planRg2(slate: readonly string[], condition: string, seed: number, perSession: number): Rg2Plan {
  const next = createRandom(seed);
  const even = slate.filter((_, index) => index % 2 === 0).slice(0, perSession);
  const odd = slate.filter((_, index) => index % 2 === 1).slice(0, perSession);
  const [feedIds, catalogueIds] = next() < 0.5 ? [even, odd] : [odd, even];
  const feed = { interface: "feed" as const, bokIds: feedIds };
  const catalogue = { interface: "catalogue" as const, bokIds: catalogueIds };
  return { sessions: condition === "catalogue_first" ? [catalogue, feed] : [feed, catalogue] };
}

export type BrowseInterface = "feed" | "catalogue" | "inline" | "cards";

export type A2Plan = {
  sessions: { interface: "inline" | "cards"; set: "a" | "b"; bokIds: string[] }[];
  minutes: number;
};

/** The condition names the first session; the second swaps both interface and set. */
export function planA2(materials: A2Materials, condition: string): A2Plan {
  const [first, set] = condition.split("_") as ["inline" | "cards", "a" | "b"];
  const firstInterface = first === "cards" ? "cards" : "inline";
  const firstSet = set === "b" ? "b" : "a";
  const otherInterface = firstInterface === "inline" ? "cards" : "inline";
  const otherSet = firstSet === "a" ? "b" : "a";
  const ids = (which: "a" | "b") => (which === "a" ? materials.setA : materials.setB);
  return {
    minutes: materials.minutes,
    sessions: [
      { interface: firstInterface, set: firstSet, bokIds: ids(firstSet) },
      { interface: otherInterface, set: otherSet, bokIds: ids(otherSet) },
    ],
  };
}

export type B1Plan = { pieces: string[] };

export function planB1(materials: B1Materials, seed: number): B1Plan {
  const next = createRandom(seed);
  return { pieces: shuffle([...materials.pieces], next).slice(0, materials.perParticipant) };
}

export type B2Mode = "music" | "silence";

export type B2Plan = {
  /** Both blocks, in the order the condition names; the second swaps both mode and set. */
  blocks: { mode: B2Mode; set: "a" | "b"; bokIds: string[] }[];
  minutes: number;
};

/** The condition names the first block, as in a2; the second gets the other mode and the other set. */
export function planB2(materials: B2Materials, condition: string): B2Plan {
  const [first, set] = condition.split("_");
  const firstMode: B2Mode = first === "silence" ? "silence" : "music";
  const firstSet = set === "b" ? "b" : "a";
  const ids = (which: "a" | "b") => (which === "a" ? materials.setA : materials.setB);
  const otherSet = firstSet === "a" ? "b" : "a";
  return {
    minutes: materials.minutes,
    blocks: [
      { mode: firstMode, set: firstSet, bokIds: ids(firstSet) },
      { mode: firstMode === "music" ? "silence" : "music", set: otherSet, bokIds: ids(otherSet) },
    ],
  };
}
