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
import { buildPoemManifest } from "../lib/boks/poetry/build-manifest.mjs";

const [slug, alignmentPath, linesPath, sceneMapPath] = process.argv.slice(2);
if (!slug || !alignmentPath || !linesPath || !sceneMapPath) {
  console.error("usage: build-poem-manifest.mjs <slug> <alignment> <lines> <scene-map>");
  process.exit(1);
}

const alignment = JSON.parse(readFileSync(alignmentPath, "utf8"));
const lines = JSON.parse(readFileSync(linesPath, "utf8"));
const sceneMap = JSON.parse(readFileSync(sceneMapPath, "utf8"));

const { manifest, words, lines: built } = buildPoemManifest({
  slug,
  alignment,
  lines,
  sceneMap,
  files: {
    audio: `/poetry/${slug}/narration.mp3`,
    image: (name) => `/poetry/${slug}/scenes/${name.replace(/\.png$/, ".webp")}`,
  },
});

const out = `public/poetry/${slug}/manifest.json`;
writeFileSync(out, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`${out}: ${built} lines, ${words} words, ${(manifest.durationMs / 1000).toFixed(2)}s`);
// A zone has a top and no bottom: whether its stanza ends above the player is
// only known once the words are laid out (lib/boks/poetry/stanza-fit.ts).
console.log(`next: npm run fit:poem -- ${out} --write && npm run check:poems -- ${out}`);
