"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoksPersonRow } from "@/components/boks/client-types";
import { PersonActions } from "@/components/boks/admin/person-actions";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import {
  loadBoksPeople,
} from "@/components/boks/supabase-browser-data";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const words = defineMessages(
  {
    loading: "Loading...",
    noMatch: "No permanent reader accounts match.",
    couldNotLoad: "Could not load people.",
    search: "Search email or @handle",
    placeholder: "Find an account…",
    accounts: (range: string, total: number) => `${range ? `${range} of ` : ""}${total} accounts`,
    refresh: "Refresh",
    suspended: "Suspended",
    active: "Active",
    summary: (minutes: number, boks: number) => `${minutes} min · ${boks} boks read`,
    paused: "Paused",
    admin: "Admin",
    reader: "Reader",
    accountAccess: "Account & access",
    email: "Email",
    reading: "Reading",
    readingValue: (finished: number, opened: number, sessions: number) => `${finished} of ${opened} opened · ${sessions} sessions`,
    algorithm: "Algorithm",
    unassigned: "Unassigned",
    lastRead: "Last read",
    never: "Never",
    suspension: "Suspension",
    pageOf: (range: string, total: number) => `${range} of ${total}`,
    previous: "Previous",
    next: "Next",
  },
  {
    ru: {
      loading: "Загрузка...",
      noMatch: "Постоянных аккаунтов читателей не найдено.",
      couldNotLoad: "Не удалось загрузить людей.",
      search: "Поиск по почте или @нику",
      placeholder: "Найти аккаунт…",
      accounts: (range: string, total: number) =>
        range
          ? `${range} из ${total} ${plural("ru", total, { one: "аккаунта", few: "аккаунтов", many: "аккаунтов", other: "аккаунта" })}`
          : `${total} ${plural("ru", total, { one: "аккаунт", few: "аккаунта", many: "аккаунтов", other: "аккаунта" })}`,
      refresh: "Обновить",
      suspended: "Заблокирован",
      active: "Активен",
      summary: (minutes: number, boks: number) =>
        `${minutes} мин · прочитано ${boks} ${plural("ru", boks, { one: "бок", few: "бока", many: "боков", other: "бока" })}`,
      paused: "Приостановлен",
      admin: "Админ",
      reader: "Читатель",
      accountAccess: "Аккаунт и доступ",
      email: "Почта",
      reading: "Чтение",
      readingValue: (finished: number, opened: number, sessions: number) =>
        `${finished} из ${opened} открытых · ${sessions} ${plural("ru", sessions, { one: "сессия", few: "сессии", many: "сессий", other: "сессии" })}`,
      algorithm: "Алгоритм",
      unassigned: "Не назначен",
      lastRead: "Последнее чтение",
      never: "Никогда",
      suspension: "Блокировка",
      pageOf: (range: string, total: number) => `${range} из ${total}`,
      previous: "Назад",
      next: "Дальше",
    },
  }
);

const pageSize = 100;

/** Account governance. Every mutation is enforced again by an admin-only RPC. */
export function AdminPeople({ currentUserId }: { currentUserId: string | null }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [rows, setRows] = useState<BoksPersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState(() => words[currentUiLanguage()].loading);
  const [busy, setBusy] = useState(false);
  const { openPerson, changes } = useAdminInspector();
  const [page, setPage] = useState(0);
  // Only the newest search may write: typing "iv" then "ivan" otherwise lets
  // the slower "iv" answer land last and replace the list.
  const latestRequest = useRef(0);

  const refresh = useCallback(async (search: string, pageIndex: number) => {
    const request = ++latestRequest.current;
    setBusy(true);
    try {
      const payload = await loadBoksPeople({ query: search, limit: pageSize, offset: pageIndex * pageSize });
      if (request !== latestRequest.current) return;
      setRows(payload.rows);
      setTotal(payload.total);
      setStatus(payload.rows.length ? "" : words[currentUiLanguage()].noMatch);
    } catch (error) {
      if (request !== latestRequest.current) return;
      setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotLoad);
    } finally {
      if (request === latestRequest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => refresh(query, page).catch(() => undefined), 200);
    return () => window.clearTimeout(handle);
  }, [query, page, refresh, changes]);

  const pageStart = total ? page * pageSize + 1 : 0;
  const pageEnd = Math.min((page + 1) * pageSize, total);

  return (
    <section className="studio-people">
      <label className="studio-search"><span>{t.search}</span><span><Search aria-hidden="true" />
        <Input placeholder={t.placeholder} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
      </span></label>
      <div className="studio-filter-line"><p>{t.accounts(total > pageSize ? `${pageStart}–${pageEnd}` : "", total)}</p>
        <Button variant="ghost" onClick={() => refresh(query, page)} disabled={busy}><RefreshCw className="size-4" /> {t.refresh}</Button>
      </div>
      {status && <p className="studio-notice" aria-live="polite">{status}</p>}
      <div className="studio-person-list">
        {rows.map((row) => {
          const isBanned = Boolean(row.bannedAt);
          return <article key={row.userId} className="studio-person-row">
            <div className="studio-person-summary">
              <button type="button" onClick={() => openPerson(row.userId)}>
                <strong>@{row.handle || "reader"}</strong><small>{isBanned ? t.suspended : t.active} · {t.summary(row.minutes, row.boksFinished)}</small>
              </button>
              <span className={`studio-role ${isBanned ? "is-suspended" : row.role === "admin" ? "is-admin" : ""}`}>{isBanned ? t.paused : row.role === "admin" ? t.admin : t.reader}</span>
            </div>
            <details className="studio-row-details"><summary>{t.accountAccess}</summary><div>
              <dl className="studio-facts"><dt>{t.email}</dt><dd>{row.email}</dd><dt>{t.reading}</dt><dd>{t.readingValue(row.boksFinished, row.boksOpened, row.sessions)}</dd><dt>{t.algorithm}</dt><dd>{row.algorithmId ?? t.unassigned}</dd><dt>{t.lastRead}</dt><dd>{row.lastReadAt ? new Date(row.lastReadAt).toLocaleDateString(language) : t.never}</dd>{isBanned && <><dt>{t.suspension}</dt><dd>{row.banReason}</dd></>}</dl>
              <PersonActions row={row} currentUserId={currentUserId} onChanged={() => refresh(query, page)} />
            </div></details>
          </article>;
        })}
      </div>
      {total > pageSize && <div className="studio-pagination"><span>{t.pageOf(`${pageStart}–${pageEnd}`, total)}</span><div>
        <Button variant="outline" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>{t.previous}</Button>
        <Button variant="outline" disabled={pageEnd >= total} onClick={() => setPage(page + 1)}>{t.next}</Button>
      </div></div>}

    </section>
  );
}
