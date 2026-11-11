import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { loadBokForShare } from "@/lib/boks/share-preview";
import { ribbonCardForBok, ribbonPreview } from "@/lib/boks/ribbon";
import { SharedBokView, idFor, refFrom, sharedBokMetadata, type RouteParams } from "../shared-bok";

/**
 * The ribbon card under test (2026-11-11): `/b/<bok>/ribbon` is the bok's own
 * link, previewing with the ribbon poster and loop (`lib/boks/ribbon.ts`)
 * once the job has made them, and with the ordinary card until then. Not
 * indexed; a person is taken to the reader like on `/b/<bok>`.
 */
const robots = { index: false, follow: false, googleBot: { index: false, follow: false } };

async function preview(id: string) {
  const bok = await loadBokForShare(id);
  return bok ? ribbonPreview(ribbonCardForBok(bok), `/b/${bok.id}`, boksOrigin) : null;
}

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const ref = await refFrom(params);
  const metadata = await sharedBokMetadata(ref, async (bok) => (await preview(bok.id))?.image ?? null);
  return { ...metadata, robots };
}

export default async function RibbonBokPage({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const id = await idFor(await refFrom(params));
  return <SharedBokView id={id} video={(await preview(id))?.video ?? null} />;
}
