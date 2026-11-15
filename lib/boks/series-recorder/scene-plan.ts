/**
 * Which lines go on which picture, with no one to lay them out by hand.
 *
 * The pictures are the author's, in the order the author gave them; each
 * carries a run of consecutive lines. Stanzas are kept whole where the count
 * allows - a picture changing in the middle of a stanza cuts a sentence - and
 * the lines are shared as evenly as that permits. With more pictures than
 * stanzas, the longest stanzas are split, at the middle.
 *
 * The words sit in the lower middle of the picture, as subtitles do, over the
 * series' veil; `raiseStanzaZones` then lifts any stanza that would run under
 * the player.
 */

/**
 * Lines on each picture, in order. Sums to the poem's line count.
 *
 * Every split of the lines into `pictures` runs is weighed: runs far from an
 * even share cost their squared distance, and a cut inside a stanza costs
 * more than any unevenness can, so stanzas stay whole whenever there are as
 * many of them as pictures, and the cuts that cannot be avoided fall evenly.
 */
export function linesPerPicture(stanzas: number[], pictures: number): number[] {
  const total = stanzas.reduce((sum, n) => sum + n, 0);
  if (!total || pictures < 1) return [];
  const count = Math.min(pictures, total);
  const stanzaEnds = new Set<number>();
  stanzas.reduce((at, n) => {
    stanzaEnds.add(at + n);
    return at + n;
  }, 0);
  const ideal = total / count;
  const midStanza = total * total;
  // best[g][end]: the cheapest way to put lines 0..end on g pictures.
  const best: number[][] = Array.from({ length: count + 1 }, () => Array(total + 1).fill(Infinity));
  const from: number[][] = Array.from({ length: count + 1 }, () => Array(total + 1).fill(0));
  best[0][0] = 0;
  for (let group = 1; group <= count; group += 1) {
    for (let end = group; end <= total; end += 1) {
      const cut = end === total || stanzaEnds.has(end) ? 0 : midStanza;
      for (let start = group - 1; start < end; start += 1) {
        const value = best[group - 1][start] + (end - start - ideal) ** 2 + cut;
        if (value < best[group][end]) {
          best[group][end] = value;
          from[group][end] = start;
        }
      }
    }
  }
  const sizes: number[] = [];
  let end = total;
  for (let group = count; group >= 1; group -= 1) {
    const start = from[group][end];
    sizes.unshift(end - start);
    end = start;
  }
  return sizes;
}

export type PlannedScene = {
  id: string;
  image: string;
  lines: number;
  line: string;
  focalPoint: { x: number; y: number };
  textPreset: string;
  transitionMs: number;
  safeZones: { x: number; y: number; width: number; height: number }[];
};

/** Where the words start on a picture before any is raised: the lower middle. */
export const plannedZoneTop = 0.58;

/** The scene map the manifest builder takes (`lib/boks/poetry/build-manifest.mjs`). */
export function planSceneMap(input: {
  title: string;
  author: string;
  language: string;
  lines: string[];
  stanzas: number[];
  images: string[];
}) {
  const sizes = linesPerPicture(input.stanzas, input.images.length);
  let cursor = 0;
  const scenes: PlannedScene[] = sizes.map((size, index) => {
    const lines = input.lines.slice(cursor, cursor + size);
    cursor += size;
    return {
      id: `scene-${String(index + 1).padStart(2, "0")}`,
      image: input.images[index],
      lines: size,
      line: lines.join(" / "),
      focalPoint: { x: 0.5, y: 0.45 },
      textPreset: index % 2 ? "farewell-drift" : "quiet-breath",
      transitionMs: 1500,
      safeZones: [{ x: 0.08, y: plannedZoneTop, width: 0.84, height: 0.18 }],
    };
  });
  return {
    version: 1,
    title: input.title,
    author: input.author,
    language: input.language,
    canvas: { width: 1080, height: 1920, aspectRatio: "9:16", fit: "cover", controlsReservedBottom: 0.12 },
    // The palette and veil of Дарья Мальо-Субботина's Series: warm words over
    // any picture, the sky darkened enough to read them in daylight.
    palette: { text: "#F7F0E4", active: "#F4C987", shadow: "rgba(10, 7, 4, 0.74)" },
    veil: 1.4,
    transitionStyle: "cinematic",
    scenes,
  };
}
