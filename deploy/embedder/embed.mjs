// The embedder: gives every newly published bok its semantic vector.
//
// Run every 15 minutes by cron (`deploy/ops/embed.sh`) as a one-off container
// on the server's private network. It does what `scripts/embed-catalogue.mjs`
// does by hand - the same model, the same `query: ` prefix, the same 1500
// characters of title and text - so a vector written here is comparable with
// every vector already in the catalogue (`docs/adr/0012-single-embedding-model.md`).
//
// Every run, including one that finds nothing to do, writes one row to
// `background_job_runs`; the admin console reads them (Studio -> Content ->
// Background jobs). The model is only loaded when there is work.

import postgres from "postgres";

const job = "embedder";
const modelId = "Xenova/multilingual-e5-small";
const modelName = "multilingual-e5-small";
const dimensions = 384;
const prefix = "query: ";
const maxInputCharacters = 1500;
/** A run handles at most this many; the rest wait fifteen minutes. */
const perRun = 200;
/** Runs older than this are removed, so the log stays a log. */
const keepDays = 30;

const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const started = Date.now();

const missing = sql`
  status = 'published'
  and coalesce(btrim(text), '') <> ''
  and (embedding is null or embedding_model is distinct from ${modelName})
`;

async function main() {
  // Two runs never overlap: a slow one keeps the lock, the next one leaves.
  const [{ locked }] = await sql`select pg_try_advisory_lock(hashtext('boks-embedder')) as locked`;
  if (!locked) {
    console.log("another run is still going");
    return;
  }

  const [run] = await sql`insert into public.background_job_runs (job) values (${job}) returning id`;
  try {
    const pending = await sql`
      select id::text as id, title, text from public.reels where ${missing}
      order by created_at limit ${perRun}
    `;
    const handled = [];
    if (pending.length) {
      const { pipeline } = await import("@huggingface/transformers");
      const extractor = await pipeline("feature-extraction", modelId);
      for (const bok of pending) {
        const input = `${prefix}${bok.title}\n\n${String(bok.text).replace(/\s+/g, " ").slice(0, maxInputCharacters)}`;
        const output = await extractor(input, { pooling: "mean", normalize: true });
        const vector = Array.from(output.data);
        if (vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
          throw new Error(`${bok.id}: the model returned ${vector.length} values`);
        }
        const literal = `[${vector.map((value) => value.toFixed(6)).join(",")}]`;
        await sql`
          update public.reels
          set embedding = ${literal}::extensions.vector(384), embedding_model = ${modelName}, embedded_at = now()
          where id = ${bok.id}::uuid
        `;
        handled.push(bok.title);
      }
    }
    const [{ remaining }] = await sql`select count(*)::int as remaining from public.reels where ${missing}`;
    await sql`
      update public.background_job_runs
      set status = 'ok', finished_at = now(), processed = ${handled.length}, remaining = ${remaining},
          duration_ms = ${Date.now() - started},
          details = ${sql.json({ model: modelName, titles: handled.slice(0, 20) })}
      where id = ${run.id}
    `;
    await sql`delete from public.background_job_runs where job = ${job} and started_at < now() - make_interval(days => ${keepDays})`;
    console.log(`${new Date().toISOString()} embedded ${handled.length}, ${remaining} left`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      update public.background_job_runs
      set status = 'failed', finished_at = now(), duration_ms = ${Date.now() - started}, error = ${message.slice(0, 2000)}
      where id = ${run.id}
    `.catch(() => undefined);
    throw error;
  }
}

try {
  await main();
} catch (error) {
  console.error(`${new Date().toISOString()} failed:`, error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
