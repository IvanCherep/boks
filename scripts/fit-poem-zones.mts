/**
 * Raise the zones whose stanza would run under the player, just enough.
 *
 *   npm run fit:poem -- <manifest.json> [--write]
 *
 * For each zone it takes the tallest the stanza gets on any phone in
 * `fitFrames` and moves the zone's top up until that stanza ends above the
 * controls (`stanza-fit.ts`); zones that fit stay put. Without --write it
 * only says what it would move. It refuses - and says which picture - when a
 * stanza cannot fit at all, or when raising a zone would put it over another
 * zone of the same picture: those need fewer lines on the picture, or the
 * picture's zones laid out again by hand.
 *
 * Run it on a new poem's manifest in its scratch folder before uploading,
 * then `npm run check:poems -- <manifest.json>`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { raiseStanzaZones } from "@/lib/boks/poetry/stanza-fit";

const [path, flag] = process.argv.slice(2);
if (!path) {
  console.error("usage: npm run fit:poem -- <manifest.json> [--write]");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(path, "utf8")) as PoemManifest;

const { moves, refusals } = raiseStanzaZones(manifest);

for (const move of moves) console.log(`  ${move}`);
for (const refusal of refusals) console.error(`✗ ${refusal}`);
if (flag === "--write" && moves.length) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`${manifest.title}: ${moves.length} zone(s) raised, written.`);
} else console.log(`${manifest.title}: ${moves.length} zone(s) to raise${flag === "--write" ? "" : " (dry run; --write to save)"}.`);
process.exit(refusals.length ? 1 : 0);
