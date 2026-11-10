// The curtain loop job: gives every published bok its 10 s link-preview loop.
//
// Run every 15 minutes by cron (`deploy/ops/curtain.sh`) as a one-off
// container on the server's private network. For each published bok it asks
// the app for the card's key (`/b/<id>/curtain/key`); a bok whose
// `<id>-<key>.mp4` is already stored is done. Otherwise it takes the two
// 960x504 layers the app draws (`art.png`, the cover; `text.png`, title and
// byline) and lays the 85 shared curtain phases between them with ffmpeg:
// open, close, hold, open, hold, 300 frames at 30 fps (public/share/curtain/
// timeline.json). The loop is written beside the link-only pieces, in
// `curtain/`, and the app serves it at `/b/<id>/loop.mp4` after its
// publication check. A changed title, byline, cover or template changes the
// key, so the loop is made again; a bok no longer published loses its loop.
//
// Nothing here is encoded in a request: a bok published a minute ago previews
// with its poster until the next run.

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const apps = (process.env.APP_URLS ?? "http://app-blue:3000,http://app-green:3000").split(",");
const rest = process.env.REST_URL ?? "http://rest:3000";
const out = process.env.OUT_DIR ?? "/out";
const phases = process.env.PHASES_DIR ?? "/static/share/curtain/phases";
/**
 * Gentle on purpose: the first run, all 230 boks at once, took the site into
 * its overload page (2026-11-10). A run makes at most this many loops, one
 * core, a pause between them, and none while the server is busy; the rest
 * wait fifteen minutes. A new bok still gets its loop within one run.
 */
const perRun = Number(process.env.PER_RUN ?? 8);
const pauseMs = Number(process.env.PAUSE_MS ?? 4000);
const busyFlag = process.env.BUSY_FLAG ?? "/flags/busy.on";
/**
 * One-minute load per core: a run does not start above the first, and stops
 * between loops above the second. The second is higher because making a loop
 * itself lifts the load of this two-core server past the first.
 */
const startLoadPerCore = Number(process.env.START_LOAD ?? 0.6);
const stopLoadPerCore = Number(process.env.STOP_LOAD ?? 1.0);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

/** Frame n shows phase clamp(n < 141 ? n - 45 : 225 - n, 0, 84); held phases become one long entry. */
function phaseList() {
  const runs = [];
  for (let n = 0; n < 300; n += 1) {
    const phase = Math.max(0, Math.min(84, n < 141 ? n - 45 : 225 - n));
    if (runs.length && runs.at(-1)[0] === phase) runs.at(-1)[1] += 1;
    else runs.push([phase, 1]);
  }
  const file = (phase) => `file '${join(phases, `phase-${String(phase).padStart(3, "0")}.webp`)}'`;
  return [...runs.flatMap(([phase, frames]) => [file(phase), `duration ${(frames / 30).toFixed(6)}`]), file(0)].join("\n") + "\n";
}

/** The server's own load (/proc/loadavg is the host's), or the overload page is on. */
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

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("nice", ["-n", "10", "ffmpeg", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${errors.slice(-400)}`))));
  });
}

async function makeLoop(id, key, work) {
  const [art, text] = await Promise.all(["art.png", "text.png"].map((layer) => app(`/b/${id}/curtain/${layer}`)));
  if (!art.ok || !text.ok) return false; // unpublished meanwhile
  if (text.headers.get("x-curtain-key") !== key) return false; // changed meanwhile: next run
  await writeFile(join(work, "art.png"), Buffer.from(await art.arrayBuffer()));
  await writeFile(join(work, "text.png"), Buffer.from(await text.arrayBuffer()));
  const partial = join(out, `.${id}-${key}.mp4.part`);
  await ffmpeg([
    "-nostdin", "-v", "error", "-y",
    "-loop", "1", "-framerate", "30", "-i", join(work, "art.png"),
    "-f", "concat", "-safe", "0", "-i", join(work, "phases.txt"),
    "-loop", "1", "-framerate", "30", "-i", join(work, "text.png"),
    "-filter_complex", "[1:v]fps=30,format=rgba[curtain];[0:v][curtain]overlay=format=auto[covered];[covered][2:v]overlay=format=auto,format=yuv420p",
    "-t", "10", "-r", "30", "-an",
    "-c:v", "libx264", "-preset", "slow", "-crf", "26", "-threads", "1", "-filter_threads", "1",
    "-movflags", "+faststart", "-f", "mp4", partial,
  ]);
  // Whole or nothing: the app only ever sees a finished file.
  await rename(partial, join(out, `${id}-${key}.mp4`));
  return true;
}

async function main() {
  const started = Date.now();
  const reason = await busy(startLoadPerCore);
  if (reason) {
    console.log(JSON.stringify({ job: "curtain", skipped: reason }));
    return;
  }
  const listed = await fetch(`${rest}/published_boks?select=id`, { signal: AbortSignal.timeout(20_000) });
  if (!listed.ok) throw new Error(`published_boks: ${listed.status}`);
  const published = new Set((await listed.json()).map((row) => row.id).filter((id) => uuid.test(id)));
  await stat(join(phases, "phase-084.webp")); // the shared phases are there

  const stored = new Map(); // id -> file names
  for (const name of await readdir(out)) {
    const match = /^([0-9a-f-]{36})-([0-9a-f]{8})\.mp4$/.exec(name);
    if (match) stored.set(match[1], [...(stored.get(match[1]) ?? []), name]);
    else if (name.endsWith(".mp4.part")) await rm(join(out, name), { force: true }); // a run that died
  }

  const work = await mkdtemp(join(tmpdir(), "curtain-"));
  await writeFile(join(work, "phases.txt"), phaseList());
  let made = 0, current = 0, failed = 0, removed = 0;
  try {
    for (const id of published) {
      try {
        const answer = await app(`/b/${id}/curtain/key`);
        if (!answer.ok) continue;
        const key = (await answer.text()).trim();
        if (!/^[0-9a-f]{8}$/.test(key)) continue;
        const name = `${id}-${key}.mp4`;
        const old = (stored.get(id) ?? []).filter((file) => file !== name);
        if (!(stored.get(id) ?? []).includes(name)) {
          if (made >= perRun || (made > 0 && (await busy(stopLoadPerCore)))) continue;
          if (made > 0) await sleep(pauseMs);
          if (!(await makeLoop(id, key, work))) continue;
          made += 1;
        } else current += 1;
        for (const file of old) await rm(join(out, file), { force: true }), (removed += 1);
      } catch (error) {
        failed += 1;
        console.error(id, error instanceof Error ? error.message : error);
      }
    }
    // Loops of boks that are no longer published.
    for (const [id, files] of stored) if (!published.has(id)) for (const file of files) await rm(join(out, file), { force: true }), (removed += 1);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ job: "curtain", published: published.size, made, current, removed, failed, seconds: Math.round((Date.now() - started) / 1000) }));
  if (failed > 0 && made === 0 && current === 0) process.exitCode = 1;
}

await main();
