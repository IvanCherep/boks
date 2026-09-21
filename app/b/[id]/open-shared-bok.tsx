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
    window.location.replace(id ? `/?bok=${encodeURIComponent(id)}` : "/");
  }, [id]);

  return null;
}
