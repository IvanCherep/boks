#!/usr/bin/env node
/**
 * Build an immersive-poem manifest from a recording's own alignment.
 *
 * The word times are not estimated and not hand-written: they are the ones
 * ElevenLabs returned for the take that ships, which is the only way the words
 * land with the voice rather than near it.
 *
 * Usage:
 *   node scripts/build-poem-manifest.mjs <slug> <alignment.json> <lines.json> <scene-map.json>
 *
 * `lines.json` is an array of the poem's lines as strings, in order. Its word
 * counts must match the scene map's scenes one for one; if they do not, the
 * poem would be cut in the wrong places and this refuses rather than guess.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [slug, alignmentPath, linesPath, sceneMapPath] = process.argv.slice(2);
if (!slug || !alignmentPath || !linesPath || !sceneMapPath) {
  console.error("usage: build-poem-manifest.mjs <slug> <alignment> <lines> <scene-map>");
  process.exit(1);
}

const alignment = JSON.parse(readFileSync(alignmentPath, "utf8"));
const lines = JSON.parse(readFileSync(linesPath, "utf8"));
const sceneMap = JSON.parse(readFileSync(sceneMapPath, "utf8"));

/** Words, cut on whitespace, each carrying the time its first letter is spoken. */
function wordsFrom({ characters, character_start_times_seconds: starts, character_end_times_seconds: ends }) {
  const words = [];
  let text = "";
  let at = 0;
  let end = 0;
  characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (text) words.push({ text, atMs: Math.round(at * 1000), endMs: Math.round(end * 1000) });
      text = "";
      return;
    }
    if (!text) at = starts[index];
    text += character;
    end = ends[index];
  });
  if (text) words.push({ text, atMs: Math.round(at * 1000), endMs: Math.round(end * 1000) });
  return words;
}

const words = wordsFrom(alignment);
const counts = lines.map((line) => line.split(/\s+/).filter(Boolean).length);
const total = counts.reduce((sum, n) => sum + n, 0);
if (total !== words.length) {
  console.error(`The lines hold ${total} words and the recording returned ${words.length}.`);
  process.exit(1);
}
/*
 * A scene may hold more than one line.
 *
 * Eight pictures across seventeen seconds is a change every two seconds, which
 * is too fast to settle into any of them. `lines` on a scene says how many it
 * carries; left out, it carries one.
 */
const sceneSpans = sceneMap.scenes.map((scene) => scene.lines ?? 1);
const covered = sceneSpans.reduce((sum, n) => sum + n, 0);
if (covered !== lines.length) {
  console.error(`Scenes cover ${covered} lines; the poem has ${lines.length}.`);
  process.exit(1);
}

/**
 * Which part of the frame a word belongs in.
 *
 * Only a scene that declares more than one safe zone splits its line, and then
 * the split is down the middle: the first half low, the second high. That is
 * the one scene where the placement is the argument.
 */
function zoneOf(scene, lineInScene, indexInLine, wordsInLine) {
  if (scene.safeZones.length < 2) return undefined;
  // Only the line the scene was composed around is split. Splitting every line
  // of a shared picture would send "Прощай," low and "Россия," high, which is
  // not an argument about anything.
  if ((scene.splitLine ?? 0) !== lineInScene) return undefined;
  const half = Math.ceil(wordsInLine / 2);
  return indexInLine < half ? scene.safeZones[0].role : scene.safeZones[1].role;
}

const durationMs = words.at(-1).endMs;

/** Which scene each line belongs to, and where it sits inside that scene. */
const sceneOfLine = [];
sceneSpans.forEach((span, sceneIndex) => {
  for (let within = 0; within < span; within += 1) sceneOfLine.push({ sceneIndex, within });
});

let cursor = 0;
let phraseCursor = 0;
const built = lines.map((_, index) => {
  const { sceneIndex, within } = sceneOfLine[index];
  const scene = sceneMap.scenes[sceneIndex];
  const chunk = words.slice(cursor, cursor + counts[index]);
  cursor += counts[index];
  return {
    sceneId: scene.id,
    startMs: chunk[0].atMs,
    endMs: chunk.at(-1).endMs,
    tokens: chunk.map((word, n) => {
      const zone = zoneOf(scene, within, n, counts[index]);
      /*
       * Which word carries the line.
       *
       * The one that closes a phrase: it ends on punctuation, or it ends the
       * line. "немытая Россия," puts the weight on Россия; "страна рабов," on
       * рабов. Set in the data rather than decided while rendering, so the
       * size of a word never changes and nothing is ever re-laid out.
       */
      const lead = /[,.;:!?—]$/.test(word.text) || n === counts[index] - 1;
      /*
       * Which phrase the word belongs to.
       *
       * The poet's own punctuation does the grouping: a phrase runs up to and
       * including the word that closes it. Lighting one word at a time meant
       * thirty-three handovers in seventeen seconds, each one a word going out
       * as the next came on, which reads as flicker however well it is timed.
       * Within a phrase the light only ever grows, and it goes out once.
       */
      const phrase = phraseCursor;
      if (lead) phraseCursor += 1;
      return {
        ...word,
        phrase,
        ...(zone ? { zone } : {}),
        ...(lead ? { emphasis: "lead" } : {}),
      };
    }),
  };
});

// A line owns the screen until the next one begins, so nothing is ever blank.
built.forEach((line, index) => {
  line.endMs = built[index + 1]?.startMs ?? durationMs;
});

/*
 * Long dissolves, deliberately.
 *
 * Eight pictures across seventeen seconds is a change every two seconds, and
 * nothing can make that sparse. What it can be is continuous: a dissolve that
 * takes most of the time until the next one means the frame is always slowly
 * becoming something else rather than being replaced. The scene map's own
 * durations set the relative weight; this sets the scale.
 */
const round10 = (n) => Math.round(n / 10) * 10;
const slowest = Math.max(...sceneMap.scenes.map((scene) => scene.transitionMs));
const ratio = 1500 / slowest;

const manifest = {
  id: `${slug}-immersive-v1`,
  title: sceneMap.title ?? slug,
  author: sceneMap.author ?? "",
  language: sceneMap.language ?? "ru",
  timingMode: "forced-alignment",
  audio: `/poetry/${slug}/narration.mp3`,
  /*
   * The theme is part of the reading, not music behind it.
   *
   * It starts, stops and seeks with the voice, and it cannot be switched off,
   * because without it the poem is a different piece. Ten decibels under the
   * voice: present rather than background, and still clear of the words. The
   * gain is measured against this recording and has to be re-measured if
   * either the theme or the reading is replaced.
   */
  /*
   * The gain is measured per poem, not shared: set `themeGain` in the scene
   * map from the active levels of this theme and this reading, ten decibels
   * apart. 0.19 is the first poem's, kept as the default so it rebuilds as
   * it was.
   */
  theme: { src: `/poetry/${slug}/theme.mp3`, gain: sceneMap.themeGain ?? 0.19 },
  durationMs,
  canvas: sceneMap.canvas,
  palette: sceneMap.palette,
  /*
   * How large the words are against the format's own size. One for short
   * lines; long ones - Whitman runs to a hundred characters - need less, or a
   * single line fills the sky. The scene map says, because the poem knows.
   */
  ...(sceneMap.textScale ? { textScale: sceneMap.textScale } : {}),
  // How much darker the sky is made behind the words. Daylight pictures need
  // more than the night the format was first drawn for.
  ...(sceneMap.veil ? { veil: sceneMap.veil } : {}),
  playback: {
    /*
     * A word appears a little before it is said.
     *
     * Its arrival takes about half a second, so beginning it on the syllable
     * means the word is still forming while the voice has moved on. Starting
     * it early makes it fully there exactly as it is spoken, and the one
     * before it dims slowly rather than being cut - which is the difference
     * between words that flow and words that flick.
     */
    tokenLeadMs: 220,
    /*
     * The picture changes after the line has landed, not with it.
     *
     * It used to begin 260ms before the next line, so the word and the whole
     * world behind it moved on the same beat - which is what made a short poem
     * feel cut rather than read. Now the first word of a line arrives in the
     * picture that belongs to the line before it, that image is held while the
     * word is still in the air, and only then does the scene begin to turn.
     * The two rhythms stop coinciding, which is the whole point.
     */
    crossfadeOffsetMs: 380,
    defaultCrossfadeMs: round10(850 * ratio),
    backgroundScaleFrom: 1,
    backgroundScaleTo: 1.035,
  },
  scenes: sceneMap.scenes.map((scene, index) => {
    // When the scene takes over, so the renderer can work in scenes rather
    // than inferring their boundaries from where the line ids happen to change.
    const firstLine = sceneOfLine.findIndex((entry) => entry.sceneIndex === index);
    return {
      ...scene,
      image: `/poetry/${slug}/scenes/${scene.image.replace(/\.png$/, ".webp")}`,
      startMs: built[firstLine].startMs,
      transitionMs: round10(scene.transitionMs * ratio),
    };
  }),
  lines: built,
};

const out = `public/poetry/${slug}/manifest.json`;
writeFileSync(out, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`${out}: ${built.length} lines, ${words.length} words, ${(durationMs / 1000).toFixed(2)}s`);
