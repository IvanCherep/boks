import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { authorSharePitch, loadAuthorForShare } from "@/lib/boks/author-preview";
import { OpeningAuthor } from "./opening-author";
import { authorPortraitFor } from "@/components/boks/author-portraits";

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
  const author = await loadAuthorForShare(handle);
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
  const image = portrait?.share
    ? { url: `${boksOrigin}${portrait.share}`, width: 1200, height: 630, alt: `${portrait.given} ${portrait.family}`, type: "image/jpeg" }
    : photo
      ? { url: photo, width: 640, height: 640, alt: author.name, type: "image/jpeg" }
      : { url: `${boksOrigin}/og-cover.png`, width: 1200, height: 630, alt: "boks" };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "profile", siteName: "boks", url, title, description, images: [image] },
    twitter: { card: photo && !portrait?.share ? "summary" : "summary_large_image", title, description, images: [image.url] },
  };
}

export default function SharedAuthorPage() {
  return <OpeningAuthor />;
}
