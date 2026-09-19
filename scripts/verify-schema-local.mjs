#!/usr/bin/env node
/**
 * Applies every Supabase migration to a throwaway local Postgres container and
 * runs `scripts/local-supabase/checks.sql` against it.
 *
 * This is the offline half of `npm run verify:supabase`. It needs no Supabase
 * project and no network, so migrations can be proven before anything is
 * deployed. `scripts/local-supabase/shim.sql` supplies the small part of the
 * Supabase platform the migrations depend on: the `auth` schema, `auth.uid()`,
 * `auth.jwt()` and the `anon` / `authenticated` / `service_role` roles.
 *
 * Usage:
 *   npm run verify:schema             apply migrations and run the checks
 *   npm run verify:schema -- --keep   leave the container running afterwards
 *   npm run verify:schema -- --down   stop and remove the container
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const containerName = "boks-local-pg";
const image = "postgres:17-alpine";
// Overridable because this machine runs other projects' databases too, and
// one of them sat on 55432 and stopped the check from starting at all.
const hostPort = process.env.BOKS_SCHEMA_PORT ?? "55432";
const password = "boks";
const database = "boks";

const args = new Set(process.argv.slice(2));

function docker(commandArgs, options = {}) {
  const result = spawnSync("docker", commandArgs, { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function containerState() {
  const result = docker(["inspect", "-f", "{{.State.Running}}", containerName]);
  if (result.status !== 0) return "missing";
  return result.stdout.trim() === "true" ? "running" : "stopped";
}

function startContainer() {
  const state = containerState();
  if (state === "running") return;

  if (state === "stopped") {
    docker(["start", containerName], { stdio: "inherit" });
    return;
  }

  console.log(`Starting ${image} as ${containerName} on port ${hostPort}...`);

  // A previous run's `docker rm -f` can still be releasing the name, which
  // fails the create with "name is already in use". Retry briefly rather than
  // surfacing that as a schema failure.
  let result;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    result = docker([
      "run", "-d",
      "--name", containerName,
      "-e", `POSTGRES_PASSWORD=${password}`,
      "-e", `POSTGRES_DB=${database}`,
      "-p", `${hostPort}:5432`,
      image,
    ]);

    if (result.status === 0) return;
    if (!/already in use|is already in progress/i.test(result.stderr)) break;
    sleepSync(1000);
  }

  throw new Error(`Could not start the Postgres container. Is Docker running?\n${result?.stderr ?? ""}`);
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * `pg_isready` is not enough: the official image runs a temporary server for
 * initdb, answers as ready, then shuts it down to start the real one. Waiting
 * on an actual query is the only signal that survives that.
 */
function waitForPostgres() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const result = psql("postgres", ["-tAc", "select 1"]);
    if (result.status === 0 && result.stdout.trim() === "1") return;
    sleepSync(1000);
  }
  throw new Error("Postgres did not become ready in 90 seconds.");
}

function psql(targetDatabase, commandArgs, input) {
  return docker(
    [
      "exec", "-i",
      "-e", `PGPASSWORD=${password}`,
      containerName,
      "psql", "-U", "postgres", "-d", targetDatabase, "-v", "ON_ERROR_STOP=1", "-q",
      ...commandArgs,
    ],
    input === undefined ? {} : { input }
  );
}

/** A fresh database every run, so a check can never pass on leftover state. */
function resetDatabase() {
  let result;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    result = psql("postgres", [
      "-c", `drop database if exists ${database} with (force)`,
      "-c", `create database ${database}`,
    ]);
    if (result.status === 0) return;
    sleepSync(1000);
  }

  throw new Error(`Could not reset the database.\n${result?.stderr ?? ""}`);
}

function apply(label, file) {
  const result = psql(database, ["-f", "-"], readFileSync(file, "utf8"));

  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`${label} failed: ${path.basename(file)}`);
  }

  return result;
}

function removeContainer() {
  docker(["rm", "-f", containerName], { stdio: "ignore" });
}

if (args.has("--down")) {
  removeContainer();
  console.log("Removed the local Postgres container.");
  process.exit(0);
}

try {
  startContainer();
  waitForPostgres();
  resetDatabase();

  apply("shim", path.join(projectRoot, "scripts/local-supabase/shim.sql"));

  const migrationsDir = path.join(projectRoot, "supabase/migrations");
  const migrations = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) {
    apply("migration", path.join(migrationsDir, migration));
    console.log(`applied ${migration}`);
  }

  const checks = apply("checks", path.join(projectRoot, "scripts/local-supabase/checks.sql"));
  const passed = checks.stderr.split("\n").filter((line) => line.includes("NOTICE:  ok:"));
  for (const line of passed) console.log(line.replace(/^.*NOTICE:  /, "  "));

  if (!checks.stderr.includes("ALL CHECKS PASSED")) {
    throw new Error("The schema checks did not reach the end of the suite.");
  }

  console.log(`\n${migrations.length} migrations applied, ${passed.length} schema checks passed.`);
} finally {
  if (!args.has("--keep")) removeContainer();
}
