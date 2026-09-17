import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberately separate from `vite.config.ts`: unit tests cover pure product
// logic and must run without the Cloudflare/vinext build pipeline.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    // The statistics tests earn their verdicts by simulation - thousands of
    // permutations and bootstrap resamples - and the slowest sit around three
    // seconds. Under the default five they pass on an idle machine and fail
    // beside a build, which is a test reporting the load average rather than
    // the code. The work is bounded and deterministic, so the honest fix is
    // room, not fewer resamples: cutting those would widen every interval the
    // thesis rests on.
    testTimeout: 30_000,
  },
});
