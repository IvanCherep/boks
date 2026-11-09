import type { Metadata } from "next";
import type { AuthorAlias } from "@/components/boks/author-portraits";

/** The preview of an author alias (`/veroslov`): its own title, pitch and picture. */
export function authorAliasMetadata(origin: string, alias: AuthorAlias): Metadata {
  const url = `${origin}/${alias.slug}`;
  const image = `${origin}${alias.image}`;
  return {
    title: alias.title,
    description: alias.description,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      siteName: "boks",
      locale: "ru_RU",
      url,
      title: alias.title,
      description: alias.description,
      images: [{ url: image, width: alias.width, height: alias.height, alt: alias.alt, type: "image/jpeg" }],
    },
    twitter: { card: "summary_large_image", title: alias.title, description: alias.description, images: [image] },
  };
}
