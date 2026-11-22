import { adminJsonError } from "@/lib/boks/admin-request";
import { linkSeriesDraft, seriesSourceFor, spendSeriesCredit } from "@/lib/boks/series-recorder/actor";
import { draftFromBok } from "@/lib/boks/series-recorder/from-bok";
import { authorSeriesClosedMessage, seriesRecorderOpenTo } from "@/lib/boks/series-recorder/switch";
import { createDraft, listDrafts } from "@/lib/boks/series-recorder/store";
import { readJsonBody, seriesJson, seriesRoute } from "./respond";

export const dynamic = "force-dynamic";

/**
 * The caller's drafts (Studio: everyone's), and how many Boks Series they have
 * left; POST starts a new one, spending one of them (`docs/series-recorder.md`).
 * Studio's POST `{ fromBok }` makes (or reopens) the draft of a piece the
 * editors took into work, with the author's take in it.
 */
export function GET(request: Request) {
  return seriesRoute(request, async (actor) => seriesJson({
    drafts: await listDrafts(actor, { mine: new URL(request.url).searchParams.has("mine") }),
    access: { admin: actor.admin, granted: actor.granted, used: actor.used, left: actor.left },
  }));
}

export function POST(request: Request) {
  return seriesRoute(request, async (actor, token) => {
    // Closed to authors while the switch is off (`lib/boks/series-recorder/switch.ts`), before a Series is spent.
    if (!seriesRecorderOpenTo(actor)) return adminJsonError(authorSeriesClosedMessage, 403);
    const body = await readJsonBody(request);
    if (typeof body.fromBok === "string") {
      if (!actor.admin) return adminJsonError("Only the boks editors make a Series from an author's piece.", 403);
      const source = await seriesSourceFor(token, body.fromBok.toLowerCase());
      if (source instanceof Response) return source;
      const made = await draftFromBok(actor, source);
      if (made.created || source.draftId !== made.draft.id) {
        const linked = await linkSeriesDraft(token, source.bokId, made.draft.id);
        if (linked instanceof Response) return linked;
      }
      return seriesJson({ draft: made.draft }, made.created ? 201 : 200);
    }
    if (!actor.admin) {
      const refused = await spendSeriesCredit(token);
      if (refused) return refused;
    }
    return seriesJson({ draft: await createDraft(actor, body) }, 201);
  });
}
