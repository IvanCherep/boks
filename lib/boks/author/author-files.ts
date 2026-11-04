import { parseFrontMatter } from "@/lib/boks/import/parse-catalogue";
import { maxBokCharacters } from "@/lib/boks/contracts";

/**
 * The files an author already has, turned into pieces the cabinet can send.
 *
 * A writer with a body of work keeps it as documents, not as something to
 * paste one at a time. The cabinet takes `.txt`, `.md` and `.docx` - one file
 * per piece - and reads them in the browser; nothing is uploaded until the
 * author sends each piece through the ordinary `submit_bok_for_review`, with
 * the same rights statement and the same 15-minute rule.
 *
 * Unlike the admin catalogue import (`lib/boks/import/parse-catalogue.ts`) no
 * front matter is required: a plain text file is the common case. When a file
 * does start with a `---` block, its `title` and `author` are read.
 */

export type AuthorFilePiece = {
  /** The file it came from, for the author to recognise it. */
  fileName: string;
  /** Empty means the text's first line becomes the title, as in the form. */
  title: string;
  text: string;
  /** A byline named in front matter; empty means the cabinet's byline. */
  authorName: string;
};

export const authorFileAccept = ".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isSupportedAuthorFile(name: string) {
  return /\.(txt|md|markdown|docx)$/i.test(name);
}

const frontMatterFence = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Plain text or Markdown, as read from a file. */
export function pieceFromText(fileName: string, content: string): AuthorFilePiece {
  let body = content.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  let title = "";
  let authorName = "";

  const match = body.match(frontMatterFence);
  if (match) {
    const fields = parseFrontMatter(match[1]);
    title = (fields.title || fields.name || "").trim();
    authorName = (fields.author || fields.author_name || fields.byline || "").trim();
    body = body.slice(match[0].length);
  }

  // A Markdown file's first `# heading` is its title, and is not left in the text.
  if (!title && /\.(md|markdown)$/i.test(fileName)) {
    const heading = body.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
    if (heading && body.slice(0, heading.index).trim() === "") {
      title = heading[1].trim();
      body = body.slice((heading.index ?? 0) + heading[0].length);
    }
  }

  return { fileName, title, text: tidyText(body), authorName };
}

/** Trailing spaces off every line, at most one blank line in a row, no blank edges. */
export function tidyText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A long text as consecutive parts that each fit a bok, cut between
 * paragraphs; a paragraph that alone is too long is cut between sentences,
 * and a sentence that is too long between words. Nothing is dropped or
 * reordered; only the whitespace at a cut changes.
 */
export function splitIntoEpisodes(text: string, limit: number = maxBokCharacters): string[] {
  const clean = tidyText(text);
  if (clean.length <= limit) return clean ? [clean] : [];

  const units = clean.split(/\n\n/).flatMap((paragraph) => breakDown(paragraph, limit));
  const parts: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      if (current) parts.push(current);
      current = unit;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function breakDown(paragraph: string, limit: number): string[] {
  if (paragraph.length <= limit) return [paragraph];
  // Split after sentence-ending punctuation and the space that follows it, so
  // every character stays in some sentence.
  const sentences = paragraph.split(/(?<=[.!?…]["»”)]*\s+)/u);
  const pieces: string[] = [];
  let current = "";
  const push = (value: string) => {
    if (value.trim()) pieces.push(value.trim());
  };
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      push(current);
      current = "";
      // One enormous sentence: by words, or by characters if it has none.
      let rest = sentence;
      while (rest.length > limit) {
        const cut = rest.lastIndexOf(" ", limit);
        const at = cut > limit / 2 ? cut : limit;
        push(rest.slice(0, at));
        rest = rest.slice(at);
      }
      current = rest;
      continue;
    }
    if ((current + sentence).length <= limit) current += sentence;
    else {
      push(current);
      current = sentence;
    }
  }
  push(current);
  return pieces;
}

/** `Title`, part 2 of 5 -> `Title. Part 2` in the interface language. */
export function episodeTitle(title: string, index: number, language: "en" | "ru") {
  const base = title.trim();
  const label = language === "ru" ? `Часть ${index + 1}` : `Part ${index + 1}`;
  return base ? `${base}. ${label}` : label;
}

// ----------------------------------------------------------------- .docx

/**
 * The text of a Word document: its paragraphs, a blank line between them.
 * A `.docx` is a zip; `word/document.xml` holds the body. Read with the
 * browser's own `DecompressionStream`, so no library is shipped for it.
 * Formatting is dropped - a bok is plain text.
 */
export async function readDocxText(data: ArrayBuffer): Promise<string> {
  const xml = await unzipEntry(new Uint8Array(data), "word/document.xml");
  if (xml === null) throw new Error("This is not a Word document.");
  return docxXmlToText(xml);
}

export function docxXmlToText(xml: string): string {
  const body = xml.match(/<w:body[\s>][\s\S]*<\/w:body>/)?.[0] ?? xml;
  const paragraphs = body.match(/<w:p[\s>][\s\S]*?<\/w:p>|<w:p\/>/g) ?? [];
  const lines = paragraphs.map((paragraph) => {
    let line = "";
    const tokens = paragraph.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g) ?? [];
    for (const token of tokens) {
      if (token.startsWith("<w:tab")) line += "\t";
      else if (token.startsWith("<w:br") || token.startsWith("<w:cr")) line += "\n";
      else line += decodeXml(token.replace(/^<w:t(?:\s[^>]*)?>/, "").replace(/<\/w:t>$/, ""));
    }
    return line;
  });
  // A Word paragraph is a paragraph: one blank line between them, as a bok has.
  return tidyText(lines.join("\n\n"));
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

/** One file out of a zip archive, by its central directory. Null when absent. */
async function unzipEntry(bytes: Uint8Array, wanted: string): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last record signed 0x06054b50.
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) return null;

  const entries = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();

  for (let entry = 0; entry < entries; entry += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== wanted) continue;

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(start, start + compressedSize);
    if (method === 0) return decoder.decode(compressed);
    if (method !== 8) return null;
    const stream = new Blob([compressed.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return decoder.decode(await new Response(stream).arrayBuffer());
  }
  return null;
}

/** A file the author chose, read into a piece. */
export async function readAuthorFile(file: File): Promise<AuthorFilePiece> {
  if (/\.docx$/i.test(file.name)) {
    const text = await readDocxText(await file.arrayBuffer());
    return { fileName: file.name, title: "", text, authorName: "" };
  }
  return pieceFromText(file.name, await file.text());
}
