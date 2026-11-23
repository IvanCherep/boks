import type { Metadata } from "next";
import { BoksErrorBoundary } from "@/components/boks/error-boundary";
import { AuthorTermsIndex } from "../../boks-client";

/** The documents for authors: the offer and the two consents, each edition at its own address. */
export const metadata: Metadata = {
  title: "Документы для авторов · Boks",
  description: "Договор-оферта для авторов Boks и согласия на обработку и распространение персональных данных.",
};

export default function AuthorTermsIndexRoute() {
  return (
    <BoksErrorBoundary>
      <AuthorTermsIndex />
    </BoksErrorBoundary>
  );
}
