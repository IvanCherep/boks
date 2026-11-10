import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { OpeningAuthor } from "../../a/[handle]/opening-author";
import { OpenSharedBok, OpeningSharedBok } from "../../b/[id]/open-shared-bok";
import { sharedBokRedirectScript } from "@/lib/boks/shared-bok-redirect";
import { OgVideo } from "@/components/boks/og-video";
import { previewLabAuthor, previewLabFilePath, previewLabVariant } from "@/lib/boks/preview-lab";

/**
 * Preview lab (temporary): `/p/<slug>` previews in messengers with its own
 * card (`lib/boks/preview-lab.ts`). It opens Алексей Прохоров's page, or, for
 * a variant tied to a bok, that bok in the reader, the way `/b/<id>` does.
 * Hidden: listed only in Studio, never indexed.
 */
type RouteParams = { variant: string };

const authorTitle = "Алексей Прохоров · boks";
const authorDescription =
  "Стихи из «Верослова» в новом формате: поэт читает сам, а картины и слова оживают в такт голосу. Послушайте на boks.";
const robots = { index: false, follow: false, googleBot: { index: false, follow: false } };

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const { variant: slug } = await params;
  const variant = previewLabVariant(String(slug ?? "").toLowerCase());
  const imagePath = variant ? previewLabFilePath(variant.image.file) : null;
  if (!variant || !imagePath) return { title: "boks", robots };

  const url = `${boksOrigin}/p/${variant.slug}`;
  const image = `${boksOrigin}${imagePath}`;
  const videoPath = variant.video ? previewLabFilePath(variant.video.file) : null;
  const title = variant.bok?.title ?? authorTitle;
  const description = variant.bok?.description ?? authorDescription;
  return {
    title,
    description,
    robots,
    alternates: { canonical: url },
    openGraph: {
      type: videoPath ? "video.other" : variant.bok ? "article" : "profile",
      siteName: "boks",
      locale: variant.bok?.locale ?? "ru_RU",
      url,
      title,
      description,
      images: [{ url: image, width: variant.image.width, height: variant.image.height, type: variant.image.type, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function PreviewLabPage({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const { variant: slug } = await params;
  const variant = previewLabVariant(String(slug ?? "").toLowerCase());
  const videoPath = variant?.video ? previewLabFilePath(variant.video.file) : null;
  return (
    <>
      {variant?.video && videoPath && <OgVideo url={`${boksOrigin}${videoPath}`} width={variant.video.width} height={variant.video.height} />}
      {variant?.bok ? (
        <>
          {/* A person goes straight to the reader; a crawler, which runs no script, keeps the page. */}
          <script dangerouslySetInnerHTML={{ __html: sharedBokRedirectScript(variant.bok.id) }} />
          <main className="reader-v44 reader-system-page">
            <article className="reader-system-page__body">
              <a href="/" className="brand-word brand-button">
                boks
              </a>
              <h1 className="mt-8">{variant.bok.title}</h1>
              <p className="mt-8 text-sm text-[var(--muted-foreground)]"><OpeningSharedBok /></p>
            </article>
            <OpenSharedBok id={variant.bok.id} />
          </main>
        </>
      ) : (
        <OpeningAuthor handle={previewLabAuthor} />
      )}
    </>
  );
}
