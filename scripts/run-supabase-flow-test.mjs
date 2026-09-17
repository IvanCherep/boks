#!/usr/bin/env node
/**
 * Runs `lib/boks/supabase-flow.test.ts` against the local Supabase stack.
 *
 * The suite creates users, boks and events, so it must never point at a real
 * project. This wrapper reads the local credentials from `supabase status`,
 * refuses anything that is not a loopback URL, and resets the database first so
 * the first-admin claim is available.
 *
 *   npx supabase start
 *   npm run test:supabase
 *
 *   npm run test:supabase -- --no-reset   keep existing local data
 */

import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));

function supabase(commandArgs, options = {}) {
  return spawnSync("npx", ["--yes", "supabase@latest", ...commandArgs], { encoding: "utf8", ...options });
}

const status = supabase(["status", "-o", "json"]);
if (status.status !== 0) {
  console.error(status.stderr || status.stdout);
  throw new Error("Could not read `supabase status`. Run `npx supabase start` first.");
}

const { API_URL: url, PUBLISHABLE_KEY: publishableKey } = JSON.parse(status.stdout);

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url ?? "")) {
  throw new Error(`Refusing to run the flow suite against a non-local URL: ${url}`);
}

if (!args.has("--no-reset")) {
  console.log("Resetting the local database so the first-admin claim is available...");
  const reset = supabase(["db", "reset"], { stdio: "inherit" });
  if (reset.status !== 0) throw new Error("`supabase db reset` failed.");
}

const test = spawnSync("npx", ["vitest", "run", "lib/boks/supabase-flow.test.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_LOCAL_URL: url,
    SUPABASE_LOCAL_PUBLISHABLE_KEY: publishableKey,
  },
});

process.exit(test.status ?? 1);
