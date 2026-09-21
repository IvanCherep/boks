# Incident: the reader stuck on "Loading" (2026-09-19, ~13:15-13:35 UTC)

Reported as "boks is down". The site itself never went down: Cloudflare served
the HTML in ~0.1 s throughout. The feed did not arrive.

## What happened

Two failures at once, one feeding the other.

1. **Supabase slowed down.** From ~13:15 UTC trivial requests took 7-16 s
   (`/rest/v1/published_boks?select=id&limit=1` 7.5 s, an empty RPC 16.6 s).
   `get_recommendation_candidates` hit the `authenticated` role's 8 s
   `statement_timeout` (`pg_stat_statements`: 736 calls, mean 479 ms, max
   7.9 s), and feeds were served degraded with
   `candidate_rollups_unavailable: canceling statement due to statement timeout`.
   The degraded path then read `published_boks` with full texts
   (84 calls, mean 2.6 s), adding load to a database that was already stuck.
   Supabase status page: no platform incident. Project `ACTIVE_HEALTHY`,
   Free plan. The dashboard (Observability -> Database) shows ~500 MB in swap
   and memory commitment at its ~1.59 GB limit for the whole day, with IOwait
   spikes at the incident time; disk IOPS/throughput far below their limits.
   Recovered by itself by ~13:35 UTC.
2. **The Worker exceeded Cloudflare's CPU limit.** Every `POST /api/feed` ended
   `exceededCpu` - "Worker exceeded resource limits", HTTP 503 with an HTML body.
   Measured with `wrangler tail`: a successful feed costs **66-97 ms CPU**; the
   Workers Free plan allows **10 ms**. Cloudflare tolerated the overage until
   today's traffic, then cut every request at 10 ms. The client fell back to
   ranking in the browser, but only after waiting 0.5-3.3 s for the 503 - on
   every load and every reload after a like.
   The feed response is ~600 KB (full texts of 80 boks), which is most of the CPU.

Timeline (UTC, from `served_feed`): Worker serves normal until 13:00; first
browser (fallback) serve 13:16; last Worker serve 13:29; the deploy
`27d9d038` at ~13:45 got a fresh CPU allowance and the Worker served again
(still at 66-97 ms CPU, so it will be cut again).

## What was changed

- `components/boks/worker-feed-breaker.ts` (+ tests): one Worker failure makes
  the browser skip `/api/feed` for 2 minutes (15 while the CPU cap was in
  force) and rank locally; a success
  clears it. Served feeds are still labelled `serving_backend = 'browser'`,
  degraded, with `fallback_reason = 'worker_feed_cooling_down'`.
- `/api/feed` call bounded at 4 s (AbortController), and a non-JSON (Cloudflare
  HTML) response is reported as such instead of a `SyntaxError`.
- Deployed as Worker version `27d9d038`. Not committed yet.

## Decisions for the owner

- **Cloudflare Workers Paid ($5/month)** lifts the CPU limit (30 s by default)
  and is the direct fix for the 503s. Without it, server-side ranking (ADR-001)
  will keep being cut off under load; the breaker only limits the damage.
- **Supabase Free compute is at its memory limit.** Either upgrade compute, or
  reduce load first: stop shipping full texts for the whole slate (ids + the
  first boks, texts on demand), make the degraded fallback cheaper, and speed
  up `get_recommendation_candidates`.

## How to check next time

```sh
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://tryboks.com/
npx wrangler tail read --format json          # look for outcome "exceededCpu"
npx supabase db query --linked "select serving_backend, degraded_mode, count(*) from public.served_feed where served_at > now() - interval '1 hour' group by 1,2"
npx supabase inspect db outliers --linked
```
Supabase dashboard: Observability -> Database (memory/swap, CPU IOwait).

## Second episode, ~14:00-14:30 UTC, and what the dashboards say

Reported again ("problems with Cloudflare or Supabase?"). At 14:27 UTC:
`tryboks.com` answered **503 `error code: 1102`** (Worker exceeded resource
limits) on plain page loads, not only `/api/feed`, while
`read.tryboks.workers.dev` still served; Supabase auth health took 6-10 s,
a trivial REST read timed out at 30 s, an empty RPC took 16.7 s. By 14:32 UTC
everything answered normally again (10/10 page loads, Supabase 0.1-0.4 s).

Evidence, 24 h window:

- **Supabase (Observability -> Database).** The instance has ~0.4-0.5 GB of RAM
  (Free plan, Nano). At 14:30 UTC: used 282 MB, cache 118 MB, **free 6 MB,
  swap 520 MB (128% of RAM)**; memory commitment **1.6 GB against a 1.2 GB
  limit (133%)**. Swap sat around 450 MB all day and rose in the last hours.
  Postgres itself was idle (`pg_stat_activity`: nothing running but the
  diagnostic query; 11 idle PostgREST connections) - the whole VM stalls,
  which is why GoTrue's health check was slow too.
- **Cloudflare (Workers -> read -> Metrics).** 1.56k invocations, 156 errors,
  **all "Exceeded CPU Time Limits"**, all after ~13:15 UTC. CPU per request
  P50 30 ms / P90 50 ms / P99 61 ms all day - 3-6x the Free plan's 10 ms,
  tolerated until then. Wall time was near zero until ~13:15 UTC, then
  requests hung 150-170 s. Subrequests to Supabase: ~2k 2xx, 36 4xx,
  **98 5xx**, mean 1.85 s.
- **Traffic is not the cause.** `served_feed`: at most ~10 readers and ~100
  feeds an hour; 2 readers in the 14:00 hour.

Reading: the Supabase Free instance is out of memory and swapping; when it
stalls, every service on it stalls, feed requests fail over to heavier paths,
and the Worker - already over the Free CPU limit on every request - starts
being cut off by Cloudflare, page renders included.

Note for whoever diagnoses next: the Supabase CLI's `inspect db` and
`db query` open their own connections and run catalogue queries (one showed
up as the top statement by total time). Keep diagnostics short on this
instance.
