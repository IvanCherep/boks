import { loadBokForShare } from "@/lib/boks/share-preview";
import { ribbonCardForBok } from "@/lib/boks/ribbon";
import { ribbonFileResponse } from "@/lib/boks/ribbon-route";

/** A published bok's ribbon card files (`lib/boks/ribbon-route.ts`). Nothing for a hidden bok. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  const bok = /^[0-9a-f-]{36}$/.test(id) ? await loadBokForShare(id) : null;
  return ribbonFileResponse(bok ? ribbonCardForBok(bok) : null, file, request);
}
