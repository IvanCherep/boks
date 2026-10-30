import type { Story } from "@/components/boks/client-types";
import { estimateMinutes } from "@/components/boks/client-format";

/** Published catalogue ids, not invented texts or research responses. Loaded in one bounded read. */
export const galleryProfileIds = [
  "d1c74fc9-95fc-43d5-bfb2-58cb54955a99", // Жираф
  "a7ebf178-0b4c-4c42-b2cc-46f6f61ae602", // Анчар
  "767a3ac8-e12c-478c-8f21-7f2873cdc109", // Воспоминание
  "a49896d0-be71-4b1a-9380-590738af79a2", // Весенняя гроза
  "1eacd775-7171-4df2-b6a8-50d1c8128290", // Автомобиль
];

/** Different authors from the five profile works, as in the A3 protocol. */
export const galleryTargetIds = [
  "8eab2d21-cd5f-46ef-bc56-1a65f68ea66b", // Баран и барышня
  "b0974f19-39ac-465f-8d4a-24caf7e3d558", // Баранчик
  "5dc74460-4709-4adb-9130-b9c3fb613d04", // Две песни шута
  "06016344-f1d3-4d4b-9806-d8cfc08462d2", // Демир-Кая
  "ab27ccb2-5757-480a-8ad6-b71ada64d6d5", // Воробьишко
  "cdd49f31-0648-4cab-88e6-653b23536c2e", // Волшебное зеркало
  "d0aafc20-9280-4a13-bdc4-6745d39ae24d", // Железная дорога
  "5b72fa0d-f4cf-4671-89e7-cb9bb44b4cbd", // Великан
  "7f4bd541-0adc-4134-a8c4-59e0f53b8199", // Домовой
  "6aceb1eb-70f8-4c90-9dbd-fabd59731f36", // Всю ночь гремел овраг соседний…
];

export const galleryWholeId = galleryTargetIds[0];
export const galleryFragmentSourceId = "c720d1ba-e20b-4b3e-adaa-8bcddaa0ca12"; // Бирюк
export const galleryChoiceWholeId = galleryTargetIds[7];
export const galleryChoiceFragmentSourceId = "48dc4cf3-19ac-49a4-9d84-d292bd5efedb"; // Город
export const galleryA2Ids = [galleryTargetIds[4], galleryTargetIds[0], galleryTargetIds[5]];
export const galleryBokIds = [...galleryProfileIds, ...galleryTargetIds, galleryFragmentSourceId, galleryChoiceFragmentSourceId];

/**
 * A1 gallery only: an exact opening excerpt ending at a paragraph boundary,
 * close to the example whole work's length. This is not a validated material
 * set, not a new published bok, and never written as a participant answer.
 */
export function galleryExcerpt(source: Story, targetWords: number): Story {
  const boundaries = [...source.body.matchAll(/\n\s*\n/g)].map((match) => match.index);
  const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
  const end = boundaries.reduce((best, next) =>
    Math.abs(wordCount(source.body.slice(0, next)) - targetWords) < Math.abs(wordCount(source.body.slice(0, best)) - targetWords) ? next : best,
  boundaries[0] ?? source.body.length);
  const body = source.body.slice(0, end).trimEnd();
  const words = wordCount(body);
  return { ...source, body, summary: "", wordCount: words, minutes: estimateMinutes(body) };
}
