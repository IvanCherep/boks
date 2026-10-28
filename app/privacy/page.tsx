import type { Metadata } from "next";

import { PrivacyDocument } from "./privacy-document";

export const metadata: Metadata = {
  title: "Privacy · boks",
  description: "What boks collects during the pilot, why, where it is kept, and how to delete it.",
};

/**
 * Written from what the product actually does - the tables, the event stream,
 * the device storage - so it can be checked against the code. When the data
 * boks keeps changes, this page changes with it - in both languages
 * (`privacy-en.tsx`, `privacy-ru.tsx`).
 */
export default function PrivacyPage() {
  return <PrivacyDocument />;
}
