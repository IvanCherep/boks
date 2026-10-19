"use client";

import { useEffect } from "react";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { BoksFlower } from "@/components/boks/reader/boks-flower";

const messages = defineMessages({ opening: "Opening this author…" }, { ru: { opening: "Открываем автора…" } });

/**
 * A shareable link to one author, mirroring `/b/<id>` for a boks.
 *
 * The reader is a single stateful feed, so the handle is handed to it rather
 * than rendering a second copy of the reading surface.
 */
export default function SharedAuthorPage() {
  const words = useMessages(messages);
  useEffect(() => {
    const handle = window.location.pathname.split("/").filter(Boolean).pop() ?? "";
    window.location.replace(handle ? `/?author=${encodeURIComponent(handle)}` : "/");
  }, []);

  return (
    <main className="reader-v44 reader-system-page reader-system-page--loading">
      <article className="reader-system-page__body">
        <header className="reader-system-page__header"><a href="/">boks</a></header>
        <div className="reader-system-art reader-system-art--loading" aria-hidden="true"><span>b</span><BoksFlower /></div>
        <h1 className="reader-system-title">{words.opening}</h1>
        <p className="reader-system-status" role="status">Loading…</p>
      </article>
    </main>
  );
}
