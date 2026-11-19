import { serveOwnCover } from "@/lib/boks/own-cover-route";

export const dynamic = "force-dynamic";

/** A published bok's own picture for the reader, 1080x1920 WebP. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveOwnCover(request, (await params).id, "webp");
}
