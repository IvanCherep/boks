/**
 * The curtain previews' descriptors for series pieces, from the catalogue:
 *
 *     npx tsx --tsconfig tsconfig.json scripts/curtain-cards.mts [storyId ...] > cards.json
 *     python3 scripts/curtain-preview.py cards.json --out DIR --video
 *
 * Title, byline and cover come from `series-catalogue.ts`, so a new piece gets
 * its card with no extra step. The cover's place behind the curtain is its own
 * `coverFocus`, unless `curtainCrop` below has a hand-set wide crop: those are
 * kept apart from the reader's crop, as the curtain shows a different window.
 * No ids: every piece.
 */
import { seriesPieces } from "@/components/boks/series/series-catalogue";

/** cropTop: share of the scaled cover's full height above the window (curtain handoff, 2026-11-10). */
const curtainCrop: Record<string, { cropTop: number; titleSize?: number }> = {
  "cc7e3800-3567-42c1-ba08-8554a345e25c": { cropTop: 0.525 }, // коса
  "6c74c9da-dca3-4a16-b238-12c93242dc1f": { cropTop: 0.5107, titleSize: 90 }, // из возвращения в побег
  "c79992b0-37ea-41f9-a2c8-cc645a3b43b7": { cropTop: 0.535 }, // память шва
  "4c517503-f15f-4602-9d29-e1ac34cbbfad": { cropTop: 0.545 }, // азбука веры
  "12794275-b2ca-48ea-a1a0-4fa1f3dd0a07": { cropTop: 0.45, titleSize: 104 }, // у горы Мегиддо
  "4eb182a0-770e-4b95-9059-07a31b229d78": { cropTop: 0.268, titleSize: 104 }, // розы Сарагосы
};

const percent = (value: string | undefined) => {
  const number = Number.parseFloat(value ?? "");
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number / 100)) : 0.5;
};

const wanted = new Set(process.argv.slice(2));
const cards = seriesPieces
  .filter((piece) => wanted.size === 0 || wanted.has(piece.storyId))
  .map((piece) => {
    const [x, y] = piece.coverFocus.split(/\s+/);
    return {
      key: piece.storyId,
      title: piece.title,
      byline: piece.author,
      art: `public${piece.cover}`,
      focus: [percent(x), percent(y)],
      ...curtainCrop[piece.storyId],
    };
  });

process.stdout.write(`${JSON.stringify(cards, null, 2)}\n`);
