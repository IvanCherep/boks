/**
 * Turning a Russian Wikisource page into one boks.
 *
 * The English corpus came from Project Gutenberg, where a book is one file and
 * the work is to *split* it. Wikisource is the opposite shape: one page is
 * already one piece, and the work is to get the literature out from under the
 * apparatus - an infobox, edition tables, footnotes, scan links, declamation
 * links, and templates nested three deep.
 *
 * Gutenberg has nothing comparable for Russian: the whole catalogue holds five
 * Russian-language texts, two of which are literature. Wikisource holds
 * thousands, with per-author categories, a machine-readable publication year,
 * and its own `PD-old-70` licence marker.
 *
 * The governing decision here: **reject rather than repair**. There are
 * thousands of candidates and boks needs a few hundred, so any page this
 * converter is not sure about is dropped. A rejected poem costs nothing. A
 * poem published with `{{poem-title|XIII}}` still in it costs a reader, and
 * costs them at the only moment the product has to be good.
 */

export type WikitextShape = "verse" | "prose";

export type WikitextPiece = {
  text: string;
  shape: WikitextShape;
};

/**
 * A page that holds no text, only a list of the editions that do.
 *
 * Wikisource keeps several printings of the same work as subpages and leaves
 * the base page as a table of contents. `Silentium!` is one: it carries the
 * poetry categories and the publication year and not a single line of Tyutchev.
 * A converter that did not notice would import the edition list as a poem.
 */
export type WikitextHub = {
  hub: true;
  /** Subpage suffixes, best edition first. */
  variants: string[];
};

const verseTemplateNames = new Set(["v", "poemx", "poemx1", "стих", "poem", "стихи"]);

/**
 * Templates whose content is the text rather than furniture around it.
 *
 * Everything not named here is deleted, which is the safe direction: a deleted
 * template leaves a gap the validator can see, while a kept one leaves markup
 * in the reader's hands.
 */
const inlineTextTemplates = new Map<string, number>([
  // Letter-spaced emphasis, in its several spellings.
  ["razr", 1],
  ["razr2", 1],
  ["razr-center", 1],
  ["разр", 1],
  // Alignment: the words are the work, the position is the printer's.
  ["ц", 1],
  ["right", 1],
  ["left", 1],
  ["center", 1],
  // An epigraph is part of the work.
  ["эпиграф", 1],
  ["roman", 1],
  // A stress mark over one letter.
  ["гравис2", 1],
  ["nobr", 1],
  ["nbsp", 1],
  ["comment", 1],
  ["lang", 2],
  ["якорь", 0],
]);

/** Headings that mark the end of the work and the start of the scholarship. */
const apparatusHeadings =
  /^=+\s*(Примечания|Примѣчания|Комментарии|Комментарій|Варианты|Редакции|Редакція|[^=\n]*редакции текста|Литература|Источники?|Источник текста|Декламация|Ссылки|См\. также|Библиография|Издания|Публикации|Иллюстрации|Аудио|Переводы|В другой орфографии)\s*=+\s*$/imu;

/**
 * Walks `open`/`close` pairs and returns the index just past the matching
 * close, so nesting is handled rather than guessed at with a regex. Wikisource
 * nests templates inside templates inside file links routinely.
 */
function matchingEnd(source: string, start: number, open: string, close: string) {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    if (source.startsWith(open, index)) {
      depth += 1;
      index += open.length;
      continue;
    }
    if (source.startsWith(close, index)) {
      depth -= 1;
      index += close.length;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  return -1;
}

/** Splits a template's body on `|` at depth zero, so nested pipes survive. */
function templateParts(body: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body.startsWith("{{", index) || body.startsWith("[[", index)) {
      depth += 1;
      current += body.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (body.startsWith("}}", index) || body.startsWith("]]", index)) {
      depth -= 1;
      current += body.slice(index, index + 2);
      index += 1;
      continue;
    }
    if (body[index] === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += body[index];
  }
  parts.push(current);
  return parts;
}

function templateName(parts: string[]) {
  return parts[0].trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Replaces every template in the source, outermost first.
 *
 * `replace` returns the text to put in its place, or null to delete it. Verse
 * containers are handled here rather than afterwards because their body is
 * literature and everything else's body is not.
 */
function transformTemplates(source: string, replace: (name: string, parts: string[]) => string | null): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("{{", index);
    if (start < 0) {
      out += source.slice(index);
      break;
    }
    out += source.slice(index, start);
    const end = matchingEnd(source, start, "{{", "}}");
    if (end < 0) {
      // Unbalanced markup. Keeping the rest verbatim would publish braces;
      // the validator rejects the piece on the leftovers.
      out += source.slice(start);
      break;
    }
    const parts = templateParts(source.slice(start + 2, end - 2));
    const replacement = replace(templateName(parts), parts);
    if (replacement !== null) {
      // The body of an unwrapped template has its own templates in it, and the
      // scan has already moved past them. `{{v|...|body|1864}}` holds the poem
      // and the poem holds `{{poem-section|<1>}}` stanza marks and `{{№|5}}`
      // line numbers, all of which reached the converted text until this
      // recursion existed - the single biggest cause of rejected pages.
      out += replacement.includes("{{") ? transformTemplates(replacement, replace) : replacement;
    }
    index = end;
  }
  return out;
}

function removeLinkedFiles(source: string) {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("[[", index);
    if (start < 0) {
      out += source.slice(index);
      break;
    }
    out += source.slice(index, start);
    const end = matchingEnd(source, start, "[[", "]]");
    if (end < 0) {
      out += source.slice(start);
      break;
    }
    const inner = source.slice(start + 2, end - 2);
    const target = inner.split("|")[0].trim();
    const isFile = /^(файл|file|image|изображение|страница|page|категория|category)\s*:/iu.test(target);
    const isInterwiki = /^[a-z-]{2,12}:/u.test(target) && !/^(w|s|:w|:s)\s*:/iu.test(target);
    if (isFile || isInterwiki) {
      index = end;
      continue;
    }
    // A plain link: the reader wants the words, not the destination.
    const parts = templateParts(inner);
    out += (parts.length > 1 ? parts[parts.length - 1] : parts[0]).replace(/^:?[ws]:/iu, "");
    index = end;
  }
  return out;
}

/**
 * The longest parameter that spans several lines.
 *
 * Verse templates differ in how many positional parameters they take and in
 * what order - `{{v||body|1829}}` against `{{poemx|title|body|date}}` - and
 * hard-coding each one was wrong twice. The body of a poem is the only
 * parameter with line breaks in it, which is a property rather than a guess.
 */
function longestMultilineParameter(parts: string[]) {
  let best = "";
  for (const part of parts.slice(1)) {
    const value = part.replace(/^[^=|]{1,40}=/u, "");
    if (!value.includes("\n")) continue;
    if (value.trim().length > best.trim().length) best = value;
  }
  return best.trim() ? best : null;
}

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/gu, " ")
    .replace(/&thinsp;/gu, " ")
    .replace(/&mdash;/gu, "—")
    .replace(/&ndash;/gu, "–")
    .replace(/&laquo;/gu, "«")
    .replace(/&raquo;/gu, "»")
    .replace(/&hellip;/gu, "…")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)));
}

/**
 * Is this page an edition list rather than a work?
 *
 * Decided on the text that is left after the apparatus is stripped, not on the
 * categories: `Silentium!` carries every poetry category there is and holds no
 * poem.
 */
export function readRedactionHub(wikitext: string): WikitextHub | null {
  const subpages = [...wikitext.matchAll(/\[\[\/([^|\]]{1,120})(?:\|[^\]]*)?\]\]/gu)].map((match) =>
    match[1].trim()
  );
  if (!subpages.length) return null;

  // `Silentium!` carries none of the obvious markers: no `{{список редакций}}`
  // template and no `== Редакции ==` heading, only the category, with its
  // edition links buried inside `{{Современник|...|часть=[[/...]]}}`. Reading
  // the category is what finds it.
  const hubMarker =
    /\{\{\s*список редакций|^=+\s*Редакци|^=+[^=\n]*редакции текста|\[\[\s*Категория:\s*Списки редакций/imu.test(
      wikitext
    );
  // Lermontov's `Дума` heads its edition list `Авторские и издательские
  // редакции текста`, which matched no marker, so the list was published as
  // the poem. Rather than collect labels for ever: a work does not link two of
  // its own subpages, an edition list links nothing else. One link stays a
  // footnote, which is what a work with a variant looks like.
  const looksLikeList = new Set(subpages).size >= 2;
  const variants = rankVariants(subpages);
  if (!variants.length) return null;
  // An edition list is mostly links. A work that merely footnotes its variants
  // has prose or verse around them, which the body test below settles.
  return hubMarker || looksLikeList ? { hub: true, variants } : null;
}

/**
 * Which printing of a work to take.
 *
 * `(ДО)` is pre-reform orthography - yat and hard signs - which is a different
 * reading experience and not the one this app promises. `с ударениями` prints
 * a stress mark over every word for students of the language. A modern
 * proofread edition is what a reader wants, and the latest one is usually the
 * best proofread.
 */
export function rankVariants(subpages: readonly string[]) {
  // No `\b` anywhere near Cyrillic: in JavaScript a word boundary is defined on
  // ASCII word characters, so `/\bДО\b/` matches nothing at all and this
  // filter silently passed every pre-reform edition through. The markers are
  // parenthesised in practice - `ПСС 1903 (ДО)` - so the parentheses are the
  // boundary.
  const usable = subpages.filter(
    (name) => !/\([^)]*(?:ДО|дореформ|ударен)[^)]*\)|дореформенн|с ударениями/iu.test(name)
  );
  // Modern orthography or a proofread text first, then the later edition.
  //
  // There used to be a bonus for `ПСС` - a complete-works edition - and it
  // outranked recency, so a 1914 printing beat a 1954 one. Which edition of
  // the collected works a text comes from is a bibliographic distinction that
  // changes nothing about reading it; whether it has been proofread, and how
  // recently, does.
  const score = (name: string) => {
    let value = 0;
    if (/\(\s*(СО|ВТ)[^)]*\)/iu.test(name)) value += 100;
    const year = name.match(/\b(1[89]\d{2}|20\d{2})\b/u);
    if (year) value += Number(year[1]) / 100;
    return value;
  };
  return [...new Set(usable)].sort((a, b) => score(b) - score(a));
}

/**
 * A Wikisource page as a piece of literature, or null if it is not one.
 */
export function wikitextToPiece(wikitext: string, title?: string): WikitextPiece | null {
  let text = wikitext.replace(/\r\n?/gu, "\n");

  // HTML comments hide draft edition lists; they are not the work.
  text = text.replace(/<!--[\s\S]*?-->/gu, "");
  // Magic words are instructions to the wiki, not words. `__NOTOC__` reached
  // the top of Garshin's story on the first run and read as its opening line.
  text = text.replace(/__[A-Z]+__/gu, "");
  // Footnotes are the editor's, never the author's.
  text = text.replace(/<ref[^>]*\/>/giu, "").replace(/<ref[^>]*>[\s\S]*?<\/ref>/giu, "");

  // Everything from the first apparatus heading on is scholarship.
  const apparatus = text.match(apparatusHeadings);
  if (apparatus?.index !== undefined) text = text.slice(0, apparatus.index);

  let shape: WikitextShape = "prose";

  // `<poem>` is the explicit verse container: line breaks inside it are the
  // poet's, which is the one thing no measurement of the text can recover.
  const poemBlocks = [...text.matchAll(/<poem[^>]*>([\s\S]*?)<\/poem>/giu)].map((match) => match[1]);
  if (poemBlocks.length) {
    shape = "verse";
    text = poemBlocks.join("\n\n");
  }

  text = transformTemplates(text, (name, parts) => {
    if (verseTemplateNames.has(name)) {
      const body = longestMultilineParameter(parts);
      if (body) {
        shape = "verse";
        return body;
      }
      return null;
    }
    const keep = inlineTextTemplates.get(name);
    if (keep !== undefined) return keep === 0 ? "" : (parts[keep] ?? "").replace(/^[^=|]{1,40}=/u, "");
    return null;
  });

  text = removeLinkedFiles(text);
  text = decodeEntities(text);

  // Headings that survived are the work's own part numbers. They read as
  // lines, not as markup.
  text = text.replace(/^=+\s*(.*?)\s*=+\s*$/gmu, "$1");
  // Verse indentation is typographic; the lines carry the poem. This has to
  // happen before the heading rule below, not after: two of Krylov's fables
  // write their heading as `:'''Басни. Книга первая'''`, and with the indent
  // marker still in place the heading rule did not recognise the line.
  text = text.replace(/^[:;*#]+[ \t]*/gmu, "");
  // A typographic rule between stanzas - `________`, `-----`, `* * *` - is a
  // blank line, not a line of characters.
  text = text.replace(/^[\s]*[_\-—–*~=.]{3,}[\s]*$/gmu, "");

  // A heading that is not a template.
  //
  // Krylov's fables print their collection and their numeral as bold lines
  // inside the `<poem>` block: `''' Басни. Книга первая '''` and
  // `''' XVII. Мартышка и очки '''`. Stripping the bold markers first turned
  // both into opening lines of the fable. Only leading lines, and only lines
  // that are bold from end to end - a bold word inside the verse is the poet's.
  // `\s*` first: a `<poem>` block starts with a newline, so the heading is not
  // at index zero and an anchored pattern missed it entirely.
  text = text.replace(/^\s*(?:[ \t]*'''[^\n]*?'''[ \t]*\n+)+/u, "");
  // Bold and italic markers, then any remaining HTML.
  text = text.replace(/'{2,5}/gu, "");
  text = text.replace(/<br\s*\/?>/giu, "\n");
  text = text.replace(
    /<\/?(?:div|span|center|p|small|big|sup|sub|u|s|i|b|em|strong|font|h[1-6]|hr|blockquote|nowiki|poem|ref|references|section|includeonly|noinclude|onlyinclude|table|tbody|tr|td|th|ul|ol|li|dl|dt|dd)[^>]*>/giu,
    ""
  );
  // Editorial stress marks. Useful to a learner, noise to a reader.
  text = text.replace(/́/gu, "");
  // A bare date line in the manuscript, e.g. `<1808>`.
  text = text.replace(/^[<(]?\s*\d{4}(?:\s*[-—]\s*\d{4})?\s*[>)]?\s*$/gmu, "");

  text = text
    .split("\n")
    // Leading space in wikitext means preformatted, and inside a verse
    // template it is the editor's indentation of the source rather than the
    // poet's indentation of the line. Either way it reads as a ragged margin:
    // it put one stanza of `Парус` half a space to the right of the others.
    .map((line) => line.replace(/^[ \t ]+/u, "").replace(/[ \t ]+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();

  text = dropImprint(text);
  text = dropRepeatedTitle(text, title);

  if (!text) return null;
  return { text, shape };
}

/**
 * Lines identifying the edition the text was typed from.
 *
 * Gorky's pages open with two of them:
 *
 *   «Собрание сочинений в тридцати томах»: Государственное издательство
 *   художественной литературы; Москва; 1949
 *   Том 11. По Руси. Рассказы 1912—1917
 *
 * That is the publisher's imprint, and it was being served to readers as the
 * opening of the story - the same failure as the editor's introduction that
 * the English corpus imported as literature, in a different costume. It also
 * names a 1949 edition, whose editorial matter is nobody's to republish.
 *
 * Leading lines only, at most a handful, each matching a tight pattern and
 * short enough not to be a paragraph of prose. An imprint further down the
 * page is a different problem, and `rejectPiece` refuses the piece for it.
 */
const imprintLine: ((line: string) => boolean)[] = [
  (line) => /^[«"']?(?:полное\s+)?собрание\s+сочинени/iu.test(line),
  (line) => /^том\s+\d+[.,\s]/iu.test(line),
  // A publisher's name alone is not enough. `Он работал в типографии на
  // Мойке` is a sentence from a story, and an earlier version of this rule
  // deleted it; an imprint always carries its year.
  (line) =>
    /(?:издательств|гослитиздат|изд-во|типографи)/iu.test(line) && /\b(?:1[6-9]|20)\d{2}\b/u.test(line),
  (line) => /^(?:москва|ленинград|санкт-петербург|спб|петербург|петроград)\s*[:;,]/iu.test(line),
];

function dropImprint(text: string) {
  const lines = text.split("\n");
  let cut = 0;
  let removed = 0;
  while (cut < lines.length && removed < 4) {
    const line = lines[cut].trim();
    if (!line) {
      cut += 1;
      continue;
    }
    if (line.length > 200 || !imprintLine.some((matches) => matches(line))) break;
    cut += 1;
    removed += 1;
  }
  return removed ? lines.slice(cut).join("\n").replace(/^\n+/u, "") : text;
}

/**
 * A work that prints its own title as its first line.
 *
 * Tolstoy's `После бала` opens with `ПОСЛЕ БАЛА`, because the edition's
 * headline is part of the page. boks shows the title above the text already,
 * so keeping it means the reader meets the name twice, once shouted.
 */
function dropRepeatedTitle(text: string, title?: string) {
  if (!title) return text;
  // The subpage comes off first, then the disambiguation. A hub variant is
  // titled `На сердце злоба накипела (Плещеев)/РС 1862 (СО)`: stripping the
  // trailing parenthesis first takes `(СО)` and leaves `(Плещеев)` sitting in
  // the middle, so nothing ever matched and every incipit-titled poem printed
  // its first line twice.
  const bare = title.replace(/\s*\/.*$/u, "").replace(/\s*\([^)]*\)\s*$/u, "");
  const normalise = (value: string) =>
    value
      .toLowerCase()
      // A printed title carries its number: `XVII. Мартышка и очки`.
      .replace(/^[\s]*(?:[ivxlcdm]+|\d{1,3})[.)]\s*/iu, "")
      // Editions differ on printing the diaeresis, so `ё` and `е` are one
      // letter here.
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const wanted = normalise(bare);
  if (!wanted) return text;

  const lines = text.split("\n");
  // Only the first line, and only when the work continues past it: a poem
  // whose one line happens to be its title is not a duplicated heading.
  if (lines.length > 2 && normalise(lines[0]) === wanted) {
    return lines.slice(1).join("\n").replace(/^\n+/u, "");
  }
  return text;
}

/**
 * Everything that must be true of a piece before it can be published.
 *
 * These are refusals, not repairs. The English corpus learned this the hard
 * way: an editor's introduction that looked like a story passed every length
 * check and was imported as literature. Each rule below is one way a
 * Wikisource page can look like a work without being one.
 */
export type WikitextRejection = {
  reason: string;
  detail?: string;
};

const leftoverMarkup = [
  { pattern: /\{\{|\}\}/u, reason: "template markup survived the conversion" },
  { pattern: /\[\[|\]\]/u, reason: "link markup survived the conversion" },
  { pattern: /<\/?[a-z][^>]*>/iu, reason: "html markup survived the conversion" },
  { pattern: /&[a-z]+;|&#\d+;/iu, reason: "html entity survived the conversion" },
  { pattern: /\bhttps?:\/\//u, reason: "contains a link to somewhere else" },
  { pattern: /\|\s*$/mu, reason: "a line ends in a table pipe" },
];

/** Words that mean the page is about a work rather than being one. */
const apparatusWords =
  /(?:^|[^\p{L}])(ценз\.\s*разр|подпись:|печатается по тексту|впервые напечатано|печатается впервые|варианты?\s+текста|примечания редакции|государственное издательство|собрание сочинений в)(?![\p{L}])/imu;

export function rejectPiece(
  piece: WikitextPiece,
  limits: { minCharacters: number; maxCharacters: number }
): WikitextRejection | null {
  const { text } = piece;

  if (text.length < limits.minCharacters) {
    return { reason: "too short to be a piece", detail: `${text.length} characters` };
  }
  if (text.length > limits.maxCharacters) {
    return { reason: "longer than fifteen minutes", detail: `${text.length} characters` };
  }

  for (const { pattern, reason } of leftoverMarkup) {
    const found = text.match(pattern);
    if (found) return { reason, detail: found[0].slice(0, 40) };
  }

  if (apparatusWords.test(text)) {
    return { reason: "reads as editorial apparatus, not the work", detail: text.match(apparatusWords)?.[0] };
  }

  // A page in pre-reform orthography is a different reading experience: yat,
  // fita and the hard sign at the end of every other word.
  if (/[ѢѣІіѲѳѴѵ]/u.test(text) || /[бвгджзклмнпрстфхцчшщ]ъ(?:[\s.,;:!?»…]|$)/u.test(text)) {
    return { reason: "pre-reform orthography" };
  }

  const cyrillic = (text.match(/[А-Яа-яЁё]/gu) ?? []).length;
  const latin = (text.match(/[A-Za-z]/gu) ?? []).length;
  if (cyrillic < latin) return { reason: "not mainly in Russian" };
  if (cyrillic / text.length < 0.5) {
    return { reason: "mostly not letters", detail: `${Math.round((cyrillic / text.length) * 100)}% Cyrillic` };
  }

  return null;
}
