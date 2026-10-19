import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { ReaderFeed } from "../boks-client";

/**
 * The series shelf at an address of its own, so it can be linked to.
 *
 * It is the same reader as `/`, opened on the shelf - not a second app. The
 * feed loads underneath, which is what makes a piece opened here end with the
 * same like, share and aftertaste as anywhere else.
 */
const description = "Literary productions with a voice, illustrations and interactive scenes.";

export const metadata: Metadata = {
  title: "boks series",
  description,
  alternates: { canonical: `${boksOrigin}/series` },
  openGraph: {
    type: "website",
    siteName: "boks",
    title: "boks series",
    description,
    url: `${boksOrigin}/series`,
    images: [{ url: "/series/lion.webp", width: 720, height: 1279, alt: "boks series" }],
  },
};

export default function SeriesPage() {
  return (
    <BoksErrorBoundary v44>
      <ReaderFeed initialView="series" />
    </BoksErrorBoundary>
  );
}
