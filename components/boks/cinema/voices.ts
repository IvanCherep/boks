/**
 * Who reads a boks aloud.
 *
 * Four voices, chosen by listening to twelve candidates read our own text -
 * a Tolstoy paragraph and a Pushkin stanza in Russian, Chopin and Hardy in
 * English - rather than the library's previews. Verse was the deciding test:
 * it is where a voice stops holding the line and starts reading a stanza as a
 * paragraph.
 *
 * The rule is the author's gender, not the narrator's taste: a man's prose is
 * read by a man, a woman's by a woman. It is a rule rather than a judgement
 * call so that five hundred boks do not each become an argument, and so the
 * catalogue sounds like one series instead of twelve.
 *
 * Every one of these is `rate: 1.0` in the ElevenLabs library - one credit per
 * character. Some Russian voices there bill at two or three times that, which
 * is invisible on one piece and worth hundreds of dollars across the
 * catalogue, so a replacement has to be checked for it. See
 * `docs/interactive-boks.md`.
 */

export type NarrationLanguage = "ru" | "en";

/** The author's gender, which is what picks the voice. */
export type AuthorGender = "male" | "female";

export type Narrator = {
  name: string;
  voiceId: string;
  language: NarrationLanguage;
  authorGender: AuthorGender;
  /** Credits per character in the ElevenLabs library. Keep this at 1. */
  rate: number;
};

const narrators: readonly Narrator[] = [
  { name: "Alex Bell", voiceId: "TUQNWEvVPBLzMBSVDPUA", language: "ru", authorGender: "male", rate: 1 },
  { name: "Mariia", voiceId: "EDpEYNf6XIeKYRzYcx4I", language: "ru", authorGender: "female", rate: 1 },
  { name: "Jerry B.", voiceId: "QuzlkGvsGTSxjYyGssV4", language: "en", authorGender: "male", rate: 1 },
  { name: "Sha", voiceId: "9GiYR5zXBWwc0khQNQA8", language: "en", authorGender: "female", rate: 1 },
];

export function narratorFor(language: NarrationLanguage, authorGender: AuthorGender): Narrator {
  const found = narrators.find(
    (voice) => voice.language === language && voice.authorGender === authorGender
  );
  // Every combination exists; the throw is here so a future language cannot be
  // added to the catalogue and quietly fall back to reading Russian in English.
  if (!found) throw new Error(`No narrator for ${language}/${authorGender}.`);
  return found;
}

export function allNarrators(): readonly Narrator[] {
  return narrators;
}

/**
 * The model, and how tightly it should hold its line.
 *
 * `eleven_v4` for everything: it follows audio tags more reliably than v3 and
 * holds its delivery steady across a long text, which is what keeps a
 * catalogue sounding like one series.
 *
 * Stability is the one setting that genuinely has to change by what is being
 * read. Verse needs it high - an expressive reading invents its own rhythm and
 * destroys the metre. A piece that wants acting needs it low, and gets inline
 * tags in the text as well.
 */
export const narrationModel = "eleven_v4";

export type ReadingShape = "prose" | "verse" | "expressive";

export const narrationSettings: Record<
  ReadingShape,
  { stability: number; similarity_boost: number; style: number }
> = {
  prose: { stability: 0.5, similarity_boost: 0.8, style: 0 },
  verse: { stability: 0.8, similarity_boost: 0.8, style: 0 },
  expressive: { stability: 0.3, similarity_boost: 0.8, style: 0.4 },
};
