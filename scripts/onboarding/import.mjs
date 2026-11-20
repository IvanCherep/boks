#!/usr/bin/env node
/**
 * Imports the designers' reader introduction (onboarding) into public/onboarding/.
 *
 *   node scripts/onboarding/import.mjs <prototype>/dist
 *
 * The prototype (boks-onboarding v54, docs/onboarding.md) is a buildless page:
 * index.html, its scripts and styles, and assets. This copies only what the
 * introduction uses, never the demo reader's own catalogue art, and:
 *  - keeps living authors' files out of this public repository: the Russian
 *    Series in the Series scene are read from their link-only folders, the
 *    three contemporary portraits from their author pages (/a/<handle>/photo),
 *    and every other contemporary author is dropped from the catalogue;
 *  - patches the demo app's endings (finish, skip, sign in) to hand the
 *    answers to boks through scripts/onboarding/bridge.js instead of opening
 *    its demo reader;
 *  - writes index.html with the bridge.
 * Run it again for a new version; it replaces public/onboarding/ whole.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { dirname, join, normalize } from "node:path";

const source = process.argv[2];
if (!source || !existsSync(join(source, "index.html"))) {
  console.error("usage: node scripts/onboarding/import.mjs <prototype>/dist");
  process.exit(2);
}
const out = new URL("../../public/onboarding/", import.meta.url).pathname;
const here = new URL("./", import.meta.url).pathname;

// Living authors' Series: link-only folders on the server (docs/link-only-pieces.md).
const linkOnlySeries = {
  "assets/onboarding/discovery-v33/series-modern/prokhorov-polet-skvoz-sny/": "/l/jgycmR8G0ml0YoXbTeHqxA/f/",
  "assets/onboarding/discovery-v33/series-modern/malyo-subbotina-zvyozdnoe/": "/l/EKvnI0C1SU4VogDdU5_vwA/f/",
};
// The three contemporary authors the Series scene names, from their pages.
const pagePortraits = { prokhorov: "/a/prokhorov/photo", vodennikov: "/a/vodennikov/photo", "mallo-subbotina": "/a/malyo_subbotina/photo" };
const livingDirs = Object.keys(linkOnlySeries);
const isLiving = (path) => livingDirs.some((dir) => path.startsWith(dir)) || /authors\/contemporary-v\d+\//.test(path);

const files = new Set(["index.html", "onboarding-assets.json"]);
const html = readFileSync(join(source, "index.html"), "utf8");
const code = [...html.matchAll(/(?:href|src)="([^"?#]+)/g)].map((m) => m[1]).filter((p) => /\.(js|css|webp|woff2)$/.test(p));
code.forEach((p) => files.add(p));

// Every asset a script or a style names, and every url() in a style.
for (const file of code.filter((p) => /\.(js|css)$/.test(p))) {
  const text = readFileSync(join(source, file), "utf8");
  for (const m of text.matchAll(/(assets\/[A-Za-z0-9_./-]+\.(?:webp|png|jpe?g|svg|woff2|json|mp3|m4a))/g)) files.add(m[1]);
  for (const m of text.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    if (m[1].startsWith("data:") || m[1].startsWith("http")) continue;
    files.add(normalize(join(dirname(file), m[1])));
  }
}
// The asset manifest's own inventory.
const manifest = JSON.parse(readFileSync(join(source, "onboarding-assets.json"), "utf8"));
for (const f of manifest.files ?? []) if (f.path) files.add(f.path.replace(/^dist\//, ""));

// The catalogue: classics only, plus the three living authors with page portraits.
const library = JSON.parse(readFileSync(join(source, "assets/library.json"), "utf8"));
library.authors = library.authors.filter((a) => !a.groups?.includes("contemporary") || a.id in pagePortraits).map((a) => {
  if (a.id in pagePortraits) return { ...a, portrait: pagePortraits[a.id], onboardingEligible: false };
  return a;
});
for (const a of library.authors) if (a.portrait && !a.portrait.startsWith("/")) files.add(`assets/${a.portrait}`);
for (const b of library.books ?? []) for (const key of ["cover", "art", "image"]) if (typeof b[key] === "string" && !b[key].startsWith("/")) files.add(`assets/${b[key]}`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let bytes = 0;
let copied = 0;
const missing = [];
for (const file of [...files].sort()) {
  if (isLiving(file)) continue;
  const from = join(source, file);
  if (!existsSync(from) || !statSync(from).isFile()) { missing.push(file); continue; }
  mkdirSync(dirname(join(out, file)), { recursive: true });
  cpSync(from, join(out, file));
  bytes += statSync(from).size;
  copied += 1;
}
writeFileSync(join(out, "assets/library.json"), JSON.stringify(library));

// Patches: living authors' files from their link-only folders, and the endings to boks.
const patch = (file, pairs) => {
  const path = join(out, file);
  let text = readFileSync(path, "utf8");
  for (const [from, to, opts] of pairs) {
    if (!text.includes(from)) { if (opts?.optional) continue; throw new Error(`${file}: patch target missing: ${from.slice(0, 80)}`); }
    text = text.split(from).join(to);
  }
  writeFileSync(path, text);
};
for (const file of [...files].filter((f) => /\.(js|css|json)$/.test(f) && existsSync(join(out, f)))) {
  const path = join(out, file);
  let text = readFileSync(path, "utf8");
  let changed = false;
  for (const [dir, to] of Object.entries(linkOnlySeries)) if (text.includes(dir)) { text = text.split(dir).join(to); changed = true; }
  if (changed) writeFileSync(path, text);
}
patch("app.js", [
  // The finish, the final Continue and Skip: the answers go to boks, which shows its real first cover.
  ["function obComplete({read=false,skip=false}={}){", "function obComplete({read=false,skip=false}={}){if(window.BoksBridge){window.BoksBridge.done({onboarding,profile:p,read,skip});return;}"],
  // Sign in at the final invitation: boks's own email code.
  ["function signInFromArrival(){", "function signInFromArrival(){if(window.BoksBridge){O.finish(onboarding,p,J,library,{applyToExisting:false,now:Date.now()});window.BoksBridge.signIn({onboarding,profile:p});return;}"],
  // Leaving the shelf: the answers are known, so boks saves them and prepares the feed while the scenes play.
  ["function beginDiscovery(){", "function beginDiscovery(){window.BoksBridge?.answers({onboarding,profile:p});"],
  // Any other way to the demo's sign-in sheet (a header button, an expired session) goes to boks's own.
  ["function auth(reason){", "function auth(reason){if(window.BoksBridge){window.BoksBridge.signIn({onboarding,profile:p});return;}"],
  // The first cover is boks's real first bok when boks has sent it.
  ["function discoveryFirstBook(){", "function discoveryFirstBook(){if(window.BoksBridge?.firstBook)return window.BoksBridge.firstBook;"],
  // The library is fetched from this folder.
  ["fetch('assets/library.json?request=52-classics',{cache:'no-store'})", "fetch('assets/library.json?v='+(window.BoksBridge?.version||'1'))"],
]);

// The language bay starts at the reading languages boks already has for this reader (`?reading=ru,en`).
patch("onboarding-model.js", [
  ["const freshReadingLanguages = () => ['ru'];", "const freshReadingLanguages = () => { const given = (new URLSearchParams(location.search).get('reading') || '').split(',').filter((l) => l === 'ru' || l === 'en'); return given.length ? [...new Set(given)] : ['ru']; };"],
]);

// The way out of the discovery scenes reads as a skip, like the shelf's.
patch("onboarding-discovery.js", [
  ["read: 'К чтению'", "read: 'Пропустить'"],
  ["read: 'Start reading'", "read: 'Skip'"],
]);

// The first room waits only for what it shows: the books' cloth on the shelf decodes later.
patch("onboarding-living-motion.js", [
  ["&&!image.closest?.('.ob-shelf-portrait'))", "&&!image.closest?.('.ob-shelf-portrait')&&!image.classList?.contains('ob-living-book-art'))"],
]);

// Pictures re-encoded for the sizes they are shown at (docs/onboarding.md, "Weight"):
// quality 72, and the books' cloth - shown at most ~300 px wide - at 600 px.
// The classics' portraits keep their supplied bytes, as the handover requires.
const resized = { "assets/onboarding/books-v43/neutral-cover.webp": 600 };
let saved = 0;
for (const file of [...files].filter((f) => f.endsWith(".webp") && existsSync(join(out, f)))) {
  if (file.startsWith("assets/authors/")) continue;
  const path = join(out, file);
  const before = statSync(path).size;
  if (before < 30_000 && !(file in resized)) continue;
  const tmp = `${path}.tmp.webp`;
  const args = ["-quiet", "-q", "72", "-m", "6"];
  if (resized[file]) args.push("-resize", String(resized[file]), "0");
  execFileSync("cwebp", [...args, path, "-o", tmp]);
  const after = statSync(tmp).size;
  if (after < before * 0.9) { cpSync(tmp, path); saved += before - after; }
  unlinkSync(tmp);
}

// One script and one stylesheet instead of sixty files, each minified (whitespace and
// syntax only: the scripts share globals across files, so their names stay).
const scripts = [...html.matchAll(/<script src="([^"?]+)[^"]*"><\/script>/g)].map((m) => m[1]);
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)[^"]*">/g)].map((m) => m[1]);
const js = [...scripts.map((f) => readFileSync(join(out, f), "utf8")), readFileSync(join(here, "open-cta.js"), "utf8")]
  .map((text) => transformSync(text, { loader: "js", minifyWhitespace: true, minifySyntax: true, target: "es2019" }).code).join(";\n");
const css = transformSync([...styles.map((f) => readFileSync(join(out, f), "utf8")), readFileSync(join(here, "overrides.css"), "utf8")].join("\n"), { loader: "css", minify: true }).code;
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 10);
writeFileSync(join(out, "onboarding.bundle.js"), js);
writeFileSync(join(out, "onboarding.bundle.css"), css);
for (const f of [...scripts, ...styles]) rmSync(join(out, f), { force: true });
let page = html;
page = page.replace(/\s*<link rel="stylesheet" href="[^"]+">/g, "");
page = page.replace(/\s*<script src="[^"]+"><\/script>/g, "");
page = page.replace("</head>", `  <link rel="stylesheet" href="onboarding.bundle.css?v=${hash(css)}">\n</head>`);
page = page.replace("</body>", `  <script src="onboarding.bundle.js?v=${hash(js)}"></script>\n</body>`);

const bridge = readFileSync(join(here, "bridge.js"), "utf8");
writeFileSync(join(out, "index.html"), page.replace("<script>window.defineMessages", `<script>${bridge}</script>\n  <script>window.defineMessages`));
console.log(`pictures: ${(saved / 1024 / 1024).toFixed(1)} MB saved; scripts ${(js.length / 1024).toFixed(0)} KB, styles ${(css.length / 1024).toFixed(0)} KB`);

// Nothing of a living author may remain as a file.
for (const file of files) if (isLiving(file) && existsSync(join(out, file))) throw new Error(`${file}: a living author's file was copied`);
console.log(`onboarding: ${copied} files, ${(bytes / 1024 / 1024).toFixed(1)} MB into public/onboarding/`);
if (missing.length) console.log(`not in the prototype (${missing.length}):`, missing.slice(0, 12).join(", "));
