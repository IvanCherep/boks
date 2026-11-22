"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { listShareLinks, type ShareLinkRow } from "@/components/boks/supabase-browser-data";

const words = defineMessages(
  {
    title: "Links to authors' posts",
    lead: "Authors send them from the Workshop after publishing a Series: the contract asks for a post in an open account within 30 days.",
    none: "No links yet.",
    failed: "Could not load the links.",
    refresh: "Refresh",
    published: "published",
    series: "Series",
    post: "Post",
  },
  {
    ru: {
      title: "Ссылки на посты авторов",
      lead: "Авторы присылают их из мастерской после публикации серии: по договору пост в открытом аккаунте нужен в течение 30 дней.",
      none: "Ссылок пока нет.",
      failed: "Не удалось загрузить ссылки.",
      refresh: "Обновить",
      published: "опубликована",
      series: "Серия",
      post: "Пост",
    },
  },
);

/** Studio → Authors: the latest links authors sent to their posts about a Series (`docs/workshop-server.md`). */
export function ShareLinks() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [rows, setRows] = useState<ShareLinkRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => listShareLinks().then((next) => {
    setRows(next);
    setFailed(false);
  }, () => setFailed(true)), []);
  useEffect(() => void load(), [load]);

  const date = (iso: string) => new Date(iso).toLocaleString(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return <section className="author-applications share-links">
    <header>
      <div>
        <h2>{t.title}</h2>
        <p>{t.lead}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />{t.refresh}</Button>
    </header>
    {failed && <p className="author-applications__error">{t.failed}</p>}
    {rows?.length === 0 && <p className="author-applications__muted">{t.none}</p>}
    <ul>
      {rows?.map((row) => <li key={row.id}>
        <div className="author-applications__who">
          <strong>{row.name || (row.handle ? `@${row.handle}` : "?")}</strong>
          <small>{[row.handle ? `@${row.handle}` : null, date(row.createdAt)].filter(Boolean).join(" · ")}</small>
        </div>
        <dl>
          <div><dt>{t.series}</dt><dd><a href={`/b/${row.slug || row.bokId}`} target="_blank" rel="noreferrer noopener">«{row.title}»</a>{row.publishedAt ? ` · ${t.published} ${date(row.publishedAt)}` : ""}</dd></div>
          <div><dt>{t.post}</dt><dd><a href={row.url} target="_blank" rel="noreferrer noopener">{row.url}</a></dd></div>
        </dl>
      </li>)}
    </ul>
  </section>;
}
