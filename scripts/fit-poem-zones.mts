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
import type { PoemManifest, SafeZone } from "@/lib/boks/poetry/manifest";
import { controlsBand, fitFrames, layoutStanzas, stanzaTopMargin } from "@/lib/boks/poetry/stanza-fit";

const [path, flag] = process.argv.slice(2);
if (!path) {
  console.error("usage: npm run fit:poem -- <manifest.json> [--write]");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(path, "utf8")) as PoemManifest;
const floor = 1 - controlsBand;
// A little under the line, so a rounding in the browser never lands on it.
const margin = 0.005;

// The tallest each zone gets, over every phone, as a share of that phone's height.
const tallest = new Map<SafeZone, number>();
for (const frame of fitFrames) {
  for (const fit of layoutStanzas(manifest, frame)) {
    tallest.set(fit.zone, Math.max(tallest.get(fit.zone) ?? 0, fit.bottom - fit.top));
  }
}

const moves: string[] = [];
const refusals: string[] = [];
manifest.scenes.forEach((scene, index) => {
  for (const zone of scene.safeZones) {
    const height = tallest.get(zone);
    if (height === undefined || zone.y + height <= floor) continue;
    const y = Math.floor((floor - margin - height) * 1000) / 1000;
    if (y < stanzaTopMargin) {
      refusals.push(`picture ${index + 1} (${scene.id}): ${Math.round(height * 100)}% of the screen tall, more than fits above the player; give it fewer lines`);
      continue;
    }
    const others = scene.safeZones.filter((other) => other !== zone);
    const clash = others.find((other) => {
      const across = zone.x < other.x + other.width && other.x < zone.x + zone.width;
      const otherBottom = other.y + (tallest.get(other) ?? other.height);
      return across && y < otherBottom && other.y < y + height;
    });
    if (clash) {
      refusals.push(`picture ${index + 1} (${scene.id}): raised to ${pct(y)} it would sit on its "${clash.role ?? "first"}" zone; lay this picture's zones out by hand`);
      continue;
    }
    moves.push(`picture ${index + 1} (${scene.id}): zone y ${pct(zone.y)} -> ${pct(y)} (stanza up to ${pct(height)} of the screen)`);
    zone.y = y;
  }
});

for (const move of moves) console.log(`  ${move}`);
for (const refusal of refusals) console.error(`✗ ${refusal}`);
if (flag === "--write" && moves.length) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 1)}\n`);
  console.log(`${manifest.title}: ${moves.length} zone(s) raised, written.`);
} else console.log(`${manifest.title}: ${moves.length} zone(s) to raise${flag === "--write" ? "" : " (dry run; --write to save)"}.`);
process.exit(refusals.length ? 1 : 0);

function pct(share: number) {
  return `${(share * 100).toFixed(1)}%`;
}
