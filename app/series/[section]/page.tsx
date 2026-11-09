import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { boksOrigin } from "@/app/layout";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { seriesSectionFromPath, seriesSectionPages } from "@/components/boks/series/series-sections";
import { ReaderFeed } from "../../boks-client";
import { authorAliasFor } from "@/components/boks/author-portraits";
import { authorAliasMetadata } from "@/lib/boks/author-alias-metadata";
import { OpeningAuthor } from "../../a/[handle]/opening-author";

/**
 * A section of the series shelf at an address of its own, for its author to
 * share: `/series/veroslov` is Алексей Прохоров's.
 *
 * The shelf opened on that section, which comes first and in every language.
 * Rendered on the server so a messenger, which fetches the HTML once and runs
 * no JavaScript, previews the link as the section's card and pitch
 * (`series-sections.ts`). An unknown section is a 404.
 */
type RouteParams = { section: string };

async function pageFor(params: RouteParams | Promise<RouteParams>) {
  const resolved = await params;
  return seriesSectionFromPath(String(resolved?.section ?? ""));
}

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const page = await pageFor(params);
  if (!page) return { title: "boks series" };
  const alias = page.profileAlias ? authorAliasFor(page.profileAlias) : null;
  if (alias) return authorAliasMetadata(boksOrigin, alias.alias);
  const url = `${boksOrigin}/series/${page.slug}`;
  const image = `${boksOrigin}${page.share.image}`;
  return {
    title: page.share.title,
    description: page.share.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "boks",
      locale: "ru_RU",
      title: page.share.title,
      description: page.share.description,
      url,
      images: [{ url: image, width: 1200, height: 630, alt: page.share.alt, type: "image/jpeg" }],
    },
    twitter: { card: "summary_large_image", title: page.share.title, description: page.share.description, images: [image] },
  };
}

export default async function SeriesSectionPage({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const page = await pageFor(params);
  if (!page) notFound();
  // A section that now stands for its author's page (`/series/veroslov`) opens it.
  const alias = page.profileAlias ? authorAliasFor(page.profileAlias) : null;
  if (alias) return <OpeningAuthor handle={alias.portrait.handle} />;
  return (
    <BoksErrorBoundary v44>
      <ReaderFeed initialView="series" seriesCollection={page.collection} />
    </BoksErrorBoundary>
  );
}

export const dynamicParams = true;
export function generateStaticParams() {
  return seriesSectionPages.map((page) => ({ section: page.slug }));
}
