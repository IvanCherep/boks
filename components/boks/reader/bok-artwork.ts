import { seriesPieceFor } from "@/components/boks/series/series-catalogue";

/** Artwork belongs to a published series piece, never to a guessed title match. */
export function getBokArtwork(bok: { id?: string; title?: string; authorName?: string }): string | null {
  return seriesPieceFor(bok.id)?.cover ?? null;
}

/** One authored contrast choice keeps the wordmark and native bar in sync,
 * before the picture loads. Native bars use the opposite neutral surface. */
export function bokArtworkStyle(bokId: string) {
  const darkInk = seriesPieceFor(bokId)?.coverLogoTone === "dark";
  return {
    "--bok-art-ink": darkInk ? "#222621" : "#fff8eb",
    "--bok-art-chrome": darkInk ? "#ffffff" : "#000000",
  };
}
