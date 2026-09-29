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
 * A sentence too long for one card, split into balanced pieces.
 *
 * Filling each card to the brim and letting the remainder fall onto the next
 * one leaves an orphan: a 103-character sentence became 91 characters and then
 * a card holding "сиянием луны." for a second and a half, which on screen
 * looks like a mistake. Aiming at an even share instead gives two half-cards.
 */
function breakLongSentence(sentence: string) {
  if (sentence.length <= maxLineCharacters) return [sentence];

  const pieceCount = Math.ceil(sentence.length / maxLineCharacters);
  const target = Math.ceil(sentence.length / pieceCount);

  const pieces: string[] = [];
  let current = "";
  for (const word of sentence.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    // Overshoot the target rather than the card, and only when there is
    // already something to leave behind.
    if (current && candidate.length > target && pieces.length < pieceCount - 1) {
      pieces.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) pieces.push(current);
  return pieces;
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

  const rawLines = verse
    ? clean.split("\n").map((line) => line.trim()).filter(Boolean)
    : clean
        .split(/\n{2,}/)
        .flatMap((paragraph) => splitSentences(paragraph.replace(/\n/g, " ")))
        .flatMap(breakLongSentence);

  // Verse lines are short, and one short line per scene-change would strobe.
  // Pairing them gives a card with something on it.
  const grouped: string[] = [];
  for (const line of rawLines) {
    const previous = grouped[grouped.length - 1];
    if (verse && previous && previous.length + line.length <= maxLineCharacters) {
      grouped[grouped.length - 1] = `${previous}\n${line}`;
    } else {
      grouped.push(line);
    }
  }

  const lines: NarrationLine[] = [];
  let spoken = "";
  for (const line of grouped) {
    const start = spoken.length;
    // Newlines inside a verse pair are shown but not spoken as a break.
    spoken += `${line.replace(/\n/g, " ")} `;
    lines.push({ text: line, start, end: spoken.length });
  }

  const sceneCount = Math.max(1, Math.min(targetSceneCount, Math.ceil(lines.length / 3)));
  const perScene = Math.ceil(lines.length / sceneCount);
  const sceneStarts = Array.from({ length: sceneCount }, (_, index) => index * perScene).filter(
    (start) => start < lines.length
  );

  return { lines, sceneStarts, spoken: spoken.trim(), seed: seedFrom(input.id) };
}

/** Which line is being spoken, from how far the voice has read. */
export function lineAtCharacter(lines: readonly NarrationLine[], character: number) {
  if (!lines.length) return 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (character >= lines[index].start) return index;
  }
  return 0;
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
