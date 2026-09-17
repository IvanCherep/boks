"use client";

import { useEffect } from "react";

/**
 * A shareable link to one boks.
 *
 * The reader is a single stateful feed, so a per-boks URL hands the id to it
 * rather than rendering a second copy of the reading surface. Doing it in the
 * browser keeps the shared link working whether the route is served statically
 * or by the Worker.
 */
export default function SharedBokPage() {
  useEffect(() => {
    const id = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
    window.location.replace(id ? `/?bok=${encodeURIComponent(id)}` : "/");
  }, []);

  return (
    <main className="legal-page">
      <article className="legal-document">
        <a href="/" className="brand-word brand-button">
          boks
        </a>
        <p className="mt-8 text-sm text-[var(--muted-foreground)]">Opening this boks…</p>
      </article>
    </main>
  );
}
