import type { Metadata } from "next";
import { boksOrigin } from "@/app/layout";
import { authorAliasFor } from "@/components/boks/author-portraits";
import { authorAliasMetadata } from "@/lib/boks/author-alias-metadata";
import { OpeningAuthor } from "../a/[handle]/opening-author";

/**
 * `/veroslov`: Алексей Прохоров's page under the name of his book. A person
 * lands on his author page; a messenger previews the book (`author-portraits.ts`).
 */
const target = authorAliasFor("veroslov")!;

export const metadata: Metadata = authorAliasMetadata(boksOrigin, target.alias);

export default function VeroslovPage() {
  return <OpeningAuthor handle={target.portrait.handle} />;
}
