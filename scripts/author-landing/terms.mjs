#!/usr/bin/env node
/*
 * Brings the page for authors in line with the author contract (v7, 2026-11-22).
 *
 *   node scripts/author-landing/terms.mjs
 *
 * Run it after every scripts/author-landing/import.mjs: the designers' copy
 * still carries the old offer (a 30 000 ₽ page without conditions, a free
 * joint launch for 15 000 views, five Series for 10 000 ₽, authors' own
 * pictures, a Series "in about a minute"). The contract says: «Совместный
 * запуск» free for authors whose posts reach 30 000 views, «Кабинет автора»
 * 30 000 ₽ a year with a link to every Series in the author's social media,
 * «Кабинет автора без продвижения» 500 000 ₽ without it (behind a «?», why-share.js); 5 starting Series, then up to 50 a year;
 * the author reads, the editors make the pictures, the author publishes.
 *
 * It rewrites the copy objects inside landing.js (both languages), then
 * renders index.html again from that script, so the two never disagree.
 * Each change must find its target; a moved text fails here, not on the site.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const dir = path.join(repo, "public", "author-landing");
const jsFile = path.join(dir, "landing.js");
const cssFile = path.join(dir, "landing.css");
const htmlFile = path.join(dir, "index.html");
let js = fs.readFileSync(jsFile, "utf8");

const studio = {
  ru: [
    "Авторская страница tryboks.com/@имя и кабинет автора",
    "5 Boks Series на старте, дальше до 50 выпусков за год",
    "Ваш голос: запись с суфлёром в кабинете или свой файл",
    "Иллюстрации и звук к каждому выпуску делает редакция",
    "Готовый выпуск вы смотрите первым и публикуете сами",
    "Публикации в общей ленте boks после стандартной проверки",
    "Поддержка: обычно отвечаем в течение рабочего дня",
  ],
  en: [
    "An author’s page at tryboks.com/@name and an author’s studio",
    "5 Boks Series to start with, then up to 50 editions a year",
    "Your voice: record with the teleprompter in the studio or send your own file",
    "The editors make the illustrations and sound for every edition",
    "You see each edition first and publish it yourself",
    "Publication in the main boks feed, subject to the standard review",
    "Support: we usually reply within one working day",
  ],
};
const copy = {
  ru: {
    plans: [
      {
        number: "01", id: "launch", label: "ДЛЯ АВТОРОВ С АУДИТОРИЕЙ", title: "Совместный запуск", price: "Бесплатно", period: "всё, что входит в «Кабинет автора»",
        promotion: "Подходит, если у вас есть читатели в соцсетях и вы готовы рассказывать им о каждом выпуске.",
        items: [
          "Условие: ссылка на каждую вышедшую Series в ваших соцсетях",
          "За первые 3 месяца ваши посты о boks вместе набирают от 30\u00a0000 просмотров",
          "Подать заявку можно с аудиторией от 500\u00a0подписчиков",
          "Каждую такую заявку редакция рассматривает индивидуально",
        ],
        cta: "Оставить заявку",
      },
      {
        number: "02", id: "author", title: "Кабинет автора", price: "30 000 ₽", period: "за год",
        promotion: "Подходит, если вы только собираете аудиторию и хотите, чтобы выпуски помогали вам её растить.",
        items: [...studio.ru, "Условие: ссылка на каждую вышедшую Series в ваших соцсетях"],
        cta: "Оставить заявку",
      },
    ],
    principle: { title: "Права остаются у вас", body: "Мы получаем только право показывать ваши произведения на boks. Любое из них можно снять в любой момент." },
    publication: "Редакция готовит Boks Series, вы проверяете её и публикуете. Выпуск выходит в общую ленту boks и попадает к новым читателям.",
    benefit: "Ваш голос рядом с текстом: выпуски с иллюстрациями редакции.",
    series: {
      body: "Нет видео и студии? Читайте текст с суфлёра на весь экран, своим голосом, прямо с телефона, или пришлите готовую запись. Редакция boks сверит каждое слово с записью, нарисует иллюстрации и соберёт выпуск, в котором слова появляются ровно тогда, когда вы их произносите.",
      steps: ["Добавьте стихотворение или рассказ.", "Читайте с суфлёра в своём темпе или пришлите свой файл.", "Иллюстрации в стиле boks по вашим строкам рисует редакция.", "Готовый выпуск вы смотрите первым и публикуете сами."],
      pictures: "Картинки",
    },
    interests: ["Совместный запуск", "Кабинет автора", "Кабинет автора без продвижения", "Пока не знаю"],
  },
  en: {
    plans: [
      {
        number: "01", id: "launch", label: "FOR AUTHORS WITH AN AUDIENCE", title: "Joint launch", price: "Free", period: "everything in the “Author’s studio”",
        promotion: "For you if you have readers on social media and are ready to tell them about every edition.",
        items: [
          "Condition: a link to every published Series on your social media",
          "Within the first 3 months your posts about boks reach 30,000\u00a0views in total",
          "You can apply with an audience of 500 followers or more",
          "The editors consider each such application individually",
        ],
        cta: "Apply",
      },
      {
        number: "02", id: "author", title: "Author’s studio", price: "30,000 ₽", period: "per year",
        promotion: "For you if you are still building an audience and want the editions to help it grow.",
        items: [...studio.en, "Condition: a link to every published Series on your social media"],
        cta: "Apply",
      },
    ],
    principle: { title: "Your rights stay with you", body: "We only receive the right to show your works on boks. You can take any of them down at any time." },
    publication: "The editors prepare a Boks Series, you check it and publish it. The edition goes out to the main boks feed and reaches new readers.",
    benefit: "Your voice next to the text: editions illustrated by the editors.",
    series: {
      body: "No video or studio? Read from a full-screen teleprompter in your own voice, right on your phone, or send a recording you already have. The boks editors align every word with the recording, draw the illustrations and put together an edition in which the words appear exactly when you say them.",
      steps: ["Add a poem or a story.", "Read from the teleprompter at your own pace, or send your own file.", "The editors draw illustrations in the boks style from your lines.", "You see the finished edition first and publish it yourself."],
      pictures: "Pictures",
    },
    interests: ["Joint launch", "Author’s studio", "Author’s studio without promotion", "Not sure yet"],
  },
};

/** The end of the JS value that starts at `from` (an object or an array), skipping strings, template literals and comments are not expected in a data literal. */
function valueEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; text[i] !== c; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error("unbalanced value");
}
/** Plain ASCII, as esbuild writes it. */
const literal = (value) => JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => {
  const n = c.charCodeAt(0);
  return n < 256 ? `\\x${n.toString(16).toUpperCase().padStart(2, "0")}` : `\\u${n.toString(16).toUpperCase().padStart(4, "0")}`;
});
const evaluate = (source) => vm.runInNewContext(`(${source})`);

/** Replace every `key:{...}` whose value passes `test`, with `change(value, language)`. Must change exactly `expected` of them. */
function rewrite(key, test, change, expected = 2) {
  let done = 0;
  let at = 0;
  for (;;) {
    const found = js.indexOf(`${key}:`, at);
    if (found < 0) break;
    const start = found + key.length + 1;
    if (js[start] !== "{" && js[start] !== "[") { at = start; continue; }
    const end = valueEnd(js, start);
    let value;
    try { value = evaluate(js.slice(start, end)); } catch { at = start; continue; }
    const language = test(value);
    if (!language) { at = start; continue; }
    const next = literal(change(value, language));
    js = js.slice(0, start) + next + js.slice(end);
    at = start + next.length;
    done++;
  }
  if (done !== expected) throw new Error(`${key}: changed ${done}, expected ${expected}`);
}

// Conditions: two plans instead of three.
rewrite("pricing", (v) => (Array.isArray(v.plans) ? (/[а-я]/.test(v.title) ? "ru" : "en") : null), (v, l) => ({ ...v, plans: copy[l].plans }));

// Selection, point 04: the free entry for 15 000 views is gone; say what the licence is instead.
rewrite("selection", (v) => (Array.isArray(v.items) && v.items.length === 4 ? (/[а-я]/.test(v.title) ? "ru" : "en") : null), (v, l) => {
  const items = [...v.items];
  items[3] = { ...items[3], ...copy[l].principle };
  return { ...v, items };
});

// The author's path, step 04.
rewrite("journey", (v) => {
  const steps = Object.values(v).find(Array.isArray);
  return steps && steps.some((s) => s && s.number === "04") ? (/[а-я]/.test(JSON.stringify(steps[3])) ? "ru" : "en") : null;
}, (v, l) => {
  const key = Object.keys(v).find((k) => Array.isArray(v[k]) && v[k].some((s) => s && s.number === "04"));
  return { ...v, [key]: v[key].map((s) => (s.number === "04" ? { ...s, body: copy[l].publication } : s)) };
});

// What the author gets: the teleprompter card.
rewrite("benefits", (v) => (JSON.stringify(v).includes("Boks Series") ? (/[а-я]/.test(JSON.stringify(v)) ? "ru" : "en") : null), (v, l) => {
  const fix = (x) => (Array.isArray(x) ? x.map(fix) : x && typeof x === "object"
    ? (typeof x.title === "string" && /^Boks Series (с суфлёром|with a teleprompter)$/.test(x.title) ? { ...x, body: copy[l].benefit } : Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fix(y)])))
    : x);
  const next = fix(v);
  if (JSON.stringify(next) === JSON.stringify(v)) throw new Error("benefits: no teleprompter card");
  return next;
});

// Boks Series with a teleprompter.
rewrite("series", (v) => (Array.isArray(v.steps) && v.steps.length === 4 ? (/[а-я]/.test(v.title) ? "ru" : "en") : null), (v, l) => ({
  ...v,
  body: copy[l].series.body,
  steps: v.steps.map((s, i) => ({ ...s, body: copy[l].series.steps[i], ...(i === 2 ? { title: copy[l].series.pictures } : {}) })),
}));

// The application form: what the author is interested in.
rewrite("application", (v) => (Array.isArray(v.interests) ? (/[а-я]/.test(v.title) ? "ru" : "en") : null), (v, l) => ({ ...v, interests: copy[l].interests, defaultInterest: copy[l].interests.at(-1) }));

/** A plain text replacement that must match exactly once. */
function once(from, to) {
  const n = js.split(from).length - 1;
  if (n !== 1) throw new Error(`expected one ${from}, found ${n}`);
  js = js.replace(from, to);
}
// «Совместный» comes first; the radio values follow the new interests (bridge.js maps author→page, launch→launch).
once("{author:0,launch:1,series:2}", "{launch:0,author:1,nopromo:2}");
once('["author","series","launch","unsure"]', '["launch","author","nopromo","unsure"]');
// bridge.js inside the bundle: the third offer has its own value in the applications.
once('{author:"page",series:"series",launch:"launch",unsure:"unsure"}', '{author:"page",nopromo:"page_no_promotion",series:"series",launch:"launch",unsure:"unsure"}');

// The plan without the condition lives behind a «?» on «Кабинет автора» (why-share.js), not in a card.
js += "\n" + fs.readFileSync(path.join(repo, "scripts", "author-landing", "why-share.js"), "utf8");
fs.writeFileSync(jsFile, js);

const css = fs.readFileSync(cssFile, "utf8") + "\n" + fs.readFileSync(path.join(repo, "scripts", "author-landing", "why-share.css"), "utf8");
fs.writeFileSync(cssFile, css);

// index.html: rendered again in Russian from the changed script.
const sandbox = { window: {}, defineMessages: (x) => x };
vm.createContext(sandbox);
try { vm.runInContext(js, sandbox); } catch { /* stops at the first DOM call; the renderer and the copy are defined by then */ }
const html = sandbox.window.BoksAuthorRender(sandbox.window.BoksAuthorCopy.ru);
const page = fs.readFileSync(htmlFile, "utf8");
const a = page.indexOf('<div id="app">') + '<div id="app">'.length;
const b = page.lastIndexOf("</div><script>");
// A new address for the changed files, so no cached copy outlives them (as import.mjs does).
const version = createHash("sha256").update(js + css).digest("hex").slice(0, 12);
const versionFile = path.join(repo, "components", "boks", "author-landing", "landing-version.ts");
const previous = fs.readFileSync(versionFile, "utf8").match(/authorLandingVersion = "([0-9a-f]+)"/)[1];
fs.writeFileSync(htmlFile, (page.slice(0, a) + html + page.slice(b)).split(`?v=${previous}`).join(`?v=${version}`));
fs.writeFileSync(versionFile, fs.readFileSync(versionFile, "utf8").replace(previous, version));

for (const gone of ["45 000", "Пять Boks Series", "Свои или", "Примерно через минуту", "в подарок"]) {
  if (html.includes(gone)) throw new Error(`index.html still says ${gone}`);
}
console.log("The page for authors now follows the contract.");
