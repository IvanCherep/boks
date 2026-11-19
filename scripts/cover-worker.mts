/**
 * The covers worker on its own, for local work (`docs/author-publishing.md`):
 *
 *   npm run covers:worker            keep watching the queue
 *   npm run covers:worker -- --once  draw what is queued, then stop
 *   BOKS_COVERS_FAKE=1 npm run covers:worker   stand-in pictures, no keys
 *
 * In production the Series worker runs the same loop in its own process.
 */
import { runCoverWorker } from "@/lib/boks/author/covers/worker";

await runCoverWorker({ once: process.argv.includes("--once") });
