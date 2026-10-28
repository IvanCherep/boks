import type { Metadata } from "next";

import { TermsDocument } from "./terms-document";

export const metadata: Metadata = {
  title: "Terms of Use · boks",
  description: "The rules for using boks during the pilot: accounts, the catalogue, author content, and what boks is and is not responsible for.",
};

/**
 * Written to be read, not skimmed past - plain sentences, one idea each.
 *
 * Revised on 2026-09-22 to add what a reading platform that hosts other
 * people's words needs to say out loud: where the catalogue comes from and what
 * "public domain" does and does not promise, how to report an infringement and
 * what happens next, what a reader may not do, what boks may do with feedback,
 * and the limits of what boks is responsible for. Governing law is deliberately
 * absent: it depends on the legal entity that operates boks, and naming one
 * that does not exist would be worse than naming none.
 *
 * The text lives in `terms-en.tsx` and `terms-ru.tsx`; a change to one is a
 * change to both.
 */
export default function TermsPage() {
  return <TermsDocument />;
}
