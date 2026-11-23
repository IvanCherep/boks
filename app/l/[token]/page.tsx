import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { LinkOnlyPoem } from "@/components/boks/link-only/link-only-poem";
import { isLinkOnlyToken } from "@/lib/boks/link-only";
import { linkOnlyHeading } from "@/lib/boks/link-only-heading";

/**
 * A link-only piece (`docs/link-only-pieces.md`). Never indexed and never
 * linked from anywhere in the product: the only way here is the link itself.
 */
type RouteParams = { token: string };

export async function generateMetadata({ params }: { params: Promise<RouteParams> }): Promise<Metadata> {
  const { token } = await params;
  const robots = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };
  const piece = isLinkOnlyToken(token) ? await linkOnlyHeading(token) : null;
  if (!piece) return { title: "boks", robots };

  const title = [piece.title, piece.author].filter(Boolean).join(" · ");
  const url = `${boksOrigin}/l/${token}`;
  return {
    title,
    robots,
    openGraph: {
      type: "article",
      siteName: "boks",
      url,
      title,
      images: [{ url: `${url}/f/cover.webp`, alt: piece.title }],
    },
  };
}

/**
 * `?curtain=1` opens the piece behind the series curtain and plays it at once,
 * as an author's page does: the Series recorder's preview in Studio.
 */
export default async function LinkOnlyRoute({ params, searchParams }: { params: Promise<RouteParams>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params;
  const curtain = (await searchParams)?.curtain === "1";
  return (
    <BoksErrorBoundary v44>
      {/* A malformed token goes through as well: its files answer 404 and
          the page says there is nothing here. */}
      <LinkOnlyPoem token={encodeURIComponent(token)} curtain={curtain} />
    </BoksErrorBoundary>
  );
}
