import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { OpeningAuthor } from "../../a/[handle]/opening-author";
import { previewLabAuthor, previewLabFilePath, previewLabVariant } from "@/lib/boks/preview-lab";

/**
 * Preview lab (temporary): `/p/<slug>` opens Алексей Прохоров's page, and each
 * slug previews in messengers with a different card (`lib/boks/preview-lab.ts`).
 * Hidden: listed only in Studio, never indexed.
 */
type RouteParams = { variant: string };

const title = "Алексей Прохоров · boks";
const description =
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
  return {
    title,
    description,
    robots,
    alternates: { canonical: url },
    openGraph: {
      type: videoPath ? "video.other" : "profile",
      siteName: "boks",
      locale: "ru_RU",
      url,
      title,
      description,
      images: [{ url: image, width: variant.image.width, height: variant.image.height, type: variant.image.type, alt: "Алексей Прохоров" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/**
 * The video's tags, written here because the metadata API of this build drops
 * `og:video:type` and `og:video:secure_url`, and Telegram and Facebook want
 * the type to play it. In order, the details right after `og:video`; React
 * hoists them into the head.
 */
export default async function PreviewLabPage({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const { variant: slug } = await params;
  const variant = previewLabVariant(String(slug ?? "").toLowerCase());
  const videoPath = variant?.video ? previewLabFilePath(variant.video.file) : null;
  return (
    <>
      {variant?.video && videoPath && (
        <>
          <meta property="og:video" content={`${boksOrigin}${videoPath}`} />
          <meta property="og:video:secure_url" content={`${boksOrigin}${videoPath}`} />
          <meta property="og:video:type" content={variant.video.type} />
          <meta property="og:video:width" content={String(variant.video.width)} />
          <meta property="og:video:height" content={String(variant.video.height)} />
        </>
      )}
      <OpeningAuthor handle={previewLabAuthor} />
    </>
  );
}
