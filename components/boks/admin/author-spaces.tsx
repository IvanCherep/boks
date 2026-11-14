"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Monitor, Plus, RefreshCw, Search, Smartphone, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "@/app/author-spaces.css";
import {
  findBoksToAttach,
  issueAuthorInvite,
  loadSpacePreview,
  loadStudioSpace,
  loadStudioSpaces,
  publishEditorialSpace,
  removeSpaceWork,
  revokeAuthorInvite,
  saveSpaceOrder,
  saveSpaceWork,
  saveStudioSpace,
  setEditorialSpaceStatus,
  setAuthorSpaceShare,
  setSpaceWorkSeries,
  setSpaceWorkStatus,
  studioMarkSeen,
  studioSendMessage,
  unpublishSpaceWork,
  type FoundBok,
  type InviteState,
  type SpaceKind,
  type SpaceStatus,
  type SpaceWork,
  type StudioSpace,
  type StudioSpaceRow,
  type WorkFormat,
  type WorkStatus,
} from "@/components/boks/author-spaces/data";
import { seriesPieceFor } from "@/components/boks/series/series-catalogue";
import { LinkPreviewMock } from "@/components/boks/author-spaces/link-preview-mock";
import { Conversation, shortDateTime } from "@/components/boks/author-spaces/conversation";
import { linkOnlyCover, linkOnlyPiecePath } from "@/lib/boks/link-only";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { clampCrop, cropLayout, encodeCrop, photoProblem, zoomMax, zoomMin, type Crop } from "@/lib/boks/author/author-photo";
import { inviteLink } from "@/lib/boks/author/invite-link";
import { moveBy } from "@/lib/boks/author/page-order";
import { spaceStage, spaceTimeline, type SpaceStage, type StageInput, type TimelineEvent } from "@/lib/boks/author/space-stage";
import { defineMessages, plural } from "@/lib/i18n/messages";

/**
 * Studio → Authors (2026-11-14): pages prepared by the team.
 *
 * A living author's page is prepared here without an account - name, the
 * address it will have, a photo, its works - previewed at phone and desktop
 * width, and handed over with an invitation link. The author publishes it
 * from their cabinet. A classic's page (editorial) is prepared the same way
 * and published here, with the basis of the rights recorded.
 *
 * Every rule is the database's (`20261114100000_boks_author_spaces.sql`):
 * this screen only asks.
 */

const words = defineMessages(
  {
    search: "Search pages",
    searchPlaceholder: "Name or @address",
    newAuthor: "Create a page",
    newEditorial: "Editorial page",
    empty: "No pages yet. Create one for an author you are preparing, or an editorial page for a classic.",
    loading: "Loading…",
    refresh: "Refresh",
    kind: { author: "Author", editorial: "Editorial" } as Record<SpaceKind, string>,
    status: { draft: "Draft", published: "Published", unpublished: "Taken down", merged: "Joined another page" } as Record<SpaceStatus, string>,
    workStatus: {
      preparing: "In preparation",
      ready: "Ready for review",
      changes_requested: "Changes requested",
      published: "Published",
      withdrawn: "Taken down",
    } as Record<WorkStatus, string>,
    format: { text: "Text", series: "Series" } as Record<WorkFormat, string>,
    invite: { pending: "Waiting for sign-in", accepted: "Accepted", expired: "Expired", revoked: "Revoked" } as Record<InviteState, string>,
    worksCount: (n: number) => `${n} work${n === 1 ? "" : "s"}`,
    readyCount: (n: number) => `${n} ready`,
    authors: "Authors",
    back: "Back to authors",
    nameLabel: "Name on the page",
    handleLabel: "Page address",
    handleHint: "3–24 English letters, digits or _, starting with a letter. For a living author it becomes their @handle when they accept.",
    handleOwned: (handle: string) => `The author owns this page; its address is their @${handle}.`,
    photoLabel: "Photo",
    choosePhoto: "Choose a file",
    removePhoto: "Remove photo",
    zoom: "Zoom",
    horizontal: "Left – right",
    vertical: "Up – down",
    badType: "A JPEG, PNG or WebP photo.",
    photoTooLarge: "The photo is over 10 MB.",
    saveDraft: "Save draft",
    saved: "Saved.",
    works: "Works",
    noWorks: "No works yet. Add a new text, or attach a published bok as a text or a Series.",
    addText: "New text",
    attach: "Attach a published bok",
    titleLabel: "Title",
    titleHint: "Empty: the first line of the text.",
    textLabel: "Text",
    formatLabel: "Format",
    findBok: "Find a bok by title or byline",
    noSeries: "No Series production is registered for this bok, so it can only be attached as a text.",
    addWork: "Add to the page",
    saveWork: "Save changes",
    cancel: "Cancel",
    edit: "Edit",
    markReady: "Mark ready",
    series: "Series",
    stage: {
      not_invited: "Author not invited",
      invite_pending: "Waiting for the author",
      invite_expired: "Invitation expired",
      invite_revoked: "Invitation revoked",
      changes_requested: "Author asked for changes",
      author_reviewing: "Author is looking",
      partly_published: "Published, more waiting",
      published: "Published",
      unpublished: "Taken down",
    } as Record<SpaceStage, string>,
    hiddenByAuthor: "Hidden by the author",
    historyTitle: "History",
    historyAll: (n: number) => `All ${n}`,
    historyLess: "Fewer",
    historyEvent: (event: TimelineEvent): string => {
      const about = "workTitle" in event && event.workTitle ? ` (about «${event.workTitle}»)` : "";
      switch (event.kind) {
        case "invited": return `Invitation sent to ${event.email}`;
        case "accepted": return "The author accepted the page";
        case "author_wrote": return `The author wrote${about}: ${event.body}`;
        case "team_wrote": return `The team answered${about}: ${event.body}`;
        case "published": return `${event.pagePublished ? "Page opened; published" : "Published"}: ${event.titles.map((title) => `«${title}»`).join(", ") || "—"}${event.by ? ` (@${event.by})` : ""}`;
      }
    },
    shareTitle: "Link preview",
    shareStill: "Still card (VK, WhatsApp, most)",
    shareMoving: "Moving card (Telegram)",
    shareNone: "No card yet: the link previews as the page's photo.",
    shareVideoLabel: "Video link (960x504 MP4, -share.mp4), optional",
    unreadMessages: (n: number) => `${n} new from the author`,
    replyPrompt: "Answer to the author (optional): what was changed",
    replyPlaceholder: "By default: “The changes are made. Have a look at the new version.”",
    messagesTitle: "Conversation with the author",
    messagesHint: "The author's notes on the page, the design or a work, and your answers. The author sees them in the cabinet, with a badge for new ones.",
    fromAuthor: "Author",
    fromTeam: "boks team",
    aboutWork: (title: string) => `about «${title}»`,
    replyToAuthor: "Answer the author…",
    send: "Send",
    noMessages: "No messages yet.",
    shareHint: "The card messengers show for the page's link: 1200x630, a -share.jpg in a link-only folder. It belongs to the page, so it stays when the author changes the address; old addresses lead to the page too. Without one, the preview is the page's photo.",
    shareLabel: "Card link",
    shareSave: "Save card",
    shareRemove: "Remove card",
    seriesWatch: "Watch Series",
    seriesPrompt: "Link to the Series (link-only, /l/<token>). The author sees it in the preview; readers do not.",
    seriesSave: "Attach Series",
    seriesRemove: "Detach",
    seriesWaiting: "Series with the text · on the author's page once published, not yet in the feed",
    seriesLive: "Series in the feed and on the shelf",
    seriesGoLive: "Registered in code: to the feed and shelf",
    seriesHold: "Take it off the feed again",
    backToPreparing: "Back to preparation",
    remove: "Remove",
    takeDown: "Take down",
    rightsPrompt: "What was checked? Text, format, files and the rights to the materials.",
    rightsPlaceholder: "Text proofread, recording and music checked, rights: written permission of 12.11",
    authorNote: "The author asks:",
    attachedTo: (title: string) => `Attached to «${title}»`,
    characters: (n: number) => `${n.toLocaleString()} characters`,
    up: "Move up",
    down: "Move down",
    saveOrder: "Save order",
    preview: "Preview",
    desktop: "Desktop",
    phone: "Phone",
    visibleToEditors: "Visible to the team",
    saveFirst: "Save the draft to see the preview.",
    inviteTitle: "Invite the author",
    inviteHint: "Give the author's email. Signed into the author's cabinet with it, they see this page straight away: no link needed, though it is handy to send one. Only that address can take the page. Valid for 14 days; a new invitation revokes the old one.",
    emailLabel: "Author's email",
    createLink: "Invite",
    linkReady: "Invitation ready",
    linkOnce: "Copy it now: the link is shown only once.",
    copyLink: "Copy link",
    copied: "Link copied.",
    revoke: "Revoke",
    inviteHistory: "Invitations",
    handleTaken: "Could not hand over: the address is taken by another account. Change it and invite again.",
    acceptedBy: (handle: string) => `The author accepted: @${handle}.`,
    publishTitle: "Publication",
    publishHint: "An editorial page is published by the team. Choose the works and record the basis.",
    basisLabel: "Basis of publication",
    basisOptions: { public_domain: "Public domain", licence: "Licence", permission: "Permission of the rights holder" } as Record<string, string>,
    sourceLabel: "Source of the texts",
    sourcePlaceholder: "Wikisource, Полное собрание сочинений, т. 3",
    confirmRights: "I confirm the rights to the texts, recordings, music and illustrations of the chosen works.",
    publish: "Publish",
    published: (n: number) => `Published: ${n}.`,
    pageLink: "Page",
    nothingReady: "Mark works as ready to publish them.",
    takePageDown: "Take the page down",
    putPageBack: "Publish the page again",
    history: "Publications",
    byAuthor: "by the author",
    byEditor: "editorial",
    changedElsewhere: "This page was changed in another tab. Reloaded.",
    failed: "Could not save.",
  },
  {
    ru: {
      search: "Поиск страниц",
      searchPlaceholder: "Имя или @адрес",
      newAuthor: "Создать страницу",
      newEditorial: "Страница редакции",
      empty: "Страниц пока нет. Создайте страницу автора, которого готовите, или страницу редакции для классика.",
      loading: "Загружаем…",
      refresh: "Обновить",
      kind: { author: "Автор", editorial: "Редакция" },
      status: { draft: "Черновик", published: "Опубликовано", unpublished: "Снято", merged: "Присоединено к другой странице" },
      workStatus: {
        preparing: "В подготовке",
        ready: "Готово к просмотру",
        changes_requested: "Нужны правки",
        published: "Опубликовано",
        withdrawn: "Снято",
      },
      format: { text: "Текст", series: "Series" },
      invite: { pending: "Ожидает входа", accepted: "Принято", expired: "Истекло", revoked: "Отозвано" },
      worksCount: (n: number) => `${n} ${plural("ru", n, { one: "произведение", few: "произведения", many: "произведений", other: "произведения" })}`,
      readyCount: (n: number) => `готово: ${n}`,
      authors: "Авторы",
      back: "К авторам",
      nameLabel: "Имя на странице",
      handleLabel: "Адрес страницы",
      handleHint: "3–24 латинские буквы, цифры или _, начинается с буквы. У живого автора станет его @именем после принятия приглашения.",
      handleOwned: (handle: string) => `Страница у автора; её адрес — его @${handle}.`,
      photoLabel: "Фото",
      choosePhoto: "Выбрать файл",
      removePhoto: "Убрать фото",
      zoom: "Масштаб",
      horizontal: "Влево – вправо",
      vertical: "Вверх – вниз",
      badType: "Фото в JPEG, PNG или WebP.",
      photoTooLarge: "Фото больше 10 МБ.",
      saveDraft: "Сохранить черновик",
      saved: "Сохранено.",
      works: "Произведения",
      noWorks: "Произведений пока нет. Добавьте новый текст или привяжите опубликованный бок как текст или Series.",
      addText: "Новый текст",
      attach: "Привязать опубликованный бок",
      titleLabel: "Название",
      titleHint: "Пусто — первая строка текста.",
      textLabel: "Текст",
      formatLabel: "Формат",
      findBok: "Найдите бок по названию или подписи",
      noSeries: "Для этого бока не зарегистрирован выпуск Series, его можно привязать только как текст.",
      addWork: "Добавить на страницу",
      saveWork: "Сохранить изменения",
      cancel: "Отмена",
      edit: "Изменить",
      markReady: "Готово к просмотру",
      series: "Series",
      stage: {
        not_invited: "Автор не приглашён",
        invite_pending: "Ждём автора",
        invite_expired: "Приглашение истекло",
        invite_revoked: "Приглашение отозвано",
        changes_requested: "Автор просит правки",
        author_reviewing: "Автор смотрит",
        partly_published: "Опубликовано, ещё ждут",
        published: "Опубликовано",
        unpublished: "Снято",
      },
      hiddenByAuthor: "Автор скрыл с сайта",
      historyTitle: "Ход работы",
      historyAll: (n: number) => `Все ${n}`,
      historyLess: "Свернуть",
      historyEvent: (event: TimelineEvent): string => {
        const about = "workTitle" in event && event.workTitle ? ` (о «${event.workTitle}»)` : "";
        switch (event.kind) {
          case "invited": return `Приглашение на ${event.email}`;
          case "accepted": return "Автор принял страницу";
          case "author_wrote": return `Автор написал${about}: ${event.body}`;
          case "team_wrote": return `Редакция ответила${about}: ${event.body}`;
          case "published": return `${event.pagePublished ? "Страница открыта; опубликовано" : "Опубликовано"}: ${event.titles.map((title) => `«${title}»`).join(", ") || "—"}${event.by ? ` (@${event.by})` : ""}`;
        }
      },
      shareTitle: "Превью ссылки",
      shareStill: "Статичная карточка (VK, WhatsApp и большинство)",
      shareMoving: "Динамичная карточка (Telegram)",
      shareNone: "Карточки пока нет: ссылка покажет фото страницы.",
      shareVideoLabel: "Ссылка на видео (960×504 MP4, -share.mp4), необязательно",
      unreadMessages: (n: number) => `${n} ${plural("ru", n, { one: "новое сообщение", few: "новых сообщения", many: "новых сообщений", other: "новых сообщения" })} от автора`,
      replyPrompt: "Ответ автору (необязательно): что исправили",
      replyPlaceholder: "По умолчанию: «Правки внесены. Посмотрите новую версию»",
      messagesTitle: "Переписка с автором",
      messagesHint: "Замечания автора о странице, оформлении или произведении и ваши ответы. Автор видит их в кабинете, новые отмечены.",
      fromAuthor: "Автор",
      fromTeam: "Редакция boks",
      aboutWork: (title: string) => `о «${title}»`,
      replyToAuthor: "Ответить автору…",
      send: "Отправить",
      noMessages: "Сообщений пока нет.",
      shareHint: "Карточка, которую мессенджеры покажут по ссылке на страницу: 1200×630, файл -share.jpg в link-only папке. Она принадлежит странице, поэтому остаётся, если автор поменяет адрес; старые адреса тоже ведут на страницу. Без неё превью — фото страницы.",
      shareLabel: "Ссылка на карточку",
      shareSave: "Сохранить карточку",
      shareRemove: "Убрать карточку",
      seriesWatch: "Смотреть Series",
      seriesPrompt: "Ссылка на Series (link-only, /l/<токен>). Автор увидит её в предпросмотре, читатели нет.",
      seriesSave: "Привязать Series",
      seriesRemove: "Отвязать",
      seriesWaiting: "Series к тексту · на странице автора после публикации, в ленте ещё нет",
      seriesLive: "Series в ленте и на полке",
      seriesGoLive: "Зарегистрирована в коде: в ленту и на полку",
      seriesHold: "Снова убрать из ленты",
      backToPreparing: "Вернуть в подготовку",
      remove: "Удалить",
      takeDown: "Снять",
      rightsPrompt: "Что проверено? Текст, формат, файлы и права на материалы.",
      rightsPlaceholder: "Текст вычитан, запись и музыка проверены, права: письменное разрешение от 12.11",
      authorNote: "Автор просит:",
      attachedTo: (title: string) => `Привязано к «${title}»`,
      characters: (n: number) => `${n.toLocaleString("ru-RU")} знаков`,
      up: "Выше",
      down: "Ниже",
      saveOrder: "Сохранить порядок",
      preview: "Предпросмотр",
      desktop: "Компьютер",
      phone: "Телефон",
      visibleToEditors: "Видно редакции",
      saveFirst: "Сохраните черновик, чтобы увидеть предпросмотр.",
      inviteTitle: "Пригласить автора",
      inviteHint: "Укажите почту автора. Войдя в кабинет автора с этой почтой, автор сразу увидит страницу: ссылка не обязательна, но её удобно отправить. Принять страницу может только эта почта. Действует 14 дней; новое приглашение отменяет прежнее.",
      emailLabel: "Почта автора",
      createLink: "Пригласить",
      linkReady: "Приглашение готово",
      linkOnce: "Скопируйте сейчас: ссылка показывается один раз.",
      copyLink: "Скопировать ссылку",
      copied: "Ссылка скопирована.",
      revoke: "Отозвать",
      inviteHistory: "Приглашения",
      handleTaken: "Передать не удалось: адрес занят другим аккаунтом. Измените адрес и пригласите снова.",
      acceptedBy: (handle: string) => `Автор принял приглашение: @${handle}.`,
      publishTitle: "Публикация",
      publishHint: "Страницу редакции публикует команда. Выберите произведения и укажите основание.",
      basisLabel: "Основание публикации",
      basisOptions: { public_domain: "Общественное достояние", licence: "Лицензия", permission: "Разрешение правообладателя" },
      sourceLabel: "Источник текстов",
      sourcePlaceholder: "Викитека, Полное собрание сочинений, т. 3",
      confirmRights: "Подтверждаю права на тексты, записи, музыку и иллюстрации выбранных произведений.",
      publish: "Опубликовать",
      published: (n: number) => `Опубликовано: ${n}.`,
      pageLink: "Страница",
      nothingReady: "Отметьте произведения как готовые, чтобы их опубликовать.",
      takePageDown: "Снять страницу",
      putPageBack: "Опубликовать страницу снова",
      history: "Публикации",
      byAuthor: "автором",
      byEditor: "редакцией",
      changedElsewhere: "Страницу изменили в другой вкладке. Обновили.",
      failed: "Не удалось сохранить.",
    },
  }
);

type Words = (typeof words)["en"];

function StatusChip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`asp-chip asp-chip--${tone}`}>{children}</span>;
}

function photoUrl(base64: string | null) {
  return base64 ? `data:image/jpeg;base64,${base64}` : null;
}

// ------------------------------------------------------------------ the list

export function AuthorSpaces() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<SpaceKind | null>(null);

  if (openId || creating) {
    return (
      <SpaceEditor
        key={openId ?? `new-${creating}`}
        spaceId={openId}
        kind={creating ?? "author"}
        onCreated={(id) => {
          setCreating(null);
          setOpenId(id);
        }}
        onBack={() => {
          setOpenId(null);
          setCreating(null);
        }}
      />
    );
  }
  return <SpaceList onOpen={setOpenId} onCreate={setCreating} />;
}

function SpaceList({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: (kind: SpaceKind) => void }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<StudioSpaceRow[] | null>(null);
  const [status, setStatus] = useState("");

  const load = useCallback(async (search: string) => {
    try {
      const answer = await loadStudioSpaces(search);
      setRows(answer.rows);
      setStatus("");
    } catch (error) {
      setStatus(readableBoksError(error, t.failed, language));
    }
  }, [t.failed, language]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  return (
    <section className="asp">
      <div className="asp-toolbar">
        <label className="studio-search asp-search">
          <span>{t.search}</span>
          <span><Search aria-hidden="true" /><Input value={query} placeholder={t.searchPlaceholder} onChange={(event) => setQuery(event.target.value)} /></span>
        </label>
        <div className="asp-toolbar__actions">
          <Button variant="outline" onClick={() => onCreate("editorial")}><Plus aria-hidden="true" />{t.newEditorial}</Button>
          <Button onClick={() => onCreate("author")}><Plus aria-hidden="true" />{t.newAuthor}</Button>
        </div>
      </div>
      {status && <p className="studio-notice" role="alert">{status}</p>}
      {!rows && !status && <p className="studio-notice">{t.loading}</p>}
      {rows && rows.length === 0 && <p className="studio-notice">{t.empty}</p>}
      <ul className="asp-rows">
        {rows?.map((row) => (
          <li key={row.id}>
            <button type="button" className="asp-row" onClick={() => onOpen(row.id)}>
              <span className="asp-row__photo" aria-hidden="true">
                {row.photoVersion && row.status === "published" && row.handle
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/a/${row.handle}/photo?v=${row.photoVersion}`} alt="" />
                  : <span>{(row.name ?? row.handle ?? "b").charAt(0).toUpperCase()}</span>}
              </span>
              <span className="asp-row__who">
                <strong>{row.name ?? `@${row.handle}`}</strong>
                <small>{row.handle ? `@${row.handle}` : "—"} · {t.kind[row.kind]}</small>
              </span>
              <span className="asp-row__state">
                <StatusChip tone={row.status}>{t.status[row.status]}</StatusChip>
                <StatusChip tone={`stage-${spaceStage(row)}`}>{t.stage[spaceStage(row)]}</StatusChip>
              </span>
              <span className="asp-row__works">
                {t.worksCount(row.works)}
                {row.ready > 0 && <small>{t.readyCount(row.ready)}</small>}
                {row.unread > 0 && <small className="asp-warn">{t.unreadMessages(row.unread)}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ one page

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

function SpaceEditor({ spaceId, kind, onCreated, onBack }: { spaceId: string | null; kind: SpaceKind; onCreated: (id: string) => void; onBack: () => void }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [space, setSpace] = useState<StudioSpace | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [photo, setPhoto] = useState<{ kind: "keep" | "remove" } | { kind: "new"; base64: string }>({ kind: "keep" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "phone">("desktop");
  const [previewNonce, setPreviewNonce] = useState(0);

  const apply = useCallback((next: StudioSpace) => {
    setSpace(next);
    setName(next.name ?? "");
    setHandle(next.owned ? next.ownerHandle ?? "" : next.proposedHandle ?? "");
    setPhoto({ kind: "keep" });
    setPreviewNonce((n) => n + 1);
  }, []);

  const reload = useCallback(async () => {
    if (!spaceId) return;
    try {
      apply(await loadStudioSpace(spaceId));
    } catch (error) {
      setNotice(readableBoksError(error, t.failed, language));
    }
  }, [spaceId, apply, t.failed, language]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  /** Every write: busy while it runs, its answer replaces the page, its refusal is said. */
  async function run(action: () => Promise<StudioSpace | void>, done?: string) {
    setBusy(true);
    setNotice("");
    try {
      const next = await action();
      if (next) apply(next);
      if (done) setNotice(done);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "40001") {
        await reload();
        setNotice(t.changedElsewhere);
      } else {
        setNotice(readableBoksError(error, t.failed, language));
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile() {
    await run(async () => {
      const next = await saveStudioSpace({
        id: space?.id ?? null,
        kind: space?.kind ?? kind,
        name,
        handle,
        photo: photo.kind === "new" ? photo.base64 : photo.kind,
        version: space?.version ?? 0,
      });
      if (!space) onCreated(next.id);
      return next;
    }, t.saved);
  }

  const effectiveKind = space?.kind ?? kind;
  const stage = space ? spaceStage(stageInputOf(space)) : null;
  const shownPhoto = photo.kind === "new" ? photoUrl(photo.base64) : photo.kind === "remove" ? null : photoUrl(space?.photo ?? null);
  const dirty = !space || name !== (space.name ?? "") || (!space.owned && handle !== (space.proposedHandle ?? "")) || photo.kind !== "keep";

  return (
    <section className="asp asp-editor">
      <nav className="asp-crumbs" aria-label={t.authors}>
        <button type="button" onClick={onBack}><ArrowLeft aria-hidden="true" />{t.authors}</button>
        <span aria-hidden="true">/</span>
        <span>{space?.name ?? (effectiveKind === "editorial" ? t.newEditorial : t.newAuthor)}</span>
        {stage && <StatusChip tone={`stage-${stage}`}>{t.stage[stage]}</StatusChip>}
        {space && <StatusChip tone="kind">{t.kind[space.kind]}</StatusChip>}
        <button type="button" className="asp-icon-button" onClick={() => void reload()} aria-label={t.refresh} disabled={!space}><RefreshCw aria-hidden="true" /></button>
      </nav>
      {notice && <p className="asp-notice" role="status">{notice}</p>}

      <div className="asp-columns">
        <div className="asp-main">
          {space && space.kind === "author" && (space.invites.length > 0 || space.publications.length > 0) && (
            <HistoryPanel t={t} space={space} />
          )}
          <ProfileForm
            t={t}
            name={name}
            setName={setName}
            handle={handle}
            setHandle={setHandle}
            owned={Boolean(space?.owned)}
            ownerHandle={space?.ownerHandle ?? null}
            photo={shownPhoto}
            onPhoto={(base64) => setPhoto(base64 ? { kind: "new", base64 } : { kind: "remove" })}
            busy={busy}
            dirty={dirty}
            onSave={() => void saveProfile()}
          />

          {space && space.status !== "merged" && (
            <Works t={t} space={space} busy={busy} run={run} />
          )}

          {space && space.kind === "author" && space.status !== "merged" && (space.owned || space.messages.length > 0) && (
            <MessagesPanel t={t} space={space} busy={busy} run={run} />
          )}

          {space && space.status !== "merged" && (
            <ShareCardPanel key={`${space.id}:${space.shareCard ?? ""}:${space.shareVideo ?? ""}`} t={t} space={space} busy={busy} run={run} />
          )}

          {space && space.kind === "author" && space.status !== "merged" && (
            <InvitePanel t={t} space={space} busy={busy} run={run} />
          )}

          {space && space.kind === "editorial" && (
            <EditorialPublish t={t} space={space} busy={busy} run={run} onPublished={(n) => setNotice(t.published(n))} />
          )}

          {space && space.publications.length > 0 && (
            <section className="asp-card">
              <h2>{t.history}</h2>
              <ul className="asp-history">
                {space.publications.map((entry) => (
                  <li key={entry.requestId}>
                    <span>{new Date(entry.createdAt).toLocaleString(language === "ru" ? "ru-RU" : "en-GB")}</span>
                    <span>{entry.basis === "editorial" ? `${t.byEditor}${entry.actorHandle ? ` @${entry.actorHandle}` : ""}` : `${t.byAuthor}${entry.actorHandle ? ` @${entry.actorHandle}` : ""}`}</span>
                    <span>{entry.items.map((item) => `«${item.title}» (${t.format[item.format]}${item.withSeries ? " + Series" : ""} r${item.revision})`).join(", ") || "—"}</span>
                    <span>{entry.termsVersion ?? entry.rightsBasis ?? ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="asp-preview">
          <header>
            <h2>{t.preview}</h2>
            <div className="asp-segmented" role="group" aria-label={t.preview}>
              <button type="button" aria-pressed={previewWidth === "desktop"} onClick={() => setPreviewWidth("desktop")}><Monitor aria-hidden="true" />{t.desktop}</button>
              <button type="button" aria-pressed={previewWidth === "phone"} onClick={() => setPreviewWidth("phone")}><Smartphone aria-hidden="true" />{t.phone}</button>
            </div>
            <StatusChip tone="kind">{t.visibleToEditors}</StatusChip>
          </header>
          {space ? <PreviewFrame spaceId={space.id} width={previewWidth} nonce={previewNonce} /> : <p className="studio-notice">{t.saveFirst}</p>}
        </aside>
      </div>
    </section>
  );
}

/** The page itself, at the width a reader would have, scaled to fit the column. */
function PreviewFrame({ spaceId, width, nonce }: { spaceId: string; width: "desktop" | "phone"; nonce: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const frame = width === "desktop" ? { w: 1280, h: 800 } : { w: 390, h: 844 };

  useEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setScale(Math.min(1, node.clientWidth / frame.w)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [frame.w]);

  return (
    <div ref={box} className={`asp-frame asp-frame--${width}`} style={{ height: frame.h * scale }}>
      <iframe
        key={`${spaceId}-${nonce}`}
        title="preview"
        src={`/author/preview?space=${encodeURIComponent(spaceId)}`}
        style={{ width: frame.w, height: frame.h, transform: `scale(${scale})` }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ profile

function ProfileForm({
  t, name, setName, handle, setHandle, owned, ownerHandle, photo, onPhoto, busy, dirty, onSave,
}: {
  t: Words;
  name: string;
  setName: (value: string) => void;
  handle: string;
  setHandle: (value: string) => void;
  owned: boolean;
  ownerHandle: string | null;
  photo: string | null;
  onPhoto: (base64: string | null) => void;
  busy: boolean;
  dirty: boolean;
  onSave: () => void;
}) {
  const [source, setSource] = useState<{ image: HTMLImageElement; url: string } | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const frameSize = 168;

  function choose(file: File | undefined) {
    if (!file) return;
    const issue = photoProblem(file);
    if (issue) {
      setProblem(issue === "badType" ? t.badType : t.photoTooLarge);
      return;
    }
    setProblem("");
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const next = clampCrop({ width: image.naturalWidth, height: image.naturalHeight, zoom: 1, x: 0, y: 0 });
      setSource({ image, url });
      setCrop(next);
      onPhoto(encodeCrop(image, next));
    };
    image.onerror = () => setProblem(t.badType);
    image.src = url;
  }

  function adjust(change: Partial<Crop>) {
    if (!source || !crop) return;
    const next = clampCrop({ ...crop, ...change });
    setCrop(next);
    onPhoto(encodeCrop(source.image, next));
  }

  const layout = crop ? cropLayout(crop, frameSize) : null;

  return (
    <section className="asp-card">
      <label className="asp-field">
        <span>{t.nameLabel}</span>
        <Input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="asp-field">
        <span>{t.handleLabel}</span>
        <span className="asp-address">
          <span>tryboks.com/@</span>
          <Input value={handle} maxLength={24} disabled={owned} autoCapitalize="off" autoCorrect="off" spellCheck={false}
            onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_]/g, ""))} />
        </span>
        <small>{owned ? t.handleOwned(ownerHandle ?? handle) : t.handleHint}</small>
      </label>
      <div className="asp-field">
        <span>{t.photoLabel}</span>
        <div className="asp-photo">
          <div className="asp-photo__frame" style={{ width: frameSize, height: frameSize }}>
            {source && layout
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={source.url} alt="" style={{ position: "absolute", width: layout.width, height: layout.height, left: layout.left, top: layout.top }} />
              // eslint-disable-next-line @next/next/no-img-element
              : photo ? <img src={photo} alt="" /> : <span aria-hidden="true">{(name || "b").charAt(0).toUpperCase()}</span>}
          </div>
          <div className="asp-photo__controls">
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => choose(event.target.files?.[0])} />
            <Button type="button" variant="outline" onClick={() => input.current?.click()}>{t.choosePhoto}</Button>
            {(photo || source) && <Button type="button" variant="ghost" onClick={() => { setSource(null); setCrop(null); onPhoto(null); }}>{t.removePhoto}</Button>}
            {crop && <>
              <label>{t.zoom}<input type="range" min={zoomMin} max={zoomMax} step={0.01} value={crop.zoom} onChange={(event) => adjust({ zoom: Number(event.target.value) })} /></label>
              <label>{t.horizontal}<input type="range" min={-1} max={1} step={0.005} value={crop.x} onChange={(event) => adjust({ x: Number(event.target.value) })} /></label>
              <label>{t.vertical}<input type="range" min={-1} max={1} step={0.005} value={crop.y} onChange={(event) => adjust({ y: Number(event.target.value) })} /></label>
            </>}
            {problem && <p className="asp-warn" role="alert">{problem}</p>}
          </div>
        </div>
      </div>
      <Button className="asp-primary" disabled={busy || !dirty || !name.trim()} onClick={onSave}>{t.saveDraft}</Button>
    </section>
  );
}

// ------------------------------------------------------------------ works

type Run = (action: () => Promise<StudioSpace | void>, done?: string) => Promise<void>;

function workTone(status: WorkStatus) {
  return status === "changes_requested" ? "warn" : status;
}

function Works({ t, space, busy, run }: { t: Words; space: StudioSpace; busy: boolean; run: Run }) {
  const [editing, setEditing] = useState<SpaceWork | "text" | "attach" | null>(null);
  const [readying, setReadying] = useState<SpaceWork | null>(null);
  const [reply, setReply] = useState("");
  const [rightsNote, setRightsNote] = useState("");
  const [seriesFor, setSeriesFor] = useState<SpaceWork | null>(null);
  const [seriesLink, setSeriesLink] = useState("");
  const visible = space.works.filter((work) => work.status !== "withdrawn");
  const [order, setOrder] = useState<string[]>(() => visible.map((work) => work.id));
  const ids = visible.map((work) => work.id).join(",");
  const [synced, setSynced] = useState(ids);
  if (synced !== ids) {
    setSynced(ids);
    setOrder(visible.map((work) => work.id));
  }
  const byId = new Map(visible.map((work) => [work.id, work]));
  const ordered = order.map((id) => byId.get(id)).filter((work): work is SpaceWork => Boolean(work));
  const moved = ordered.map((work) => work.id).join(",") !== ids;

  function saveOrder() {
    // Published works are ordered as their boks; prepared ones as works.
    const keys = ordered.map((work) => (work.status === "published" && work.bokId ? `b:${work.bokId}` : `w:${work.id}`));
    void run(async () => {
      await saveSpaceOrder(space.id, keys, space.orderVersion);
      return loadStudioSpace(space.id);
    });
  }

  return (
    <section className="asp-card">
      <header className="asp-card__head">
        <h2>{t.works}</h2>
        <div>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing("attach")}>{t.attach}</Button>
          {space.kind === "author" && <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing("text")}>{t.addText}</Button>}
        </div>
      </header>
      {ordered.length === 0 && !editing && <p className="studio-notice">{t.noWorks}</p>}
      <ol className="asp-works">
        {ordered.map((work, index) => {
          const artwork = work.seriesPiece ? linkOnlyCover(work.seriesPiece) : work.bokId ? getBokArtwork({ id: work.bokId }) : null;
          return (
            <li key={work.id} className="asp-work">
              <span className="asp-work__thumb" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {artwork ? <img src={artwork} alt="" /> : <span>{work.title.charAt(0).toUpperCase()}</span>}
              </span>
              <span className="asp-work__body">
                <strong>{work.title}</strong>
                <small>
                  {work.bokId ? t.attachedTo(work.bokTitle ?? work.title) : t.characters(work.characters)}
                  {work.rightsNote ? ` · ${work.rightsNote}` : ""}
                </small>
                {work.status === "changes_requested" && work.note && <small className="asp-warn">{t.authorNote} {work.note}</small>}
                {work.seriesPiece && (
                  <small>
                    <a href={linkOnlyPiecePath(work.seriesPiece)} target="_blank" rel="noopener noreferrer">▶ {t.seriesWatch}</a>
                    {" · "}{work.seriesPublished ? t.seriesLive : t.seriesWaiting}
                  </small>
                )}
              </span>
              <StatusChip tone={work.format === "series" ? "series" : "text"}>{t.format[work.format]}</StatusChip>
              {work.status === "published" && work.bokStatus === "withdrawn"
                ? <StatusChip tone="warn">{t.hiddenByAuthor}</StatusChip>
                : <StatusChip tone={workTone(work.status)}>{t.workStatus[work.status]}</StatusChip>}
              <span className="asp-work__actions">
                <button type="button" className="asp-icon-button" aria-label={t.up} disabled={busy || index === 0} onClick={() => setOrder(moveBy(order, index, -1))}><ArrowUp aria-hidden="true" /></button>
                <button type="button" className="asp-icon-button" aria-label={t.down} disabled={busy || index === ordered.length - 1} onClick={() => setOrder(moveBy(order, index, 1))}><ArrowDown aria-hidden="true" /></button>
                {work.status !== "published" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(work)}>{t.edit}</Button>}
                {(work.status === "preparing" || work.status === "changes_requested") && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => { setRightsNote(work.rightsNote ?? ""); setReadying(work); }}>{t.markReady}</Button>
                )}
                {work.status === "ready" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => setSpaceWorkStatus(work.id, "preparing"))}>{t.backToPreparing}</Button>}
                {work.format === "text" && work.status !== "withdrawn" && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setSeriesLink(work.seriesPiece ? linkOnlyPiecePath(work.seriesPiece) : ""); setSeriesFor(work); }}>{t.series}</Button>
                )}
                {work.status === "published" && work.seriesPiece && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => setSpaceWorkSeries(work.id, work.seriesPiece ?? "", !work.seriesPublished))}>
                    {work.seriesPublished ? t.seriesHold : t.seriesGoLive}
                  </Button>
                )}
                {work.status !== "published" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => removeSpaceWork(work.id))}>{t.remove}</Button>}
                {work.status === "published" && (space.kind === "editorial" || work.format === "series") && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { await unpublishSpaceWork(work.id); return loadStudioSpace(space.id); })}>{t.takeDown}</Button>
                )}
              </span>
              {seriesFor?.id === work.id && (
                <div className="asp-inline-form">
                  <label className="asp-field">
                    <span>{t.seriesPrompt}</span>
                    <Input value={seriesLink} maxLength={300} placeholder="/l/…" onChange={(event) => setSeriesLink(event.target.value)} />
                  </label>
                  <div className="asp-buttons">
                    <Button variant="ghost" onClick={() => setSeriesFor(null)}>{t.cancel}</Button>
                    {work.seriesPiece && (
                      <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { const next = await setSpaceWorkSeries(work.id, ""); setSeriesFor(null); return next; })}>{t.seriesRemove}</Button>
                    )}
                    <Button disabled={busy || !seriesLink.trim()} onClick={() => void run(async () => { const next = await setSpaceWorkSeries(work.id, seriesLink, work.seriesPublished); setSeriesFor(null); return next; })}>{t.seriesSave}</Button>
                  </div>
                </div>
              )}
              {readying?.id === work.id && (
                <div className="asp-inline-form">
                  <label className="asp-field">
                    <span>{t.rightsPrompt}</span>
                    <Input value={rightsNote} maxLength={500} placeholder={t.rightsPlaceholder} onChange={(event) => setRightsNote(event.target.value)} />
                  </label>
                  {work.status === "changes_requested" && (
                    <label className="asp-field">
                      <span>{t.replyPrompt}</span>
                      <Input value={reply} maxLength={2000} placeholder={t.replyPlaceholder} onChange={(event) => setReply(event.target.value)} />
                    </label>
                  )}
                  <div className="asp-buttons">
                    <Button variant="ghost" onClick={() => setReadying(null)}>{t.cancel}</Button>
                    <Button disabled={busy || !rightsNote.trim()} onClick={() => void run(async () => { const next = await setSpaceWorkStatus(work.id, "ready", rightsNote, reply); setReadying(null); setReply(""); return next; })}>{t.markReady}</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {moved && <Button className="asp-primary" disabled={busy} onClick={saveOrder}>{t.saveOrder}</Button>}
      {editing && (
        <WorkForm
          key={typeof editing === "string" ? editing : editing.id}
          t={t}
          space={space}
          work={typeof editing === "string" ? null : editing}
          mode={typeof editing === "string" ? editing : editing.bokId ? "attach" : "text"}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) => void run(async () => {
            const next = await saveSpaceWork({ spaceId: space.id, ...input });
            setEditing(null);
            return next;
          })}
        />
      )}
    </section>
  );
}

function WorkForm({
  t, space, work, mode, busy, onCancel, onSave,
}: {
  t: Words;
  space: StudioSpace;
  work: SpaceWork | null;
  mode: "text" | "attach";
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { workId: string | null; title: string; body: string; format: WorkFormat; bokId: string | null }) => void;
}) {
  const [title, setTitle] = useState(work?.title ?? "");
  const [body, setBody] = useState(work?.body ?? "");
  const [format, setFormat] = useState<WorkFormat>(work?.format ?? "text");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundBok[]>([]);
  const [bok, setBok] = useState<FoundBok | null>(work?.bokId ? { id: work.bokId, title: work.bokTitle ?? work.title, authorName: null, authorHandle: null } : null);
  const [needBody, setNeedBody] = useState(mode === "text" && Boolean(work) && !work?.body);
  const hasSeries = bok ? Boolean(seriesPieceFor(bok.id)) : false;

  // Editing a text needs its body, which the list does not carry.
  useEffect(() => {
    if (!needBody || !work) return;
    let active = true;
    loadSpacePreview(space.id)
      .then((preview) => {
        if (!active) return;
        const item = preview.items.find((entry) => entry.workId === work.id);
        if (item?.body) setBody(item.body);
        setNeedBody(false);
      })
      .catch(() => setNeedBody(false));
    return () => { active = false; };
  }, [needBody, work, space.id]);

  useEffect(() => {
    if (mode !== "attach" || query.trim().length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      findBoksToAttach(query, space.id).then((rows) => active && setFound(rows)).catch(() => undefined);
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mode, query, space.id]);

  const canSave = mode === "text" ? body.trim().length > 0 && !needBody : Boolean(bok) && (format === "text" || hasSeries);

  return (
    <div className="asp-inline-form asp-work-form">
      {mode === "attach" && (
        <>
          {!bok && (
            <label className="asp-field">
              <span>{t.findBok}</span>
              <Input value={query} autoFocus onChange={(event) => setQuery(event.target.value)} />
            </label>
          )}
          {!bok && found.length > 0 && (
            <ul className="asp-found">
              {found.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => { setBok(row); setTitle(row.title); setFormat(seriesPieceFor(row.id) ? "series" : "text"); }}>
                    <strong>{row.title}</strong>
                    <small>{row.authorName ?? ""}{row.authorHandle ? ` · @${row.authorHandle}` : ""}{seriesPieceFor(row.id) ? " · Series" : ""}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {bok && (
            <>
              <p className="asp-picked"><strong>{bok.title}</strong> <button type="button" onClick={() => setBok(null)}>×</button></p>
              <fieldset className="asp-field">
                <legend>{t.formatLabel}</legend>
                <div className="asp-segmented">
                  <button type="button" aria-pressed={format === "text"} onClick={() => setFormat("text")}>{t.format.text}</button>
                  <button type="button" aria-pressed={format === "series"} disabled={!hasSeries} onClick={() => setFormat("series")}>{t.format.series}</button>
                </div>
                {!hasSeries && <small>{t.noSeries}</small>}
              </fieldset>
            </>
          )}
        </>
      )}
      <label className="asp-field">
        <span>{t.titleLabel}</span>
        <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        {mode === "text" && <small>{t.titleHint}</small>}
      </label>
      {mode === "text" && (
        <label className="asp-field">
          <span>{t.textLabel}</span>
          <textarea className="asp-textarea" value={body} rows={12} disabled={needBody} onChange={(event) => setBody(event.target.value)} />
          <small>{t.characters(body.length)}</small>
        </label>
      )}
      <div className="asp-buttons">
        <Button variant="ghost" onClick={onCancel}>{t.cancel}</Button>
        <Button disabled={busy || !canSave} onClick={() => onSave({
          workId: work?.id ?? null,
          title,
          body: mode === "text" ? body : "",
          format: mode === "text" ? "text" : format,
          bokId: mode === "attach" ? bok?.id ?? null : null,
        })}>{work ? t.saveWork : t.addWork}</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ invitation

/** The page's link preview card: it belongs to the page, so a rename keeps it. */
function ShareCardPanel({ t, space, busy, run }: { t: Words; space: StudioSpace; busy: boolean; run: Run }) {
  const [card, setCard] = useState(space.shareCard ?? "");
  const [video, setVideo] = useState(space.shareVideo ?? "");
  const changed = card.trim() !== (space.shareCard ?? "") || video.trim() !== (space.shareVideo ?? "");
  const handle = space.handle ?? space.proposedHandle ?? "";
  return (
    <section className="asp-card">
      <header className="asp-card__head"><h2>{t.shareTitle}</h2></header>
      <p className="asp-hint">{t.shareHint}</p>
      {handle && (
        <LinkPreviewMock
          handle={handle}
          name={space.name ?? ""}
          card={space.shareCard}
          video={space.shareVideo}
          labels={{ still: t.shareStill, moving: t.shareMoving, noCard: t.shareNone, site: "boks" }}
        />
      )}
      <label className="asp-field">
        <span>{t.shareLabel}</span>
        <Input value={card} maxLength={300} placeholder="/l/…/f/…-share.jpg" onChange={(event) => setCard(event.target.value)} />
      </label>
      <label className="asp-field">
        <span>{t.shareVideoLabel}</span>
        <Input value={video} maxLength={300} placeholder="/l/…/f/…-share.mp4" onChange={(event) => setVideo(event.target.value)} />
      </label>
      <div className="asp-buttons">
        {(space.shareCard || space.shareVideo) && <Button variant="ghost" disabled={busy} onClick={() => void run(() => setAuthorSpaceShare(space.id, "", ""))}>{t.shareRemove}</Button>}
        <Button disabled={busy || !changed || (!card.trim() && !video.trim())} onClick={() => void run(() => setAuthorSpaceShare(space.id, card, video))}>{t.shareSave}</Button>
      </div>
    </section>
  );
}

/** The stage's input from a whole page, as the list row gives it for a summary. */
function stageInputOf(space: StudioSpace): StageInput {
  return {
    kind: space.kind,
    status: space.status,
    owned: space.owned,
    invite: space.invites[0] ?? null,
    ready: space.works.filter((work) => work.status === "ready").length,
    changesRequested: space.works.filter((work) => work.status === "changes_requested").length,
  };
}

/** Where the page has been: invitation, acceptance, the author's notes, the team's answers, publications. */
function HistoryPanel({ t, space }: { t: Words; space: StudioSpace }) {
  const language = useUiLanguage();
  const [all, setAll] = useState(false);
  const events = spaceTimeline(space);
  const shown = all ? events : events.slice(0, 6);
  return (
    <section className="asp-card">
      <header className="asp-card__head"><h2>{t.historyTitle}</h2></header>
      <ol className="asp-timeline">
        {shown.map((event, index) => (
          <li key={`${event.at}-${index}`} className={`asp-timeline__item asp-timeline__item--${event.kind}`}>
            <time dateTime={event.at}>{shortDateTime(event.at, language)}</time>
            <span>{t.historyEvent(event)}</span>
          </li>
        ))}
      </ol>
      {events.length > 6 && (
        <Button variant="ghost" size="sm" onClick={() => setAll(!all)}>{all ? t.historyLess : t.historyAll(events.length)}</Button>
      )}
    </section>
  );
}

/** The page's conversation with its author: their notes, the team's answers. */
function MessagesPanel({ t, space, busy, run }: { t: Words; space: StudioSpace; busy: boolean; run: Run }) {
  const language = useUiLanguage();
  // Opening the page in Studio is reading what the author wrote.
  useEffect(() => {
    if (space.unread > 0) void studioMarkSeen(space.id).catch(() => undefined);
  }, [space.id, space.unread]);
  return (
    <section className="asp-card">
      <header className="asp-card__head"><h2>{t.messagesTitle}{space.unread > 0 && <span className="amp-unread">{space.unread}</span>}</h2></header>
      <p className="asp-hint">{t.messagesHint}</p>
      <Conversation
        messages={space.messages}
        mine="team"
        busy={busy}
        language={language}
        labels={{ author: t.fromAuthor, team: t.fromTeam, about: t.aboutWork, placeholder: t.replyToAuthor, send: t.send, empty: t.noMessages }}
        onSend={async (body) => {
          let sent = false;
          await run(async () => { const next = await studioSendMessage(space.id, body); sent = true; return next; });
          return sent;
        }}
      />
    </section>
  );
}

function InvitePanel({ t, space, busy, run }: { t: Words; space: StudioSpace; busy: boolean; run: Run }) {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const latest = space.invites[0] ?? null;

  if (space.owned) {
    return (
      <section className="asp-card">
        <h2>{t.inviteTitle}</h2>
        <p className="studio-notice">{t.acceptedBy(space.ownerHandle ?? "")}</p>
      </section>
    );
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="asp-card">
      <header className="asp-card__head"><h2><UserPlus aria-hidden="true" /> {t.inviteTitle}</h2></header>
      <p className="asp-hint">{t.inviteHint}</p>
      {latest?.problem === "handle_taken" && <p className="asp-warn" role="alert">{t.handleTaken}</p>}
      {link ? (
        <div className="asp-invite-ready">
          <strong>{t.linkReady}</strong>
          <small>{t.linkOnce}</small>
          <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
          <div className="asp-buttons">
            <Button onClick={() => void copy()}><Copy aria-hidden="true" />{copied ? t.copied : t.copyLink}</Button>
          </div>
        </div>
      ) : (
        <div className="asp-invite-form">
          <label className="asp-field">
            <span>{t.emailLabel}</span>
            <Input type="email" value={email} autoComplete="off" onChange={(event) => setEmail(event.target.value)} />
          </label>
          <Button disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} onClick={() => void run(async () => {
            const answer = await issueAuthorInvite(space.id, email.trim());
            setLink(inviteLink(window.location.origin, answer.token));
            setCopied(false);
            return loadStudioSpace(space.id);
          })}>{t.createLink}</Button>
        </div>
      )}
      {space.invites.length > 0 && (
        <>
          <h3>{t.inviteHistory}</h3>
          <ul className="asp-invites">
            {space.invites.map((invite) => (
              <li key={invite.id}>
                <span>{invite.email}</span>
                <StatusChip tone={`invite-${invite.state}`}>{t.invite[invite.state]}</StatusChip>
                <small>{new Date(invite.expiresAt).toLocaleDateString()}</small>
                {invite.state === "pending" && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(async () => { setLink(null); return revokeAuthorInvite(invite.id); })}>{t.revoke}</Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ editorial publication

function EditorialPublish({ t, space, busy, run, onPublished }: { t: Words; space: StudioSpace; busy: boolean; run: Run; onPublished: (n: number) => void }) {
  const ready = useMemo(() => space.works.filter((work) => work.status === "ready"), [space.works]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(ready.map((work) => work.id)));
  const [basis, setBasis] = useState(space.rightsBasis && t.basisOptions[space.rightsBasis] ? space.rightsBasis : "public_domain");
  const [source, setSource] = useState(space.rightsSource ?? "");
  const [confirmed, setConfirmed] = useState(false);
  // One id per attempt: pressing twice, or retrying after a lost answer, is the same publication.
  const [requestId, setRequestId] = useState(newRequestId);

  const items = ready.filter((work) => chosen.has(work.id)).map((work) => ({ workId: work.id, revision: work.revision }));
  const canPublish = (items.length > 0 || space.status !== "published") && source.trim() && confirmed;

  return (
    <section className="asp-card">
      <h2>{t.publishTitle}</h2>
      <p className="asp-hint">{t.publishHint}</p>
      {ready.length === 0 && <p className="studio-notice">{t.nothingReady}</p>}
      <ul className="asp-choose">
        {ready.map((work) => (
          <li key={work.id}>
            <label>
              <input type="checkbox" checked={chosen.has(work.id)} onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(work.id); else next.delete(work.id);
                setChosen(next);
              }} />
              <span>{work.title}</span>
              <StatusChip tone={work.format === "series" ? "series" : "text"}>{t.format[work.format]}</StatusChip>
            </label>
          </li>
        ))}
      </ul>
      <label className="asp-field">
        <span>{t.basisLabel}</span>
        <select className="asp-select" value={basis} onChange={(event) => setBasis(event.target.value)}>
          {Object.entries(t.basisOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="asp-field">
        <span>{t.sourceLabel}</span>
        <Input value={source} maxLength={500} placeholder={t.sourcePlaceholder} onChange={(event) => setSource(event.target.value)} />
      </label>
      <label className="asp-check">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        <span>{t.confirmRights}</span>
      </label>
      <div className="asp-buttons">
        {space.status === "published" && <Button variant="outline" disabled={busy} onClick={() => void run(() => setEditorialSpaceStatus(space.id, "unpublished"))}>{t.takePageDown}</Button>}
        {space.status === "unpublished" && <Button variant="outline" disabled={busy || !space.rightsBasis} onClick={() => void run(() => setEditorialSpaceStatus(space.id, "published"))}>{t.putPageBack}</Button>}
        {space.status === "published" && space.handle && <Button variant="ghost" asChild><a href={`/@${space.handle}`} target="_blank" rel="noopener noreferrer">{t.pageLink} @{space.handle}</a></Button>}
        <Button className="asp-primary" disabled={busy || !canPublish} onClick={() => void run(async () => {
          const result = await publishEditorialSpace({
            spaceId: space.id,
            items,
            rightsBasis: basis,
            rightsSource: source.trim(),
            rightsConfirmed: confirmed,
            requestId,
          });
          setRequestId(newRequestId());
          setConfirmed(false);
          onPublished(result.published.length);
          return loadStudioSpace(space.id);
        })}>{t.publish}</Button>
      </div>
    </section>
  );
}
