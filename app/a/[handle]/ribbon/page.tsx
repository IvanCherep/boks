import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { authorSharePitch, bareHandle, loadAuthorForShare } from "@/lib/boks/author-preview";
import { ribbonCardForAuthor, ribbonPreview } from "@/lib/boks/ribbon";
import { OgVideo } from "@/components/boks/og-video";
import { OpeningAuthor } from "../opening-author";

/**
 * The ribbon card under test (2026-11-11) for an author: `/a/<handle>/ribbon`
 * previews with the ribbon poster and loop (`lib/boks/ribbon.ts`) once the job
 * has made them; a person lands on the author's page. Not indexed.
 */
type RouteParams = { handle: string };
const robots = { index: false, follow: false, googleBot: { index: false, follow: false } };

async function load(params: RouteParams | Promise<RouteParams>) {
  const handle = bareHandle(String((await params)?.handle ?? "")) ?? "";
  const author = handle ? await loadAuthorForShare(handle) : null;
  const card = author ? ribbonCardForAuthor(author) : null;
  return { handle, author, preview: card ? await ribbonPreview(card, `/a/${author!.handle}`, boksOrigin) : null };
}

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const { handle, author, preview } = await load(params);
  if (!author) return { title: "boks", robots };
  const url = `${boksOrigin}/@${author.handle}`;
  const title = author.name.startsWith("@") ? `${author.name} · boks` : `${author.name} · @${author.handle}`;
  const description = authorSharePitch(author);
  const images = preview ? [{ ...preview.image, alt: title }] : [{ url: `${boksOrigin}/og-cover.png`, width: 1200, height: 630, alt: "boks" }];
  return {
    title,
    description,
    robots,
    alternates: { canonical: url },
    openGraph: { type: preview ? "video.other" : "profile", siteName: "boks", url: `${boksOrigin}/a/${handle}/ribbon`, title, description, images },
    twitter: { card: "summary_large_image", title, description, images: [images[0].url] },
  };
}

export default async function RibbonAuthorPage({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const { handle, preview } = await load(params);
  return (
    <>
      {preview && <OgVideo url={preview.video.url} width={preview.video.width} height={preview.video.height} />}
      <OpeningAuthor handle={handle} />
    </>
  );
}
