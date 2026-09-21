// The embedding worker: Supabase's own model, inside Supabase.
//
// `Supabase.ai.Session("gte-small")` runs a 384-dimension sentence encoder in
// the Edge runtime. That choice is the whole point of this file: the ranker
// needed a semantic source (see `lib/boks/recommendations/strategies/for-you.ts`),
// and every alternative meant an API key, a per-text price and a third party
// holding the catalogue. This has none of those - no key to rotate, no bill
// per bok, and the text never leaves the project.
//
// It is a batch worker, not a hook. Called with a limit, it takes that many
// boks that have no vector yet (`get_boks_needing_embedding`), embeds each and
// writes it back through `set_bok_embedding`, which enforces the 384
// dimensions. Run it in a loop until `remaining` is 0.
//
// **Three per call, measured.** An Edge Function has a CPU budget per request
// (~2 s) and inference spends it: 3 texts take about 2 s wall and succeed, 6
// die with `WORKER_RESOURCE_LIMIT`, and 25 - the first thing tried - embedded
// two of its batch and then failed. The write of each vector is its own
// request, so a batch that dies still keeps what it finished, but a loop of
// threes is the shape that never fails. 300 boks take about four minutes:
//
//   for i in $(seq 1 200); do
//     curl -s -X POST "$URL/functions/v1/embed" \
//       -H "x-embed-key: $EMBED_KEY" -H "Content-Type: application/json" \
//       --data '{"limit":3}' | python3 -c "import json,sys; print(json.load(sys.stdin)['"'"'remaining'"'"'])"
//   done
//
// Auth: an `x-embed-key` header matching the `EMBED_KEY` secret. The function
// holds the service role, so it must not be callable by whoever finds the URL.
// Deployed with `--no-verify-jwt` precisely so this check is the only door;
// there is no path here that trusts anything else about the caller.

declare const Supabase: {
  ai: { Session: new (model: string) => { run: (input: string, options?: Record<string, unknown>) => Promise<unknown> } };
};

const model = new Supabase.ai.Session("gte-small");

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const embedKey = Deno.env.get("EMBED_KEY") ?? "";

/** Title first, then the opening: `gte-small` reads 512 tokens and stops. */
const maxInputCharacters = 2000;

type Pending = { id: string; title: string; text: string };

async function rpc<Result>(name: string, body: Record<string, unknown>): Promise<Result> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${name}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as Result;
}

function inputFor(bok: Pending) {
  const title = (bok.title ?? "").trim();
  const text = (bok.text ?? "").replace(/\s+/g, " ").trim();
  return `${title}\n\n${text}`.slice(0, maxInputCharacters);
}

async function embed(text: string) {
  const output = await model.run(text, { mean_pool: true, normalize: true });
  const vector = Array.isArray(output) ? (output as number[]) : null;
  if (!vector || vector.length !== 384 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`the model returned ${vector ? `${vector.length} values` : typeof output}`);
  }
  return vector;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "POST only." }, { status: 405 });
  }
  if (!embedKey || request.headers.get("x-embed-key") !== embedKey) {
    return Response.json({ error: "Not authorised." }, { status: 401 });
  }

  let limit = 3;
  try {
    const body = (await request.json()) as { limit?: unknown };
    const asked = Number(body?.limit);
    // Capped at 5: above that the CPU budget is a coin toss, and a caller
    // asking for 25 gets a working batch instead of a resource error.
    if (Number.isFinite(asked)) limit = Math.min(5, Math.max(1, Math.round(asked)));
  } catch {
    // An empty body is the common case: embed the next batch.
  }

  const pending = await rpc<Pending[]>("get_boks_needing_embedding", { p_limit: limit });
  const failures: { id: string; reason: string }[] = [];
  let embedded = 0;

  for (const bok of pending) {
    try {
      const vector = await embed(inputFor(bok));
      await rpc("set_bok_embedding", { p_reel_id: bok.id, p_embedding: vector, p_model: "gte-small" });
      embedded += 1;
    } catch (caught) {
      failures.push({ id: bok.id, reason: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  const coverage = await rpc<{ publishedMissing: number; pendingMissing: number }>(
    "boks_embedding_coverage",
    {}
  );

  return Response.json({
    asked: limit,
    found: pending.length,
    embedded,
    failures,
    remaining: (coverage.publishedMissing ?? 0) + (coverage.pendingMissing ?? 0),
    coverage,
  });
});
