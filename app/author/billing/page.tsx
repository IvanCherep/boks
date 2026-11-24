import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorBilling } from "../../boks-client";

/** «Договор и оплаты»: the author's contract, payments and documents (docs/author-agreements.md). Never indexed. */
export const metadata: Metadata = {
  title: "Договор и оплаты · boks",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function AuthorBillingRoute() {
  return (
    <BoksErrorBoundary>
      <AuthorBilling />
    </BoksErrorBoundary>
  );
}
