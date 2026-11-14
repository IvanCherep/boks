import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { boksOrigin } from "@/app/layout";
import { authorSharePitch, loadAuthorForShare, loadMovedAuthorHandle } from "@/lib/boks/author-preview";
import { OpeningAuthor } from "./opening-author";
import { authorPortraitFor } from "@/components/boks/author-portraits";
import { OgVideo } from "@/components/boks/og-video";

/**
 * A shareable link to one author: `/a/<handle>`, shared as `/@<handle>`
 * (`proxy.ts`). Rendered on the server so a messenger previews it with the
 * author's name and boks; a person is handed to the reader (`OpeningAuthor`).
 */
type RouteParams = { handle: string };

async function handleFrom(params: RouteParams | Promise<RouteParams>) {
  const resolved = await params;
  let handle = String(resolved?.handle ?? "");
  try {
    handle = decodeURIComponent(handle);
  } catch {
    // Read as it is.
  }
  return handle.replace(/^@+/, "").toLowerCase();
}

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const handle = await handleFrom(params);
  let author = await loadAuthorForShare(handle);
  // An earlier address previews as the page it now leads to.
  if (!author) {
    const moved = await loadMovedAuthorHandle(handle);
    if (moved) author = await loadAuthorForShare(moved);
  }
  const url = `${boksOrigin}/@${author?.handle ?? handle}`;
  if (!author) {
    return { title: "boks", alternates: { canonical: url }, openGraph: { type: "website", url, siteName: "boks", title: "boks" } };
  }
  const title = author.name.startsWith("@") ? `${author.name} · boks` : `${author.name} · @${author.handle}`;
  const description = authorSharePitch(author);
  // An author with a portrait card previews as it (design v48); one who set a
  // photo in the cabinet, as that photo; anyone else, as boks.
  const portrait = authorPortraitFor(author.handle);
  const photo = author.photoVersion ? `${boksOrigin}/a/${author.handle}/photo?v=${author.photoVersion}` : null;
  // The page's own card (set in Studio, kept through a rename) before a card registered in code.
  const card = author.shareCard ?? portrait?.share ?? null;
  const image = card
    ? { url: `${boksOrigin}${card}`, width: 1200, height: 630, alt: author.name, type: card.endsWith(".webp") ? "image/webp" : card.endsWith(".gif") ? "image/gif" : "image/jpeg" }
    : photo
      ? { url: photo, width: 640, height: 640, alt: author.name, type: "image/jpeg" }
      : { url: `${boksOrigin}/og-cover.png`, width: 1200, height: 630, alt: "boks" };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "profile", siteName: "boks", url, title, description, images: [image] },
    twitter: { card: photo && !card ? "summary" : "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function SharedAuthorPage({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const handle = await handleFrom(params);
  // A link from before the author renamed: take the reader to the page.
  const moved = await loadMovedAuthorHandle(handle);
  if (moved) redirect(`/@${moved}`);
  // The page's own moving card (Studio), else a registered portrait's curtain
  // loop; the picture above stays the still for everyone else.
  const loop = (await loadAuthorForShare(handle))?.shareVideo ?? authorPortraitFor(handle)?.shareLoop;
  return (
    <>
      {loop && <OgVideo url={`${boksOrigin}${loop}`} width={960} height={504} />}
      <OpeningAuthor />
    </>
  );
}
