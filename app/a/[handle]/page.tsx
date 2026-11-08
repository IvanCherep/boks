import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { authorPreviewDescription, loadAuthorForShare } from "@/lib/boks/author-preview";
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
  const description = authorPreviewDescription(author);
  // An author with a portrait previews as their portrait card (design v48).
  const portrait = authorPortraitFor(author.handle);
  const image = portrait?.share ? `${boksOrigin}${portrait.share}` : `${boksOrigin}/og-cover.png`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      siteName: "boks",
      url,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: portrait ? `${portrait.given} ${portrait.family}` : "boks", ...(portrait?.share ? { type: "image/jpeg" } : {}) }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function SharedAuthorPage() {
  return <OpeningAuthor />;
}
