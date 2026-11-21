import { adminJsonError } from "@/lib/boks/admin-request";
import { spendSeriesCredit } from "@/lib/boks/series-recorder/actor";
import { authorSeriesClosedMessage, seriesRecorderOpenTo } from "@/lib/boks/series-recorder/switch";
import { createDraft, listDrafts } from "@/lib/boks/series-recorder/store";
import { readJsonBody, seriesJson, seriesRoute } from "./respond";

export const dynamic = "force-dynamic";

/**
 * The caller's drafts (Studio: everyone's), and how many Boks Series they have
 * left; POST starts a new one, spending one of them (`docs/series-recorder.md`).
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
    if (!actor.admin) {
      const refused = await spendSeriesCredit(token);
      if (refused) return refused;
    }
    return seriesJson({ draft: await createDraft(actor, body) }, 201);
  });
}
