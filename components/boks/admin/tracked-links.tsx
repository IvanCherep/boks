"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LinkArrivalStats, LinkAttribution, TrackedLinkReport } from "@/components/boks/client-types";
import {
  createTrackedLink,
  loadLinkAttribution,
  setTrackedLinkArchived,
} from "@/components/boks/supabase-browser-data";
import { readHiddenCountries } from "@/components/boks/admin/guest-funnel";
import { percent } from "@/components/boks/admin/guest-funnel-steps";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import { countryLabel } from "@/components/boks/admin/country-label";
import { bokIdFromInput, linkCodeFrom, trackedLinkUrl } from "@/lib/boks/tracked-links";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const windows = [7, 30, 90] as const;

/** "3 (60%)" - a count with its share of the devices printed beside it. */
function share(count: number, of: number) {
  if (!of) return String(count);
  return `${count} (${percent(count / of)})`;
}

function day(value: string | null, language: string) {
  return value ? new Date(value).toLocaleDateString(language) : "—";
}

/** The outcome columns, shared by the links table and the landed-boks table. */
function outcomeCells(stats: LinkArrivalStats, hasBok: boolean) {
  const d = stats.devices;
  return [
    hasBok ? share(stats.startedBok, d) : "—",
    hasBok ? share(stats.finishedBok, d) : "—",
    hasBok ? share(stats.openedFormat, d) : "—",
    share(stats.readAnother, d),
    share(stats.cameBack, d),
    share(stats.createdAccount, stats.guests),
    stats.medianMinutes === null ? "—" : `${stats.medianMinutes}`,
  ];
}

const words = defineMessages(
  {
    outcomeHeaders: [
      { label: "Opened the bok", title: "Devices that started the bok the link opens" },
      { label: "Finished it", title: "Devices that finished the bok the link opens" },
      { label: "Production", title: "Devices that opened the bok's cinema or immersive poem" },
      { label: "Read another", title: "Devices that finished at least one other bok after arriving" },
      { label: "Came back", title: "Devices that read again on a later day (UTC)" },
      { label: "New accounts", title: "Of the devices that arrived as guests, how many signed up afterwards" },
      { label: "Median min", title: "Median reading minutes per arriving device, from arrival on" },
    ],
    loading: "Loading…",
    couldNotLoad: "Could not load the links.",
    needName: "Give the link a name - who it is for, e.g. “MSU, philology - Лев и собачка”.",
    badBok: "Paste a bok link (tryboks.com/b/…) or its id - copy it from the reader's share button.",
    badCode: "A code is latin letters, digits and dashes, up to 40 - or leave it empty for a generated one.",
    couldNotCreate: "Could not create the link.",
    couldNotUpdate: "Could not update the link.",
    title: "Links",
    lead: (days: number) => `A link per place you send boks to, and what each one brought - arrivals in the last ${days} days, counted by device.`,
    includeTeam: "Include the team",
    window: "Window",
    days: (n: number) => `${n} days`,
    refresh: "Refresh",
    newLink: "New link",
    forWhom: "Who the link is for",
    forWhomPlaceholder: "Who it is for - MSU, philology",
    bok: "Bok link or id",
    bokPlaceholder: "Bok link or id (empty = the feed)",
    code: "Code",
    codePlaceholder: "Code (optional)",
    create: "Create",
    formHint: "The link opens the bok for the reader exactly like a shared one. Make one per place - a faculty chat, a newsletter, a poster - so each can be told apart. The code is what shows in the address; leave it empty for a short random one.",
    copied: "Copied",
    copy: "Copy",
    brought: "What each link brought",
    showArchived: (n: number) => `Show archived (${n})`,
    link: "Link",
    visitsTitle: "Sessions that arrived through the link",
    visits: "Visits",
    devicesTitle: "Distinct devices that arrived",
    devices: "Devices",
    lastVisit: "Last visit",
    noLinks: "No links yet. Make the first one above.",
    aBok: "a bok",
    theFeed: "the feed",
    archived: " · archived",
    from: "From:",
    directApp: "direct / app",
    restore: "Restore",
    archive: "Archive",
    landedOn: "Which bok they landed on",
    landedLead: "Every visit that opened a bok from a link - tracked links and links readers shared themselves - by the bok it opened. Which piece makes the best first bok.",
    bokColumn: "Bok",
    viaLinksTitle: "Of the devices, arrived through a tracked link",
    viaLinks: "Via tracked links",
    noVisits: "No visits through a bok link in this window.",
    readWithCare: (hidden: string | null, since: string | null) =>
      `Read with care. A device is counted once per link, from its first visit through it in the window, and what it did after is counted up to today - so a link sent last week has had less time than one sent last month. A device is not a person: someone who opens the link on a phone and later on a laptop is two. Percentages are of the devices beside them; “New accounts” is of the devices that arrived as guests, and signing in to an older account does not count. The team is left out unless included${hidden ? `, and so are the countries hidden on the Guests tab (${hidden})` : ""}. Visits carry their bok and link from ${since ?? "the first visit after this release"} onwards.`,
  },
  {
    ru: {
      outcomeHeaders: [
        { label: "Открыли бок", title: "Устройства, которые начали бок, открываемый ссылкой" },
        { label: "Дочитали", title: "Устройства, которые дочитали бок, открываемый ссылкой" },
        { label: "Постановка", title: "Устройства, которые открыли кино или иммерсивный стих бока" },
        { label: "Прочли ещё", title: "Устройства, которые после прихода дочитали хотя бы один другой бок" },
        { label: "Вернулись", title: "Устройства, которые снова читали в другой день (UTC)" },
        { label: "Новые аккаунты", title: "Сколько из устройств, пришедших гостями, потом зарегистрировались" },
        { label: "Медиана, мин", title: "Медианные минуты чтения на пришедшее устройство, считая с прихода" },
      ],
      loading: "Загрузка…",
      couldNotLoad: "Не удалось загрузить ссылки.",
      needName: "Назовите ссылку: для кого она, например «МГУ, филфак: Лев и собачка».",
      badBok: "Вставьте ссылку на бок (tryboks.com/b/…) или его id: скопируйте её кнопкой «Поделиться» в читалке.",
      badCode: "Код: латинские буквы, цифры и дефисы, до 40 символов. Или оставьте пустым, и код создастся сам.",
      couldNotCreate: "Не удалось создать ссылку.",
      couldNotUpdate: "Не удалось обновить ссылку.",
      title: "Ссылки",
      lead: (days: number) =>
        `По ссылке на каждое место, куда вы отправляете боки, и что каждая принесла: приходы за последние ${days} ${plural("ru", days, { one: "день", few: "дня", many: "дней", other: "дня" })}, по устройствам.`,
      includeTeam: "С командой",
      window: "Окно",
      days: (n: number) => `${n} ${plural("ru", n, { one: "день", few: "дня", many: "дней", other: "дня" })}`,
      refresh: "Обновить",
      newLink: "Новая ссылка",
      forWhom: "Для кого ссылка",
      forWhomPlaceholder: "Для кого: МГУ, филфак",
      bok: "Ссылка на бок или id",
      bokPlaceholder: "Ссылка на бок или id (пусто = лента)",
      code: "Код",
      codePlaceholder: "Код (необязательно)",
      create: "Создать",
      formHint: "Ссылка открывает читателю бок так же, как обычная ссылка «поделиться». Делайте по одной на место: чат факультета, рассылка, плакат, чтобы их можно было различить. Код виден в адресе; оставьте пустым, и будет короткий случайный.",
      copied: "Скопировано",
      copy: "Копировать",
      brought: "Что принесла каждая ссылка",
      showArchived: (n: number) => `Показать архивные (${n})`,
      link: "Ссылка",
      visitsTitle: "Сессии, пришедшие по ссылке",
      visits: "Визиты",
      devicesTitle: "Разные устройства, которые пришли",
      devices: "Устройства",
      lastVisit: "Последний визит",
      noLinks: "Ссылок пока нет. Создайте первую выше.",
      aBok: "бок",
      theFeed: "лента",
      archived: " · в архиве",
      from: "Откуда:",
      directApp: "напрямую / приложение",
      restore: "Вернуть",
      archive: "В архив",
      landedOn: "На какой бок попали",
      landedLead: "Каждый визит, открывший бок по ссылке (отслеживаемой или той, которой поделились сами читатели), по открытому боку. Какой текст лучше всего работает первым.",
      bokColumn: "Бок",
      viaLinksTitle: "Из устройств: пришли по отслеживаемой ссылке",
      viaLinks: "По отслеживаемым ссылкам",
      noVisits: "В этом окне визитов по ссылкам на боки нет.",
      readWithCare: (hidden: string | null, since: string | null) =>
        `Читайте с осторожностью. Устройство считается по ссылке один раз, с первого визита по ней в окне, а то, что оно делало потом, считается до сегодня: у ссылки, отправленной на прошлой неделе, было меньше времени, чем у отправленной месяц назад. Устройство не человек: кто открыл ссылку на телефоне, а потом на ноутбуке, считается дважды. Проценты берутся от устройств рядом с ними; «Новые аккаунты» считаются от устройств, пришедших гостями, а вход в старый аккаунт не считается. Команда исключена, если её не включить${hidden ? `, как и страны, скрытые на вкладке «Гости» (${hidden})` : ""}. Визиты несут свой бок и ссылку начиная с ${since ?? "первого визита после этого релиза"}.`,
    },
  }
);

/**
 * Tracked links: the link sent to one place, and what it brought.
 *
 * Built for sending boks to universities - one link per place, usually opening
 * a series piece chosen for it - and then asking of each link: did anyone come,
 * did they read the bok, did they stay for another, did they come back, did
 * they sign up. A link is made here and carries its code (`?link=`); the
 * numbers come from `get_link_attribution`, counted by arriving device the way
 * the Guests tab counts, with the team and hidden countries left out the same
 * way.
 *
 * Below the links, the same outcomes per landed bok for every shared-bok
 * visit, tracked link or not - which piece makes the best first bok.
 */
export function TrackedLinksPanel() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const outcomeHeaders = t.outcomeHeaders;
  const { openBok } = useAdminInspector();
  const [days, setDays] = useState<(typeof windows)[number]>(30);
  const [includeTeam, setIncludeTeam] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [hiddenCountries, setHiddenCountries] = useState<string[] | null>(null);
  const [data, setData] = useState<LinkAttribution | null>(null);
  const [status, setStatus] = useState(() => words[currentUiLanguage()].loading);
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState("");
  const [bokInput, setBokInput] = useState("");
  const [code, setCode] = useState("");
  const [formNote, setFormNote] = useState("");
  const [created, setCreated] = useState<{ label: string; url: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async (window: number, team: boolean, hidden: string[]) => {
    setBusy(true);
    try {
      setData(await loadLinkAttribution(window, { includeTeam: team, hideCountries: hidden }));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotLoad);
    } finally {
      setBusy(false);
    }
  }, []);

  // The Guests tab's country filter, read once: one filter for every visitor number.
  useEffect(() => {
    const handle = window.setTimeout(() => setHiddenCountries(readHiddenCountries()), 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (hiddenCountries === null) return;
    const handle = window.setTimeout(() => refresh(days, includeTeam, hiddenCountries).catch(() => undefined), 0);
    return () => window.clearTimeout(handle);
  }, [days, includeTeam, hiddenCountries, refresh]);

  function urlOf(link: { code: string; bokId: string | null }) {
    return trackedLinkUrl(window.location.origin, link);
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      window.setTimeout(() => setCopied((current) => (current === url ? null : current)), 2000);
    } catch {
      // Clipboard refused (an http page, a denied permission): the link is on screen to copy by hand.
      setFormNote(url);
    }
  }

  async function submit() {
    setFormNote("");
    setCreated(null);
    const name = label.trim();
    if (!name) {
      setFormNote(t.needName);
      return;
    }
    const bokId = bokInput.trim() ? bokIdFromInput(bokInput) : null;
    if (bokInput.trim() && !bokId) {
      setFormNote(t.badBok);
      return;
    }
    const typedCode = code.trim();
    if (typedCode && !linkCodeFrom(typedCode)) {
      setFormNote(t.badCode);
      return;
    }

    setBusy(true);
    try {
      const link = await createTrackedLink({ label: name, bokId, code: typedCode ? linkCodeFrom(typedCode) : null });
      const url = urlOf(link);
      setCreated({ label: link.bokTitle ? `${link.label} → ${link.bokTitle}` : link.label, url });
      setLabel("");
      setBokInput("");
      setCode("");
      await refresh(days, includeTeam, hiddenCountries ?? []);
      void copy(url);
    } catch (error) {
      setFormNote(error instanceof Error ? error.message : t.couldNotCreate);
    } finally {
      setBusy(false);
    }
  }

  async function archive(link: TrackedLinkReport, archived: boolean) {
    try {
      await setTrackedLinkArchived(link.code, archived);
      await refresh(days, includeTeam, hiddenCountries ?? []);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.couldNotUpdate);
    }
  }

  const links = (data?.links ?? []).filter((link) => showArchived || !link.archived);
  const archivedCount = (data?.links ?? []).filter((link) => link.archived).length;

  return (
    <section className="panel studio-tracked-links overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="text-xl font-semibold tracking-normal">{t.title}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.lead(days)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeTeam} onChange={(event) => setIncludeTeam(event.target.checked)} />
            {t.includeTeam}
          </label>
          <div className="admin-segmented" aria-label={t.window}>
            {windows.map((window) => (
              <button key={window} type="button" aria-pressed={days === window} onClick={() => setDays(window)}>
                {t.days(window)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={() => void refresh(days, includeTeam, hiddenCountries ?? [])}
            disabled={busy}
          >
            <RefreshCw className="size-4" /> {t.refresh}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 p-4">
        <form
          className="grid gap-3 rounded-xl border border-[var(--border)] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h3 className="text-sm font-semibold">{t.newLink}</h3>
          <div className="grid gap-3 md:grid-cols-[2fr_2fr_1fr_auto]">
            <Input
              aria-label={t.forWhom}
              placeholder={t.forWhomPlaceholder}
              value={label}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
            />
            <Input
              aria-label={t.bok}
              placeholder={t.bokPlaceholder}
              value={bokInput}
              onChange={(event) => setBokInput(event.target.value)}
            />
            <Input
              aria-label={t.code}
              placeholder={t.codePlaceholder}
              value={code}
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setCode(event.target.value)}
            />
            <Button type="submit" disabled={busy}>
              <Link2 className="size-4" /> {t.create}
            </Button>
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {t.formHint}
          </p>
          {created && (
            <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
              <span>{created.label}:</span>
              <code className="break-all rounded bg-[var(--muted)] px-2 py-1">{created.url}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => void copy(created.url)}>
                <Copy className="size-4" /> {copied === created.url ? t.copied : t.copy}
              </Button>
            </div>
          )}
          {formNote && <p className="text-sm text-[var(--muted-foreground)] break-all">{formNote}</p>}
        </form>

        {status && <p className="p-2 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}

        {data && (
          <>
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{t.brought}</h3>
                {archivedCount > 0 && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(event) => setShowArchived(event.target.checked)}
                    />
                    {t.showArchived(archivedCount)}
                  </label>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full min-w-[960px] text-sm">
                  <thead>
                    <tr className="text-left text-[var(--muted-foreground)]">
                      <th className="py-1 font-medium">{t.link}</th>
                      <th className="py-1 text-right font-medium" title={t.visitsTitle}>
                        {t.visits}
                      </th>
                      <th className="py-1 text-right font-medium" title={t.devicesTitle}>
                        {t.devices}
                      </th>
                      {outcomeHeaders.map((header) => (
                        <th key={header.label} className="py-1 text-right font-medium" title={header.title}>
                          {header.label}
                        </th>
                      ))}
                      <th className="py-1 text-right font-medium">{t.lastVisit}</th>
                      <th className="py-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {links.length === 0 && (
                      <tr>
                        <td colSpan={12} className="py-2 text-[var(--muted-foreground)]">
                          {t.noLinks}
                        </td>
                      </tr>
                    )}
                    {links.map((link) => {
                      const url = urlOf(link);
                      return (
                        <tr
                          key={link.code}
                          className={`border-t border-[var(--border)] align-top ${link.archived ? "opacity-60" : ""}`}
                        >
                          <td className="py-2 pr-3">
                            <div className="font-medium">{link.label}</div>
                            <div className="text-xs text-[var(--muted-foreground)]">
                              <code>{link.code}</code>
                              {" · "}
                              {link.bokId ? (
                                <button
                                  type="button"
                                  className="author-account-link"
                                  onClick={() => openBok(link.bokId as string)}
                                >
                                  {link.bokTitle ?? t.aBok}
                                </button>
                              ) : (
                                t.theFeed
                              )}
                              {link.archived ? t.archived : ""}
                            </div>
                            {link.referrers.length > 0 && (
                              <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                                {t.from}{" "}
                                {link.referrers
                                  .map((row) => `${row.value === "direct" ? t.directApp : row.value} ${row.visits}`)
                                  .join(", ")}
                              </div>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums">{link.stats.visits}</td>
                          <td className="py-2 text-right tabular-nums">{link.stats.devices}</td>
                          {outcomeCells(link.stats, Boolean(link.bokId)).map((value, index) => (
                            <td key={outcomeHeaders[index].label} className="py-2 text-right tabular-nums">
                              {value}
                            </td>
                          ))}
                          <td className="py-2 text-right tabular-nums">{day(link.stats.lastVisit, language)}</td>
                          <td className="py-2 pl-2 text-right whitespace-nowrap">
                            <Button type="button" variant="ghost" size="sm" onClick={() => void copy(url)} title={url}>
                              <Copy className="size-4" /> {copied === url ? t.copied : t.copy}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => void archive(link, !link.archived)}>
                              {link.archived ? t.restore : t.archive}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold">{t.landedOn}</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t.landedLead}
              </p>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full min-w-[960px] text-sm">
                  <thead>
                    <tr className="text-left text-[var(--muted-foreground)]">
                      <th className="py-1 font-medium">{t.bokColumn}</th>
                      <th className="py-1 text-right font-medium">{t.visits}</th>
                      <th className="py-1 text-right font-medium">{t.devices}</th>
                      <th className="py-1 text-right font-medium" title={t.viaLinksTitle}>
                        {t.viaLinks}
                      </th>
                      {outcomeHeaders.map((header) => (
                        <th key={header.label} className="py-1 text-right font-medium" title={header.title}>
                          {header.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.boks.length === 0 && (
                      <tr>
                        <td colSpan={11} className="py-2 text-[var(--muted-foreground)]">
                          {t.noVisits}
                        </td>
                      </tr>
                    )}
                    {data.boks.map((row) => (
                      <tr key={row.bokId} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-3">
                          <button type="button" className="author-account-link text-left" onClick={() => openBok(row.bokId)}>
                            {row.bokTitle}
                          </button>
                          {row.bokAuthor && (
                            <span className="text-xs text-[var(--muted-foreground)]"> · {row.bokAuthor}</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{row.stats.visits}</td>
                        <td className="py-2 text-right tabular-nums">{row.stats.devices}</td>
                        <td className="py-2 text-right tabular-nums">{row.throughLinks}</td>
                        {outcomeCells(row.stats, true).map((value, index) => (
                          <td key={outcomeHeaders[index].label} className="py-2 text-right tabular-nums">
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
              {t.readWithCare(
                hiddenCountries && hiddenCountries.length > 0
                  ? hiddenCountries.map((code) => countryLabel(code, language)).join(", ")
                  : null,
                data.trackedSince ? day(data.trackedSince, language) : null
              )}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
