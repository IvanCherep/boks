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
if (lines.length !== sceneMap.scenes.length) {
  console.error(`${lines.length} lines against ${sceneMap.scenes.length} scenes.`);
  process.exit(1);
}

/**
 * Which part of the frame a word belongs in.
 *
 * Only a scene that declares more than one safe zone splits its line, and then
 * the split is down the middle: the first half low, the second high. That is
 * the one scene where the placement is the argument.
 */
function zoneOf(scene, indexInLine, wordsInLine) {
  if (scene.safeZones.length < 2) return undefined;
  const half = Math.ceil(wordsInLine / 2);
  return indexInLine < half ? scene.safeZones[0].role : scene.safeZones[1].role;
}

const durationMs = words.at(-1).endMs;
let cursor = 0;
const built = lines.map((_, index) => {
  const scene = sceneMap.scenes[index];
  const chunk = words.slice(cursor, cursor + counts[index]);
  cursor += counts[index];
  return {
    sceneId: scene.id,
    startMs: chunk[0].atMs,
    endMs: chunk.at(-1).endMs,
    tokens: chunk.map((word, n) => {
      const zone = zoneOf(scene, n, counts[index]);
      /*
       * Which word carries the line.
       *
       * The one that closes a phrase: it ends on punctuation, or it ends the
       * line. "немытая Россия," puts the weight on Россия; "страна рабов," on
       * рабов. Set in the data rather than decided while rendering, so the
       * size of a word never changes and nothing is ever re-laid out.
       */
      const lead = /[,.;:!?—]$/.test(word.text) || n === counts[index] - 1;
      return { ...word, ...(zone ? { zone } : {}), ...(lead ? { emphasis: "lead" } : {}) };
    }),
  };
});

// A line owns the screen until the next one begins, so nothing is ever blank.
built.forEach((line, index) => {
  line.endMs = built[index + 1]?.startMs ?? durationMs;
});

/*
 * The scene map's transitions were authored against an assumed reading. Scaled
 * to the real one they stay the same share of a line instead of swallowing it.
 */
const assumed = 29_900;
const ratio = durationMs / assumed;
const round10 = (n) => Math.round(n / 10) * 10;

const manifest = {
  id: `${slug}-immersive-v1`,
  title: sceneMap.title ?? slug,
  author: sceneMap.author ?? "",
  language: sceneMap.language ?? "ru",
  timingMode: "forced-alignment",
  audio: `/poetry/${slug}/narration.mp3`,
  durationMs,
  canvas: sceneMap.canvas,
  palette: sceneMap.palette,
  playback: {
    /*
     * Read a little slower than recorded.
     *
     * The model ignores both a speed setting and break tags, so the take comes
     * back at its own pace - about two seconds a line, which for eight
     * full-screen scenes is a slideshow. Slowed here instead: the manifest
     * times are in audio time and `currentTime` reports audio time, so
     * everything stays in sync for free.
     */
    rate: 0.8,
    crossfadeLeadMs: 260,
    defaultCrossfadeMs: round10(850 * ratio),
    backgroundScaleFrom: 1,
    backgroundScaleTo: 1.035,
  },
  scenes: sceneMap.scenes.map((scene) => ({
    ...scene,
    image: `/poetry/${slug}/scenes/${scene.image.replace(/\.png$/, ".webp")}`,
    transitionMs: round10(scene.transitionMs * ratio),
  })),
  lines: built,
};

const out = `public/poetry/${slug}/manifest.json`;
writeFileSync(out, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`${out}: ${built.length} lines, ${words.length} words, ${(durationMs / 1000).toFixed(2)}s`);
