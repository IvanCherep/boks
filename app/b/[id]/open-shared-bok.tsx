"use client";

import { useEffect } from "react";
import { sharedBokTarget } from "@/lib/boks/shared-bok-redirect";

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
    // Normally the inline script in page.tsx has already left; this is the
    // fallback for a browser where it did not run.
    window.location.replace(
      sharedBokTarget({
        id,
        search: window.location.search,
        referrer: document.referrer,
        hostname: window.location.hostname,
      })
    );
  }, [id]);

  return null;
}
