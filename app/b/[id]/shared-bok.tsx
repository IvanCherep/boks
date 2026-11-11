import { Suspense } from "react";
import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import {
  loadBokForShare,
  shareDescription,
  sharePitchFor,
  shareReadingNote,
  shareTitle,
  sharedBokRefFrom,
  type SharedBok,
} from "@/lib/boks/share-preview";
import { sharedBokRedirectScript } from "@/lib/boks/shared-bok-redirect";
import { OpenSharedBok, OpeningSharedBok } from "./open-shared-bok";
import { curtainCardFor, curtainPosterSize } from "@/lib/boks/curtain";
import { OgVideo } from "@/components/boks/og-video";

/**
 * A shareable link to one boks.
 *
 * Rendered on the server for one reason: a messenger asked to preview this link
 * fetches the HTML once and never runs JavaScript. Before this, the route was a
 * client-side redirect, so a shared poem previewed as the bare word "boks".
 * Now the title, the opening lines and the cover come from the server, and the
 * redirect below still takes a person to the reader.
 *
 * The segment is a bok's slug (`/b/neznakomka-blok`, what the app shares) or
 * its id (every link shared before slugs, which keeps working). A slug is
 * turned into the id here, on the server, because the reader opens a bok by id.
 *
 * Nothing here can fail the page: the lookup swallows its own errors and
 * returns null, and every branch has a generic answer.
 */
export type RouteParams = { id: string };

/** The segment as an id or a slug - repairing what messengers do to a link (`sharedBokRefFrom`). */
export async function refFrom(params: RouteParams | Promise<RouteParams>) {
  const resolved = await params;
  const ref = sharedBokRefFrom(String(resolved?.id ?? ""));
  return ref ? ("id" in ref ? ref.id : ref.slug) : "";
}

/**
 * The bok's id, looking a slug up. A slug that names nothing is passed on as
 * it is: the reader then says the bok is unavailable, instead of opening the
 * feed as if nothing had been asked for.
 */
export async function idFor(ref: string) {
  if (!ref || /^[0-9a-f-]{36}$/.test(ref)) return ref;
  return (await loadBokForShare(ref))?.id ?? ref;
}

/**
 * The page's preview tags. `card` swaps the curtain poster for another card's
 * picture (the ribbon test page, `ribbon/page.tsx`).
 */
export async function sharedBokMetadata(
  ref: string,
  card?: (bok: SharedBok) => Promise<{ url: string; width: number; height: number; type: "image/jpeg" } | null>
): Promise<Metadata> {
  const bok = await loadBokForShare(ref);
  const url = `${boksOrigin}/b/${bok?.slug ?? ref}`;

  if (!bok) {
    return {
      title: "boks",
      description: "Short literature, one focused read at a time.",
      alternates: { canonical: url },
      openGraph: { type: "website", url, siteName: "boks", title: "boks" },
    };
  }

  const title = shareTitle(bok);
  const description = sharePitchFor(bok);
  // The curtain card (`lib/boks/curtain.tsx`); its key changes with anything drawn, so a
  // messenger that cached the old card fetches the new one.
  const other = card ? await card(bok) : null;
  const image = other?.url ?? `${boksOrigin}/b/${bok.id}/image?v=${curtainCardFor(bok).key}`;

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
      images: [{ url: image, ...(other ? { width: other.width, height: other.height } : curtainPosterSize), alt: title, type: "image/jpeg" }],
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

/** The page itself: its og:video (if any), the redirect for a person, the text for a crawler. */
export function SharedBokView({ id, video }: { id: string; video: { url: string; width: number; height: number } | null }) {
  return (
    <>
      {video && <OgVideo url={video.url} width={video.width} height={video.height} />}
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
          <p className="mt-8 text-sm text-[var(--muted-foreground)]"><OpeningSharedBok /></p>
        </article>
        <OpenSharedBok id={id} />
      </main>
    </>
  );
}
