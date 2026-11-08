/**
 * Refuses to deploy a build that points at a developer's machine.
 *
 * This exists because it happened. A local override file
 * (`.env.production.local`) outranks `.env.local` in a production build, so
 * `npm run deploy` shipped a bundle configured with `http://127.0.0.1:54321`.
 * The site looked healthy to the one person whose laptop was running Supabase
 * and was broken for everyone else - no feed, no sign-in, no email. Nothing in
 * the pipeline noticed, because every check passed: the code was correct, only
 * its address was wrong.
 *
 * A build cannot be trusted to describe itself, so this reads the artifact.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
// The self-hosted release (deploy/release.sh) passes its own output directories
// and its backend origin: `node scripts/check-deploy-target.mjs <dir>...` with
// BOKS_BACKEND=https://tryboks.com.
const argRoots = process.argv.slice(2);
const bundleRoots = (argRoots.length ? argRoots : ["dist/client", "dist/server"]).map((dir) => path.resolve(root, dir));
const expectedBackend = process.env.BOKS_BACKEND || null;

/**
 * A backend address that only resolves on the machine that built the bundle.
 *
 * Deliberately narrow: the bare word "localhost" appears all over framework and
 * Wrangler output for legitimate reasons, and flagging it would make this check
 * noise that people learn to skip. What is never legitimate in a deployed
 * bundle is a *service origin* on a loopback address - the Supabase CLI ports
 * are 5432x, and an app server is typically 3000/5173/8787.
 */
const localBackend = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::(?:5432\d|3000|5173|8787|8788))\b/;
const backendHost = /https:\/\/[a-z0-9]+\.supabase\.co/g;

/**
 * Runtime-only files. `.dev.vars` is read by `wrangler dev` on this machine and
 * is not uploaded; `wrangler.json` carries local dev server settings.
 */
const ignoredNames = new Set([".dev.vars", "wrangler.json"]);

function* bundleFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* bundleFiles(full);
      continue;
    }
    if (ignoredNames.has(entry)) continue;
    if (/\.(js|mjs|cjs|html|json)$/.test(entry)) yield full;
  }
}

const offenders = [];
let backendsFound = new Set();
let scanned = 0;

for (const dir of bundleRoots) {
  for (const file of bundleFiles(dir)) {
    scanned += 1;
    const text = readFileSync(file, "utf8");
    const local = text.match(localBackend);
    if (local) offenders.push({ file: path.relative(root, file), found: local[0] });
    for (const match of text.matchAll(backendHost)) backendsFound.add(match[0]);
    if (expectedBackend && ["\"", "`", "'"].some((q) => text.includes(q + expectedBackend + q))) backendsFound.add(expectedBackend);
  }
}

if (!scanned) {
  console.error("check:deploy-target: no build output found. Run `npm run build` first.");
  process.exit(1);
}

if (offenders.length) {
  console.error(
    `check:deploy-target: this build points at a local machine and must not be deployed.\n` +
      offenders.map((entry) => `  ${entry.file}: ${entry.found}`).join("\n") +
      `\n\nA local override is outranking the production one. Check for` +
      ` .env.production.local, then rebuild.\n`
  );
  process.exit(1);
}

if (!backendsFound.size) {
  console.error(
    "check:deploy-target: this build names no Supabase backend at all. It would" +
      " reach nothing in production. Check that .env.local is present and rebuild.\n"
  );
  process.exit(1);
}

console.log(
  `check:deploy-target: ${scanned} build files, backend ${[...backendsFound].join(", ")}, no local addresses.`
);
