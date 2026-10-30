import { seriesPieceFor } from "@/components/boks/series/series-catalogue";
import { catalogueBokArtwork } from "@/lib/boks/catalogue-artwork";

function artworkFor(bokId?: string) {
  if (!bokId) return null;
  const series = seriesPieceFor(bokId);
  // Preserve both the existing image and the reader's centred Series crop.
  // The Series shelf continues to own its separate authored coverFocus.
  if (series) return { cover: series.cover, coverFocus: "50% 50%" };
  const artwork = Object.prototype.hasOwnProperty.call(catalogueBokArtwork, bokId) ? catalogueBokArtwork[bokId] : undefined;
  return artwork ? { cover: `/covers/${bokId}.webp`, ...artwork } : null;
}

/** Artwork is resolved by exact bok ID; Series always keeps its existing cover. */
export function getBokArtwork(bok: { id?: string; title?: string; authorName?: string }): string | null {
  return artworkFor(bok.id)?.cover ?? null;
}

export function bokArtworkFocus(bokId: string) {
  return artworkFor(bokId)?.coverFocus ?? "50% 50%";
}

/** The image renderer needs JPEG; only registered, application-owned paths enter it. */
export function getBokPosterArtwork(bokId: string): string | null {
  const cover = artworkFor(bokId)?.cover;
  return cover?.replace(/^\/(?:series|covers)\//u, "/share/art/").replace(/\.webp$/u, ".jpg") ?? null;
}

/** The image crop is authored per bok; illustrated cover controls stay white. */
export function bokArtworkStyle(bokId: string) {
  const artwork = artworkFor(bokId);
  return {
    "--bok-art-focus": artwork?.coverFocus ?? "50% 50%",
  };
}
