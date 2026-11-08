import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node builds (BOKS_PLATFORM=node) emit dist/standalone/server.js.
  ...(process.env.BOKS_PLATFORM === "node" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
