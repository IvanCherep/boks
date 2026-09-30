/**
 * A boks, cut into the pieces a cinema needs: lines to show one at a time, and
 * scenes to show behind them.
 *
 * Everything here is deterministic. The same boks always gets the same scenes
 * in the same order, because a prototype that repaints itself differently on
 * every open cannot be shown to anybody twice, and because a reader who comes
 * back should find the piece they remember.
 */

/** One line of narration: what is read aloud, and what is printed on the card. */
export type NarrationLine = {
  text: string;
  /** Where this line starts in the spoken text, for matching speech progress. */
  start: number;
  end: number;
};

export type ScenePlan = {
  lines: NarrationLine[];
  /** Index of the first line of each scene. One entry per scene. */
  sceneStarts: number[];
  /** The whole text as it is spoken, which is what the offsets above index. */
  spoken: string;
  seed: number;
};

/** Longer than this and a line stops being one thought on a card. */
const maxLineCharacters = 96;
/** Fewer than this and a line is a fragment that flashes past. */
const minLineCharacters = 24;
/** Enough to feel like a film, few enough that each one is looked at. */
const targetSceneCount = 6;

/**
 * Sentence ends, in both languages the catalogue holds.
 *
 * Deliberately not a full sentence splitter. An abbreviation broken in the
 * wrong place costs a slightly short line; a clever splitter that is wrong
 * about verse costs the shape of a poem.
 */
function splitSentences(paragraph: string) {
  const parts: string[] = [];
  let current = "";
  for (const chunk of paragraph.split(/([.!?…]+["»”')\]]*\s+)/)) {
    current += chunk;
    if (/[.!?…]+["»”')\]]*\s+$/.test(chunk) && current.trim().length >= minLineCharacters) {
      parts.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * A sentence too long for one card, split into balanced pieces at its own
 * punctuation.
 *
 * Two things had to be got right. Filling each card to the brim and letting
 * the remainder fall onto the next leaves an orphan - a 103-character sentence
 * became 91 characters and then a card holding "сиянием луны." for a second
 * and a half, which reads as a fault. And breaking at any space at all put the
 * cut between "стал хлестать" and "себя, хвостом по бокам", which is a seam
 * across the middle of a phrase.
 *
 * So the sentence is first cut where its author already paused - at commas,
 * semicolons, colons and dashes - and those pieces are packed onto cards. Only
 * a clause too long to fit on its own falls back to breaking at a space.
 */
function splitAtWords(text: string, target: number, remainingPieces: number) {
  const pieces: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > target && pieces.length < remainingPieces - 1) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

function breakLongSentence(sentence: string) {
  if (sentence.length <= maxLineCharacters) return [sentence];

  const pieceCount = Math.ceil(sentence.length / maxLineCharacters);
  const target = Math.ceil(sentence.length / pieceCount);

  // The author's own pauses, kept with the words they follow.
  const clauses = sentence.split(/(?<=[,;:—–-])\s+/).filter(Boolean);

  const pieces: string[] = [];
  let current = "";
  for (const clause of clauses) {
    const candidate = current ? `${current} ${clause}` : clause;
    if (current && candidate.length > target && pieces.length < pieceCount - 1) {
      pieces.push(current);
      current = clause;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);

  // A single clause longer than a card has no pause to use; that one is cut at
  // a space, as before.
  return pieces.flatMap((piece) =>
    piece.length <= maxLineCharacters ? [piece] : splitAtWords(piece, target, Math.ceil(piece.length / maxLineCharacters))
  );
}

/**
 * Verse keeps the line breaks the writer chose; prose is cut into sentences.
 *
 * The reader already knows which of the two a boks is - `reading_shape` is
 * derived on submission - but the cinema is given the text alone, so it asks
 * the text: several short lines in a row is a stanza, not a paragraph.
 */
export function looksLikeVerse(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length < 4) return false;
  const short = lines.filter((line) => line.length <= 52).length;
  return short / lines.length >= 0.7;
}

/** A small, stable number from a string: the same boks, the same scenes. */
export function seedFrom(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
}

export function planScenes(input: { id: string; text: string }): ScenePlan {
  const clean = input.text.replace(/\r/g, "").trim();
  const verse = looksLikeVerse(clean);

  // Which lines open a paragraph, because that is where the story itself
  // changes scene. Prose paragraphs; in verse, stanzas.
  const paragraphs = verse ? clean.split(/\n{2,}/) : clean.split(/\n{2,}/);
  const rawLines: string[] = [];
  const paragraphStarts = new Set<number>();
  for (const paragraph of paragraphs) {
    const lines = verse
      ? paragraph.split("\n").map((line) => line.trim()).filter(Boolean)
      : splitSentences(paragraph.replace(/\n/g, " ")).flatMap(breakLongSentence);
    if (!lines.length) continue;
    paragraphStarts.add(rawLines.length);
    rawLines.push(...lines);
  }

  // Verse lines are short, and one short line per scene-change would strobe.
  // Pairing them gives a card with something on it.
  const grouped: string[] = [];
  const groupedParagraphStarts = new Set<number>();
  rawLines.forEach((line, rawIndex) => {
    const previous = grouped[grouped.length - 1];
    const pairs = verse && previous && previous.length + line.length <= maxLineCharacters
      && !paragraphStarts.has(rawIndex);
    if (pairs) {
      grouped[grouped.length - 1] = `${previous}\n${line}`;
      return;
    }
    if (paragraphStarts.has(rawIndex)) groupedParagraphStarts.add(grouped.length);
    grouped.push(line);
  });

  const lines: NarrationLine[] = [];
  let spoken = "";
  for (const line of grouped) {
    const start = spoken.length;
    // Newlines inside a verse pair are shown but not spoken as a break.
    spoken += `${line.replace(/\n/g, " ")} `;
    lines.push({ text: line, start, end: spoken.length });
  }

  const sceneCount = Math.max(1, Math.min(targetSceneCount, Math.ceil(lines.length / 3)));
  const sceneStarts = planSceneStarts(lines.length, sceneCount, groupedParagraphStarts);

  return { lines, sceneStarts, spoken: spoken.trim(), seed: seedFrom(input.id) };
}

/**
 * Where the pictures change.
 *
 * Evenly spaced would be arithmetic: every fifth line, wherever that lands.
 * "Лев и собачка" would have changed scene in the middle of the lion's grief,
 * because line twenty-five happened to fall there. Each even position is moved
 * to the nearest paragraph the author wrote - the story's own turns - and only
 * falls back to the arithmetic one when there is no paragraph near enough to
 * be that turn.
 */
export function planSceneStarts(
  lineCount: number,
  sceneCount: number,
  paragraphStarts: ReadonlySet<number>
) {
  const perScene = lineCount / sceneCount;
  // Far enough to find the real break, near enough not to bunch the scenes up.
  const reach = Math.max(1, Math.round(perScene * 0.6));
  const candidates = [...paragraphStarts].sort((a, b) => a - b);

  const starts: number[] = [];
  for (let index = 0; index < sceneCount; index += 1) {
    const ideal = Math.round(index * perScene);
    if (index === 0) {
      starts.push(0);
      continue;
    }
    const previous = starts[starts.length - 1];
    const snapped = candidates
      .filter((line) => line > previous && Math.abs(line - ideal) <= reach)
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    const start = snapped ?? ideal;
    if (start > previous && start < lineCount) starts.push(start);
  }
  return starts;
}

/** Which scene a line belongs to. */
export function sceneAtLine(sceneStarts: readonly number[], line: number) {
  let scene = 0;
  for (let index = 0; index < sceneStarts.length; index += 1) {
    if (line >= sceneStarts[index]) scene = index;
  }
  return scene;
}

/**
 * How long this will take to say, before a word of it has been said.
 *
 * The speech API will not tell us, and the player needs a total from the first
 * frame. Measured against the catalogue: Russian runs near 13 characters a
 * second at rate 1, English a little faster because its words are shorter.
 */
export function estimateNarrationSeconds(spoken: string, language: string) {
  const perSecond = language === "ru" ? 13.2 : 14.6;
  return Math.max(20, Math.round(spoken.length / perSecond));
}

export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
