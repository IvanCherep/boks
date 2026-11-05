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

/** Only these two covers have motion; thumbnails and posters keep the still artwork. */
export function getBokCoverAnimation(bokId: string): string | null {
  return bokId === "7a67ce67-bceb-4e41-8f66-191718345880" || bokId === "3def4114-623e-4633-968a-52dd0e7cdf9b"
    ? `/covers/${bokId}.mp4`
    : null;
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
