/**
 * A small deterministic PRNG.
 *
 * Resampling estimates must be reproducible: the same data and the same seed
 * must produce the same confidence interval, or a thesis table cannot be
 * regenerated. `Math.random` cannot offer that.
 *
 * mulberry32 - fast, seedable, good enough for resampling.
 */
export function createRandom(seed: number) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(next: () => number, maxExclusive: number) {
  return Math.floor(next() * maxExclusive) % maxExclusive;
}

/** Fisher-Yates, in place, using the supplied generator. */
export function shuffle<T>(values: T[], next: () => number) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = randomInt(next, index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}
