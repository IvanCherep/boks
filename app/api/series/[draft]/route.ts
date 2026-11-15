import { publishRecordedSeries } from "@/lib/boks/series-recorder/actor";
import { deleteDraft, generateImages, markPublished, publicationOf, queueBuild, readDraft, regenerateImage, updateDraft } from "@/lib/boks/series-recorder/store";
import { readJsonBody, seriesJson, seriesRoute } from "../respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ draft: string }> };

/** One draft, its owner's or Studio's: read, change, delete; POST builds it, or draws pictures for it. */
export function GET(request: Request, { params }: Params) {
  return seriesRoute(request, async (actor) => seriesJson({ draft: await readDraft(actor, (await params).draft) }));
}

export function PATCH(request: Request, { params }: Params) {
  return seriesRoute(request, async (actor) => seriesJson({ draft: await updateDraft(actor, (await params).draft, await readJsonBody(request)) }));
}

export function DELETE(request: Request, { params }: Params) {
  return seriesRoute(request, async (actor) => {
    await deleteDraft(actor, (await params).draft);
    return seriesJson({ deleted: true });
  });
}

export function POST(request: Request, { params }: Params) {
  return seriesRoute(request, async (actor, token) => {
    const { draft } = await params;
    const body = await readJsonBody(request);
    if (body.action === "publish") {
      // Straight onto the author's page, no review: the team trusted them when it granted Boks Series.
      const what = await publicationOf(actor, draft);
      const done = await publishRecordedSeries(token, { bokId: what.bokId, title: what.title, text: what.text, piece: what.token });
      if (done instanceof Response) return done;
      return seriesJson({ draft: await markPublished(actor, draft, done.bokId, what.token) });
    }
    if (body.action === "generate") return seriesJson({ draft: await generateImages(actor, draft, body.count) }, 202);
    if (body.action === "regenerate") return seriesJson({ draft: await regenerateImage(actor, draft, body.file) }, 202);
    return seriesJson({ draft: await queueBuild(actor, draft) }, 202);
  });
}
