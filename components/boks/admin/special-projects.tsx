"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { shareOrigin } from "@/lib/boks/share-link";
import { linkOnlyCover, linkOnlyPiecePath } from "@/lib/boks/link-only";
import { loadSpecialProjects, type SpecialProjectPiece } from "@/components/boks/supabase-browser-data";

const words = defineMessages(
  {
    title: "Special projects",
    lead: "Pieces in progress, reachable only by their link: not in the feed, the shelf, search or the catalogue. Share a link only with whoever should see it. The go. link is the one that previews in Telegram.",
    loading: "Loading…",
    empty: "No special projects yet.",
    failed: "Could not load the special projects.",
    copy: "Copy",
    copied: "Copied",
    open: "Open",
  },
  {
    ru: {
      title: "Спецпроекты",
      lead: "Работы в доработке, открываются только по ссылке: их нет в ленте, на полке, в поиске и каталоге. Давайте ссылку только тем, кому её нужно видеть. В Telegram превью есть только у ссылки go.",
      loading: "Загрузка…",
      empty: "Спецпроектов пока нет.",
      failed: "Не удалось загрузить спецпроекты.",
      copy: "Копировать",
      copied: "Скопировано",
      open: "Открыть",
    },
  }
);

/** Studio -> Special projects: link-only pieces grouped by project (`boks_special_projects`). */
export function SpecialProjectsPanel() {
  const t = useMessages(words);
  const [pieces, setPieces] = useState<SpecialProjectPiece[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "https://tryboks.com" : window.location.origin;
  const share = shareOrigin(origin).replace(/\/+$/, "");

  useEffect(() => {
    let live = true;
    loadSpecialProjects()
      .then((rows) => live && setPieces(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      window.setTimeout(() => setCopied((current) => (current === url ? null : current)), 2000);
    } catch {
      // The link is on screen to copy by hand.
    }
  }

  const projects = [...new Set((pieces ?? []).map((piece) => piece.project))];

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-4">
        <h2 className="text-xl font-semibold tracking-normal">{t.title}</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">{t.lead}</p>
      </div>
      {failed && <p className="p-4 text-sm">{t.failed}</p>}
      {!failed && !pieces && <p className="p-4 text-sm text-[var(--muted-foreground)]">{t.loading}</p>}
      {pieces && pieces.length === 0 && <p className="p-4 text-sm text-[var(--muted-foreground)]">{t.empty}</p>}
      {projects.map((project) => (
        <div key={project} className="border-b border-[var(--border)] p-4 last:border-b-0">
          <h3 className="text-lg font-semibold">{project}</h3>
          <ul className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(pieces ?? [])
              .filter((piece) => piece.project === project)
              .map((piece) => {
                const path = linkOnlyPiecePath(piece.token);
                const links = [`${share}${path}`, `${origin.replace(/\/+$/, "")}${path}`].filter(
                  (url, index, all) => all.indexOf(url) === index
                );
                return (
                  <li key={piece.token} className="grid grid-cols-[96px_1fr] gap-3 rounded-xl border border-[var(--border)] p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={linkOnlyCover(piece.token)} alt="" loading="lazy" className="aspect-[9/16] w-24 rounded-lg object-cover" />
                    <div className="grid min-w-0 content-start gap-2">
                      <div>
                        <div className="font-medium">{piece.title}</div>
                        {piece.author && <div className="text-xs text-[var(--muted-foreground)]">{piece.author}</div>}
                        {piece.note && <p className="mt-1 text-sm">{piece.note}</p>}
                      </div>
                      {links.map((url) => (
                        <div key={url} className="flex items-center gap-2">
                          <code className="min-w-0 flex-1 truncate rounded bg-[var(--muted)] px-2 py-1 text-xs">{url}</code>
                          <Button type="button" size="sm" variant="outline" onClick={() => void copy(url)}>
                            <Copy className="size-4" /> {copied === url ? t.copied : t.copy}
                          </Button>
                        </div>
                      ))}
                      <a className="author-account-link inline-flex items-center gap-1 text-xs" href={path} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="size-3" /> {t.open}
                      </a>
                    </div>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
