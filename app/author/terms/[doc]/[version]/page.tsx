import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorTermsPage } from "../../../../boks-client";

/** One edition of a document for authors, for good: `/author/terms/offer/2026-11-23`. */
type RouteParams = { doc: string; version: string };

const titles: Record<string, string> = {
  offer: "Договор-оферта для авторов",
  processing: "Согласие на обработку персональных данных",
  distribution: "Согласие на распространение персональных данных",
};

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const { doc, version } = await params;
  return { title: `${titles[doc] ?? "Документ для авторов"}, редакция ${decodeURIComponent(String(version ?? ""))} · Boks` };
}

export default async function AuthorTermsEditionRoute({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const { doc, version } = await params;
  return (
    <BoksErrorBoundary>
      <AuthorTermsPage slug={String(doc ?? "")} version={decodeURIComponent(String(version ?? ""))} />
    </BoksErrorBoundary>
  );
}
