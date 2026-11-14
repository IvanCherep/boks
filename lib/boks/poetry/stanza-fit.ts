import { glyphFallback500, glyphFallback600, glyphWidths500, glyphWidths600 } from "@/lib/boks/poetry/glyph-widths";
import { zoneFor, type PoemManifest, type PoemToken, type SafeZone } from "@/lib/boks/poetry/manifest";

/**
 * Whether every stanza of a poem fits its picture, without a browser.
 *
 * A zone in the manifest has a top and a nominal height, but the renderer
 * gives it no bottom: the stanza is as tall as its words make it. Two long
 * lines that wrap, set low in the picture, ran under the player and off the
 * screen - on «Нишевые интересы» and twenty other stanzas of Дарья
 * Мальо-Субботина's poems (2026-11-14), all of which passed the old check
 * because it looked at the declared box, not at the words.
 *
 * So this lays the words out as `.poem__zone` does (`app/globals.css`): the
 * display face's own widths (`glyph-widths.ts`), the size from the column's
 * width, two rows a zone, lines wrapping inside a row. It is the check the
 * manifest builder, the shipped-poems test, the release and Studio all run;
 * `scripts/check-poem-layout.mjs` confirms it in a real browser.
 */

/** Share of the frame's height the player's controls take at the foot; no stanza may end inside it. */
export const controlsBand = 0.19;
/** How high the player may raise a stanza that does not fit (share of the frame). */
export const stanzaTopMargin = 0.08;

/**
 * The frames a poem is checked on: the small and the common phones, and a
 * phone in Safari with both toolbars showing, which is the shortest frame a
 * reader actually gets.
 */
export const fitFrames: readonly { name: string; width: number; height: number }[] = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone in Safari", width: 390, height: 664 },
  { name: "small Android", width: 360, height: 740 },
  { name: "iPhone 15", width: 390, height: 844 },
  { name: "iPhone Pro Max", width: 430, height: 932 },
];

// `.poem__zone` and `.poem__verse` in app/globals.css.
const lineHeight = 1.12;
const leadScale = 1.45;
const wordGap = 0.36;
const wrapGap = 0.08;
const rowGap = 0.18;
const letterSpacing = -0.005;
/**
 * The estimate runs 0-5 px taller than the browser draws it (checked against
 * all 37 stanzas of Дарья Мальо-Субботина's poems, 2026-11-14); a stanza within
 * that of the line is not called out.
 */
const slackPx = 5;

/** The quiet size: `clamp(1.55rem, 6.6cqw, 2.5rem)`, times the poem's own scale. */
export function wordSize(frameWidth: number, textScale = 1) {
  return Math.min(Math.max(24.8, frameWidth * 0.066), 40) * textScale;
}

function wordWidth(text: string, lead: boolean, size: number) {
  const table = lead ? glyphWidths600 : glyphWidths500;
  const fallback = lead ? glyphFallback600 : glyphFallback500;
  let ems = 0;
  for (const char of text) ems += (table[char] ?? fallback) / 100 + letterSpacing;
  return ems * size * (lead ? leadScale : 1);
}

/**
 * A word as the browser may break it: after a hyphen or a dash inside it
 * («карикатурно-продолговатая» wraps after «карикатурно-»), nowhere else.
 */
function pieces(text: string) {
  return text.split(/(?<=[-\u2010\u2013\u2014])(?=.)/u);
}

/** One line's words wrapped in a column `width` wide: its height in px. */
function verseHeight(tokens: readonly PoemToken[], width: number, size: number) {
  let lines = 0;
  let used = 0;
  let tallest = 0;
  let total = 0;
  const newLine = (w: number, h: number) => {
    if (lines > 0) total += tallest + wrapGap * size;
    lines += 1;
    used = w;
    tallest = h;
  };
  for (const token of tokens) {
    const lead = token.emphasis === "lead";
    const h = lineHeight * size * (lead ? leadScale : 1);
    const w = wordWidth(token.text, lead, size);
    if (w <= width) {
      // A word is a flex item: on this line if it fits, else on the next.
      if (lines === 0 || used + wordGap * size + w > width) newLine(w, h);
      else {
        used += wordGap * size + w;
        tallest = Math.max(tallest, h);
      }
      continue;
    }
    // Wider than the column: the word takes whole lines of its own, broken
    // at its hyphens, and the next word starts below it.
    let inside = 0;
    let rows = 1;
    for (const piece of pieces(token.text)) {
      const pw = wordWidth(piece, lead, size);
      if (inside > 0 && inside + pw > width) {
        rows += 1;
        inside = pw;
      } else inside += pw;
    }
    newLine(width + 1, h * rows);
  }
  return lines === 0 ? 0 : total + tallest;
}

export type ZoneFit = {
  sceneId: string;
  frame: string;
  zone: SafeZone;
  /** Where the stanza starts and ends, as shares of the frame's height. */
  top: number;
  bottom: number;
  /** What the player has to do: nothing, raise it over the controls, or also set it smaller. */
  verdict: "fits" | "raised" | "shrunk";
  /** The longest word is wider than the zone and is set smaller to fit it. */
  narrowed: boolean;
};

/** Every zone of every stanza, laid out on one frame. */
export function layoutStanzas(manifest: PoemManifest, frame: { name: string; width: number; height: number }): ZoneFit[] {
  const size = wordSize(frame.width, manifest.textScale ?? 1);
  // Stanzas as the player groups them: consecutive lines over the same scene.
  const groups: { sceneId: string; zones: Map<SafeZone, PoemToken[][][]> }[] = [];
  const scenes = new Map(manifest.scenes.map((scene) => [scene.id, scene]));
  let verseInStanza = 0;
  for (const line of manifest.lines) {
    const scene = scenes.get(line.sceneId);
    if (!scene) continue;
    let group = groups.at(-1);
    if (!group || group.sceneId !== scene.id) {
      group = { sceneId: scene.id, zones: new Map() };
      groups.push(group);
      verseInStanza = 0;
    }
    const slot = verseInStanza % 2;
    verseInStanza += 1;
    const perZone = new Map<SafeZone, PoemToken[]>();
    for (const token of line.tokens) {
      const zone = zoneFor(scene, token.zone);
      perZone.set(zone, [...(perZone.get(zone) ?? []), token]);
    }
    for (const [zone, tokens] of perZone) {
      const rows = group.zones.get(zone) ?? [[], []];
      rows[slot].push(tokens);
      group.zones.set(zone, rows);
    }
  }

  const floor = 1 - controlsBand;
  const fits: ZoneFit[] = [];
  for (const group of groups) {
    for (const [zone, rows] of group.zones) {
      const width = zone.width * frame.width;
      let widest = 0;
      for (const row of rows) for (const verse of row) for (const token of verse) {
        for (const piece of pieces(token.text)) widest = Math.max(widest, wordWidth(piece, token.emphasis === "lead", size));
      }
      const narrowed = widest > width;
      const scaled = narrowed ? size * (width / widest) : size;
      const heights = rows.map((row) => Math.max(0, ...row.map((verse) => verseHeight(verse, width, scaled))));
      const used = heights.filter((h) => h > 0);
      const height = used.reduce((sum, h) => sum + h, 0) + Math.max(0, used.length - 1) * rowGap * scaled;
      const top = zone.y;
      const bottom = top + height / frame.height;
      const room = floor - Math.min(top, stanzaTopMargin);
      fits.push({
        sceneId: group.sceneId,
        frame: frame.name,
        zone,
        top,
        bottom,
        verdict: bottom <= floor + slackPx / frame.height ? "fits" : height / frame.height > room ? "shrunk" : "raised",
        narrowed,
      });
    }
  }
  return fits;
}

/** What does not fit, on any of the frames, in words a person can act on. Empty when it all fits. */
export function stanzaFitProblems(manifest: PoemManifest, frames = fitFrames): string[] {
  const problems: string[] = [];
  for (const frame of frames) {
    for (const fit of layoutStanzas(manifest, frame)) {
      if (fit.verdict === "fits") continue;
      const scene = manifest.scenes.findIndex((s) => s.id === fit.sceneId) + 1;
      problems.push(
        `${manifest.title}, picture ${scene} (${fit.sceneId}) on ${frame.name} ${frame.width}x${frame.height}: ` +
          `the stanza runs from ${pct(fit.top)} to ${pct(fit.bottom)} of the screen, past ${pct(1 - controlsBand)} where the player begins` +
          (fit.verdict === "shrunk" ? ", and is too tall to fit even raised" : "") +
          `. Start the zone higher (y at most ${pct(Math.max(0, fit.top - (fit.bottom - (1 - controlsBand))))}) or give the picture fewer lines.`
      );
    }
  }
  return problems;
}

function pct(share: number) {
  return `${Math.round(share * 100)}%`;
}
