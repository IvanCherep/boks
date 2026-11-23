"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/app/author-spaces.css";
import {
  loadMyAuthorSpace,
  loadMySeriesShelf,
  loadSpacePreview,
  publishMyAuthorSpace,
  requestSpaceChanges,
  saveSpaceOrder,
  unpublishSpaceWork,
  type MyAuthorSpace,
  type PageItem,
  type PreviewItem,
  type PublicationResult,
  type SpacePreview,
  type WorkStatus,
  markMyMessagesSeen,
  sendMyMessage,
} from "@/components/boks/author-spaces/data";
import { WorkPreview, previewWords } from "@/components/boks/author-spaces/space-preview";
import { useLivePoll } from "@/components/boks/author-spaces/live-poll";
import { seriesPieceFor } from "@/components/boks/series/series-catalogue";
import { currentBoksTermsVersion } from "@/components/boks/user-auth-panel";
import { workshopEnabled } from "@/lib/boks/author-desk/switch";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { describeBoksHandleProblem, maxHandleLength, minHandleLength } from "@/lib/boks/contracts";
import { acceptBoksTerms, restoreMyBok, updateBoksProfile, withdrawMyBok } from "@/components/boks/supabase-browser-data";
import { moveBy, moveTo, orderChanged } from "@/lib/boks/author/page-order";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { Icon, Sheet, Thumb, Topbar } from "./ui";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { linkOnlyCover, linkOnlyFilePath } from "@/lib/boks/link-only";
import { authorShareLabel, authorShareLabelPrefix, authorShareUrl } from "@/lib/boks/share-link";
import { ShareLinkPair } from "@/components/boks/share/share-link-pair";
import { Composer, openInComposer } from "./composer";
import { loadPublishing } from "./composer-data";
import { loadMyDecisions, loadMySeriesWork, loadMyVoices, withdrawMySentBok, type SeriesWork } from "./voice-data";
import { DecisionNote } from "./decision-note";
import { decisionWords } from "./decision-words";
import { changeAction, type EditorDecision } from "@/lib/boks/author/editor-decisions";
import { LinkPreviewMock } from "@/components/boks/author-spaces/link-preview-mock";
import { StoryKitSheet, type KitSubject } from "@/components/boks/story-kit/story-kit-sheet";
import { poemManifestFor } from "@/components/boks/poetry/poems";
import { bokArtworkFocus } from "@/components/boks/reader/bok-artwork";

/**
 * The cabinet's "My page" (2026-11-14): what the team prepared, next to what
 * readers already see, in one list and one order.
 *
 * The author looks at the page and each work, asks for changes, orders the
 * page, and publishes the versions they choose - with the terms they accept
 * shown and recorded. The rules are the database's
 * (`publish_my_author_space`): a work that changed after the preview is
 * refused, and a second press returns the first answer.
 */

export type MyPageView = "my-page" | "my-page-order" | "my-page-publish" | "my-page-done" | "my-page-new";
export const myPageViews = new Set<string>(["my-page", "my-page-order", "my-page-publish", "my-page-done", "my-page-new"]);

const words = defineMessages(
  {
    title: "My page",
    back: "Back",
    cabinet: "Cabinet",
    language: "Language",
    loading: "Loading…",
    failed: "Could not load your page.",
    draft: "Closed: visible to you and the team",
    open: "Open to readers",
    photoAndName: "Photo and name",
    previewPage: "Preview the page",
    orderPreview: "Your page, as readers see it",
    orderPreviewChanged: "Your page in the new order · not saved yet",
    orderReset: "Put it back",
    works: "Works",
    order: "Order on the page",
    toPublish: "To publication",
    nothing: "Nothing is prepared for your page yet.",
    format: { text: "Text", series: "Series" } as Record<string, string>,
    status: {
      preparing: "The team is preparing it",
      ready: "Ready to publish",
      changes_requested: "You asked for changes",
      published: "Published",
      withdrawn: "Hidden from the site",
    } as Record<WorkStatus, string>,
    hide: "Hide from the site",
    unhide: "Put back on the site",
    hidden: "Hidden: readers no longer see it. You can put it back here.",
    unhidden: "It is back on your page.",
    guideTitle: "How to publish",
    stepWatch: "“▶ Watch”: look at each work.",
    stepFix: "“Suggest changes”: write what to fix, the team will do it.",
    stepSkip: "“Don't publish”: if something should wait.",
    stepPublish: "“Publish” at the bottom. Until then only you and the team see these works.",
    replied: (n: number) => (n === 1 ? "The team has replied to you" : `The team has replied to you (${n})`),
    readReply: "Read",
    guideNote: "After publication everything stays in your hands: reorder your boks, hide texts and bring them back, change the photo and name, at any time.",
    watch: "Watch",
    readText: "Text",
    fix: "Suggest changes",
    skip: "Don't publish",
    unskip: "Put back into the publication",
    skipped: "Not publishing",
    publishCount: (n: number) => `Publish · ${n}`,
    publishPageOnly: "Publish the page",
    shelfNote: "Your Series appear at once on your page, in the feed and first on the boks Series shelf.",
    seriesOnShelf: "On your page, in the feed and on the boks Series shelf.",
    shownOnShelf: "Your page, the feed and the boks Series shelf, at once",
    doneShelf: "Your Series are already on the boks Series shelf, in the order of your page.",
    openShelf: "Open the Series shelf",
    orderShelf: "The boks Series shelf shows your Series in the same order.",
    yourNote: "Your note to the team:",
    messagesTitle: "Conversation with the team",
    messagesHint: "A question or a wish? Write here, the team answers here.",
    fromYou: "You",
    fromTeam: "boks team",
    aboutWork: (title: string) => `about «${title}»`,
    writePlaceholder: "Write to the team…",
    noMessages: "No messages yet.",
    sentToTeam: "Sent to the team.",
    kitTitle: "For social media",
    kitHint: "Ready pictures for stories and posts about your page and each work: a poster, a frame of a Series, your lines. Save them or send them straight to a story.",
    kitPage: "The whole page",
    kitWork: "For social media",
    linkTitle: "Link to your page",
    linkHint: "This is how the link looks when you send it.",
    linkLater: "It opens for readers once your page is published.",
    copyLink: "Copy link",
    copied: "Link copied.",
    still: "Still card (VK, WhatsApp, most)",
    moving: "Moving card (Telegram)",
    noCard: "The link will preview as your page's photo.",
    reorder: "Change the order",
    allPublished: "Everything is published. Your library is yours to run: change the order, hide a text or bring it back, whenever you like.",
    seriesWaiting: "The Series is on your page; the team adds it to the feed and the Series shelf.",
    seriesLive: "The Series is on your page, in the feed and on the Series shelf.",
    notYet: "Not in this publication:",
    notYetReason: { preparing: "the team is preparing it", changes_requested: "waiting for the changes you asked for" } as Record<string, string>,
    pageOpensAt: (handle: string) => `Your page opens at ${authorShareLabel(handle)}.`,
    waitingChanges: "Nothing to publish right now: the team is making the changes you asked for.",
    doneSeries: "Your page shows them with their Series now; the team adds the Series to the feed and the Series shelf.",
    seriesHeld: "Series in preparation",
    watchSeries: "Watch Series",
    shownWithSeries: "The text and its Series go to your page now; the Series reaches the feed and the Series shelf once the team adds it",
    look: "Read the version",
    askChanges: "Suggest changes",
    askTitle: "What should change?",
    askHint: "Write what should change: a word, a line, a picture, the music. The team fixes it and the work comes back to you here; it stays unpublished until then.",
    send: "Send",
    cancel: "Cancel",
    changeAddress: "Change address",
    addressLabel: "Page address, also your @name",
    addressRule: "English letters, numbers and underscores; starts with a letter.",
    addressOldLink: (old: string) => `Links to ${authorShareLabel(old)} will keep leading to your page.`,
    saveAddress: "Save address",
    addressSaved: (handle: string) => `Your page is now ${authorShareLabel(handle)}`,
    asked: "Sent to the team.",
    takeDownSeries: "Take the Series down",
    takenDown: "The Series is taken down; the text stays published.",
    orderTitle: "Order on the page",
    orderHint: "The top work comes first: readers see your page in this order.",
    orderDraftHint: "A draft takes its place when it is published.",
    up: "Move up",
    down: "Move down",
    drag: "Drag to reorder",
    saveOrder: "Save order",
    orderSaved: "Order saved.",
    publishTitle: "Publication",
    pageAndWorks: (n: number) => `The page and ${n} work${n === 1 ? "" : "s"}`,
    worksOnly: (n: number) => `${n} work${n === 1 ? "" : "s"}`,
    pageOnly: "The page",
    shownIn: { text: "Your page and the feed", series: "Your page, the feed and the Series shelf" } as Record<string, string>,
    terms: "Publication terms",
    termsSummary: "You keep ownership. boks gets a worldwide, non-exclusive, royalty-free licence to host, show, distribute, recommend and promote the chosen works.",
    accept: "I accept the boks terms for the chosen works",
    publishPage: "Publish the page and works",
    publishWorks: "Publish the chosen works",
    nothingReady: "Nothing is ready to publish yet. The team marks a work ready when it is checked.",
    changed: "Something changed since you opened the preview. Look at the works again and confirm.",
    doneTitle: "Published",
    doneBody: (n: number) => `${n} work${n === 1 ? " is" : "s are"} published: readers see ${n === 1 ? "it" : "them"} on your page and in the feed.`,
    donePage: "Your page is open.",
    openPage: "Open my page",
    toCabinet: "Back to the cabinet",
    refresh: "Refresh",
    deskBadge: "New",
    deskTitle: "Workshop",
    deskBody: "Your texts, your voice and the Boks Series queue in one place: write, record, send to the editors and publish.",
    deskOpen: "Open",
    newBok: "New bok",
    newBokHint: "Paste the text, read it in your voice and send it to the editors: they make the cover.",
    voiceChip: "Waiting for your voice",
    voiceNote: "Record or upload your reading, then send it to the editors.",
    recordVoice: "Record",
    draftChip: "Draft",
    edit: "Edit",
    continueDraft: "Continue",
    draftNote: "Only you see it. It goes out when you publish it.",
    waitingChip: "Waiting for a cover",
    waitingNote: "The editors are choosing its cover; it goes out once it has one.",
    sentChip: "Sent",
    sentNote: "The editors are reading and listening. Until they take it into work, you can take it back.",
    withdraw: "Take back",
    withdrawTitle: "Take it back from the editors?",
    withdrawBody: "The text and the recording stay with you, in your drafts.",
    withdrawDone: "Taken back: the bok is in your drafts with its text and recording.",
    inWorkChip: "With the editors",
    inWorkNote: "The editors are making its Boks Series. We will bring it back to you when it is done.",
    seriesReadyChip: "Series ready",
    seriesReadyNote: "Watch it, then publish it.",
    requests: "Requests and ideas",
    requestsTitle: "Requests and ideas",
    requestsHint: "Something does not work, or you would like something new? Write here: the editors read every note and answer here.",
    kinds: { problem: "Something doesn't work", idea: "An idea", question: "A question" } as Record<string, string>,
    kindPrefix: { problem: "Not working", idea: "Idea", question: "Question" } as Record<string, string>,
    requestPlaceholder: { problem: "What happened, and where? A step or a screen is enough.", idea: "What would make boks better for you?", question: "Ask anything." } as Record<string, string>,
    history: "Earlier",
  },
  {
    ru: {
      title: "Моя страница",
      back: "Назад",
      cabinet: "Кабинет",
      language: "Язык",
      loading: "Загружаем…",
      failed: "Не удалось загрузить страницу.",
      draft: "Закрыта: видно вам и редакции",
      open: "Открыта читателям",
      photoAndName: "Фото и имя",
      previewPage: "Предпросмотр страницы",
      orderPreview: "Ваша страница, как её видят читатели",
      orderPreviewChanged: "Страница в новом порядке · ещё не сохранено",
      orderReset: "Вернуть как было",
      works: "Произведения",
      order: "Порядок на странице",
      toPublish: "К публикации",
      nothing: "Для вашей страницы пока ничего не подготовлено.",
      format: { text: "Текст", series: "Series" },
      status: {
        preparing: "Редакция готовит",
        ready: "Можно публиковать",
        changes_requested: "Вы попросили правки",
        published: "Опубликовано",
        withdrawn: "Скрыто с сайта",
      },
      hide: "Скрыть с сайта",
      unhide: "Вернуть на сайт",
      hidden: "Скрыто: читатели его больше не видят. Вернуть можно здесь же.",
      unhidden: "Снова на вашей странице.",
      guideTitle: "Как опубликовать",
      stepWatch: "«▶ Смотреть» — посмотрите каждое произведение.",
      stepFix: "«Внести правки» — напишите, что изменить, редакция исправит.",
      stepSkip: "«Не публиковать» — если что-то пока не выкладываем.",
      stepPublish: "«Опубликовать» — внизу. До этого эти произведения видите только вы и редакция.",
      replied: (n: number) => (n === 1 ? "Редакция ответила вам" : `Редакция ответила вам (${n})`),
      readReply: "Прочитать",
      guideNote: "После публикации всё остаётся в ваших руках: менять порядок боков, скрывать и возвращать тексты, менять фото и имя — в любой момент.",
      watch: "Смотреть",
      readText: "Текст",
      fix: "Внести правки",
      skip: "Не публиковать",
      unskip: "Вернуть в публикацию",
      skipped: "Не публикуем",
      publishCount: (n: number) => `Опубликовать · ${n}`,
      publishPageOnly: "Опубликовать страницу",
      shelfNote: "Series сразу появятся на вашей странице, в ленте и первыми на полке boks Series.",
      seriesOnShelf: "На вашей странице, в ленте и на полке boks Series.",
      shownOnShelf: "Сразу на вашей странице, в ленте и на полке boks Series",
      doneShelf: "Ваши Series уже на полке boks Series — в порядке вашей страницы.",
      openShelf: "Открыть полку Series",
      orderShelf: "В этом же порядке ваши Series стоят на полке boks Series.",
      yourNote: "Ваша заметка редакции:",
      messagesTitle: "Переписка с редакцией",
      messagesHint: "Вопрос или пожелание? Напишите здесь — редакция ответит здесь же.",
      fromYou: "Вы",
      fromTeam: "Редакция boks",
      aboutWork: (title: string) => `о «${title}»`,
      writePlaceholder: "Написать редакции…",
      noMessages: "Сообщений пока нет.",
      sentToTeam: "Отправлено редакции.",
      kitTitle: "Для соцсетей",
      kitHint: "Готовые картинки для сторис и постов о вашей странице и каждой работе: афиша, кадр из Series, ваши строки. Сохраните или сразу отправьте в сторис.",
      kitPage: "Вся страница",
      kitWork: "Для соцсетей",
      linkTitle: "Ссылка на вашу страницу",
      linkHint: "Так ссылка выглядит, когда вы ей делитесь.",
      linkLater: "Читателям она откроется после публикации страницы.",
      copyLink: "Скопировать ссылку",
      copied: "Ссылка скопирована.",
      still: "Статичная карточка (VK, WhatsApp и большинство)",
      moving: "Динамичная карточка (Telegram)",
      noCard: "Ссылка покажет фото вашей страницы.",
      reorder: "Изменить порядок",
      allPublished: "Всё опубликовано. Библиотека в ваших руках: меняйте порядок, скрывайте и возвращайте тексты — когда угодно.",
      seriesWaiting: "Series уже на вашей странице; в ленту и на полку Series её добавит редакция.",
      seriesLive: "Series на вашей странице, в ленте и на полке Series.",
      notYet: "Не войдут в эту публикацию:",
      notYetReason: { preparing: "редакция готовит", changes_requested: "ждём правок, которые вы попросили" },
      pageOpensAt: (handle: string) => `Страница откроется по адресу ${authorShareLabel(handle)}.`,
      waitingChanges: "Сейчас публиковать нечего: редакция вносит правки, которые вы попросили.",
      doneSeries: "На вашей странице они уже с Series; в ленту и на полку Series их добавит редакция.",
      seriesHeld: "Series готовится",
      watchSeries: "Смотреть Series",
      shownWithSeries: "Текст и Series сразу появятся на вашей странице; в ленте и на полке Series она появится, когда редакция её добавит",
      look: "Посмотреть версию",
      askChanges: "Внести правки",
      askTitle: "Что изменить?",
      askHint: "Напишите, что изменить: слово, строку, картинку, музыку. Редакция исправит, и произведение вернётся к вам сюда; до этого оно не публикуется.",
      send: "Отправить",
      cancel: "Отмена",
      changeAddress: "Изменить адрес",
      addressLabel: "Адрес страницы, он же ваше @имя",
      addressRule: "Латинские буквы, цифры и подчёркивание; начинается с буквы.",
      addressOldLink: (old: string) => `Старые ссылки на ${authorShareLabel(old)} будут вести на вашу страницу.`,
      saveAddress: "Сохранить адрес",
      addressSaved: (handle: string) => `Теперь ваша страница — ${authorShareLabel(handle)}`,
      asked: "Отправлено редакции.",
      takeDownSeries: "Снять Series",
      takenDown: "Series снята; текст остаётся опубликованным.",
      orderTitle: "Порядок на странице",
      orderHint: "Верхняя работа будет первой: в этом порядке читатели видят вашу страницу.",
      orderDraftHint: "Черновик займёт своё место после публикации.",
      up: "Выше",
      down: "Ниже",
      drag: "Перетащите, чтобы изменить порядок",
      saveOrder: "Сохранить порядок",
      orderSaved: "Порядок сохранён.",
      publishTitle: "Публикация",
      pageAndWorks: (n: number) => `Страница и ${n} ${plural("ru", n, { one: "произведение", few: "произведения", many: "произведений", other: "произведения" })}`,
      worksOnly: (n: number) => `${n} ${plural("ru", n, { one: "произведение", few: "произведения", many: "произведений", other: "произведения" })}`,
      pageOnly: "Страница",
      shownIn: { text: "Ваша страница и лента", series: "Ваша страница, лента и полка Series" },
      terms: "Условия публикации",
      termsSummary: "Права остаются у вас. boks получает всемирную неисключительную безвозмездную лицензию размещать, показывать, распространять, рекомендовать и продвигать выбранные работы.",
      accept: "Я принимаю условия boks для выбранных работ",
      publishPage: "Опубликовать страницу и работы",
      publishWorks: "Опубликовать выбранные работы",
      nothingReady: "Пока нечего публиковать. Редакция отмечает работу готовой, когда проверит её.",
      changed: "После предпросмотра что-то изменилось. Посмотрите работы ещё раз и подтвердите.",
      doneTitle: "Опубликовано",
      doneBody: (n: number) => `Опубликовано ${n} ${plural("ru", n, { one: "произведение", few: "произведения", many: "произведений", other: "произведения" })}: читатели видят ${n === 1 ? "его" : "их"} на вашей странице и в ленте.`,
      donePage: "Ваша страница открыта.",
      openPage: "Открыть мою страницу",
      toCabinet: "Вернуться в кабинет",
      refresh: "Обновить",
      deskBadge: "Новое",
      deskTitle: "Мастерская",
      deskBody: "Тексты, ваш голос и очередь Boks Series в одном месте: пишите, записывайте, отправляйте в редакцию и публикуйте.",
      deskOpen: "Открыть",
      newBok: "Новый бок",
      newBokHint: "Вставьте текст, прочитайте его своим голосом и отправьте в редакцию: обложку сделаем мы.",
      voiceChip: "Ждёт вашего голоса",
      voiceNote: "Запишите или загрузите чтение, и бок можно отправить в редакцию.",
      recordVoice: "Записать",
      draftChip: "Черновик",
      edit: "Изменить",
      continueDraft: "Продолжить",
      draftNote: "Видите только вы. Выйдет, когда опубликуете.",
      waitingChip: "Ждёт обложку",
      waitingNote: "Редакция подбирает обложку; бок выйдет, как только она будет готова.",
      sentChip: "Отправлено",
      sentNote: "Редакция читает и слушает. Пока бок не взят в работу, его можно отозвать.",
      withdraw: "Отозвать",
      withdrawTitle: "Отозвать из редакции?",
      withdrawBody: "Текст и запись останутся у вас, в черновиках.",
      withdrawDone: "Отозвано: бок в черновиках, текст и запись на месте.",
      inWorkChip: "В работе у редакции",
      inWorkNote: "Редакция готовит Boks Series. Вернём её вам, когда закончим.",
      seriesReadyChip: "Серия готова",
      seriesReadyNote: "Посмотрите и опубликуйте.",
      requests: "Просьбы и предложения",
      requestsTitle: "Просьбы и предложения",
      requestsHint: "Что-то не работает или хочется чего-то нового? Напишите: редакция читает каждое сообщение и отвечает здесь же.",
      kinds: { problem: "Что-то не работает", idea: "Есть идея", question: "Вопрос" },
      kindPrefix: { problem: "Не работает", idea: "Идея", question: "Вопрос" },
      requestPlaceholder: { problem: "Что случилось и где? Достаточно шага или экрана.", idea: "Что сделало бы boks удобнее для вас?", question: "Спросите что угодно." },
      history: "Ранее",
    },
  }
);

type Words = (typeof words)["en"];

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

/** The status a line shows: its work's, or published for a bok readers see. */
function lineStatus(item: PageItem): WorkStatus {
  if (item.hidden) return "withdrawn";
  if (item.work && item.work.status !== "published" && item.work.status !== "withdrawn") return item.work.status;
  return item.published ? "published" : item.work?.status ?? "preparing";
}

function chipTone(status: WorkStatus) {
  return status === "changes_requested" ? "warn" : status;
}

/** Whether readers get this work as a Series: its own recording, or a registered production. */
function isSeries(item: PageItem) {
  return item.format === "series" || Boolean(item.work?.seriesPiece) || Boolean(item.bokId && seriesPieceFor(item.bokId) && !item.seriesHeld);
}

/** A cover for a line: its Series' first picture, or the bok's artwork. */
function coverOf(item: PageItem) {
  if (item.work?.seriesPiece) return linkOnlyCover(item.work.seriesPiece);
  // An own picture is served only once the bok is published; a draft shows its letter here.
  return item.bokId ? getBokArtwork({ id: item.bokId, coverVersion: item.published ? item.coverVersion : null }) : null;
}

/**
 * The last publication's answer. The cabinet mounts each view afresh, so the
 * "Published" screen reads it from here rather than from the view it left.
 */
let lastPublication: PublicationResult | null = null;

/**
 * Works the author chose not to publish now ("Don't publish"), by line key.
 * Kept on this device so the choice survives a reload, and read by the
 * publication step, which mounts as a view of its own.
 */
const skipKey = "boks-my-page-skip";

function readSkipped(): Set<string> {
  try {
    const raw = window.localStorage.getItem(skipKey);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((key): key is string => typeof key === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSkipped(keys: Set<string>) {
  try {
    window.localStorage.setItem(skipKey, JSON.stringify([...keys]));
  } catch {
    // Private mode: the choice holds while this page is open.
  }
}

/** Works the author may publish now: ready, at the revision they are looking at. */
export function publishable(items: PageItem[]) {
  return items.filter((item) => item.work?.status === "ready");
}

export function MyPage({
  view,
  go,
  toast,
  onEditProfile,
  onIdentityChanged,
}: {
  view: MyPageView;
  go: (view: MyPageView | "library") => void;
  toast: (message: string) => void;
  onEditProfile: () => void;
  /** The account's @name changed here: the rest of the cabinet reads it again. */
  onIdentityChanged?: () => void;
}) {
  const w = useMessages(words);
  const d = useMessages(decisionWords);
  const pw = useMessages(previewWords);
  const language = useUiLanguage();
  const [data, setData] = useState<MyAuthorSpace | null>(null);
  const [preview, setPreview] = useState<SpacePreview | null>(null);
  const [failed, setFailed] = useState("");
  const [reading, setReading] = useState<PreviewItem | null>(null);
  /** The reading opened on its Series (Back then returns to the cabinet). */
  const [readingSeries, setReadingSeries] = useState(false);
  const [asking, setAsking] = useState<PageItem | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublicationResult | null>(() => lastPublication);
  const [editingAddress, setEditingAddress] = useState(false);
  const [address, setAddress] = useState("");
  const [addressProblem, setAddressProblem] = useState("");
  /** Whether published Series go onto the boks Series shelf at once (`series_shelf`). */
  const [onShelf, setOnShelf] = useState(false);
  /** Whether this author publishes straight away (`boks_publishes_directly`): the composer is theirs. */
  const [direct, setDirect] = useState(false);
  const [skipped, setSkippedState] = useState<Set<string>>(() => (typeof window === "undefined" ? new Set() : readSkipped()));
  function toggleSkip(key: string) {
    const next = new Set(skipped);
    if (next.has(key)) next.delete(key); else next.add(key);
    writeSkipped(next);
    setSkippedState(next);
  }

  /** Pieces whose chosen take reads their text as saved; null until known, so nothing is marked meanwhile. */
  const [voiced, setVoiced] = useState<Set<string> | null>(null);
  /** The editors' answers on the author's pieces: requests for changes and refusals. */
  const [decisions, setDecisions] = useState<EditorDecision[]>([]);
  /** The editors' work on the author's pieces: accepted into work, the series sent back, published. */
  const [seriesWork, setSeriesWork] = useState<Map<string, SeriesWork>>(new Map());
  /** A sent piece the author is about to take back from the editors. */
  const [withdrawing, setWithdrawing] = useState<PageItem | null>(null);
  /** "For social media": the page, or one work, being made into pictures. */
  const [kit, setKit] = useState<KitSubject | null>(null);

  const load = useCallback(async () => {
    try {
      const [mine, look, shelf, publishing, voices] = await Promise.all([
        loadMyAuthorSpace(),
        loadSpacePreview(null).catch(() => null),
        loadMySeriesShelf(),
        loadPublishing(null).catch(() => null),
        loadMyVoices().catch(() => null),
      ]);
      setDecisions(await loadMyDecisions().catch(() => []));
      setSeriesWork(new Map((await loadMySeriesWork().catch(() => [] as SeriesWork[])).map((entry) => [entry.bokId, entry])));
      setData(mine);
      setVoiced(voices ? new Set(voices.filter((voice) => voice.current).map((voice) => voice.bokId)) : null);
      setPreview(look);
      setOnShelf(shelf);
      setDirect(Boolean(publishing?.direct));
      setFailed("");
      return mine;
    } catch (error) {
      setFailed(readableBoksError(error, w.failed, language));
      return null;
    }
  }, [w.failed, language]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Opening "My page" is reading the team's answers.
  const unread = data?.unread ?? 0;
  useEffect(() => {
    if (view === "my-page" && unread > 0) void markMyMessagesSeen().catch(() => undefined);
  }, [view, unread]);

  async function sendMessage(body: string) {
    try {
      setData(await sendMyMessage(body));
      toast(w.sentToTeam);
      return true;
    } catch (error) {
      toast(readableBoksError(error, w.failed, language));
      return false;
    }
  }

  async function copyPageLink(link: string) {
    if (!data?.handle) return;
    try {
      await navigator.clipboard.writeText(link);
      toast(w.copied);
    } catch {
      // Clipboard refused (insecure context, permissions): the pair shows the link to copy by hand.
      return false;
    }
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const ready = publishable(items);
  const chosen = ready.filter((item) => !skipped.has(item.key));
  const pageDraft = data?.space?.status === "draft";
  const waiting = items.filter((item) => item.work && (item.work.status === "preparing" || item.work.status === "changes_requested"));
  const orderable = items.filter((item) => !item.hidden && !item.draft && !item.coverWaiting).length;
  const [requestsOpen, setRequestsOpen] = useState(false);
  // The team's answers arrive while the page is open: every 15 seconds with
  // the conversation open, every minute otherwise, for the badge. Only the
  // conversation is taken from the answer, so nothing the author is in the
  // middle of on the page changes under them.
  const pollMessages = useCallback(async () => {
    const mine = await loadMyAuthorSpace();
    setData((current) => (current && mine ? { ...current, messages: mine.messages, unread: mine.unread } : current));
  }, []);
  useLivePoll(pollMessages, requestsOpen ? 15_000 : 60_000, Boolean(data?.space));
  const undecided = items.some((item) => item.work && item.work.status !== "published" && item.work.status !== "withdrawn");

  function readItem(item: PageItem, series = false) {
    const found = preview?.items.find((entry) => entry.key === item.key || (item.bokId && entry.bokId === item.bokId));
    if (!found) return;
    setReadingSeries(series);
    setReading(found);
  }

  /**
   * The page's address is the account's @name: changing it here is the same
   * change as in You → Settings, and the page moves with it.
   */
  async function saveAddress() {
    const problem = describeBoksHandleProblem(address, language);
    if (problem) { setAddressProblem(problem); return; }
    setBusy(true);
    try {
      await updateBoksProfile({ handle: address });
      onIdentityChanged?.();
      setEditingAddress(false);
      toast(w.addressSaved(address));
      await load();
    } catch (error) {
      setAddressProblem(readableBoksError(error, w.failed, language));
    } finally {
      setBusy(false);
    }
  }

  async function sendChanges() {
    if (!asking?.work) return;
    setBusy(true);
    try {
      setData(await requestSpaceChanges(asking.work.id, note));
      setAsking(null);
      setNote("");
      toast(w.asked);
    } catch (error) {
      toast(readableBoksError(error, w.failed, language));
    } finally {
      setBusy(false);
    }
  }

  /** Take a sent piece back from the editors, while they have not taken it into work. */
  async function withdraw(item: PageItem) {
    if (!item.bokId) return;
    setBusy(true);
    try {
      await withdrawMySentBok(item.bokId);
      setWithdrawing(null);
      await load();
      toast(w.withdrawDone);
    } catch (error) {
      setWithdrawing(null);
      toast(readableBoksError(error, w.failed, language));
    } finally {
      setBusy(false);
    }
  }

  /** A piece whose series the editors sent back shows once: as the ready series, not also as the sent text. */
  function seriesShownAsWork(item: PageItem) {
    if (!item.coverWaiting || !item.bokId || seriesWork.get(item.bokId)?.state !== "sent") return false;
    return items.some((other) => other.work?.bokId === item.bokId && other.work.status === "ready");
  }

  /** A work readers can open now: it gets pictures for social media. */
  function kitWork(item: PageItem): KitSubject | null {
    if (!item.bokId || !item.published || item.hidden || item.draft) return null;
    const previewed = preview?.items.find((entry) => entry.key === item.key || entry.bokId === item.bokId);
    const piece = item.work?.seriesPiece ?? previewed?.seriesPiece ?? null;
    return {
      kind: "work",
      bokId: item.bokId,
      title: item.title,
      byline: preview?.name || data?.name || null,
      cover: coverOf(item),
      focus: seriesPieceFor(item.bokId)?.coverFocus ?? bokArtworkFocus(item.bokId),
      series: isSeries(item) || Boolean(piece),
      manifest: piece ? linkOnlyFilePath(piece, "manifest.json") : poemManifestFor(item.bokId),
      body: previewed?.body ?? null,
    };
  }


  /** Take a published work off the site, or put it back: the cabinet's own withdraw. */
  async function setHidden(item: PageItem, hide: boolean) {
    if (!item.bokId) return;
    setBusy(true);
    try {
      await (hide ? withdrawMyBok(item.bokId) : restoreMyBok(item.bokId));
      await load();
      toast(hide ? w.hidden : w.unhidden);
    } catch (error) {
      toast(readableBoksError(error, w.failed, language));
    } finally {
      setBusy(false);
    }
  }

  async function takeDownSeries(item: PageItem) {
    if (!item.work) return;
    setBusy(true);
    try {
      await unpublishSpaceWork(item.work.id);
      await load();
      toast(w.takenDown);
    } catch (error) {
      toast(readableBoksError(error, w.failed, language));
    } finally {
      setBusy(false);
    }
  }

  const header = (title: string, back: MyPageView | "library") => (
    <Topbar title={title} backLabel={w.back} languageLabel={w.language} onBack={() => go(back)} />
  );

  function compose(bokId: string | null, at: "voice" | null = null) {
    openInComposer(bokId, at);
    go("my-page-new");
  }

  if (view === "my-page-new") {
    return <Composer go={(next) => { void load(); go(next); }} toast={toast} />;
  }

  if (!data) {
    return (
      <main className="page detail-page">
        {header(w.title, "library")}
        <p className="desk-note" role="status">{failed || w.loading}</p>
      </main>
    );
  }

  if (view === "my-page-order") {
    return <OrderView w={w} data={data} preview={preview} onShelf={onShelf} header={header(w.orderTitle, "my-page")} onSaved={async () => { await load(); toast(w.orderSaved); go("my-page"); }} />;
  }

  if (view === "my-page-publish") {
    return (
      <PublishView
        w={w}
        items={ready}
        skipped={skipped}
        onShelf={onShelf}
        waiting={waiting}
        handle={data.handle}
        pageDraft={pageDraft}
        header={header(w.publishTitle, "my-page")}
        onRead={readItem}
        onAsk={(item) => { setNote(""); setAsking(item); }}
        reload={load}
        onDone={(answer) => {
          lastPublication = answer;
          setResult(answer);
          // What was skipped stays skipped; what went out needs no choice any more.
          const left = new Set([...skipped].filter((key) => !answer.published.some((item) => items.find((entry) => entry.key === key)?.work?.id === item.workId)));
          writeSkipped(left);
          setSkippedState(left);
          void load();
          go("my-page-done");
        }}
        reading={reading && <WorkPreview key={`${reading.key}:${readingSeries}`} item={reading} t={pw} watchFirst={readingSeries} onClose={() => setReading(null)} />}
        asking={asking && <AskSheet w={w} item={asking} note={note} setNote={setNote} busy={busy} onSend={() => void sendChanges()} onClose={() => setAsking(null)} />}
      />
    );
  }

  if (view === "my-page-done") {
    const handle = result?.handle ?? data.handle;
    return (
      <main className="page detail-page amp">
        {header(w.doneTitle, "library")}
        <section className="amp-done">
          <div className="empty-letter">b.</div>
          <h1>{w.doneTitle}<span className="dot">.</span></h1>
          {result?.pagePublished && <p>{w.donePage}</p>}
          {result && <p>{w.doneBody(result.published.length)}</p>}
          <ul className="amp-list">
            {result?.published.map((item) => {
              const line = items.find((entry) => entry.work?.id === item.workId);
              return (
                <li key={item.workId}>
                  <Thumb id={item.bokId} title={item.title} image={line ? coverOf(line) : null} />
                  <span><strong>{item.title}</strong><small>{item.withSeries ? w.format.series : w.format[item.format]}</small></span>
                </li>
              );
            })}
          </ul>
          {result?.published.some((item) => item.withSeries) && <p className="desk-note">{onShelf ? w.doneShelf : w.doneSeries}</p>}
          <div className="sheet-buttons">
            <button type="button" className="btn btn-secondary" onClick={() => go("my-page")}>{w.title}</button>
            {onShelf && result?.published.some((item) => item.withSeries) && <a className="btn btn-secondary" href="/series">{w.openShelf}</a>}
            {handle && <a className="btn btn-red" href={`/@${handle}`}>{w.openPage} <Icon name="arrow" /></a>}
          </div>
        </section>
      </main>
    );
  }

  const name = preview?.name || (data.handle ? `@${data.handle}` : "");
  const photo = preview?.photo ? `data:image/jpeg;base64,${preview.photo}` : null;
  const kitWorks = items.filter((item) => !seriesShownAsWork(item)).map(kitWork).filter((entry): entry is Extract<KitSubject, { kind: "work" }> => entry?.kind === "work");
  const kitPage: KitSubject = { kind: "page", name, photo, covers: kitWorks.map((entry) => entry.cover).filter((cover): cover is string => Boolean(cover)).slice(0, 3), works: kitWorks.length, series: kitWorks.filter((entry) => entry.series).length };

  return (
    <main className="page amp">
      {header(w.title, "library")}
      <section className="amp-identity">
        <span className="amp-photo" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photo ? <img src={photo} alt="" /> : name.replace(/^@/, "").charAt(0).toUpperCase()}
        </span>
        <div>
          <h1 className="serif">{name}</h1>
          <p>
            {authorShareLabel(data.handle ?? "")} · <span className={`asp-chip asp-chip--${pageDraft ? "draft" : "published"}`}>{pageDraft ? w.draft : w.open}</span>
            {" "}<button type="button" className="amp-link" onClick={() => { setAddress(data.handle ?? ""); setAddressProblem(""); setEditingAddress(true); }}>{w.changeAddress}</button>
          </p>
          {editingAddress && (
            <form className="amp-address" onSubmit={(event) => { event.preventDefault(); void saveAddress(); }}>
              <label>
                <span>{w.addressLabel}</span>
                <span className="amp-address__field">
                  <span aria-hidden="true">{authorShareLabelPrefix()}</span>
                  <input value={address} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                    minLength={minHandleLength} maxLength={maxHandleLength}
                    onChange={(event) => { setAddress(event.target.value.trim().replace(/^@+/, "").toLowerCase()); setAddressProblem(""); }} />
                </span>
              </label>
              <small>{w.addressRule}{!pageDraft && data.handle ? ` ${w.addressOldLink(data.handle)}` : ""}</small>
              {addressProblem && <p className="notice" role="alert">{addressProblem}</p>}
              <div className="sheet-buttons">
                <button type="button" className="btn btn-secondary" onClick={() => setEditingAddress(false)}>{w.cancel}</button>
                <button type="submit" className="btn" disabled={busy || address === data.handle}>{w.saveAddress}</button>
              </div>
            </form>
          )}
        </div>
        <div className="amp-identity__actions">
          <button type="button" className="btn btn-secondary" onClick={onEditProfile}>{w.photoAndName}</button>
          <a className="btn btn-secondary" href="/author/preview">{w.previewPage}</a>
          {data.space && (
            <button type="button" className="btn btn-secondary amp-requests" onClick={() => setRequestsOpen(true)}>
              {w.requests}{unread > 0 && <span className="amp-unread">{unread}</span>}
            </button>
          )}
        </div>
      </section>

      {unread > 0 && data.space && (
        <a className="amp-replied" href="#messages" onClick={(event) => { event.preventDefault(); setRequestsOpen(true); }}>
          <span>✉ {w.replied(unread)}</span>
          <span className="amp-replied__go">{w.readReply} ↓</span>
        </a>
      )}

      {undecided && (
        <section className="amp-guide">
          <h2 className="serif">{w.guideTitle}</h2>
          <ol>
            <li>{w.stepWatch}</li>
            <li>{w.stepFix}</li>
            <li>{w.stepSkip}</li>
            <li>{w.stepPublish}</li>
          </ol>
          <p className="amp-guide__control">{w.guideNote}</p>
        </section>
      )}

      {workshopEnabled && direct ? (
        <a className="desk-entry" href="/author/desk">
          <span className="desk-entry-mark" aria-hidden="true">b.</span>
          <span className="desk-entry-text">
            <strong>
              {w.deskTitle} <em>{w.deskBadge}</em>
            </strong>
            <small>{w.deskBody}</small>
          </span>
          <span className="desk-entry-go">{w.deskOpen} →</span>
        </a>
      ) : null}

      <section className="amp-works">
        <header className="amp-works__head">
          <h2 className="serif">{w.works}</h2>
          {orderable > 1 && <button type="button" className="amp-link" onClick={() => go("my-page-order")}>{w.order}</button>}
        </header>
        {direct && (
          <button type="button" className="amp-new" onClick={() => (workshopEnabled ? window.location.assign("/author/desk#add") : compose(null))}>
            <span className="amp-new__plus" aria-hidden="true">+</span>
            <span><strong>{w.newBok}</strong><small>{w.newBokHint}</small></span>
          </button>
        )}
        {items.length === 0 && !direct && <p className="desk-note">{w.nothing}</p>}
        <ul className="amp-list amp-cards">
          {items.filter((item) => !seriesShownAsWork(item)).map((item) => {
            const status = lineStatus(item);
            // The editors' work on it: accepted (locked), or its series sent back to publish.
            const work = item.bokId ? seriesWork.get(item.bokId) : undefined;
            const inWork = Boolean(item.coverWaiting && work && (work.state === "accepted" || work.state === "sent"));
            const seriesReady = Boolean(item.work?.status === "ready" && item.work.bokId && seriesWork.get(item.work.bokId)?.state === "sent");
            const isSkipped = item.work?.status === "ready" && skipped.has(item.key);
            const previewed = preview?.items.find((entry) => entry.key === item.key || (item.bokId && entry.bokId === item.bokId));
            const piece = item.work?.seriesPiece ?? previewed?.seriesPiece ?? null;
            const series = item.format === "series" || item.work?.format === "series";
            // Returned by the editors with their reasons: what they ask, and the way to do it.
            const returned = item.draft && item.bokId ? decisions.find((entry) => entry.bokId === item.bokId && entry.decision === "changes") ?? null : null;
            // A draft without the author's reading of its text cannot go to the editors yet.
            const voiceWaiting = Boolean(!returned && item.draft && item.bokId && voiced && !voiced.has(item.bokId));
            return (
              <li key={item.key} className={`amp-card${isSkipped ? " is-skipped" : ""}${item.draft || item.coverWaiting ? " is-draft" : ""}`}>
                <button type="button" className="amp-card__cover" disabled={!previewed && !item.draft && !item.coverWaiting} onClick={() => ((item.draft || item.coverWaiting) && item.bokId ? compose(item.bokId) : readItem(item, Boolean(piece)))} aria-label={`${item.draft ? w.continueDraft : item.coverWaiting && !inWork ? w.edit : piece ? w.watch : w.readText}: ${item.title}`}>
                  <Thumb id={item.bokId ?? item.key} title={item.title} image={coverOf(item)} />
                  {piece && <span className="amp-card__play" aria-hidden="true">▶</span>}
                </button>
                <div className="amp-card__body">
                  <strong className="amp-card__title">{item.title}</strong>
                  <span className="amp-card__chips">
                    <span className={`asp-chip asp-chip--${series || piece ? "series" : "text"}`}>{w.format[series || piece ? "series" : "text"]}</span>
                    {item.coverWaiting
                      ? <span className={`asp-chip asp-chip--${inWork ? "series" : "warn"}`}>{inWork ? w.inWorkChip : w.sentChip}</span>
                      : seriesReady
                      ? <span className="asp-chip asp-chip--ready">{w.seriesReadyChip}</span>
                      : returned
                      ? <span className="asp-chip asp-chip--warn">{d.changesTitle}</span>
                      : voiceWaiting
                      ? <span className="asp-chip asp-chip--warn">{w.voiceChip}</span>
                      : item.draft
                      ? <span className="asp-chip asp-chip--draft">{w.draftChip}</span>
                      : <span className={`asp-chip asp-chip--${isSkipped ? "withdrawn" : chipTone(status)}`}>{isSkipped ? w.skipped : w.status[status]}</span>}
                  </span>
                  {returned && <DecisionNote decision={returned} compact />}
                  {item.draft && !returned && <small className="amp-card__note">{voiceWaiting ? w.voiceNote : w.draftNote}</small>}
                  {item.coverWaiting && <small className="amp-card__note">{inWork ? w.inWorkNote : w.sentNote}</small>}
                  {seriesReady && <small className="amp-card__note">{w.seriesReadyNote}</small>}
                  {item.seriesHeld && <small className="amp-card__note">{w.seriesHeld}</small>}
                  {item.work?.note && item.work.status === "changes_requested" && <small className="amp-card__note">{w.yourNote} {item.work.note}</small>}
                  {item.work?.seriesPiece && item.work.status === "published" && !item.hidden && (
                    <small className="amp-card__note">{onShelf ? w.seriesOnShelf : item.work.seriesPublished ? w.seriesLive : w.seriesWaiting}</small>
                  )}
                  <div className="amp-card__actions">
                    {returned && item.bokId && (
                      <button type="button" className="btn amp-card__watch" onClick={() => compose(item.bokId, changeAction(returned.kind) === "voice" ? "voice" : null)}>
                        {changeAction(returned.kind) === "voice" ? `● ${d.recordAgain}` : changeAction(returned.kind) === "text" ? d.fixText : d.edit}
                      </button>
                    )}
                    {item.draft && item.bokId && voiceWaiting && (
                      <button type="button" className="btn amp-card__watch" onClick={() => compose(item.bokId, "voice")}>● {w.recordVoice}</button>
                    )}
                    {item.draft && item.bokId && !returned && (
                      <button type="button" className={voiceWaiting ? "btn btn-secondary" : "btn amp-card__watch"} onClick={() => compose(item.bokId)}>{w.continueDraft}</button>
                    )}
                    {item.coverWaiting && item.bokId && !inWork && (
                      <button type="button" className="btn btn-secondary" onClick={() => compose(item.bokId)}>{w.edit}</button>
                    )}
                    {item.coverWaiting && item.bokId && !inWork && (
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setWithdrawing(item)}>{w.withdraw}</button>
                    )}
                    {direct && !item.draft && item.bokId && !piece && !series && !item.work && (item.published || item.hidden) && (
                      <button type="button" className="btn btn-secondary" onClick={() => compose(item.bokId)}>{w.edit}</button>
                    )}
                    {piece && previewed && (
                      <button type="button" className="btn amp-card__watch" onClick={() => readItem(item, true)}>▶ {w.watch}</button>
                    )}
                    {previewed && (
                      <button type="button" className="btn btn-secondary" onClick={() => readItem(item)}>{w.readText}</button>
                    )}
                    {kitWork(item) && (
                      <button type="button" className="btn btn-secondary" onClick={() => setKit(kitWork(item))}>{w.kitWork}</button>
                    )}
                    {item.work && ["preparing", "ready", "changes_requested"].includes(item.work.status) && (
                      <button type="button" className="btn btn-secondary" onClick={() => { setNote(""); setAsking(item); }}>{w.fix}</button>
                    )}
                    {item.work?.status === "ready" && (
                      <button type="button" className="btn btn-secondary" aria-pressed={isSkipped} onClick={() => toggleSkip(item.key)}>{isSkipped ? w.unskip : w.skip}</button>
                    )}
                    {item.bokId && (item.published || item.hidden) && (
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void setHidden(item, !item.hidden)}>
                        {item.hidden ? w.unhide : w.hide}
                      </button>
                    )}
                    {item.work?.status === "published" && item.work.format === "series" && (
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void takeDownSeries(item)}>{w.takeDownSeries}</button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {/* Refused by the editors, with their reasons: the text stays with the author, it is not sent again as it is. */}
          {decisions.filter((entry) => entry.decision === "refused").map((entry) => (
            <li key={`refused-${entry.bokId}`} className="amp-card is-draft is-refused">
              <button type="button" className="amp-card__cover" onClick={() => compose(entry.bokId)} aria-label={`${d.openText}: ${entry.title}`}>
                <Thumb id={entry.bokId} title={entry.title} image={null} />
              </button>
              <div className="amp-card__body">
                <strong className="amp-card__title">{entry.title}</strong>
                <span className="amp-card__chips">
                  <span className="asp-chip asp-chip--text">{w.format.text}</span>
                </span>
                <DecisionNote decision={entry} onRequests={() => setRequestsOpen(true)} />
                <div className="amp-card__actions">
                  <button type="button" className="btn btn-secondary" onClick={() => compose(entry.bokId)}>{d.openText}</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {ready.length > 0 || pageDraft || waiting.length > 0 ? (
          <>
          {onShelf && ready.some((item) => item.work?.seriesPiece) && <p className="amp-publish-note">{w.shelfNote}</p>}
          <div className="amp-publish-bar">
            <button type="button" className="btn btn-red amp-publish" disabled={chosen.length === 0 && !pageDraft} onClick={() => go("my-page-publish")}>
              {chosen.length > 0 ? w.publishCount(chosen.length) : pageDraft ? w.publishPageOnly : w.toPublish} <Icon name="arrow" />
            </button>
            {ready.length === 0 && items.length > 0 && (
              <p className="desk-note">{waiting.some((item) => item.work?.status === "changes_requested") ? w.waitingChanges : w.nothingReady}</p>
            )}
          </div>
          </>
        ) : orderable > 1 ? (
          // Everything is published: what the author does here now is arrange the page.
          <>
            <button type="button" className="btn btn-secondary amp-publish" onClick={() => go("my-page-order")}>{w.reorder}</button>
            <p className="desk-note">{w.allPublished}</p>
          </>
        ) : null}
      </section>
      {requestsOpen && data.space && (
        <RequestsSheet w={w} messages={data.messages ?? []} language={language} busy={busy} onSend={sendMessage} onClose={() => setRequestsOpen(false)} />
      )}

      {data.handle && !pageDraft && kitWorks.length > 0 && (
        <section className="amp-section">
          <h2 className="serif">{w.kitTitle}</h2>
          <p>{w.kitHint}</p>
          <div className="kit-shelf">
            <button type="button" className="kit-tile" onClick={() => setKit(kitPage)}>
              <span className="kit-tile-art" aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {photo ? <img src={photo} alt="" /> : <span className="kit-tile-letter">{name.replace(/^@/, "").charAt(0).toUpperCase()}</span>}
              </span>
              <strong>{name}</strong>
              <small>{w.kitPage}</small>
            </button>
            {kitWorks.map((entry) => (
              <button key={entry.bokId} type="button" className="kit-tile" onClick={() => setKit(entry)}>
                <span className="kit-tile-art" aria-hidden="true">
                  <span className="kit-tile-letter">{entry.title.charAt(0)}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {entry.cover && <img src={entry.cover} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />}
                </span>
                <strong>{entry.title}</strong>
                <small>{entry.series ? w.format.series : w.format.text}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {data.handle && (
        <section className="amp-section">
          <h2 className="serif">{w.linkTitle}</h2>
          <p>{w.linkHint}{pageDraft ? ` ${w.linkLater}` : ""}</p>
          <LinkPreviewMock
            handle={data.handle}
            name={data.name ?? preview?.name ?? ""}
            card={data.shareCard ?? null}
            video={data.shareVideo ?? null}
            labels={{ still: w.still, moving: w.moving, noCard: w.noCard, site: "boks" }}
          />
          <div className="amp-section__actions">
            <ShareLinkPair url={typeof window === "undefined" ? "" : authorShareUrl(data.handle, window.location.origin)} onCopy={(link) => copyPageLink(link)} className="amp-share-pair" />
          </div>
        </section>
      )}
      {kit && data.handle && <StoryKitSheet subject={kit} handle={data.handle} onClose={() => setKit(null)} />}
      {reading && <WorkPreview key={`${reading.key}:${readingSeries}`} item={reading} t={pw} watchFirst={readingSeries} onClose={() => setReading(null)} />}
      {asking && <AskSheet w={w} item={asking} note={note} setNote={setNote} busy={busy} onSend={() => void sendChanges()} onClose={() => setAsking(null)} />}
      {withdrawing && (
        <Sheet title={w.withdrawTitle} closeLabel={w.cancel} onClose={() => setWithdrawing(null)}>
          <p className="serif" style={{ fontSize: 22 }}>{withdrawing.title}</p>
          <p>{w.withdrawBody}</p>
          <div className="sheet-buttons">
            <button type="button" className="btn btn-secondary" onClick={() => setWithdrawing(null)}>{w.cancel}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void withdraw(withdrawing)}>{w.withdraw}</button>
          </div>
        </Sheet>
      )}
    </main>
  );
}

/**
 * Requests and ideas (2026-11-20): what was the page's conversation with the
 * team, behind one button. A note says what kind it is - something broken,
 * an idea, a question - so the team reads it the right way; the answers come
 * back below, as before (`send_my_author_space_message`).
 */
function RequestsSheet({ w, messages, language, busy, onSend, onClose }: {
  w: Words;
  messages: NonNullable<MyAuthorSpace["messages"]>;
  language: string;
  busy: boolean;
  onSend: (body: string) => Promise<boolean | undefined>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"problem" | "idea" | "question">("problem");
  const [body, setBody] = useState("");
  const newestFirst = [...messages].reverse();
  return (
    <Sheet title={w.requestsTitle} closeLabel={w.cancel} onClose={onClose}>
      <p>{w.requestsHint}</p>
      <div className="amp-kinds" role="radiogroup" aria-label={w.requestsTitle}>
        {(["problem", "idea", "question"] as const).map((entry) => (
          <button key={entry} type="button" role="radio" aria-checked={kind === entry} className={`amp-kind${kind === entry ? " is-on" : ""}`} onClick={() => setKind(entry)}>{w.kinds[entry]}</button>
        ))}
      </div>
      <textarea className="asp-textarea amp-note" value={body} maxLength={1900} rows={5} autoFocus placeholder={w.requestPlaceholder[kind]} onChange={(event) => setBody(event.target.value)} />
      <div className="sheet-buttons">
        <button type="button" className="btn btn-secondary" onClick={onClose}>{w.cancel}</button>
        <button type="button" className="btn" disabled={busy || !body.trim()} onClick={() => void onSend(`${w.kindPrefix[kind]}: ${body.trim()}`).then((sent) => { if (sent) setBody(""); })}>{w.send}</button>
      </div>
      {newestFirst.length > 0 && (
        <>
          <p className="amp-requests__earlier">{w.history}</p>
          <ol className="conv-list amp-requests__list">
            {newestFirst.map((message) => (
              <li key={message.id} className={`conv-msg${message.fromAuthor ? " is-own" : " is-team"}`}>
                <span className="conv-meta">{message.fromAuthor ? w.fromYou : w.fromTeam} · {new Date(message.createdAt).toLocaleString(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{message.workTitle ? ` · ${w.aboutWork(message.workTitle)}` : ""}</span>
                <span className="conv-body">{message.body}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Sheet>
  );
}

function AskSheet({ w, item, note, setNote, busy, onSend, onClose }: { w: Words; item: PageItem; note: string; setNote: (value: string) => void; busy: boolean; onSend: () => void; onClose: () => void }) {
  return (
    <Sheet title={w.askTitle} closeLabel={w.cancel} onClose={onClose}>
      <p className="serif" style={{ fontSize: 22 }}>{item.title}</p>
      <p>{w.askHint}</p>
      <textarea className="asp-textarea amp-note" value={note} maxLength={1000} rows={5} autoFocus onChange={(event) => setNote(event.target.value)} />
      <div className="sheet-buttons">
        <button type="button" className="btn btn-secondary" onClick={onClose}>{w.cancel}</button>
        <button type="button" className="btn" disabled={busy || !note.trim()} onClick={onSend}>{w.send}</button>
      </div>
    </Sheet>
  );
}

// ------------------------------------------------------------------ order

/**
 * The page's order, with the page itself beside it: the list moves by drag or
 * by arrows, and the phone on the right is the reader's page (`AuthorPortraitPage`,
 * the same component) laid out in the order on the left, before it is saved.
 */
function OrderView({ w, data, preview, onShelf, header, onSaved }: { w: Words; data: MyAuthorSpace; preview: SpacePreview | null; onShelf: boolean; header: React.ReactNode; onSaved: () => Promise<void> }) {
  const language = useUiLanguage();
  // A hidden work is not on the page readers see, so it has no place to order.
  const initial = useMemo(() => data.items.filter((item) => !item.hidden && !item.draft && !item.coverWaiting).map((item) => item.key), [data.items]);
  const [keys, setKeys] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const dragging = useRef<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const byKey = new Map(data.items.map((item) => [item.key, item]));
  const changed = orderChanged(initial, keys);
  // The reader's page in a phone-sized frame (`/author/preview`, laid out for a
  // phone because the frame is one), told the order on every move.
  const frame = useRef<HTMLIFrameElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && (event.data as { type?: string } | null)?.type === "boks-preview-ready") setFrameReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (frameReady) frame.current?.contentWindow?.postMessage({ type: "boks-preview-order", keys }, window.location.origin);
  }, [frameReady, keys]);

  async function save() {
    setBusy(true);
    setProblem("");
    try {
      await saveSpaceOrder(data.space?.id ?? null, keys, data.orderVersion);
      await onSaved();
    } catch (error) {
      setProblem(readableBoksError(error, w.failed, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page detail-page amp amp-order-page">
      {header}
      <div className="amp-order-layout">
      <div>
      <h1 className="serif amp-h1">{w.orderTitle}</h1>
      <p className="desk-note">{w.orderHint}{data.items.some((item) => !item.published) ? ` ${w.orderDraftHint}` : ""}{onShelf ? ` ${w.orderShelf}` : ""}</p>
      <ol className="amp-order">
        {keys.map((key, index) => {
          const item = byKey.get(key);
          if (!item) return null;
          const status = lineStatus(item);
          return (
            <li
              key={key}
              className={`amp-order__row${over === index ? " is-over" : ""}`}
              draggable
              onDragStart={(event) => { dragging.current = index; event.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(event) => { event.preventDefault(); setOver(index); }}
              onDragLeave={() => setOver((current) => (current === index ? null : current))}
              onDragEnd={() => setOver(null)}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging.current !== null) setKeys(moveTo(keys, dragging.current, index));
                dragging.current = null;
                setOver(null);
              }}
            >
              <span className="amp-order__num" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="amp-order__handle" aria-hidden="true" title={w.drag}>⋮⋮</span>
              <Thumb id={item.bokId ?? item.key} title={item.title} image={coverOf(item)} />
              <span className="amp-row__title">
                <strong>{item.title}</strong>
                <small><em>{isSeries(item) ? w.format.series : w.format[item.format]}</em> · {w.status[status]}</small>
              </span>
              <span className="amp-order__buttons">
                <button type="button" className="icon-btn" aria-label={`${w.up}: ${item.title}`} disabled={index === 0} onClick={() => setKeys(moveBy(keys, index, -1))}>↑</button>
                <button type="button" className="icon-btn" aria-label={`${w.down}: ${item.title}`} disabled={index === keys.length - 1} onClick={() => setKeys(moveBy(keys, index, 1))}>↓</button>
              </span>
            </li>
          );
        })}
      </ol>
      {problem && <p className="notice" role="alert">{problem}</p>}
      <div className="amp-order-actions">
        <button type="button" className="btn amp-save" disabled={busy || !changed} onClick={() => void save()}>{w.saveOrder}</button>
        {changed && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setKeys(initial)}>{w.orderReset}</button>}
      </div>
      </div>
      {preview && <aside className="amp-order-preview" aria-label={w.orderPreview}>
        <p className="amp-order-preview__label">{changed ? w.orderPreviewChanged : w.orderPreview}</p>
        <div className="amp-order-phone">
          <iframe ref={frame} src="/author/preview" title={w.orderPreview} />
        </div>
      </aside>}
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ publication

function PublishView({
  w, items, skipped, onShelf, waiting, handle, pageDraft, header, onRead, onAsk, reload, onDone, reading, asking,
}: {
  w: Words;
  items: PageItem[];
  /** Works the author marked "Don't publish" on My page: unticked here. */
  skipped: ReadonlySet<string>;
  onShelf: boolean;
  /** Works that will not go out now, and why. */
  waiting: PageItem[];
  handle: string | null;
  pageDraft: boolean;
  header: React.ReactNode;
  onRead: (item: PageItem) => void;
  onAsk: (item: PageItem) => void;
  reload: () => Promise<MyAuthorSpace | null>;
  onDone: (result: PublicationResult) => void;
  reading: React.ReactNode;
  asking: React.ReactNode;
}) {
  const language = useUiLanguage();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.filter((item) => !skipped.has(item.key)).map((item) => item.key)));
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // One id per confirmation: a second press, or a retry after a lost answer,
  // is the same publication. A new confirmation gets a new id.
  const [requestId, setRequestId] = useState(newRequestId);
  const picked = items.filter((item) => chosen.has(item.key) && item.work);

  async function publish() {
    setBusy(true);
    setProblem("");
    const send = () =>
      publishMyAuthorSpace({
        items: picked.map((item) => ({ workId: item.work!.id, revision: item.work!.revision })),
        publishPage: pageDraft,
        termsVersion: `${currentBoksTermsVersion}#author-content`,
        requestId,
      });
    try {
      let result;
      try {
        result = await send();
      } catch (error) {
        // An account that never accepted the boks terms (made before they were
        // asked for, or outside the sign-in screen): the box just ticked is
        // that acceptance, so record it and publish.
        if (!/Accept the boks terms/.test(String((error as { message?: string })?.message ?? ""))) throw error;
        await acceptBoksTerms(currentBoksTermsVersion);
        result = await send();
      }
      onDone(result);
    } catch (error) {
      if ((error as { code?: string })?.code === "40001") {
        await reload();
        setAccepted(false);
        setRequestId(newRequestId());
        setProblem(w.changed);
      } else {
        setProblem(readableBoksError(error, w.failed, language));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page detail-page amp">
      {header}
      <h1 className="serif amp-h1">{w.publishTitle}</h1>
      <h2 className="serif amp-h2">{pageDraft ? (picked.length ? w.pageAndWorks(picked.length) : w.pageOnly) : w.worksOnly(picked.length)}</h2>
      {items.length === 0 && <p className="desk-note">{w.nothingReady}</p>}
      {pageDraft && handle && <p className="desk-note">{w.pageOpensAt(handle)}</p>}
      <ul className="amp-list amp-choose">
        {items.map((item) => (
          <li key={item.key}>
            <label className="amp-row">
              <input type="checkbox" checked={chosen.has(item.key)} onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(item.key); else next.delete(item.key);
                setChosen(next);
                setAccepted(false);
              }} />
              <Thumb id={item.bokId ?? item.key} title={item.title} image={coverOf(item)} />
              <span className="amp-row__title">
                <strong>{item.title}</strong>
                <small>
                  <em>{item.work?.seriesPiece ? w.format.series : w.format[item.work?.format ?? item.format]}</em>
                  {" · "}{item.work?.seriesPiece ? (onShelf ? w.shownOnShelf : w.shownWithSeries) : w.shownIn[item.work?.format ?? item.format]}
                </small>
              </span>
            </label>
            <span className="amp-choose__actions">
              <button type="button" className="amp-link" onClick={() => onRead(item)}>{w.look}</button>
              <button type="button" className="amp-link" onClick={() => onAsk(item)}>{w.askChanges}</button>
            </span>
          </li>
        ))}
      </ul>
      {waiting.length > 0 && (
        <div className="amp-waiting">
          {w.notYet}
          <ul>
            {waiting.map((item) => <li key={item.key}>«{item.title}» — {w.notYetReason[item.work?.status ?? "preparing"]}</li>)}
          </ul>
        </div>
      )}
      <section className="amp-terms">
        <a href="/terms#author-content" target="_blank" rel="noopener noreferrer">{w.terms}</a>
        <p>{w.termsSummary}</p>
        <label className="amp-accept">
          <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          <span>{w.accept}</span>
        </label>
      </section>
      {problem && <p className="notice" role="alert">{problem}</p>}
      <button type="button" className="btn btn-red amp-save" disabled={busy || !accepted || (!picked.length && !pageDraft)} onClick={() => void publish()}>
        {pageDraft ? w.publishPage : w.publishWorks}
      </button>
      {reading}
      {asking}
    </main>
  );
}
