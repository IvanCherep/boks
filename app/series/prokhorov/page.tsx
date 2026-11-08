import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { ReaderFeed } from "../../boks-client";

/**
 * Алексей Прохоров's own address on boks, for him to share with his readers.
 *
 * The series shelf opened on his section, which comes first and in every
 * language. A messenger previews the link as the cover of his book «Верослов»:
 * a 1200x630 card with the whole cover in the middle (messengers crop a
 * portrait image), held in link-only storage like his poems
 * (`docs/link-only-pieces.md`), since this repository is public.
 */
const url = `${boksOrigin}/series/prokhorov`;
const title = "Алексей Прохоров · boks series";
const description =
  "Стихи в авторском чтении: «коса», «у горы Мегиддо», «азбука веры», «розы Сарагосы» и другие. Голос поэта, иллюстрации и текст в такт чтению.";
const image = `${boksOrigin}/l/XFKejQcwEa7M_7jI_1T6LA/f/veroslov-share.jpg`;
const alt = "Алексей Прохоров, «Верослов»";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: {
    type: "website",
    siteName: "boks",
    locale: "ru_RU",
    title,
    description,
    url,
    images: [{ url: image, width: 1200, height: 630, alt, type: "image/jpeg" }],
  },
  twitter: { card: "summary_large_image", title, description, images: [image] },
};

export default function ProkhorovPage() {
  return (
    <BoksErrorBoundary v44>
      <ReaderFeed initialView="series" seriesCollection="prokhorov" />
    </BoksErrorBoundary>
  );
}
