import { readCoverPicture } from "@/lib/boks/author/covers/jobs";

export const dynamic = "force-dynamic";

/** One drawn picture, before the author chooses it; the job id is the key. */
export async function GET(_request: Request, { params }: { params: Promise<{ job: string; file: string }> }) {
  const { job, file } = await params;
  const bytes = await readCoverPicture(job, file);
  if (!bytes) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
