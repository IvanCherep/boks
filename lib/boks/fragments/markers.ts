/**
 * Transition markers: the words a narrator uses to move the story to another
 * time or place - "На другой день", "Вечером", "Through the week", "Meanwhile".
 *
 * TextTiling sees a boundary only where the vocabulary turns over, and a new
 * episode often keeps the same people and the same words: "На другой день
 * Лаевский опять пошёл к Самойленку" is a new scene with nothing new in it
 * lexically. Its first words say so, and they are cheap to read. A marker
 * counts only at the start of a paragraph, where it moves the narrative,
 * not inside one, where it is usually a detail of the same scene.
 */

import type { Paragraph } from "@/lib/boks/fragments/text";

type Marker = { pattern: RegExp; strength: number };

// Strength 1: a jump in time stated outright. 0.7: a cut to another line of
// the story. 0.5: a time of day, which opens a new scene as often as it
// continues the old one ("Вечером они сидели…" after an afternoon scene).
const markers: Marker[] = [
  { pattern: /^(на (другой|следующий|третий|четвертый|пятый|другое|следующее) (день|утро|вечер|год|неделе)|наутро|назавтра)/u, strength: 1 },
  { pattern: /^(через|спустя) ([\p{L}-]+ )?(минут|час|дн|недел|месяц|год|лет|сутк)/u, strength: 1 },
  { pattern: /^(прошл[оаи]|миновал[оаи]?) ([\p{L}-]+ )?(минут|час|дн|недел|месяц|год|лет|сутк|время)/u, strength: 1 },
  { pattern: /^(однажды|как-то раз|как-то (утром|вечером|ночью|днем))/u, strength: 0.8 },
  { pattern: /^(между тем|тем временем|в это (же )?время|в то (же )?время)/u, strength: 0.7 },
  { pattern: /^(в тот же (день|вечер)|в тот (день|вечер)|в ту ночь|в это утро|в этот вечер)/u, strength: 0.6 },
  { pattern: /^(утром|вечером|ночью|днем|на рассвете|к вечеру|к утру|в полдень|в сумерки|после обеда|после ужина|перед обедом)(?=[\s,.]|$)/u, strength: 0.5 },
  { pattern: /^(the (next|following) (day|morning|evening|night|week|year)|next (day|morning|evening))/u, strength: 1 },
  { pattern: /^(([\p{L}-]+ )?(minutes|hours|days|weeks|months|years) (later|passed|went by))/u, strength: 1 },
  { pattern: /^(some time later|later that|after (a|some) (while|time))/u, strength: 1 },
  { pattern: /^(one (day|morning|evening|night)|once upon)/u, strength: 0.8 },
  { pattern: /^(meanwhile|in the meantime|at the same time)/u, strength: 0.7 },
  { pattern: /^(that (day|evening|night|morning)|on (that|the same) (day|evening|night))/u, strength: 0.6 },
  { pattern: /^(in the (morning|evening|afternoon)|at (dawn|dusk|noon|night))(?=[\s,.]|$)/u, strength: 0.5 },
];

/** The strength of the marker this paragraph opens with, 0 when none. */
export function transitionStrength(text: string) {
  const opening = text
    .trimStart()
    .replace(/^[«"“„'(\[]+/u, "")
    .slice(0, 80)
    .toLowerCase()
    .replace(/ё/g, "е");
  for (const marker of markers) if (marker.pattern.test(opening)) return marker.strength;
  return 0;
}

/**
 * Per gap, indexed like `Cohesion.similarity`: `markers[i]` is the gap before
 * paragraph `i`. A line of dialogue never carries one - "Утром придёшь?" is a
 * question, not a scene change.
 */
export function measureTransitions(source: string, paragraphs: Paragraph[]) {
  const strength = new Array<number>(paragraphs.length + 1).fill(0);
  for (const paragraph of paragraphs) {
    if (paragraph.index === 0 || paragraph.dialogue || paragraph.continued) continue;
    strength[paragraph.index] = transitionStrength(source.slice(paragraph.start, paragraph.end));
  }
  return strength;
}
