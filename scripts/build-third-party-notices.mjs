#!/usr/bin/env node
// The third-party notices boks owes the people whose code it ships.
//
//   node scripts/build-third-party-notices.mjs
//
// Writes public/licenses/third-party-notices.txt, served at
// /licenses/third-party-notices.txt and linked from Settings -> About.
//
// **Why this exists.** Almost everything boks runs in a browser is open source,
// and almost all of it is MIT, ISC or Apache-2.0. Those licences are
// permissive, not silent: each asks that its copyright notice and licence text
// travel with "all copies or substantial portions of the Software", and a
// minified bundle sent to every reader's browser is a copy. Until 2026-09-22
// only the font's licence was published, so every other notice was missing.
//
// **What it covers.** The whole production dependency tree (`npm ls
// --omit=dev`), which is more than the bundle ends up containing after tree
// shaking - over-inclusion costs nothing, a missing notice is the thing that
// matters - plus the build tools whose runtime is compiled into the pages
// themselves (vinext, Vite, Rolldown).
//
// **What it refuses.** A copyleft licence anywhere in that tree fails the run.
// GPL, AGPL, LGPL, MPL, EPL and the share-alike Creative Commons licences would
// each impose obligations on boks's own source, and that should be a decision
// someone makes, not something a dependency update does quietly.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "public", "licenses", "third-party-notices.txt");

/** Compiled into the served pages even though they are devDependencies. */
const bundledBuildTools = ["vinext", "vite", "rolldown"];

/**
 * Installed, but provably never sent to anyone - and checked, not assumed.
 *
 * `next` depends on `sharp` for image optimisation, and `sharp` ships libvips
 * as a native binary for the build machine under LGPL-3.0. The copyleft guard
 * below caught it on the first run, which is what it is for. It is not
 * distributed: a Cloudflare Worker cannot load a native binary and the pages
 * never reference one. So it is excluded here with a reason - and the run
 * greps the built output for it, so the day it is ever bundled the guard fires
 * again instead of this list hiding it.
 */
const notDistributed = [
  { pattern: /^@img\/sharp-/, marker: "sharp-libvips", reason: "native libvips binary for the build machine" },
  { pattern: /^sharp$/, marker: "sharp/lib", reason: "image optimisation at build time; not bundled" },
];

const permissive = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "Unlicense",
  "CC0-1.0",
  "OFL-1.1",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
]);
const copyleft = /GPL|MPL|EPL|CDDL|EUPL|OSL|SSPL|CC-BY-SA|CC-BY-NC/i;

/**
 * Every installed copy in the production tree, by its real path.
 *
 * Paths rather than names because the same package is often installed twice
 * at two versions - one hoisted, one nested under whatever needed the other -
 * and a notice list built from names alone silently drops the nested copies.
 */
function productionTree() {
  const raw = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const found = new Map();
  for (const dir of raw.split("\n").map((line) => line.trim()).filter(Boolean)) {
    if (dir === root) continue;
    const manifestPath = path.join(dir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.name || !manifest.version) continue;
    const key = `${manifest.name}@${manifest.version}`;
    if (!found.has(key)) found.set(key, { name: manifest.name, version: manifest.version, dir });
  }
  return found;
}

function packageDir(name) {
  const direct = path.join(root, "node_modules", name);
  return existsSync(path.join(direct, "package.json")) ? direct : null;
}

function licenceOf(manifest) {
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license && typeof manifest.license.type === "string") return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type ?? entry).join(" OR ");
  return "UNKNOWN";
}

function licenceText(dir) {
  const files = readdirSync(dir).filter((file) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(file));
  return files
    .sort()
    .map((file) => readFileSync(path.join(dir, file), "utf8").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Every licence named in an SPDX expression must be permissive for the whole to pass. */
function isAcceptable(licence) {
  if (copyleft.test(licence)) {
    // "MIT OR GPL-2.0" lets us choose MIT; "MIT AND GPL-2.0" does not.
    if (!/\bOR\b/i.test(licence)) return false;
  }
  const parts = licence.replace(/[()]/g, " ").split(/\s+(?:OR|AND)\s+/i).map((part) => part.trim());
  return /\bOR\b/i.test(licence) ? parts.some((part) => permissive.has(part)) : parts.every((part) => permissive.has(part));
}

const packages = productionTree();
for (const tool of bundledBuildTools) {
  const dir = packageDir(tool);
  if (!dir) continue;
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  packages.set(`${tool}@${manifest.version}`, { name: tool, version: manifest.version, dir });
}

function builtOutputMentions(marker) {
  const dist = path.join(root, "dist");
  if (!existsSync(dist)) return false;
  try {
    execFileSync("grep", ["-rlq", marker, dist]);
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(path.join(root, "dist"))) {
  console.error("warning: no dist/ - run the build first, or the exclusions below go unchecked");
}

const entries = [];
const problems = [];
const excluded = [];
for (const { name, version, dir } of [...packages.values()].sort(
  (left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version)
)) {
  const skip = notDistributed.find((rule) => rule.pattern.test(name));
  if (skip) {
    if (builtOutputMentions(skip.marker)) {
      problems.push(`${name}@${version}: excluded as "${skip.reason}", but the built output contains it`);
    } else {
      excluded.push(`${name}@${version} (${skip.reason})`);
    }
    continue;
  }
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const licence = licenceOf(manifest);
  if (!isAcceptable(licence)) problems.push(`${name}@${version}: ${licence}`);
  const author = typeof manifest.author === "string" ? manifest.author : manifest.author?.name ?? "";
  entries.push({ name, version, licence, author, homepage: manifest.homepage ?? "", text: licenceText(dir) });
}

if (problems.length) {
  console.error("Refusing to write notices: these licences need a decision before they ship.");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const byLicence = entries.reduce((counts, entry) => {
  counts[entry.licence] = (counts[entry.licence] ?? 0) + 1;
  return counts;
}, {});

const header = `boks - third-party notices

boks is built on open-source software. The packages below are included in, or
compiled into, the pages served at tryboks.com. Each is listed with its version,
its licence, and the licence text its authors ship with it.

Generated by scripts/build-third-party-notices.mjs on ${new Date().toISOString().slice(0, 10)}.
${entries.length} packages: ${Object.entries(byLicence)
  .sort((left, right) => right[1] - left[1])
  .map(([licence, count]) => `${licence} ${count}`)
  .join(", ")}.

The typeface Source Serif 4 is licensed separately, under the SIL Open Font
License 1.1: /licenses/source-serif-4-OFL.txt
`;

const body = entries
  .map((entry) => {
    const heading = `${entry.name} ${entry.version}  (${entry.licence})`;
    const meta = [entry.author && `Author: ${entry.author}`, entry.homepage && `Homepage: ${entry.homepage}`]
      .filter(Boolean)
      .join("\n");
    const text = entry.text || `Licensed under ${entry.licence}. No licence file is shipped with this package.`;
    return `${"=".repeat(78)}\n${heading}\n${meta ? `${meta}\n` : ""}${"-".repeat(78)}\n${text}\n`;
  })
  .join("\n");

writeFileSync(output, `${header}\n${body}`);
console.log(`wrote ${path.relative(root, output)}: ${entries.length} packages`);
for (const entry of excluded) console.log(`  not distributed, verified absent from dist/: ${entry}`);
console.log(Object.entries(byLicence).map(([licence, count]) => `  ${licence}: ${count}`).join("\n"));
