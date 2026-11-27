// The facet labeller: gives published boks their reading facets
// (`docs/reading-facets.md`): a mood per bok, an author group per byline.
//
// Run by cron right after the embedder (`deploy/ops/embed.sh`), as a one-off
// container on the server's private network, and skipped while the server is
// overloaded. Asks YandexGPT (Yandex AI Studio; calibrated against Alice AI
// in docs/reading-facets.md) under the rubrics in
// `lib/boks/facets/rubric.ts`; the rubric and the request/reply code come from
// `facets-lib.mjs`, which the release bundles from that TypeScript.
//
// Labels what is due: a published bok with no mood label, or with a model's
// label written under an older rubric or for a text that has since changed;
// a byline with no author group, or a model's under an older rubric. An
// editor's label is never touched. Every run writes one row to
// `background_job_runs` (job `facets`), shown in Studio -> Content ->
// Background jobs.
//
//   node facets.mjs                   label what is due
//   node facets.mjs --calibrate 60    ask the model about 60 labelled boks, write nothing,
//                                     print how often it agrees with the labels there

import { createHash } from "node:crypto";
import postgres from "postgres";
import * as lib from "./facets-lib.mjs";

const job = "facets";
/** Which Yandex model labels; FACETS_MODEL overrides it for a calibration run. */
const model = process.env.FACETS_MODEL || "yandexgpt";
/** Boks and bylines one run handles; the rest wait fifteen minutes. */
const boksPerRun = 40;
const bylinesPerRun = 20;
const keepDays = 30;
const requestTimeoutMs = 90_000;

const sql = postgres(process.env.DATABASE_URL, { max: 1, idle_timeout: 5, connect_timeout: 15 });
const started = Date.now();
const usage = { promptTokens: 0, completionTokens: 0 };

const { YANDEX_API_KEY: apiKey, YANDEX_FOLDER_ID: folderId } = process.env;

async function ask(task) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(lib.yandexChatUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Api-Key ${apiKey}`, "x-folder-id": folderId },
      body: JSON.stringify(lib.yandexChatBody(task, folderId, model)),
    });
    if (!response.ok) {
      const error = new Error(`Yandex answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
      error.status = response.status;
      throw error;
    }
    const reply = lib.readYandexChat(await response.json());
    if (reply.usage) {
      usage.promptTokens += reply.usage.promptTokens;
      usage.completionTokens += reply.usage.completionTokens;
    }
    return reply;
  } catch (error) {
    // A timeout is worth retrying, unlike a caller's abort.
    if (error instanceof Error && error.name === "AbortError") error.name = "TimeoutError";
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const call = lib.withRetries(lib.withConcurrency(ask, lib.yandexConcurrency), { attempts: 4 });

/** One request that failed after its retries does not stop the others; the last error is kept for the run's row. */
let lastError = null;
/** The provider's content filter said no (`refused`): `answer` stays null, and it is not a failure of the run. */
async function askOrNull(request, read) {
  try {
    const reply = await request();
    return { answer: reply.refused ? null : read(reply.json), refused: Boolean(reply.refused) };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return { answer: null, refused: false };
  }
}

/**
 * Yandex's content filter refuses some texts outright ("Я не могу обсуждать
 * эту тему"; the first, 2026-11-21, a poem about a girlhood "мальчишкой в
 * платьице"). The same text is refused every time, so the bok gets an empty
 * label marked `refusedNote`: it is not asked again until its text changes, the
 * run does not fail, and ops/inbox.py tells the team once so an editor sets the
 * mood by hand (an editor's label is never overwritten).
 */
const refusedNote = "refused: content_filter";

const textHash = (title, text) => createHash("md5").update(`${title ?? ""}\n${text ?? ""}`, "utf8").digest("hex");

const dueMood = sql`
  r.status = 'published'
  and coalesce(btrim(r.text), '') <> ''
  and (
    l.bok_id is null
    or (l.source = 'model' and (
      l.rubric_version < f.rubric_version
      or l.text_hash is distinct from public.boks_bok_text_hash(r.title, r.text)
    ))
  )
`;

const dueByline = sql`
  (l.byline is null or (l.source = 'model' and l.rubric_version < f.rubric_version))
`;

async function dueBoks(limit) {
  return sql`
    select r.id::text as id, r.title, btrim(r.author_name) as byline, r.language, r.text
    from public.reels r
    join public.reading_facets f on f.key = 'mood'
    left join public.bok_facet_labels l on l.bok_id = r.id and l.facet = 'mood'
    where ${dueMood}
    order by r.created_at desc
    limit ${limit}
  `;
}

async function dueBylines(limit) {
  // An account that publishes under one byline is that author's own; the
  // catalogue account publishes under many. A hint for the model, no more.
  return sql`
    with published as (
      select btrim(r.author_name) as byline, r.title, r.author_user_id, r.created_at
      from public.reels r
      where r.status = 'published' and coalesce(btrim(r.author_name), '') <> ''
    ), accounts as (
      select author_user_id, count(distinct byline) as bylines from published group by author_user_id
    )
    select p.byline,
           (array_agg(p.title order by p.created_at))[1:5] as titles,
           bool_and(a.bylines = 1) as own_account
    from published p
    join accounts a on a.author_user_id is not distinct from p.author_user_id
    join public.reading_facets f on f.key = 'author_group'
    left join public.byline_facet_labels l on l.byline = p.byline and l.facet = 'author_group'
    where ${dueByline}
    group by p.byline
    order by p.byline
    limit ${limit}
  `;
}

async function counts() {
  const [row] = await sql`
    select
      (select count(*)::int from public.reels r
         join public.reading_facets f on f.key = 'mood'
         left join public.bok_facet_labels l on l.bok_id = r.id and l.facet = 'mood'
         where ${dueMood}) as boks,
      (select count(distinct btrim(r.author_name))::int from public.reels r
         join public.reading_facets f on f.key = 'author_group'
         left join public.byline_facet_labels l on l.byline = btrim(r.author_name) and l.facet = 'author_group'
         where r.status = 'published' and coalesce(btrim(r.author_name), '') <> '' and ${dueByline}) as bylines
  `;
  return row;
}

async function labelBoks(boks, rubricVersion) {
  const done = [];
  const refused = [];
  let unusable = 0;
  await Promise.all(boks.map(async (bok) => {
    const asked = await askOrNull(() => call(lib.moodTask(bok)), lib.readMoodAnswer);
    if (asked.refused) {
      await sql`
        insert into public.bok_facet_labels (bok_id, facet, facet_values, source, labeler, rubric_version, text_hash, note)
        values (${bok.id}::uuid, 'mood', '{}'::text[], 'model', ${model}, ${rubricVersion}, ${textHash(bok.title, bok.text)}, ${refusedNote})
        on conflict (bok_id, facet) do update set
          facet_values = excluded.facet_values, source = excluded.source, labeler = excluded.labeler,
          rubric_version = excluded.rubric_version, text_hash = excluded.text_hash, note = excluded.note, labeled_at = now()
        where public.bok_facet_labels.source <> 'editor'
      `;
      refused.push(bok.title);
      return;
    }
    const answer = asked.answer;
    if (!answer) {
      unusable += 1;
      return;
    }
    await sql`
      insert into public.bok_facet_labels (bok_id, facet, facet_values, source, labeler, rubric_version, text_hash, note)
      values (${bok.id}::uuid, 'mood', ${answer.values}::text[], 'model', ${model}, ${rubricVersion}, ${textHash(bok.title, bok.text)}, ${answer.note})
      on conflict (bok_id, facet) do update set
        facet_values = excluded.facet_values, source = excluded.source, labeler = excluded.labeler,
        rubric_version = excluded.rubric_version, text_hash = excluded.text_hash, note = excluded.note, labeled_at = now()
      where public.bok_facet_labels.source <> 'editor'
    `;
    done.push(`${bok.title}: ${answer.values.join(",") || "-"}`);
  }));
  return { done, unusable, refused };
}

async function labelBylines(bylines, rubricVersion) {
  const done = [];
  const refused = [];
  let unusable = 0;
  await Promise.all(bylines.map(async (row) => {
    const asked = await askOrNull(() => call(lib.authorGroupTask(row.byline, row.titles, row.own_account)), lib.readAuthorGroupAnswer);
    // The filter may refuse a byline for its titles (God, church): same as a bok, an empty label
    // marked `refusedNote`, not asked again, and an editor sets the group by hand.
    if (asked.refused) {
      await sql`
        insert into public.byline_facet_labels (byline, facet, facet_values, source, labeler, rubric_version, note)
        values (${row.byline}, 'author_group', '{}'::text[], 'model', ${model}, ${rubricVersion}, ${refusedNote})
        on conflict (byline, facet) do update set
          facet_values = excluded.facet_values, source = excluded.source, labeler = excluded.labeler,
          rubric_version = excluded.rubric_version, note = excluded.note, labeled_at = now()
        where public.byline_facet_labels.source <> 'editor'
      `;
      refused.push(row.byline);
      return;
    }
    const answer = asked.answer;
    if (!answer) {
      unusable += 1;
      return;
    }
    await sql`
      insert into public.byline_facet_labels (byline, facet, facet_values, source, labeler, rubric_version, note)
      values (${row.byline}, 'author_group', ${answer.values}::text[], 'model', ${model}, ${rubricVersion}, ${answer.note})
      on conflict (byline, facet) do update set
        facet_values = excluded.facet_values, source = excluded.source, labeler = excluded.labeler,
        rubric_version = excluded.rubric_version, note = excluded.note, labeled_at = now()
      where public.byline_facet_labels.source <> 'editor'
    `;
    done.push(`${row.byline}: ${answer.values[0] ?? "unknown"}`);
  }));
  return { done, unusable, refused };
}

async function label() {
  // Two runs never overlap: a slow one keeps the lock, the next one leaves.
  const [{ locked }] = await sql`select pg_try_advisory_lock(hashtext('boks-facets')) as locked`;
  if (!locked) {
    console.log("another run is still going");
    return;
  }
  const [run] = await sql`insert into public.background_job_runs (job) values (${job}) returning id`;
  try {
    if (!apiKey || !folderId) throw new Error("YANDEX_API_KEY and YANDEX_FOLDER_ID are not set for the facets job.");
    const versions = Object.fromEntries((await sql`select key, rubric_version from public.reading_facets`).map((row) => [row.key, row.rubric_version]));
    const boks = await dueBoks(boksPerRun);
    const bylines = await dueBylines(bylinesPerRun);
    const moods = await labelBoks(boks, versions.mood);
    const groups = await labelBylines(bylines, versions.author_group);
    const unusable = moods.unusable + groups.unusable;
    // Every reply unusable is a broken model or prompt, not bad luck.
    if (boks.length + bylines.length > moods.refused.length + groups.refused.length && moods.done.length + groups.done.length === 0) {
      throw new Error(`The model gave no usable answer for ${unusable} requests.${lastError ? ` Last error: ${lastError}` : ""}`);
    }
    const remaining = await counts();
    // Refused boks are labelled (empty) above, so they are not counted as remaining.
    await sql`
      update public.background_job_runs
      set status = 'ok', finished_at = now(), processed = ${moods.done.length + groups.done.length + moods.refused.length + groups.refused.length},
          remaining = ${remaining.boks + remaining.bylines}, duration_ms = ${Date.now() - started},
          details = ${sql.json({ model, usage, unusable, lastError, refused: moods.refused, refusedBylines: groups.refused, boks: moods.done.slice(0, 20), bylines: groups.done.slice(0, 20) })}
      where id = ${run.id}
    `;
    await sql`delete from public.background_job_runs where job = ${job} and started_at < now() - make_interval(days => ${keepDays})`;
    console.log(`${new Date().toISOString()} labelled ${moods.done.length} boks, ${groups.done.length} bylines, ${moods.refused.length} refused by the filter, ${unusable} unusable, ${remaining.boks + remaining.bylines} left`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`
      update public.background_job_runs
      set status = 'failed', finished_at = now(), duration_ms = ${Date.now() - started}, error = ${message.slice(0, 2000)},
          details = ${sql.json({ model, usage })}
      where id = ${run.id}
    `.catch(() => undefined);
    throw error;
  }
}

/** Asks the model about boks that already carry a label from another labeller; writes nothing. */
async function calibrate(size) {
  if (!apiKey || !folderId) throw new Error("YANDEX_API_KEY and YANDEX_FOLDER_ID are not set.");
  const rows = await sql`
    select r.id::text as id, r.title, btrim(r.author_name) as byline, r.language, r.text, l.facet_values as reference
    from public.reels r
    join public.bok_facet_labels l on l.bok_id = r.id and l.facet = 'mood' and l.labeler <> ${model}
    where r.status = 'published'
    order by md5(r.id::text)
    limit ${size}
  `;
  const pairs = [];
  let unusable = 0;
  await Promise.all(rows.map(async (bok) => {
    const { answer } = await askOrNull(() => call(lib.moodTask(bok)), lib.readMoodAnswer);
    if (!answer) unusable += 1;
    else pairs.push({ title: bok.title, reference: bok.reference, candidate: answer.values, note: answer.note });
  }));
  const exact = pairs.filter((pair) => [...pair.reference].sort().join() === [...pair.candidate].sort().join()).length;
  console.log(JSON.stringify({
    model, asked: rows.length, unusable, lastError, exact,
    agreement: lib.agreement(["sad", "fun", "think"], pairs),
    usage,
    disagreements: pairs.filter((pair) => [...pair.reference].sort().join() !== [...pair.candidate].sort().join()),
  }, null, 2));
}

try {
  const at = process.argv.indexOf("--calibrate");
  if (at >= 0) await calibrate(Math.min(Math.max(Number(process.argv[at + 1]) || 60, 1), 300));
  else await label();
} catch (error) {
  console.error(`${new Date().toISOString()} failed:`, error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
