import { coverJobState } from "@/lib/boks/author/covers/jobs";

export const dynamic = "force-dynamic";

/** Where a drawing is: queued, drawing, done with its pictures, or failed. Known only to whoever holds the job id. */
export async function GET(_request: Request, { params }: { params: Promise<{ job: string }> }) {
  const state = await coverJobState((await params).job);
  return Response.json(state, { status: state.state === "missing" ? 404 : 200, headers: { "Cache-Control": "private, no-store" } });
}
