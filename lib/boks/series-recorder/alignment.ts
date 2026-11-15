/**
 * Word times for an author's own recording, and whether the take is the text.
 *
 * Forced alignment (ElevenLabs `/v1/forced-alignment`, the recording plus the
 * exact text) gives every character a time, but glues a short word that opens
 * a line after a pause («в», «и») to the end of the phrase before it. Speech
 * to text hears where that word really starts, so where the two agree on a
 * word and speech to text starts it clearly later, its start is taken
 * (`docs/link-only-pieces.md`, as done by hand for Дарья Мальо-Субботина).
 *
 * Speech to text is also the check that the take reads the text: forced
 * alignment always returns times, even for a take that skipped a stanza.
 */

export type ForcedAlignment = {
  characters: { text: string; start: number; end: number }[];
  words: { text: string; start: number; end: number }[];
  loss?: number;
};

export type SpeechWord = { text: string; start: number; end: number; type?: string };

/** The character alignment `buildPoemManifest` reads. */
export type CharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

const normalise = (word: string) => word.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]/gu, "");

/** Pairs of equal items, longest common subsequence: [index in a, index in b]. */
function commonPairs(a: string[], b: string[]): [number, number][] {
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

export type TakeMatch = {
  /** Share of the text's words heard, in order. */
  match: number;
  words: number;
  missed: string[];
  extra: string[];
};

/** How much of the text the take reads, and the first words it missed or added. */
export function matchTake(text: string, heard: SpeechWord[], limit = 6): TakeMatch {
  const textWords = (text.match(/\S+/g) ?? []).filter((word) => normalise(word));
  const spoken = heard.filter((word) => (word.type ?? "word") === "word" && normalise(word.text));
  const a = textWords.map(normalise);
  const b = spoken.map((word) => normalise(word.text));
  const pairs = commonPairs(a, b);
  const inText = new Set(pairs.map(([i]) => i));
  const inTake = new Set(pairs.map(([, j]) => j));
  return {
    match: a.length ? pairs.length / a.length : 0,
    words: a.length,
    missed: textWords.filter((_, i) => !inText.has(i)).slice(0, limit),
    extra: spoken.filter((_, j) => !inTake.has(j)).map((word) => word.text).slice(0, limit),
  };
}

/**
 * Character times for `text`, from forced alignment corrected by speech to text.
 * `text` must be exactly the text that was aligned.
 */
export function characterAlignment(text: string, aligned: ForcedAlignment, heard: SpeechWord[]): CharacterAlignment {
  const tokens = [...text.matchAll(/\S+/g)].map((match) => ({ from: match.index!, to: match.index! + match[0].length, text: match[0] }));
  const starts: number[] = [];
  const ends: number[] = [];

  if (aligned.characters.length === text.length) {
    // One entry a character: each word spans its own characters.
    for (const token of tokens) {
      const span = aligned.characters.slice(token.from, token.to);
      starts.push(Math.min(...span.map((c) => c.start)));
      ends.push(Math.max(...span.map((c) => c.end)));
    }
  } else {
    const words = aligned.words.filter((word) => word.text.trim());
    if (words.length !== tokens.length) {
      throw new Error(`Forced alignment returned ${words.length} words for a text of ${tokens.length}.`);
    }
    for (const word of words) {
      starts.push(word.start);
      ends.push(word.end);
    }
  }

  // Where speech to text heard the same word clearly later, inside the aligned span, it starts there.
  const spoken = heard.filter((word) => (word.type ?? "word") === "word");
  const a = tokens.map((token) => normalise(token.text));
  const b = spoken.map((word) => normalise(word.text));
  for (const [i, j] of commonPairs(a, b)) {
    if (!a[i]) continue;
    const start = spoken[j].start;
    if (start - starts[i] > 0.25 && start < ends[i]) starts[i] = start;
  }
  // Times only move forward.
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1];
    if (ends[i] < starts[i]) ends[i] = starts[i];
  }

  const characters: string[] = [];
  const characterStarts: number[] = [];
  const characterEnds: number[] = [];
  let token = 0;
  let last = 0;
  for (let position = 0; position < text.length; position += 1) {
    while (token < tokens.length && tokens[token].to <= position) {
      last = ends[token];
      token += 1;
    }
    const inside = token < tokens.length && tokens[token].from <= position;
    characters.push(text[position]);
    characterStarts.push(inside ? starts[token] : last);
    characterEnds.push(inside ? ends[token] : last);
  }
  return { characters, character_start_times_seconds: characterStarts, character_end_times_seconds: characterEnds };
}

/** Every time moved by `seconds` (a take trimmed at its head), never below zero. */
export function shiftAlignment(alignment: CharacterAlignment, seconds: number): CharacterAlignment {
  const shift = (values: number[]) => values.map((value) => Math.max(0, Math.round((value - seconds) * 1000) / 1000));
  return {
    characters: alignment.characters,
    character_start_times_seconds: shift(alignment.character_start_times_seconds),
    character_end_times_seconds: shift(alignment.character_end_times_seconds),
  };
}
