import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node builds (BOKS_PLATFORM=node) emit dist/standalone/server.js.
  ...(process.env.BOKS_PLATFORM === "node" ? { output: "standalone" as const } : {}),
  // The preview tags (og:*, title) go in <head> for every visitor, not only
  // for the crawlers the framework knows by name. Others got them streamed
  // late in <body>, and Max (VK's messenger) showed no preview for a
  // tryboks.com link (2026-11-18). The cost is the page's metadata query
  // before the first byte, a few milliseconds.
  htmlLimitedBots: /.+/,
};

export default nextConfig;
