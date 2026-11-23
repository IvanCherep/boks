/**
 * What a card may quote (`docs/story-kit.md`). Pure, so it is tested.
 *
 * A Series quotes only what its recording reads: the lines of its manifest,
 * never an epigraph or a title that is printed but not voiced. A text quotes
 * its own lines: verse line by line, prose sentence by sentence.
 */

/** The parts of a Series manifest a card reads. */
export type KitManifest = {
  scenes: { id: string; image: string }[];
  lines: { sceneId: string; tokens: { text: string }[] }[];
};

/** A picture of a Series and the words it carries on screen. */
export type KitFrame = { image: string; lines: string[] };

/** Longer than this, a line of a text is prose: it is offered a sentence at a time. */
const proseLine = 160;

/** The most a card quotes: past this, the type gets too small for a phone. */
export const kitQuoteLimit = { lines: 8, characters: 420 } as const;

function tidy(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

/** A spoken line, as the reader saw it lit: its words joined, the non-breaking spaces kept. */
function spoken(tokens: { text: string }[]) {
  return tidy(tokens.map((token) => token.text).join(" ").replace(/ ([,.;:!?…»)])/g, "$1"));
}

/** Every line a Series' recording reads, in order. */
export function manifestLines(manifest: KitManifest): string[] {
  return manifest.lines.map((line) => spoken(line.tokens)).filter(Boolean);
}

/** Each picture with its own lines; a picture with no words still makes a frame. */
export function manifestFrames(manifest: KitManifest): KitFrame[] {
  return manifest.scenes
    .filter((scene) => typeof scene.image === "string" && scene.image)
    .map((scene) => ({
      image: scene.image,
      lines: manifest.lines.filter((line) => line.sceneId === scene.id).map((line) => spoken(line.tokens)).filter(Boolean).slice(0, 4),
    }));
}

/** A text's quotable lines: verse as it is set, prose cut into sentences. */
export function textLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map(tidy)
    .filter(Boolean)
    .flatMap((line) => (line.length > proseLine ? line.split(/(?<=[.!?…])\s+(?=[«"„A-ZА-ЯЁ0-9—–-])/u).map(tidy).filter(Boolean) : [line]));
}

/** The passage a card opens with: the first lines, as many as a card holds well. */
export function defaultQuote(lines: string[]): number[] {
  const chosen: number[] = [];
  let length = 0;
  const verse = lines.slice(0, 4).every((line) => line.length <= 80);
  const most = verse ? 4 : 2;
  for (let index = 0; index < lines.length && chosen.length < most; index += 1) {
    if (chosen.length && length + lines[index].length > 260) break;
    chosen.push(index);
    length += lines[index].length;
  }
  return chosen;
}

/**
 * The selection after a tap on line `index`: taken off if chosen, else added
 * in its place, unless the card is already full. Returns null when full.
 */
export function toggleQuoteLine(lines: string[], chosen: number[], index: number): number[] | null {
  if (chosen.includes(index)) return chosen.filter((value) => value !== index);
  const next = [...chosen, index].sort((a, b) => a - b);
  const characters = next.reduce((sum, value) => sum + (lines[value]?.length ?? 0), 0);
  if (next.length > kitQuoteLimit.lines || characters > kitQuoteLimit.characters) return null;
  return next;
}

/** The chosen lines, with a gap marked where the passage skips some. */
export function quotedLines(lines: string[], chosen: number[]): string[] {
  const out: string[] = [];
  chosen.forEach((index, at) => {
    if (at > 0 && index !== chosen[at - 1] + 1) out.push("…");
    out.push(lines[index]);
  });
  return out.filter((line) => line !== undefined);
}

/** Which language a card's own words take: Russian for a Cyrillic title or name, else English. */
export function kitLanguage(text: string): "ru" | "en" {
  return /[А-Яа-яЁё]/.test(text) ? "ru" : "en";
}

/** A file name a phone keeps: latin letters, digits and dashes. */
export function kitFileName(parts: string[]) {
  const map: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  const slug = parts
    .join("-")
    .toLowerCase()
    .split("")
    .map((char) => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `boks-${slug || "card"}.jpg`;
}
