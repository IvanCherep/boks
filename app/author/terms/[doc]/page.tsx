import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorTermsPage } from "../../../boks-client";

/**
 * A document for authors in the edition in force: `/author/terms/offer`,
 * `/author/terms/processing`, `/author/terms/distribution`, and the Privacy
 * policy of /privacy in the same frame, `/author/terms/privacy`
 * (`docs/author-agreements.md`). The text comes from the stored edition.
 */
type RouteParams = { doc: string };

const titles: Record<string, string> = {
  offer: "Договор-оферта для авторов · Boks",
  processing: "Согласие на обработку персональных данных · Boks",
  distribution: "Согласие на распространение персональных данных · Boks",
  privacy: "Политика конфиденциальности · Boks",
};

export async function generateMetadata({ params }: { params: RouteParams | Promise<RouteParams> }): Promise<Metadata> {
  const { doc } = await params;
  const title = titles[doc] ?? "Документы для авторов · Boks";
  // The policy is the one of /privacy, shown in the authors' frame.
  return doc === "privacy" ? { title, alternates: { canonical: "/privacy" } } : { title };
}

export default async function AuthorTermsRoute({ params }: { params: RouteParams | Promise<RouteParams> }) {
  const { doc } = await params;
  return (
    <BoksErrorBoundary>
      <AuthorTermsPage slug={String(doc ?? "")} />
    </BoksErrorBoundary>
  );
}
