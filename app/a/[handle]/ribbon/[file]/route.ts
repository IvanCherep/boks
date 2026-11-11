import { loadAuthorForShare } from "@/lib/boks/author-preview";
import { ribbonCardForAuthor } from "@/lib/boks/ribbon";
import { ribbonFileResponse } from "@/lib/boks/ribbon-route";

/** An author's ribbon card files (`lib/boks/ribbon-route.ts`), for an author with published boks. */
export async function GET(request: Request, { params }: { params: Promise<{ handle: string; file: string }> }) {
  const { handle, file } = await params;
  const author = await loadAuthorForShare(String(handle ?? ""));
  return ribbonFileResponse(author ? ribbonCardForAuthor(author) : null, file, request);
}
