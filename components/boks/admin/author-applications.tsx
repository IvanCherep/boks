"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import {
  listAuthorApplications,
  setAuthorApplicationStatus,
  type AuthorApplicationOffer,
  type AuthorApplicationRow,
} from "@/components/boks/supabase-browser-data";

const words = defineMessages(
  {
    title: "Applications",
    lead: "From the page for authors at /author: people with nothing published yet.",
    none: "No applications yet.",
    failed: "Could not load the applications.",
    refresh: "Refresh",
    fresh: (n: number) => `${n} new`,
    offers: { page: "Author page", series: "Three Boks Series", launch: "Joint launch", unsure: "Not sure yet" } as Record<AuthorApplicationOffer, string>,
    status: { new: "New", contacted: "Written to", closed: "Closed" } as Record<AuthorApplicationRow["status"], string>,
    links: "Links",
    audience: "Readers",
    contact: "Contact",
    markContacted: "We wrote",
    close: "Close",
    reopen: "Reopen",
  },
  {
    ru: {
      title: "Заявки",
      lead: "Со страницы для авторов /author: люди, у которых ещё нет публикаций.",
      none: "Заявок пока нет.",
      failed: "Не удалось загрузить заявки.",
      refresh: "Обновить",
      fresh: (n: number) => `${n} новых`,
      offers: { page: "Авторская страница", series: "Три Boks Series", launch: "Совместный запуск", unsure: "Пока не знает" },
      status: { new: "Новая", contacted: "Написали", closed: "Закрыта" },
      links: "Ссылки",
      audience: "Читатели",
      contact: "Связь",
      markContacted: "Написали",
      close: "Закрыть",
      reopen: "Вернуть",
    },
  },
);

/** Studio → Authors: applications from the page for authors (`docs/author-applications.md`). */
export function AuthorApplications() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [rows, setRows] = useState<AuthorApplicationRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => listAuthorApplications().then((next) => {
    setRows(next);
    setFailed(false);
  }, () => setFailed(true)), []);
  useEffect(() => void load(), [load]);

  const mark = (row: AuthorApplicationRow, status: AuthorApplicationRow["status"]) =>
    setAuthorApplicationStatus(row.id, status).then(load, () => setFailed(true));

  const fresh = rows?.filter((row) => row.status === "new").length ?? 0;
  return <section className="author-applications">
    <header>
      <div>
        <h2>{t.title} {fresh > 0 && <em>{t.fresh(fresh)}</em>}</h2>
        <p>{t.lead}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />{t.refresh}</Button>
    </header>
    {failed && <p className="author-applications__error">{t.failed}</p>}
    {rows?.length === 0 && <p className="author-applications__muted">{t.none}</p>}
    <ul>
      {rows?.map((row) => <li key={row.id} className={`is-${row.status}`}>
        <div className="author-applications__who">
          <strong>{row.name}</strong>
          <small>{[row.handle ? `@${row.handle}` : null, row.email, new Date(row.createdAt).toLocaleString(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · ")}</small>
          <span className="author-applications__tags"><b>{t.offers[row.offer]}</b><i>{t.status[row.status]}</i></span>
        </div>
        <dl>
          <div><dt>{t.links}</dt><dd>{row.links.split(/\n+/).filter(Boolean).map((link) => {
            const href = /^https?:\/\//i.test(link.trim()) ? link.trim() : null;
            return <span key={link}>{href ? <a href={href} target="_blank" rel="noreferrer noopener">{link.trim()}</a> : link.trim()}</span>;
          })}</dd></div>
          {row.audience && <div><dt>{t.audience}</dt><dd>{row.audience}</dd></div>}
          <div><dt>{t.contact}</dt><dd>{row.contact}</dd></div>
        </dl>
        {row.message && <p className="author-applications__message">{row.message}</p>}
        <div className="author-applications__actions">
          {row.status === "new" && <Button size="sm" onClick={() => void mark(row, "contacted")}>{t.markContacted}</Button>}
          {row.status !== "closed"
            ? <Button size="sm" variant="ghost" onClick={() => void mark(row, "closed")}>{t.close}</Button>
            : <Button size="sm" variant="ghost" onClick={() => void mark(row, "new")}>{t.reopen}</Button>}
        </div>
      </li>)}
    </ul>
  </section>;
}
