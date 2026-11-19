import { serveOwnCover } from "@/lib/boks/own-cover-route";

export const dynamic = "force-dynamic";

/** The same picture as JPEG, for the link card and the curtain loop. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveOwnCover(request, (await params).id, "jpeg");
}
