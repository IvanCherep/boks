import type { PreviewItem, SpacePreview } from "@/components/boks/author-spaces/data";
import { getBokArtwork, bokArtworkFocus } from "@/components/boks/reader/bok-artwork";
import { seriesPieceFor } from "@/components/boks/series/series-catalogue";
import { poemManifestFor } from "@/components/boks/poetry/poems";
import { linkOnlyCover, linkOnlyFilePath } from "@/lib/boks/link-only";
import type { KitSubject } from "./story-kit-sheet";

export type KitWork = Extract<KitSubject, { kind: "work" }>;

/**
 * What "For social media" offers for a page, from the page's preview
 * (`get_author_space_preview`): the page itself and each work readers can
 * open. Studio uses it to show the team what an author gets.
 */
export function kitWorkFromPreview(item: PreviewItem, byline: string | null): KitWork | null {
  if (!item.published || !item.bokId) return null;
  const piece = item.seriesPiece ?? null;
  return {
    kind: "work",
    bokId: item.bokId,
    title: item.title,
    byline,
    // A Series' first picture; a catalogue cover; else the bok's own picture, if it has one.
    cover: piece ? linkOnlyCover(piece) : getBokArtwork({ id: item.bokId }) ?? `/b/${item.bokId}/cover.webp`,
    focus: seriesPieceFor(item.bokId)?.coverFocus ?? bokArtworkFocus(item.bokId),
    series: item.format === "series" || Boolean(piece) || Boolean(seriesPieceFor(item.bokId) && !item.seriesHeld),
    manifest: piece ? linkOnlyFilePath(piece, "manifest.json") : poemManifestFor(item.bokId),
    body: item.body,
  };
}

export function kitSubjectsFromPreview(preview: SpacePreview): { page: KitSubject; works: KitWork[] } {
  const name = preview.name || (preview.handle ? `@${preview.handle}` : "");
  const works = preview.items.map((item) => kitWorkFromPreview(item, preview.name || null)).filter((work): work is KitWork => Boolean(work));
  return {
    page: {
      kind: "page",
      name,
      photo: preview.photo ? `data:image/jpeg;base64,${preview.photo}` : null,
      covers: works.map((work) => work.cover).filter((cover): cover is string => Boolean(cover)).slice(0, 3),
      works: works.length,
      series: works.filter((work) => work.series).length,
    },
    works,
  };
}
