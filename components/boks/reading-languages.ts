import { isUnreachableBoksError } from "@/lib/boks/network-errors";
/**
 * Which languages a reader accepts.
 *
 * Three kinds of reader have to be comfortable: people who read only English,
 * people who read only Russian, and people who read both. Showing someone a
 * piece in a language they cannot read is not a weak recommendation, it is not
 * a recommendation - so this is a filter and never a score.
 *
 * Where the default comes from: the browser. `navigator.languages` for a
 * Russian-speaking reader almost always already reads
 * `["ru", "ru-RU", "en-US", "en"]`, so a bilingual reader gets both languages
 * and an English-only reader gets English, with nothing asked of either. That
 * is worth more than a correct-in-theory onboarding question placed in front of
 * the one promise the product makes, which is that you open it and read.
 *
 * The default is a starting point and nothing more. It is stored the moment a
 * reader changes it, and from then on their choice is what counts.
 */

export const supportedReadingLanguages = ["en", "ru"] as const;

export type ReadingLanguage = (typeof supportedReadingLanguages)[number];

export const readingLanguageNames: Record<ReadingLanguage, string> = {
  en: "English",
  ru: "Russian",
};

const storageKey = "boks-reading-languages";

function isSupported(value: string): value is ReadingLanguage {
  return (supportedReadingLanguages as readonly string[]).includes(value);
}

/** `ru-RU` and `RU` both mean `ru`; anything unsupported is dropped. */
export function normalizeReadingLanguages(values: readonly string[] | null | undefined) {
  const seen = new Set<ReadingLanguage>();
  for (const raw of values ?? []) {
    const tag = String(raw).trim().toLowerCase().split("-")[0];
    if (isSupported(tag)) seen.add(tag);
  }
  return supportedReadingLanguages.filter((language) => seen.has(language));
}

/**
 * What the browser says the reader reads, narrowed to what boks publishes.
 *
 * An empty result means the browser named nothing we carry - a Japanese-only
 * browser, say - and the honest response is to filter nothing rather than to
 * show that reader an empty app.
 */
/**
 * Does a change of languages leave the feed standing?
 *
 * Turning one off does not: what is on screen, and much of what is queued
 * behind it, may be in the language just refused. Turning one on does: nothing
 * has stopped being readable, and the feed extends itself with the wider
 * filter, so the reader keeps the piece they were in the middle of and the new
 * language arrives on its own. Rebuilding on both was
 * https://github.com/IvanCherep/boks/issues/5.
 *
 * Kept as a rule of its own because the reader cannot be asked about it in a
 * test: the pills are in an account that a test has no way to sign in to.
 */
export function readingLanguageChangeKeepsFeed(
  previous: readonly string[],
  next: readonly string[]
) {
  const stillAllowed = new Set<string>(next);
  return previous.every((language) => stillAllowed.has(language));
}

export function readingLanguagesFromBrowser(): ReadingLanguage[] {
  if (typeof navigator === "undefined") return [];
  const declared = navigator.languages?.length ? navigator.languages : [navigator.language];
  return normalizeReadingLanguages(declared);
}

/**
 * The guest's copy of the setting.
 *
 * A guest has no profile row to store it in, so it lives here and is sent with
 * the feed request. A signed-in reader's stored choice always wins over this,
 * which is what makes the setting follow them between devices.
 */
export function storedReadingLanguages(): ReadingLanguage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeReadingLanguages(parsed) : null;
  } catch {
    return null;
  }
}

export function rememberReadingLanguages(languages: readonly string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeReadingLanguages(languages)));
  } catch {
    // A private window refusing storage is not a reason to fail a feed load.
  }
}

/** The set to send with a feed request: the reader's choice, else the browser's. */
export function effectiveReadingLanguages(stored: readonly string[] | null | undefined) {
  const chosen = normalizeReadingLanguages(stored);
  if (chosen.length) return chosen;
  const remembered = storedReadingLanguages();
  if (remembered?.length) return remembered;
  return readingLanguagesFromBrowser();
}

/**
 * What to tell a reader whose filter leaves them nothing.
 *
 * The alternative - quietly adding a language back - would break the only
 * promise this feature makes. Saying so also surfaces the demand: a reader who
 * asked for Russian and found none is the most useful thing the console can
 * know about what to acquire next.
 */
export function describeEmptyLanguageFeed(
  languages: readonly string[],
  coverage: Record<string, number> | null | undefined
) {
  const chosen = normalizeReadingLanguages(languages);
  if (!chosen.length) return null;

  const names = chosen.map((language) => readingLanguageNames[language]);
  const available = supportedReadingLanguages.filter(
    (language) => !chosen.includes(language) && (coverage?.[language] ?? 0) > 0
  );

  return {
    title: `No boks in ${names.join(" or ")} yet`,
    body:
      available.length > 0
        ? `boks has nothing in ${names.join(" or ")} so far. There is plenty in ${available
            .map((language) => readingLanguageNames[language])
            .join(" and ")} — add it to your languages to start reading, or leave this as it is and we will fill the gap.`
        : `boks has nothing to show you yet. Your languages are set to ${names.join(" and ")}.`,
    offer: available,
  };
}

export type FeedLoadPhase = "loading" | "ready" | "failed";

export type EmptyFeedNotice =
  | { kind: "language"; title: string; body: string; offer: ReadingLanguage[] }
  | { kind: "message"; message: string }
  /** The API host did not answer: the reader's network, not an empty feed. */
  | { kind: "unreachable" };

/**
 * What to show when the feed has nothing in it.
 *
 * This decision used to live in the reader, keyed on the *text* of the status
 * message ("is it empty, or does it mention boks?"). Status is a message
 * channel - it also carries "Link copied", a copied URL and every error - so
 * the rule broke silently the moment the settled message was "Ready", and a
 * reader whose filter had emptied their feed was shown the bare word instead
 * of an explanation. It is a pure function here so that the rule has a test
 * rather than a screenshot.
 *
 * Only a load that *succeeded* can be called empty. A failure shows its error:
 * telling a reader that nothing exists in their language, when in truth the
 * request did not arrive, is the worse of the two wrong answers.
 */
export function emptyFeedNotice(input: {
  phase: FeedLoadPhase;
  message: string;
  languages: readonly string[];
  coverage: Record<string, number> | null | undefined;
}): EmptyFeedNotice {
  // A network that cannot reach our server is not a feed with nothing in it,
  // and it is the one failure a reader can act on. Checked before the phase,
  // because the phase says only that the load failed, never why.
  if (isUnreachableBoksError(input.message)) return { kind: "unreachable" };
  if (input.phase !== "ready") return { kind: "message", message: input.message };
  const gap = describeEmptyLanguageFeed(input.languages, input.coverage);
  if (!gap) return { kind: "message", message: input.message };
  return { kind: "language", ...gap };
}
