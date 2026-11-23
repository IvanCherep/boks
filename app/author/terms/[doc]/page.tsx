import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorTermsPage } from "../../../boks-client";

/**
 * A document for authors in the edition in force: `/author/terms/offer`,
 * `/author/terms/processing`, `/author/terms/distribution`
 * (`docs/author-agreements.md`). The text comes from the stored edition.
 */
type RouteParams = { doc: string };

const titles: Record<string, string> = {
  offer: "Договор-оферта для авторов · Boks",
  processing: "Согласие на обработку персональных данных · Boks",
  distribution: "Согласие на распространение персональных данных · Boks",
};

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const { doc } = await params;
  return { title: titles[doc] ?? "Документы для авторов · Boks" };
}

export default async function AuthorTermsRoute({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const { doc } = await params;
  return (
    <BoksErrorBoundary>
      <AuthorTermsPage slug={String(doc ?? "")} />
    </BoksErrorBoundary>
  );
}
