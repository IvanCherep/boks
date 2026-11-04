import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { LinkOnlyPoem } from "@/components/boks/link-only/link-only-poem";
import { isLinkOnlyToken, linkOnlyStorageUrl } from "@/lib/boks/link-only";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/**
 * A link-only piece (`docs/link-only-pieces.md`). Never indexed and never
 * linked from anywhere in the product: the only way here is the link itself.
 */
type RouteParams = { token: string };

async function pieceHeading(token: string): Promise<{ title: string; author: string } | null> {
  const source = supabaseUrl ? linkOnlyStorageUrl(supabaseUrl, token, "manifest.json") : null;
  if (!source) return null;
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const manifest = (await response.json()) as { title?: unknown; author?: unknown };
    if (typeof manifest.title !== "string") return null;
    return { title: manifest.title, author: typeof manifest.author === "string" ? manifest.author : "" };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<RouteParams> }): Promise<Metadata> {
  const { token } = await params;
  const robots = { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } };
  const piece = isLinkOnlyToken(token) ? await pieceHeading(token) : null;
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

export default async function LinkOnlyRoute({ params }: { params: Promise<RouteParams> }) {
  const { token } = await params;
  return (
    <BoksErrorBoundary v44>
      {/* A malformed token goes through as well: its files answer 404 and
          the page says there is nothing here. */}
      <LinkOnlyPoem token={encodeURIComponent(token)} />
    </BoksErrorBoundary>
  );
}
