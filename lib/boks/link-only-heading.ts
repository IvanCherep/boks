import { isLinkOnlyToken, linkOnlyStorageUrl } from "@/lib/boks/link-only";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/** A link-only piece's title and author, from its manifest in storage. Null if there is none. */
export async function linkOnlyHeading(token: string): Promise<{ title: string; author: string } | null> {
  const source = supabaseUrl && isLinkOnlyToken(token) ? linkOnlyStorageUrl(supabaseUrl, token, "manifest.json") : null;
  if (!source) return null;
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const manifest = (await response.json()) as { title?: unknown; author?: unknown };
    if (typeof manifest.title !== "string") return null;
    return { title: manifest.title, author: typeof manifest.author === "string" ? manifest.author : "" };
  } catch {
    return null;
  }
}
