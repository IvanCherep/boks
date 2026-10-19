import { Suspense } from "react";
import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import {
  loadBokForShare,
  shareDescription,
  shareReadingNote,
  shareTitle,
  sharedBokIdFrom,
} from "@/lib/boks/share-preview";
import { sharedBokRedirectScript } from "@/lib/boks/shared-bok-redirect";
import { OpenSharedBok } from "./open-shared-bok";
import { sharePosterVersion } from "@/lib/boks/share-link";
import { sharePosterSize } from "@/lib/boks/share-poster";

/**
 * A shareable link to one boks.
 *
 * Rendered on the server for one reason: a messenger asked to preview this link
 * fetches the HTML once and never runs JavaScript. Before this, the route was a
 * client-side redirect, so a shared poem previewed as the bare word "boks".
 * Now the title, the opening lines and the cover come from the server, and the
 * redirect below still takes a person to the reader.
 *
 * Nothing here can fail the page: the lookup swallows its own errors and
 * returns null, and every branch has a generic answer.
 */
type RouteParams = { id: string };

async function idFrom(params: RouteParams | Promise<RouteParams>) {
  const resolved = await params;
  // Repairs what messengers do to a shared link - see `sharedBokIdFrom`.
  return sharedBokIdFrom(String(resolved?.id ?? ""));
}

export async function generateMetadata({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}): Promise<Metadata> {
  const id = await idFrom(params);
  const bok = await loadBokForShare(id);
  const url = `${boksOrigin}/b/${id}`;

  if (!bok) {
    return {
      title: "boks",
      description: "Short literature, one focused read at a time.",
      alternates: { canonical: url },
      openGraph: { type: "website", url, siteName: "boks", title: "boks" },
    };
  }

  const title = shareTitle(bok);
  const description = shareDescription(bok.text);
  const image = `${boksOrigin}/b/${id}/image?v=${sharePosterVersion}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      siteName: "boks",
      url,
      title,
      description,
      images: [{ url: image, ...sharePosterSize, alt: title, type: "image/png" }],
      authors: bok.authorName ? [bok.authorName] : undefined,
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/**
 * What the link is, for a crawler that reads the page rather than its Open
 * Graph tags. Streamed behind the redirect script, so the script reaches a
 * person's browser without waiting for this lookup.
 */
async function SharedBokText({ id }: { id: string }) {
  const bok = await loadBokForShare(id);
  if (!bok) return null;
  return (
    <>
      <h1 className="mt-8">{bok.title}</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        {[bok.authorName, shareReadingNote(bok)].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-4">{shareDescription(bok.text, 320)}</p>
    </>
  );
}

export default async function SharedBokPage({
  params,
}: {
  params: RouteParams | Promise<RouteParams>;
}) {
  const id = await idFrom(params);

  return (
    <>
      {/* Before anything below is painted: a person goes straight to the
          reader, and a crawler, which runs no script, keeps the page. */}
      <script dangerouslySetInnerHTML={{ __html: sharedBokRedirectScript(id) }} />
      <main className="reader-v44 reader-system-page">
        <article className="reader-system-page__body">
          <a href="/" className="brand-word brand-button">
            boks
          </a>
          <Suspense fallback={null}>
            <SharedBokText id={id} />
          </Suspense>
          <p className="mt-8 text-sm text-[var(--muted-foreground)]">Opening this bok…</p>
        </article>
        <OpenSharedBok id={id} />
      </main>
    </>
  );
}
