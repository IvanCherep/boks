#!/usr/bin/env node
/*
 * Imports a version of the designers' page for authors into
 * public/author-landing/ (docs/author-applications.md, "The page").
 *
 *   node scripts/author-landing/import.mjs <unzipped boks-author-landing folder>
 *
 * The source is the static prototype the designers hand over as a zip
 * (README, build.mjs, bundle.mjs, dist/). This copies only the scripts,
 * styles and pictures the page uses, then makes it a boks page:
 * - a living author's files never enter this public repository: Прохоров's
 *   portrait and «полет сквозь сны» (text, recording, pictures) are read
 *   from his link-only folders on the server (docs/link-only-pieces.md);
 * - links to tryboks.com become paths, so the page works on any host;
 * - bridge.js sends the application through submit_author_application,
 *   shows "Sign in" to a guest and the status of an application;
 * - index.html is rendered in Russian ahead of time, like the prototype's build.
 * It also writes the version /author frames (landing-version.ts).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const source = process.argv[2];
if (!source || !fs.existsSync(path.join(source, "dist", "index.html"))) {
  console.error("Usage: node scripts/author-landing/import.mjs <boks-author-landing folder with dist/>");
  process.exit(1);
}
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const target = path.join(repo, "public", "author-landing");
const dist = path.join(source, "dist");

// Прохоров's link-only folders (already public in components/boks/author-portraits.ts and poetry/poems.ts).
const portraits = "/l/XFKejQcwEa7M_7jI_1T6LA/f/";
const polet = "/l/jgycmR8G0ml0YoXbTeHqxA/f/manifest.json";

// Which scripts and styles the page loads, in order: read from bundle.mjs, not run.
const bundle = fs.readFileSync(path.join(source, "bundle.mjs"), "utf8");
const list = (name) => {
  const match = bundle.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!match) throw new Error(`bundle.mjs has no ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
};
const scripts = list("renderScripts");
const styles = list("styles");

// The pictures, sound and fonts the page shows. Anything else in dist/assets is an archived iteration.
const assets = [
  "actual/spring-storm/cover.webp", "actual/spring-storm/01-first-thunder.webp", "actual/spring-storm/02-rain-pearls.webp",
  "actual/spring-storm/03-forest-and-stream.webp", "actual/spring-storm/04-hebe-thunder-cup.webp", "actual/spring-storm/narration.mp3",
  "authors/blok.jpg", "authors/pushkin.jpg", "authors/tyutchev.webp", "brand/art-rozy-saragosy.webp", "favicon.svg",
  "fonts/serif-cyrillic.woff2", "fonts/serif-italic-cyrillic.woff2", "fonts/serif-italic.woff2", "fonts/serif-latin.woff2",
  "fonts/font-license.txt", "lucide-license.txt",
  "functional-v7/author-curtain.webp", "functional-v7/opening-hope-feathers.webp", "functional-v7/opening-night-street.webp",
  "functional-v7/reader-coins.webp", "functional-v7/landing-preview.jpg", "functional-v8/opening-winter-morning.webp",
  "generated/author-v5-series-sequence.webp", "generated/spring-thunder-boks-v2.webp",
  "journey-digital-final/author-page-ivan-egorov-v1.png", "journey-digital-final/publication.webp",
  "journey-straight/application.png", "journey-straight/reader-responses.png", "journey-straight/texts.png", "journey-straight/readers.png",
  "published-sample/gold-frame.png",
];

/** Text replacements; each must match, so a new version that moved things fails here, not on the site. */
const patches = {
  "*": [
    ["assets/brand/prokhorov-portrait-original.jpg", `${portraits}prokhorov-portrait.webp`, { optional: true }],
    ["assets/authors/prokhorov.webp", `${portraits}prokhorov.webp`, { optional: true }],
    ['src="assets/authors/${file}"', `src="\${file==='prokhorov.webp'?'${portraits}prokhorov.webp':'assets/authors/'+file}"`, { optional: true }],
    [/href="https:\/\/tryboks\.com\/?"/g, 'href="/"', { optional: true }],
    [/href="https:\/\/tryboks\.com\//g, 'href="/', { optional: true }],
    [/const href='https:\/\/tryboks\.com\//g, "const href='/", { optional: true }],
  ],
  "radical-author.js": [
    ['src="assets/${src}"', "src=\"${src[0]==='/'?src:'assets/'+src}\""],
    ["pict('brand/prokhorov-portrait-original.jpg'", `pict('${portraits}prokhorov-portrait.webp'`],
  ],
  // The poem is fetched from its link-only folder before the scripts run (index.html); without it the frame stays empty.
  "bok-sample.js": [
    [/const manifest = \{.*\};\n/, "const manifest = root.BoksPoletManifest || null;\n"],
    [/const directory='[^']*';\n\s*const localAsset=[^\n]*\n/, "const localAsset=path=>String(path);\n"],
    ["manifest.lines.forEach((line,lineIndex)=>{", "if(manifest)manifest.lines.forEach((line,lineIndex)=>{"],
    ["function render(c){\n", "function render(c){\n    if(!manifest)return '';\n"],
  ],
  // The dialog's first words, before bridge.js fills in what happened to the application.
  "copy.js": [
    ['"readyTitle": "Заявка готова"', '"readyTitle": "Заявка у нас"'],
    ['"readyBody": "Это прототип. Данные никуда не отправлены."', '"readyBody": "Редакция прочитает её и напишет вам в течение двух рабочих дней."'],
    ['"readyTitle": "Application ready"', '"readyTitle": "The application is in"'],
    ['"readyBody": "This is a prototype. Your data has not been sent anywhere."', '"readyBody": "The editors will read it and write to you within two working days."'],
  ],
  // Rendered ahead of time without the poem: put just the poem in once it has arrived, not the whole page again.
  "app.js": [
    ["if (lang !== document.documentElement.lang || !app.hasChildNodes()) app.innerHTML = render(copy());", "if (lang !== document.documentElement.lang || !app.hasChildNodes()) app.innerHTML = render(copy());\n  else { const slot = app.querySelector('.rp-culture-art--published'); if (slot && !slot.firstElementChild && window.BoksPublishedSample) slot.innerHTML = window.BoksPublishedSample.render(copy()); }"],
  ],
  // Every picture waits until it is near the screen; on phones the opening collage is hidden and never loads.
  // SVG pictures cannot be lazy by themselves: bridge.js gives them their address near the screen.
  "render.js": [
    ["root.BoksAuthorRender=render;", "root.BoksAuthorRender=c=>render(c).replace(/<image([^>]*?)\\shref=\"(assets\\/[^\"]+)\"/g,'<image$1 data-lazy-href=\"$2\"').replace(/<img(?![^>]*\\sloading=)/g,'<img loading=\"lazy\" decoding=\"async\"').replace(/<img([^>]*)\\sloading=\"lazy\"(?![^>]*decoding=)/g,'<img$1 loading=\"lazy\" decoding=\"async\"');"],
  ],
};

function patch(name, text) {
  for (const [from, to, options] of [...patches["*"], ...(patches[name] ?? [])]) {
    const found = typeof from === "string" ? text.includes(from) : new RegExp(from.source, from.flags.replace("g", "")).test(text);
    if (!found) {
      if (options?.optional) continue;
      throw new Error(`${name}: expected ${from}`);
    }
    text = typeof from === "string" ? text.split(from).join(to) : text.replace(from, to);
  }
  return text;
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

const pngs = assets.filter((a) => a.endsWith(".png"));
/**
 * Pictures are shown at most ~380 CSS pixels wide (twice that on a sharp
 * screen), so 760 is enough; these few are shown larger and keep their size.
 */
const maxWidth = 760;
const fullSize = new Set(["published-sample/gold-frame.png", "generated/spring-thunder-boks-v2.webp", "functional-v7/reader-coins.webp", "generated/author-v5-series-sequence.webp", "functional-v7/landing-preview.jpg"]);
const widthOf = (file) => {
  const header = fs.readFileSync(file);
  if (header.toString("ascii", 12, 16) === "VP8X") return 1 + header.readUIntLE(24, 3);
  if (header.toString("ascii", 12, 16) === "VP8 ") return header.readUInt16LE(26) & 0x3fff;
  if (header.toString("ascii", 1, 4) === "PNG") return header.readUInt32BE(16);
  return 0;
};
let webp = false;
try {
  execFileSync("cwebp", ["-version"], { stdio: "ignore" });
  webp = true;
} catch {
  console.warn("cwebp not found: PNG pictures are copied as they are.");
}
for (const asset of assets) {
  const from = path.join(dist, "assets", asset);
  if (!fs.existsSync(from)) throw new Error(`missing asset ${asset}`);
  const to = path.join(target, "assets", asset);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const resize = webp && !fullSize.has(asset) && /\.(png|webp)$/.test(asset) && widthOf(from) > maxWidth ? ["-resize", String(maxWidth), "0"] : [];
  if (webp && (asset.endsWith(".png") || resize.length)) {
    execFileSync("cwebp", ["-quiet", "-q", asset.endsWith(".png") ? "88" : "80", "-alpha_q", "100", "-m", "6", ...resize, from, "-o", to.replace(/\.png$/, ".webp")]);
  } else fs.copyFileSync(from, to);
}
const renamePngs = (text) => (webp ? pngs.reduce((t, a) => t.split(a).join(a.replace(/\.png$/, ".webp")), text) : text);

for (const name of [...scripts, ...styles, "app.js"]) {
  const text = renamePngs(patch(name, fs.readFileSync(path.join(dist, name), "utf8")));
  fs.writeFileSync(path.join(target, name), text);
}
fs.copyFileSync(path.join(repo, "scripts", "author-landing", "bridge.js"), path.join(target, "bridge.js"));
fs.copyFileSync(path.join(repo, "scripts", "author-landing", "bridge.css"), path.join(target, "bridge.css"));

// Nothing of Прохоров's beyond what the server already serves by link.
for (const name of fs.readdirSync(target)) {
  if (!/\.(js|css)$/.test(name)) continue;
  const text = fs.readFileSync(path.join(target, name), "utf8");
  if (/assets\/[^"'`)]*prokhorov|published-sample\/polet|Прохоров","language"/.test(text)) throw new Error(`${name} still carries a living author's file or text`);
}

// One script and one stylesheet, minified: two requests instead of forty-two.
const { transform } = await import("esbuild");
const allScripts = [...scripts, "app.js", "bridge.js"];
const allStyles = [...styles, "bridge.css"];
const read = (name) => fs.readFileSync(path.join(target, name), "utf8");
const js = (await transform(allScripts.map((n) => `/* ${n} */\n${read(n)}\n;`).join("\n"), { loader: "js", minify: true, target: "es2020", legalComments: "none" })).code;
const css = (await transform(allStyles.map(read).join("\n"), { loader: "css", minify: true, legalComments: "none" })).code;
const version = createHash("sha256").update(js + css).digest("hex").slice(0, 12);
fs.writeFileSync(path.join(target, "landing.js"), js);
fs.writeFileSync(path.join(target, "landing.css"), css);

const sandbox = { window: {}, defineMessages: (x) => x };
vm.createContext(sandbox);
for (const name of scripts) vm.runInContext(fs.readFileSync(path.join(target, name), "utf8"), sandbox, { filename: name });
const ru = sandbox.window.BoksAuthorCopy.ru;
const prerendered = sandbox.window.BoksAuthorRender(ru);
for (const name of [...allScripts, ...allStyles]) fs.rmSync(path.join(target, name));
const attr = (s) => String(s).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
// The poem is asked for first thing; the page's script runs once it is here (or after 1.5 s without it).
const head = `window.defineMessages=function(t){return t};window.BoksPoletLoad=fetch(${JSON.stringify(polet)}).then(function(r){return r.ok?r.json():null}).then(function(m){if(m&&m.lines)window.BoksPoletManifest=m},function(){});`;
const tail = `(function(){var go=false;function run(){if(go)return;go=true;var e=document.createElement('script');e.src='landing.js?v=${version}';document.body.appendChild(e)}setTimeout(run,1500);window.BoksPoletLoad.then(run,run)})();`;
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#4b172b"><meta name="robots" content="noindex"><meta name="description" content="${attr(ru.hero.body)}"><title>boks · авторам</title><script>${head}</script><link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="preload" as="font" href="assets/fonts/serif-cyrillic.woff2" type="font/woff2" crossorigin><link rel="preload" as="font" href="assets/fonts/serif-italic-cyrillic.woff2" type="font/woff2" crossorigin><link rel="preload" as="script" href="landing.js?v=${version}"><link rel="stylesheet" href="landing.css?v=${version}"></head><body><div id="app">${prerendered}</div><script>${tail}</script></body></html>`;
fs.writeFileSync(path.join(target, "index.html"), html.replace(/[ \t]+$/gm, ""));

const origin = (fs.readFileSync(path.join(source, "START-HERE.txt"), "utf8").match(/[0-9a-f]{40}/) ?? ["unknown"])[0];
fs.writeFileSync(
  path.join(repo, "components", "boks", "author-landing", "landing-version.ts"),
  `// Written by scripts/author-landing/import.mjs: changes the frame's address with every import, so no cached copy outlives it.\nexport const authorLandingVersion = "${version}";\n/** The designers' commit this page was imported from. */\nexport const authorLandingSource = "${origin}";\n`,
);
console.log(`Imported the page for authors ${version} (source ${origin.slice(0, 7)}) into public/author-landing/.`);
