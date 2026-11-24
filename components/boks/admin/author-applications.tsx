"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authorsChangedEvent, startNewAuthor } from "@/components/boks/admin/author-agreement";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import {
  addApplicationNote,
  listApplicationEvents,
  listAuthorApplications,
  setApplicationFocus,
  setApplicationStage,
  type ApplicationEvent,
  type AuthorApplicationOffer,
  type AuthorApplicationRow,
} from "@/components/boks/supabase-browser-data";
import { applicationStages, type ApplicationStage, type Mover } from "@/lib/boks/author/pipeline";
import {
  applicationFilters,
  applicationWait,
  contactHref,
  countApplications,
  matchesApplicationFilter,
  matchesApplicationSearch,
  orderApplications,
  type ApplicationFilter,
} from "@/lib/boks/author/applications";

const days = (n: number) => `${n} d`;
const ruDays = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return `${n} ${m10 === 1 && m100 !== 11 ? "день" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "дня" : "дней"}`;
};

const words = defineMessages(
  {
    title: "Applications",
    lead: "From the page for authors at /author. Each one has a stage: move it as the conversation goes, keep «To clarify» current, and leave notes so nothing is lost.",
    none: "No applications yet.",
    nothingHere: "Nothing here.",
    failed: "Could not load the applications.",
    saveFailed: "Could not save. Try again.",
    refresh: "Refresh",
    fresh: (n: number) => `${n} new`,
    search: "Name, contact, @handle",
    filters: { open: "In progress", ours: "Our move", waiting: "Waiting for a reply", closed: "Closed", all: "All" } as Record<ApplicationFilter, string>,
    offers: { page: "Author’s studio", page_no_promotion: "Author’s studio, no promotion", series: "Five Boks Series (old offer)", launch: "Joint launch", unsure: "Not sure yet" } as Record<AuthorApplicationOffer, string>,
    stages: { new: "New", written: "We wrote, waiting", replied: "They replied", agreed: "Agreed", declined: "Declined", silent: "No answer" } as Record<ApplicationStage, string>,
    stageHints: {
      new: "Nobody has written to them yet.",
      written: "We wrote; the move is theirs.",
      replied: "They answered; think it over and reply.",
      agreed: "We agreed: make the author’s page and invite them.",
      declined: "Closed: we or they said no.",
      silent: "Closed: they never answered.",
    } as Record<ApplicationStage, string>,
    closeAs: "Close as",
    movers: { team: "Our move", author: "Waiting for them", none: "Closed" } as Record<Mover, string>,
    waited: days,
    stuck: "too long",
    stage: "Stage",
    focus: "To clarify",
    focusHint: "One line: what is open, what worries us, what to ask. Shown on the list.",
    save: "Save",
    saved: "Saved",
    filled: "What they sent",
    name: "Name",
    offer: "Plan",
    links: "Links",
    audience: "Readers",
    contact: "Contact",
    about: "About",
    account: "Account",
    guest: "applied as a guest, no account",
    sent: "Sent",
    others: (n: number) => `${n} more application${n === 1 ? "" : "s"} from the same person: search by the contact.`,
    journal: "Journal",
    notePlaceholder: "What was said, what we agreed, what to do next",
    addNote: "Add note",
    noEvents: "No notes yet.",
    loading: "Loading…",
    eventStage: "Stage",
    eventFocus: "To clarify",
    eventFocusCleared: "To clarify: cleared",
    notes: (n: number) => `${n} note${n === 1 ? "" : "s"}`,
    pageIn: "✓ The author accepted the invitation and works in the cabinet.",
    pageInvited: (email: string | null) => `Invitation sent${email ? ` to ${email}` : ""}. The author gets in once they accept it.`,
    pagePage: "The page exists, but the author has not been invited and cannot get in. Open the page and press «Invite the author».",
    openAndInvite: "Open and invite",
    openPage: "Open the page",
    makeAuthor: "Make the author",
  },
  {
    ru: {
      title: "Заявки",
      lead: "Со страницы для авторов /author. У каждой есть этап: двигайте его по ходу разговора, держите «Что уточнить» в актуальном виде и оставляйте заметки, чтобы ничего не потерялось.",
      none: "Заявок пока нет.",
      nothingHere: "Здесь пусто.",
      failed: "Не удалось загрузить заявки.",
      saveFailed: "Не сохранилось. Попробуйте ещё раз.",
      refresh: "Обновить",
      fresh: (n: number) => `${n} новых`,
      search: "Имя, контакт, @имя",
      filters: { open: "В работе", ours: "Наш ход", waiting: "Ждём ответа", closed: "Закрытые", all: "Все" },
      offers: { page: "Кабинет автора", page_no_promotion: "Кабинет автора без продвижения", series: "Пять Boks Series (старое)", launch: "Совместный запуск", unsure: "Пока не знает" },
      stages: { new: "Новая", written: "Написали, ждём", replied: "Ответили нам", agreed: "Договорились", declined: "Отказ", silent: "Не отвечает" },
      stageHints: {
        new: "Мы ещё не писали.",
        written: "Мы написали, ход за автором.",
        replied: "Автор ответил: подумать и ответить.",
        agreed: "Договорились: создать страницу и пригласить автора.",
        declined: "Закрыта: мы или автор отказались.",
        silent: "Закрыта: автор так и не ответил.",
      },
      closeAs: "Закрыть как",
      movers: { team: "Наш ход", author: "Ждём автора", none: "Закрыта" },
      waited: ruDays,
      stuck: "слишком долго",
      stage: "Этап",
      focus: "Что уточнить",
      focusHint: "Одна строка: что открыто, что смущает, о чём спросить. Видна в списке.",
      save: "Сохранить",
      saved: "Сохранено",
      filled: "Что прислал автор",
      name: "Имя",
      offer: "Тариф",
      links: "Ссылки",
      audience: "Читатели",
      contact: "Связь",
      about: "О себе",
      account: "Аккаунт",
      guest: "подал как гость, без аккаунта",
      sent: "Отправлена",
      others: (n: number) => `Ещё заявок от этого человека: ${n}. Найдите их поиском по контакту.`,
      journal: "Журнал",
      notePlaceholder: "Что сказали, о чём договорились, что дальше",
      addNote: "Добавить заметку",
      noEvents: "Заметок пока нет.",
      loading: "Загружаю…",
      eventStage: "Этап",
      eventFocus: "Что уточнить",
      eventFocusCleared: "Что уточнить: очищено",
      notes: (n: number) => `заметок: ${n}`,
      pageIn: "✓ Автор принял приглашение и работает в кабинете.",
      pageInvited: (email: string | null) => `Приглашение отправлено${email ? ` на ${email}` : ""}. Автор войдёт в кабинет, как только примет его.`,
      pagePage: "Страница создана, но автор ещё не приглашён и войти в кабинет не может. Откройте страницу и нажмите «Пригласить автора».",
      openAndInvite: "Открыть и пригласить",
      openPage: "Открыть страницу",
      makeAuthor: "Оформить автора",
    },
  },
);
type Words = typeof words.en;

const openStages: ApplicationStage[] = applicationStages.filter((stage) => stage !== "declined" && stage !== "silent");
const closingStages: ApplicationStage[] = ["declined", "silent"];
const emailOf = (row: AuthorApplicationRow) => row.email ?? (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.contact.trim()) ? row.contact.trim() : "");
const planOf = (row: AuthorApplicationRow) => (row.offer === "launch" || row.offer === "page" || row.offer === "page_no_promotion" ? row.offer : "page");

/** Studio → Authors: applications from the page for authors, worked as a small CRM (`docs/author-applications.md`). */
export function AuthorApplications() {
  const t = useMessages(words);
  const [rows, setRows] = useState<AuthorApplicationRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<ApplicationFilter>("open");
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Set<number>>(() => new Set());

  const load = useCallback(() => listAuthorApplications().then((next) => {
    setRows(next);
    setFailed(false);
  }, () => setFailed(true)), []);
  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener(authorsChangedEvent, reload);
    return () => window.removeEventListener(authorsChangedEvent, reload);
  }, [load]);

  const counts = useMemo(() => countApplications(rows ?? []), [rows]);
  const shown = useMemo(
    () => orderApplications((rows ?? []).filter((row) => matchesApplicationFilter(row, filter) && matchesApplicationSearch(row, query))),
    [rows, filter, query],
  );
  const fresh = rows?.filter((row) => row.stage === "new").length ?? 0;
  const toggle = (id: number) => setOpened((now) => {
    const next = new Set(now);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return <section className="author-applications crm">
    <header>
      <div>
        <h2>{t.title} {fresh > 0 && <em>{t.fresh(fresh)}</em>}</h2>
        <p>{t.lead}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />{t.refresh}</Button>
    </header>
    {failed && <p className="author-applications__error" role="alert">{t.failed}</p>}
    {rows?.length === 0 && <p className="author-applications__muted">{t.none}</p>}
    {rows && rows.length > 0 && <div className="crm-toolbar">
      <div className="crm-filters" role="tablist">
        {applicationFilters.map((key) => <button key={key} type="button" role="tab" aria-selected={filter === key}
          className={filter === key ? "is-on" : undefined} onClick={() => setFilter(key)}>
          {t.filters[key]} <span>{counts[key]}</span>
        </button>)}
      </div>
      <label className="crm-search">
        <Search className="size-4" aria-hidden />
        <input type="search" value={query} placeholder={t.search} aria-label={t.search} onChange={(event) => setQuery(event.target.value)} />
      </label>
    </div>}
    {rows && rows.length > 0 && shown.length === 0 && <p className="author-applications__muted">{t.nothingHere}</p>}
    <ul className="crm-list">
      {shown.map((row) => <ApplicationItem key={row.id} row={row} t={t} open={opened.has(row.id)} onToggle={() => toggle(row.id)} onChanged={load} />)}
    </ul>
  </section>;
}

function ApplicationItem({ row, t, open, onToggle, onChanged }: { row: AuthorApplicationRow; t: Words; open: boolean; onToggle: () => void; onChanged: () => Promise<void> }) {
  const language = useUiLanguage();
  const wait = applicationWait(row);
  const contact = [row.handle ? `@${row.handle}` : null, row.contact].filter(Boolean).join(" · ");
  return <li className={`crm-row is-${row.stage}${wait.stuck ? " is-stuck" : ""}${open ? " is-open" : ""}`}>
    <button type="button" className="crm-row__head" aria-expanded={open} onClick={onToggle}>
      <span className="crm-row__who">
        <strong>{row.name}</strong>
        <small>{contact}</small>
      </span>
      <span className="crm-row__state">
        <span className={`crm-stage crm-stage--${row.stage}`}>{t.stages[row.stage]}</span>
        <small className={`crm-move is-${wait.mover}`}>
          {t.movers[wait.mover]}{wait.mover !== "none" && <> · {t.waited(wait.days)}</>}{wait.stuck && <b> · {t.stuck}</b>}
        </small>
      </span>
      <span className="crm-row__offer">
        <span>{t.offers[row.offer]}</span>
        <small>{new Date(row.createdAt).toLocaleDateString(language, { day: "numeric", month: "short" })}{row.notes > 0 && ` · ${t.notes(row.notes)}`}</small>
      </span>
      <ChevronDown className="crm-row__chevron size-4" aria-hidden />
      {(row.focus || row.lastNote) && <span className="crm-row__focus">
        {row.focus ? <><b>{t.focus}:</b> {row.focus}</> : row.lastNote?.body}
      </span>}
    </button>
    {open && <ApplicationDetail row={row} t={t} onChanged={onChanged} />}
  </li>;
}

function ApplicationDetail({ row, t, onChanged }: { row: AuthorApplicationRow; t: Words; onChanged: () => Promise<void> }) {
  const language = useUiLanguage();
  const [events, setEvents] = useState<ApplicationEvent[] | null>(null);
  const [focus, setFocus] = useState(row.focus ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const [savedFocus, setSavedFocus] = useState(false);

  const loadEvents = useCallback(() => listApplicationEvents(row.id).then(setEvents, () => setEvents([])), [row.id]);
  useEffect(() => { void loadEvents(); }, [loadEvents]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(false);
    try {
      await action();
      await Promise.all([onChanged(), loadEvents()]);
      return true;
    } catch {
      setProblem(true);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const moveTo = (stage: ApplicationStage) => {
    if (stage !== row.stage) void run(() => setApplicationStage(row.id, stage));
  };
  const saveFocus = async () => {
    if (await run(() => setApplicationFocus(row.id, focus))) {
      setSavedFocus(true);
      window.setTimeout(() => setSavedFocus(false), 1800);
    }
  };
  const saveNote = async () => {
    if (note.trim() && await run(() => addApplicationNote(row.id, note))) setNote("");
  };
  const at = (iso: string) => new Date(iso).toLocaleString(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const contactLink = contactHref(row.contact);

  return <div className="crm-detail">
    <div className="crm-detail__work">
      <section className="crm-block">
        <h3>{t.stage}</h3>
        <div className="crm-stages" role="group" aria-label={t.stage}>
          {openStages.map((stage, index) => <button key={stage} type="button" disabled={busy}
            className={`crm-step${row.stage === stage ? " is-on" : ""}${openStages.indexOf(row.stage) > index ? " is-past" : ""}`}
            aria-pressed={row.stage === stage} onClick={() => moveTo(stage)}>
            <span>{index + 1}</span>{t.stages[stage]}
          </button>)}
        </div>
        <div className="crm-closing">
          <small>{t.closeAs}</small>
          {closingStages.map((stage) => <button key={stage} type="button" disabled={busy}
            className={`crm-close${row.stage === stage ? " is-on" : ""}`} aria-pressed={row.stage === stage} onClick={() => moveTo(stage)}>
            {t.stages[stage]}
          </button>)}
        </div>
        <p className="crm-hint">{t.stageHints[row.stage]}</p>
      </section>

      <section className="crm-block">
        <h3><label htmlFor={`crm-focus-${row.id}`}>{t.focus}</label></h3>
        <textarea id={`crm-focus-${row.id}`} className="crm-text" rows={2} maxLength={500} value={focus} placeholder={t.focusHint}
          onChange={(event) => setFocus(event.target.value)} />
        <div className="crm-row-actions">
          <Button size="sm" variant="outline" disabled={busy || focus.trim() === (row.focus ?? "").trim()} onClick={() => void saveFocus()}>{t.save}</Button>
          {savedFocus && <small role="status">{t.saved}</small>}
        </div>
      </section>

      <section className="crm-block">
        <h3><label htmlFor={`crm-note-${row.id}`}>{t.journal}</label></h3>
        <textarea id={`crm-note-${row.id}`} className="crm-text" rows={3} maxLength={4000} value={note} placeholder={t.notePlaceholder}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void saveNote(); }} />
        <div className="crm-row-actions">
          <Button size="sm" disabled={busy || !note.trim()} onClick={() => void saveNote()}>{t.addNote}</Button>
        </div>
        {problem && <p className="author-applications__error" role="alert">{t.saveFailed}</p>}
        {events === null ? <p className="author-applications__muted">{t.loading}</p>
          : events.length === 0 ? <p className="author-applications__muted">{t.noEvents}</p>
            : <ol className="crm-journal">
              {events.map((event) => <li key={event.id} className={`is-${event.kind}`}>
                <small>{at(event.at)}{event.by && ` · @${event.by}`}</small>
                {event.kind === "stage" && event.stageTo && <p className="crm-journal__stage">
                  {t.eventStage}: {event.stageFrom ? `${t.stages[event.stageFrom]} → ` : ""}<b>{t.stages[event.stageTo]}</b>
                </p>}
                {event.kind === "focus" && <p className="crm-journal__stage">{event.body ? <>{t.eventFocus}: <b>{event.body}</b></> : t.eventFocusCleared}</p>}
                {event.kind !== "focus" && event.body && <p>{event.body}</p>}
              </li>)}
            </ol>}
        <p className="crm-journal__start"><small>{at(row.createdAt)}</small> {t.sent}</p>
      </section>
    </div>

    <aside className="crm-detail__facts">
      <section className="crm-block">
        <h3>{t.filled}</h3>
        <dl className="crm-facts">
          <div><dt>{t.name}</dt><dd>{row.name}</dd></div>
          <div><dt>{t.offer}</dt><dd>{t.offers[row.offer]}</dd></div>
          <div><dt>{t.contact}</dt><dd>{contactLink ? <a href={contactLink} target="_blank" rel="noreferrer noopener">{row.contact}</a> : row.contact}</dd></div>
          <div><dt>{t.links}</dt><dd>{row.links.split(/\n+/).map((link) => link.trim()).filter(Boolean).map((link) => {
            const href = /^https?:\/\//i.test(link) ? link : contactHref(link);
            return <span key={link}>{href ? <a href={href} target="_blank" rel="noreferrer noopener">{link}</a> : link}</span>;
          })}</dd></div>
          {row.audience && <div><dt>{t.audience}</dt><dd>{row.audience}</dd></div>}
          {row.message && <div><dt>{t.about}</dt><dd className="crm-facts__message">{row.message}</dd></div>}
          <div><dt>{t.account}</dt><dd>{row.guest ? t.guest : [row.handle ? `@${row.handle}` : null, row.email].filter(Boolean).join(" · ")}</dd></div>
          <div><dt>{t.sent}</dt><dd>{new Date(row.createdAt).toLocaleString(language, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</dd></div>
        </dl>
        {row.others > 0 && <p className="crm-hint">{t.others(row.others)}</p>}
      </section>

      <section className="crm-block">
        {row.pageStage && <p className={`author-applications__page is-${row.pageStage}`}>
          {row.pageStage === "in" ? t.pageIn : row.pageStage === "invited" ? t.pageInvited(row.invitedEmail) : t.pagePage}
        </p>}
        <div className="crm-row-actions">
          {row.spaceId && <Button size="sm" variant={row.pageStage === "page" ? "default" : "outline"} onClick={() => startNewAuthor({
            spaceId: row.spaceId,
            applicationId: row.id,
            handle: row.handle ?? null,
            email: emailOf(row),
            plan: planOf(row),
          })}>{row.pageStage === "page" ? t.openAndInvite : t.openPage}</Button>}
          {!row.spaceId && row.stage !== "declined" && row.stage !== "silent" && <Button size="sm"
            variant={row.stage === "agreed" ? "default" : "outline"} onClick={() => startNewAuthor({
              applicationId: row.id,
              name: row.name,
              handle: row.handle ?? null,
              // The account's own email when they applied signed in; else the contact, if it is an email.
              email: emailOf(row),
              plan: planOf(row),
            })}>{t.makeAuthor}</Button>}
        </div>
      </section>
    </aside>
  </div>;
}
