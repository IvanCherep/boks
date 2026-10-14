"use client";

import { useEffect } from "react";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

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
    <main className="legal-page">
      <article className="legal-document">
        <a href="/" className="brand-word brand-button">
          boks
        </a>
        <p className="mt-8 text-sm text-[var(--muted-foreground)]">{words.opening}</p>
      </article>
    </main>
  );
}
