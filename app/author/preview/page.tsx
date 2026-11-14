import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { SpacePreviewPage } from "../../boks-client";

/**
 * A closed author page as it will look (`?space=<id>` for the team; the
 * owner's own page without it). The data comes from an RPC that checks the
 * caller, so this shell holds nothing private and is never indexed.
 */
export const metadata: Metadata = {
  title: "boks",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AuthorPreviewRoute() {
  return (
    <BoksErrorBoundary>
      <SpacePreviewPage />
    </BoksErrorBoundary>
  );
}
