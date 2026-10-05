/**
 * Do the live algorithms actually produce different feeds on the catalog as it
 * stands today?
 *
 * Ask this before reading any experiment result. Two rankers over a handful of
 * boks serve nearly the same list, so the arms tie forever no matter how many
 * readers or how much time you give them - and a metrics panel cannot tell you
 * that, because a tie looks like a tie either way.
 *
 *   npm run verify:divergence                    # local supabase stack
 *   npm run verify:divergence -- --env .env.local  # a configured project
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { measureStrategyDivergence } from "@/lib/boks/recommendations/divergence";
import { candidatesFromRollupRows, type SupabaseCandidateRow } from "@/lib/boks/supabase-reels";

const args = process.argv.slice(2);
const envIndex = args.indexOf("--env");

function readEnvFile(path: string) {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return env;
}

const env = envIndex >= 0 ? readEnvFile(args[envIndex + 1]) : process.env;
const url = env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const signIn = await client.auth.signInAnonymously();
if (signIn.error) throw signIn.error;

const result = await client.rpc("get_recommendation_candidates", { p_limit: 400 });
if (result.error) throw result.error;

// The same mapping production ranks from. A hand-written copy here once left
// out bylines, shapes, author counts and the semantic fields, so `for_you`
// was measured with author spacing, shape spacing and its cold-start priors
// all switched off - a different ranker from the one readers get.
const { candidates } = candidatesFromRollupRows(result.data as SupabaseCandidateRow[]);

const experiment = await client.rpc("get_active_recommendation_experiment");
const liveArms: string[] = (experiment.data?.arms ?? [])
  .filter((arm: { weight: number }) => arm.weight > 0)
  .map((arm: { algorithmId: string }) => arm.algorithmId);

const report = measureStrategyDivergence({
  candidates,
  algorithmIds: liveArms.length > 1 ? liveArms : undefined,
});

console.log(`\ncatalog: ${report.candidateCount} published boks`);
console.log(`arms:    ${liveArms.length > 1 ? liveArms.join(", ") : "all registered algorithms"}\n`);
console.log(report.summary);
console.log(`\nverdict: ${report.verdict.toUpperCase()}   mean overlap of top ${report.topK}: ${Math.round(report.meanOverlap * 100)}%\n`);

for (const pair of report.pairs) {
  console.log(
    `  ${pair.leftAlgorithmName.padEnd(18)} vs ${pair.rightAlgorithmName.padEnd(18)}` +
      `  overlap ${String(Math.round(pair.overlap * 100)).padStart(3)}%   tau ${String(pair.kendallTau).padStart(6)}`
  );
}

console.log("");
process.exit(report.verdict === "indistinguishable" ? 1 : 0);
