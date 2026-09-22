"use client";

import { useEffect } from "react";

/**
 * Hands the shared id to the reader.
 *
 * The reader is one stateful feed, so a per-boks URL cannot render a second
 * copy of it; it passes the id across and the feed opens that piece at the
 * reader's current place. This runs in the browser, while the page around it is
 * rendered on the server - which is the point: a crawler gets the metadata and
 * a person gets the reader.
 */
export function OpenSharedBok({ id }: { id: string }) {
  useEffect(() => {
    if (!id) {
      window.location.replace("/");
      return;
    }
    // A redirect drops the referrer, and the referrer is how the console knows
    // a visitor came from Telegram rather than from nowhere. So it travels as
    // `ref`, with `from=share` marking the landing, alongside any utm tags the
    // link was posted with.
    const next = new URLSearchParams({ bok: id, from: "share" });
    try {
      const referrer = document.referrer ? new URL(document.referrer).hostname : "";
      if (referrer && referrer !== window.location.hostname) next.set("ref", referrer);
    } catch {
      // No referrer is a direct visit, which is also worth knowing.
    }
    const incoming = new URLSearchParams(window.location.search);
    for (const key of ["utm_source", "utm_medium", "utm_campaign"]) {
      const value = incoming.get(key);
      if (value) next.set(key, value);
    }
    window.location.replace(`/?${next.toString()}`);
  }, [id]);

  return null;
}
