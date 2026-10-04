#!/usr/bin/env node
// Turns curated JSONL into one SQL file that loads a catalogue.
//
//   node scripts/build-catalogue-sql.mjs out.sql work/…/ru.jsonl work/…/en.jsonl
//   npx supabase db query --linked --file out.sql
//
// Why a file and not the admin console's importer: `import_boks_batch` takes
// 100 rows per call, needs an admin JWT, and ignores `genre`, `mood` and
// `language` - it was written for a folder of plain text files where none of
// those are known. A curated set knows all three, and the language decides
// which readers can be served the piece at all, so it must not be guessed.
// Everything else the database still does for itself: `boks_set_reel_word_count`
// derives the word count, minutes, reading shape and line breaks, and
// `boks_reels_title_and_hook` fills an empty title from the first line.
//
// Each row is checked here rather than in the database, because a rejected row
// in a 400-row load should be named with its file and line while the file is
// still in front of whoever ran this.
//
// The rights record is written in the same transaction as the bok: nothing in
// this catalogue is publishable without one, and an import that creates boks
// without rights leaves the moderation queue unable to approve them.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** @boks - the publisher account the whole seeded catalogue belongs to. */
const publisherUserId = "c990a7fc-1114-4a01-984b-e6ced9eeaa74";
/** The admin recorded as the reviewer and as the one confirming rights. */
const adminUserId = "c990a7fc-1114-4a01-984b-e6ced9eeaa74";
/** Overridable per batch, so a later hand-picked batch keeps its own keys. */
const importPrefix = process.env.CATALOGUE_PREFIX || "catalogue-2026-09-20";

/**
 * The floor is there to catch scrape debris - a stub page, a heading with no
 * piece under it. A short poem chosen by hand is not debris ("Ночь, улица,
 * фонарь, аптека…" is 230 characters), so a curated batch may lower it.
 */
const minCharacters = Number(process.env.CATALOGUE_MIN_CHARACTERS || 400);
/** `boks_max_text_characters()`. Kept in step with the database on purpose. */
const maxCharacters = 20_000;
const genres = new Set(["literary", "mystery", "slice of life", "speculative", "fantasy"]);
const moods = new Set(["quiet", "warm", "tense", "strange", "playful"]);
const languages = new Set(["ru", "en"]);
/**
 * Pages that a catalogue scrape picks up and a reader should never be served:
 * the book's furniture rather than anything in it.
 */
const editorialTitles = new Set([
  "от автора",
  "от редактора",
  "от издателя",
  "предисловие",
  "вместо предисловия",
  "введение",
  "послесловие",
  "примечания",
  "комментарии",
  "оглавление",
  "содержание",
  "посвящение",
  "об авторе",
  "биография",
  "preface",
  "foreword",
  "introduction",
  "contents",
  "table of contents",
  "notes",
  "appendix",
  "dedication",
  "about the author",
  "bibliography",
]);

/**
 * Publication dates, spread over the past month.
 *
 * Every piece here is a classic, so a real publication date would be 1837 -
 * which is what the previous catalogue stored, leaving `created_at` spanning
 * four centuries and the `freshness` signal meaningless. Retrieval takes half
 * a slate as "the newest", so identical timestamps would make that half an
 * accident of insertion order.
 *
 * **The order must mix the languages**, which is why `interleave` exists below.
 * Dated in file order, the 299 Russian pieces took the older half of the month
 * and the 148 English ones the newer half, so "the newest half" of every slate
 * was English and a Russian-speaking reader opened the app on Tennyson.
 * Measured on the deployed feed before the fix: the first six boks served to a
 * browser asking for `ru, en` were all English.
 */
function publishedAt(index, total) {
  const days = 30 * (1 - index / Math.max(1, total));
  const jitterMinutes = (index * 37) % 1440;
  const at = new Date(Date.now() - days * 86_400_000 - jitterMinutes * 60_000);
  return at.toISOString();
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Repairs what a Wikisource scrape leaves on a title, rather than losing the
 * work over it.
 *
 * Three artefacts, all of them mechanical: an editor's reconstruction of an
 * abbreviated word ("В альбом Б<аратынскому>" - the letters are part of the
 * title, the brackets are not), a footnote bracket left at the end ("Из песен
 * Сапфо["), and a subpage path where only the last segment is the piece
 * ("Басни / Лисица и Сурок"). Anything still carrying structure after this is
 * rejected, because then the scrape, not the title, is what went wrong.
 */
function cleanTitle(raw) {
  let title = String(raw ?? "").trim();
  const segments = title.split(/\s\/\s/);
  if (segments.length > 1) title = segments[segments.length - 1].trim();
  title = title.replace(/[<>]/g, "").replace(/[\u0300\u0301]/g, "");
  title = title.replace(/\s*\[\s*$/, "");
  title = title.replace(/^[«"'\s]+|[«\s]+$/g, "").trim();
  // A closing quote with no opening one is the other half of a cut title.
  if (/[»"]$/.test(title) && !/^[«"]/.test(title)) title = title.replace(/[»"]+$/, "").trim();
  return title.replace(/[\s.,;:]+$/, (tail) => (tail.includes("...") || tail.includes("…") ? tail : "")).trim();
}

/**
 * Drops a first line that is only the title again.
 *
 * Anthologies number their contents, and the scrape keeps the heading: Kubla
 * Khan arrived as "550.Kubla Khan" followed by the poem. The reader already
 * has the title above the text, so the line is a stutter. Only removed when
 * the line is the title and little else - never when it is the opening verse.
 */
function stripRepeatedTitle(text, title) {
  const lines = text.split("\n");
  const first = (lines[0] ?? "").trim();
  if (!first || !title) return text;
  const indexed = /^[\dIVXLCM]+\s*[.)]\s*/i.test(first);
  const bare = first.replace(/^[\dIVXLCM]+\s*[.)]\s*/i, "").trim();
  const same = bare.toLowerCase() === title.toLowerCase();
  const wrapped = bare.toLowerCase().replace(/^[«"']|[»"']$/g, "") === title.toLowerCase();
  if (!((same || wrapped) && bare.length <= title.length + 4)) return text;

  // **A line equal to the title is not always a heading.** An untitled poem is
  // known by its opening, so its title *is* its first line - "О доблестях, о
  // подвигах, о славе…", "When I was one-and-twenty" - and removing it takes a
  // line of the poem away. Two things distinguish a heading from an incipit:
  // it carries an anthology index ("550.Kubla Khan"), or it stands in its own
  // block with a blank line under it. Verse that runs straight on is the poem.
  const standsAlone = (lines[1] ?? "").trim() === "";
  if (!indexed && !standsAlone) return text;
  return lines.slice(1).join("\n").trim();
}

function read(paths) {
  const rows = [];
  const problems = [];
  for (const path of paths) {
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const where = `${path}:${index + 1}`;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch (error) {
        problems.push(`${where}: not JSON (${error.message})`);
        return;
      }
      rows.push({ ...row, where });
    });
  }
  return { rows, problems };
}

function validate(rows, problems) {
  const seenKey = new Set();
  const seenOpening = new Set();
  const kept = [];

  for (const row of rows) {
    const title = cleanTitle(row.title);
    const authorName = String(row.authorName ?? "").trim();
    // The same editorial reconstruction brackets appear inside verse - Pushkin's
    // "В евр<ейской> хижине лампада" - where the letters are the poem and the
    // brackets are an editor talking to scholars. A reader should see the word.
    //
    // Stress marks go too (U+0301, and its grave twin). Scholarly Russian
    // editions print them over the stressed vowel; a reader sees "о́" and reads
    // a typo, and because they are invisible to a naive comparison they also
    // defeat duplicate detection - the same fable arrived twice, once accented
    // and once not, and both passed.
    const text = String(row.text ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/[<>]/g, "")
      .replace(/[\u0300\u0301]/g, "")
      .trim();
    const language = String(row.language ?? "").trim();
    const genre = String(row.genre ?? "").trim();
    const mood = String(row.mood ?? "").trim();
    const sourceUrl = String(row.sourceUrl ?? "").trim();
    const reject = (reason) => problems.push(`${row.where}: ${reason}`);

    if (!title) {
      reject("no title");
      continue;
    }
    if (!authorName) {
      reject(`no author (${title})`);
      continue;
    }
    if (!languages.has(language)) {
      reject(`language ${JSON.stringify(language)} is not ru or en (${title})`);
      continue;
    }
    // Measured after the repeated title is removed, so the limits apply to
    // what a reader actually gets.
    const body = stripRepeatedTitle(text, title);
    if (body.length < minCharacters || body.length > maxCharacters) {
      reject(`${body.length} characters, outside ${minCharacters}..${maxCharacters} (${title})`);
      continue;
    }
    // A stray "[1]" or "{{...}}" means the cleaning missed a page, and a
    // footnote marker in the middle of a poem is what a reader sees.
    const markup = body.match(/\{\{|\}\}|\[\d+\]|<ref|&[a-z]+;|\|\s*style=/i);
    if (markup) {
      reject(`leftover markup ${JSON.stringify(markup[0])} (${title})`);
      continue;
    }
    // A title carrying page structure is a scrape artefact, not a title: a
    // truncated bracket ("И. Л. Бахтадзе["), or a Wikisource subpage path
    // ("Возмездие (1908 - 1913) / Забывшие тебя").
    const titleArtefact = title.match(/[[\]{}|<>]|\s\/\s|^\/|\/$/);
    if (titleArtefact) {
      reject(`title carries page structure ${JSON.stringify(titleArtefact[0])} (${title})`);
      continue;
    }
    // Editorial apparatus reads as a literary work to a scraper and as
    // nonsense to a reader.
    if (editorialTitles.has(title.toLowerCase().replace(/[.!?…]+$/, "").trim())) {
      reject(`editorial page, not a work (${title})`);
      continue;
    }

    const key = `${importPrefix}:${language}:${createHash("sha1")
      .update(`${authorName}\u0000${title}\u0000${body.slice(0, 400)}`)
      .digest("hex")
      .slice(0, 16)}`;
    if (seenKey.has(key)) {
      reject(`duplicate of an earlier row (${authorName} - ${title})`);
      continue;
    }
    const opening = body.slice(0, 200).replace(/\s+/g, " ");
    if (seenOpening.has(opening)) {
      reject(`same opening as an earlier row (${authorName} - ${title})`);
      continue;
    }
    seenKey.add(key);
    seenOpening.add(opening);

    kept.push({
      key,
      title,
      authorName,
      text: body,
      language,
      genre: genres.has(genre) ? genre : "literary",
      mood: moods.has(mood) ? mood : "quiet",
      sourceUrl,
    });
  }

  return kept;
}

/**
 * Orders the set so that each language is spread evenly across the whole
 * timeline: every piece is placed by its position *within its own language*,
 * so a slate taken from any window of dates holds both in proportion.
 */
function interleave(rows) {
  const positions = new Map();
  const counts = rows.reduce((totals, row) => {
    totals[row.language] = (totals[row.language] ?? 0) + 1;
    return totals;
  }, {});
  const seen = {};
  for (const row of rows) {
    seen[row.language] = (seen[row.language] ?? 0) + 1;
    positions.set(row, seen[row.language] / counts[row.language]);
  }
  return [...rows].sort((left, right) => positions.get(left) - positions.get(right));
}

function build(unordered) {
  const rows = interleave(unordered);
  const values = rows
    .map((row, index) =>
      [
        sqlString(row.key),
        sqlString(row.title),
        sqlString(row.authorName),
        sqlString(row.text),
        sqlString(row.genre),
        sqlString(row.mood),
        sqlString(row.language),
        sqlString(row.sourceUrl),
        `${sqlString(publishedAt(index, rows.length))}::timestamptz`,
      ].join(", ")
    )
    .map((line) => `  (${line})`)
    .join(",\n");

  return `-- Generated by scripts/build-catalogue-sql.mjs. ${rows.length} boks.
begin;

create temporary table boks_catalogue_load (
  import_key text primary key,
  title text,
  author_name text,
  text text,
  genre text,
  mood text,
  language text,
  source_url text,
  created_at timestamptz
) on commit drop;

insert into boks_catalogue_load
  (import_key, title, author_name, text, genre, mood, language, source_url, created_at)
values
${values};

-- The bok and its rights record together, so neither can exist without the
-- other. import_key is the idempotency key: running this twice imports
-- nothing the second time.
with fresh as (
  select l.*
  from boks_catalogue_load l
  -- Three ways a piece can already be here, and all three have to be checked
  -- because a second pass is how a catalogue grows. The import key covers a
  -- byte-identical reload; the byline plus title covers the same work fetched
  -- from a different page; the normalised opening covers the same work whose
  -- whitespace or line breaks differ, which is what actually happens when a
  -- poem is scraped twice from two layouts.
  where not exists (
    select 1 from public.reels r
    where r.author_user_id = ${sqlString(publisherUserId)}::uuid and r.import_key = l.import_key
  )
  and not exists (
    select 1 from public.reels r
    where lower(btrim(coalesce(r.author_name, ''))) = lower(btrim(l.author_name))
      and lower(btrim(r.title)) = lower(btrim(l.title))
  )
  and not exists (
    select 1 from public.reels r
    where left(regexp_replace(r.text, '[[:space:]]+', ' ', 'g'), 200)
        = left(regexp_replace(l.text, '[[:space:]]+', ' ', 'g'), 200)
  )
),
inserted as (
  insert into public.reels (
    title, author_name, hook, text, genre, mood, language, status,
    author_user_id, import_key, is_seed,
    created_at, submitted_at, reviewed_at, reviewed_by, updated_at
  )
  select
    f.title, f.author_name, '', f.text, f.genre, f.mood, f.language, 'published',
    ${sqlString(publisherUserId)}::uuid, f.import_key, false,
    f.created_at, f.created_at, now(), ${sqlString(adminUserId)}::uuid, now()
  from fresh f
  returning id, import_key
)
insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
select
  i.id,
  true,
  'Public domain. Source: ' || coalesce(nullif(l.source_url, ''), 'curated public-domain collection, 2026-09-20'),
  ${sqlString(adminUserId)}::uuid,
  now(),
  now()
from inserted i
join boks_catalogue_load l on l.import_key = i.import_key;

-- Counted before the commit: the load table drops on commit.
select count(*) as offered from boks_catalogue_load;

commit;

select
  count(*) filter (where status = 'published') as published,
  count(*) filter (where language = 'ru') as russian,
  count(*) filter (where language = 'en') as english,
  count(*) filter (where embedding is null) as awaiting_embedding
from public.reels;
`;
}

/**
 * Rewrites the text of boks already loaded, where the cleaning rules have
 * since changed.
 *
 * Needed once, and the reason is worth keeping: the first version of
 * `stripRepeatedTitle` removed any first line equal to the title, which took a
 * line off every poem whose title *is* its opening. The rules live in one
 * place, so the repair has to come from the same place rather than a second
 * implementation that drifts.
 *
 * Matched on byline plus title, which is unique in this catalogue, and guarded
 * by `text <> ...` so only the rows that actually differ are written - and
 * only those lose their embedding to the trigger and need re-embedding.
 */
function buildRepair(rows) {
  const perFile = 25;
  const files = [];
  for (let start = 0; start < rows.length; start += perFile) {
    const batch = rows.slice(start, start + perFile);
    const values = batch
      .map((row) => `  (${sqlString(row.authorName)}, ${sqlString(row.title)}, ${sqlString(row.text)})`)
      .join(",\n");
    // A temp table, so each text is written once rather than twice, and the
    // whole batch is one statement: a repair split by string surgery on the
    // generated SQL breaks on any poem whose line ends in a semicolon, which
    // is most of them.
    files.push(`begin;

create temporary table boks_repair (author_name text, title text, text text) on commit drop;

insert into boks_repair (author_name, title, text) values
${values};

update public.reels r
set text = p.text
from boks_repair p
where lower(btrim(r.author_name)) = lower(btrim(p.author_name))
  and lower(btrim(r.title)) = lower(btrim(p.title))
  and r.text <> p.text;

commit;
`);
  }
  return files;
}

const argv = process.argv.slice(2);
const repair = argv.includes("--repair");
const [outPath, ...inputs] = argv.filter((value) => value !== "--repair");
if (!outPath || !inputs.length) {
  console.error("usage: node scripts/build-catalogue-sql.mjs [--repair] <out.sql> <in.jsonl...>");
  process.exit(2);
}

const { rows, problems } = read(inputs);
const kept = validate(rows, problems);
if (repair) {
  const files = buildRepair(kept);
  files.forEach((contents, index) => writeFileSync(`${outPath}.${String(index).padStart(3, "0")}.sql`, contents));
  console.error(`wrote ${files.length} repair files as ${outPath}.NNN.sql`);
} else {
  writeFileSync(outPath, build(kept));
}

const byLanguage = kept.reduce((counts, row) => {
  counts[row.language] = (counts[row.language] ?? 0) + 1;
  return counts;
}, {});
const lengths = kept.map((row) => row.text.length).sort((left, right) => left - right);
const authors = new Set(kept.map((row) => row.authorName));

console.error(`read ${rows.length} rows, kept ${kept.length}, rejected ${problems.length}`);
console.error(`by language: ${JSON.stringify(byLanguage)}, authors: ${authors.size}`);
if (lengths.length) {
  console.error(
    `characters: min ${lengths[0]}, median ${lengths[Math.floor(lengths.length / 2)]}, max ${lengths[lengths.length - 1]}`
  );
}
for (const problem of problems.slice(0, 40)) console.error(`  rejected ${problem}`);
if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
