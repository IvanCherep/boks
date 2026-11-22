import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorDesk } from "../../boks-client";

/** The author's desk: a local prototype (docs/author-desk.md). Never indexed. */
export const metadata: Metadata = {
  title: "Мастерская · boks",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AuthorDeskRoute() {
  return (
    <BoksErrorBoundary>
      <AuthorDesk />
    </BoksErrorBoundary>
  );
}
