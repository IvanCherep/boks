import type { Metadata } from "next";
import { loadBokForShare } from "@/lib/boks/share-preview";
import { curtainCardFor, curtainLoopSize } from "@/lib/boks/curtain";
import { curtainLoopReady } from "@/lib/boks/curtain-loop";
import { boksOrigin } from "@/app/layout";
import { SharedBokView, idFor, refFrom, sharedBokMetadata, type RouteParams } from "./shared-bok";

/** A shareable link to one bok; what it is and does: `shared-bok.tsx`. */
export async function generateMetadata({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}): Promise<Metadata> {
  return sharedBokMetadata(await refFrom(params));
}

export default async function SharedBokPage({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}) {
  const id = await idFor(await refFrom(params));
  // The curtain loop beside the poster, once the server job has made it
  // (`deploy/curtain/`); until then the poster alone. Internal and quick.
  const bok = await loadBokForShare(id);
  const card = bok ? curtainCardFor(bok) : null;
  const loop = card && (await curtainLoopReady(card)) ? `${boksOrigin}/b/${card.id}/loop.mp4?v=${card.key}` : null;
  return <SharedBokView id={id} video={loop ? { url: loop, ...curtainLoopSize } : null} />;
}
