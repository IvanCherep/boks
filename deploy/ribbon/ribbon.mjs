// The ribbon card job: gives each target its ribbon link-preview poster and
// loop (lib/boks/ribbon.ts says what the card is; scene.mjs draws it).
//
// Run every 15 minutes after the curtain job (deploy/ops/curtain.sh), as a
// one-off container on the server's private network. For each target it asks
// the app for the card (`/b/<id>/ribbon/card`, `/a/<handle>/ribbon/card`),
// which carries its key; a card whose `<name>.jpg` and `<name>.mp4` are stored
// is done. Otherwise it takes the cover (`.../ribbon/art`), draws 342 frames
// with Skia and encodes them with ffmpeg: no browser. Files land in /out
// (`link-only/ribbon` on the server), which the app serves after its own
// publication check. A changed title, byline, cover or template changes the
// key, so the card is made again and the old files go.
//
// Targets: RIBBON_TARGETS, space-separated, `b:<bok id>`, `a:<handle>`, or
// `b:*` for every published bok, newest first. Rolling the ribbon out to all
// boks is adding `b:*` here.
import { mkdir, readdir, rm, stat, readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { renderCard } from "./render.mjs";

const defaultTargets = [
  "a:prokhorov",
  "b:4eb182a0-770e-4b95-9059-07a31b229d78", // розы Сарагосы
  "b:521c8ccd-83ed-478f-9f77-1eb2d6f8eff4", // сошлись по швам
].join(" ");

const apps = (process.env.APP_URLS ?? "http://app-blue:3000,http://app-green:3000").split(",");
const rest = process.env.REST_URL ?? "http://rest:3000";
const out = process.env.OUT_DIR ?? "/out";
const targetsText = process.env.RIBBON_TARGETS || defaultTargets;
/** Gentle, like the curtain job: a few cards a run, a pause between, none while the server is busy. */
const perRun = Number(process.env.PER_RUN ?? 3);
const pauseMs = Number(process.env.PAUSE_MS ?? 5000);
const busyFlag = process.env.BUSY_FLAG ?? "/flags/busy.on";
const startLoadPerCore = Number(process.env.START_LOAD ?? 0.6);
const stopLoadPerCore = Number(process.env.STOP_LOAD ?? 1.0);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const handle = /^[a-z0-9_.-]{1,40}$/;
const stored = /^([ab])-([0-9a-z_.-]+)-([0-9a-f]{8})\.(mp4|jpg)$/;

/** A response from whichever app copy answers: one may be stopping for a release. */
async function app(path) {
  let last;
  for (const base of apps) {
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000) });
      if (response.ok || response.status === 404) return response;
      last = new Error(`${path}: ${response.status}`);
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

async function busy(maxLoadPerCore) {
  try {
    await stat(busyFlag);
    return "overload page is on";
  } catch {
    // no flag
  }
  try {
    const load = Number((await readFile("/proc/loadavg", "utf8")).split(" ")[0]);
    if (load / cpus().length > maxLoadPerCore) return `load ${load}`;
  } catch {
    // unknown: go on
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The targets as page paths, `b:*` expanded to every published bok. */
async function targets() {
  const paths = [];
  for (const target of targetsText.split(/\s+/).filter(Boolean)) {
    const [kind, ref] = [target.slice(0, 2), target.slice(2)];
    if (kind === "b:" && ref === "*") {
      const listed = await fetch(`${rest}/published_boks?select=id&order=created_at.desc,id`, { signal: AbortSignal.timeout(20_000) });
      if (!listed.ok) throw new Error(`published_boks: ${listed.status}`);
      for (const row of await listed.json()) if (uuid.test(row.id)) paths.push(`/b/${row.id}`);
    } else if (kind === "b:" && uuid.test(ref)) paths.push(`/b/${ref}`);
    else if (kind === "a:" && handle.test(ref)) paths.push(`/a/${ref}`);
    else console.error(`ignored target ${target}`);
  }
  return [...new Set(paths)];
}

async function main() {
  const started = Date.now();
  const reason = await busy(startLoadPerCore);
  if (reason) {
    console.log(JSON.stringify({ job: "ribbon", skipped: reason }));
    return;
  }
  await mkdir(out, { recursive: true });
  const files = new Map(); // "<b|a>-<ref>" -> stored file names
  for (const name of await readdir(out)) {
    const match = stored.exec(name);
    if (match) files.set(`${match[1]}-${match[2]}`, [...(files.get(`${match[1]}-${match[2]}`) ?? []), name]);
    else if (name.endsWith(".part")) await rm(join(out, name), { force: true }); // a run that died
  }

  const keep = new Set(); // prefixes whose files stay: current cards, and any we could not ask about
  let made = 0, current = 0, failed = 0, removed = 0;
  for (const path of await targets()) {
    const prefix = `${path[1]}-${path.slice(3)}`;
    try {
      const answer = await app(`${path}/ribbon/card`);
      if (answer.status === 404) continue; // unpublished, or an author without a picture: files go below
      const card = await answer.json();
      if (!/^[0-9a-f]{8}$/.test(card.key) || card.name !== `${prefix}-${card.key}`) throw new Error("odd card");
      keep.add(prefix);
      const have = files.get(prefix) ?? [];
      if (have.includes(`${card.name}.mp4`) && have.includes(`${card.name}.jpg`)) {
        current += 1;
      } else {
        if (made >= perRun || (made > 0 && (await busy(stopLoadPerCore)))) continue;
        if (made > 0) await sleep(pauseMs);
        let art = null;
        if (card.hasArt) {
          const response = await app(`${path}/ribbon/art`);
          if (!response.ok || response.headers.get("x-ribbon-key") !== card.key) continue; // changed meanwhile: next run
          art = Buffer.from(await response.arrayBuffer());
        }
        const begun = Date.now();
        await renderCard(card, art, out, card.name);
        console.log(JSON.stringify({ job: "ribbon", made: card.name, seconds: Math.round((Date.now() - begun) / 1000) }));
        made += 1;
      }
      for (const file of have) {
        if (file.startsWith(`${card.name}.`)) continue;
        await rm(join(out, file), { force: true });
        removed += 1;
      }
    } catch (error) {
      keep.add(prefix);
      failed += 1;
      console.error(path, error instanceof Error ? error.message : error);
    }
  }
  // Cards no longer targeted, no longer published, or without a picture now.
  for (const [prefix, names] of files) {
    if (keep.has(prefix)) continue;
    for (const name of names) {
      await rm(join(out, name), { force: true });
      removed += 1;
    }
  }
  console.log(JSON.stringify({ job: "ribbon", made, current, removed, failed, seconds: Math.round((Date.now() - started) / 1000) }));
  if (failed > 0 && made === 0 && current === 0) process.exitCode = 1;
}

await main();
