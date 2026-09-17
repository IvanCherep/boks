"use client";

import { useEffect } from "react";

/**
 * A shareable link to one author, mirroring `/b/<id>` for a boks.
 *
 * The reader is a single stateful feed, so the handle is handed to it rather
 * than rendering a second copy of the reading surface.
 */
export default function SharedAuthorPage() {
  useEffect(() => {
    const handle = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
    window.location.replace(handle ? `/?author=${encodeURIComponent(handle)}` : "/");
  }, []);

  return (
    <main className="legal-page">
      <article className="legal-document">
        <a href="/" className="brand-word brand-button">
          boks
        </a>
        <p className="mt-8 text-sm text-[var(--muted-foreground)]">Opening this author…</p>
      </article>
    </main>
  );
}
