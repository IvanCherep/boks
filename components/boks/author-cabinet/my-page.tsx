"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/app/author-spaces.css";
import {
  loadMyAuthorSpace,
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
import { currentBoksTermsVersion } from "@/components/boks/user-auth-panel";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { describeBoksHandleProblem, maxHandleLength, minHandleLength } from "@/lib/boks/contracts";
import { acceptBoksTerms, restoreMyBok, updateBoksProfile, withdrawMyBok } from "@/components/boks/supabase-browser-data";
import { moveBy, moveTo, orderChanged } from "@/lib/boks/author/page-order";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { Icon, Sheet, Thumb, Topbar } from "./ui";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { linkOnlyCover } from "@/lib/boks/link-only";
import { Conversation } from "@/components/boks/author-spaces/conversation";
import { LinkPreviewMock } from "@/components/boks/author-spaces/link-preview-mock";

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

export type MyPageView = "my-page" | "my-page-order" | "my-page-publish" | "my-page-done";
export const myPageViews = new Set<string>(["my-page", "my-page-order", "my-page-publish", "my-page-done"]);

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
    guideTitle: "How it works",
    guideLook: "Open each work: read the text and, where there is one, watch its Series.",
    guideAsk: "Something is off? Press “Ask for changes”: the team fixes it and it comes back here.",
    guidePublish: "All good? “To publication”: choose the works and publish them. Until then only you and the team see them.",
    guideNote: "Your photo, name and page address can be changed at any time.",
    yourNote: "Your note to the team:",
    messagesTitle: "Conversation with the team",
    messagesHint: "Something about the page, the design or a work you do not like, or a question? Write here: the team answers here, and tells you when a fix is done.",
    fromYou: "You",
    fromTeam: "boks team",
    aboutWork: (title: string) => `about «${title}»`,
    writePlaceholder: "Write to the team…",
    noMessages: "No messages yet.",
    sentToTeam: "Sent to the team.",
    linkTitle: "Link to your page",
    linkHint: "This is how the link looks when you send it.",
    linkLater: "It opens for readers once your page is published.",
    copyLink: "Copy link",
    copied: "Link copied.",
    still: "Still card (VK, WhatsApp, most)",
    moving: "Moving card (Telegram)",
    noCard: "The link will preview as your page's photo.",
    reorder: "Change the order",
    allPublished: "Everything here is published. The order is the order readers see on your page; change it whenever you like.",
    seriesWaiting: "The Series is on your page; the team adds it to the feed and the Series shelf.",
    seriesLive: "The Series is on your page, in the feed and on the Series shelf.",
    notYet: "Not in this publication:",
    notYetReason: { preparing: "the team is preparing it", changes_requested: "waiting for the changes you asked for" } as Record<string, string>,
    pageOpensAt: (handle: string) => `Your page opens at tryboks.com/@${handle}.`,
    waitingChanges: "Nothing to publish right now: the team is making the changes you asked for.",
    doneSeries: "Your page shows them with their Series now; the team adds the Series to the feed and the Series shelf.",
    seriesHeld: "Series in preparation",
    watchSeries: "Watch Series",
    shownWithSeries: "The text and its Series go to your page now; the Series reaches the feed and the Series shelf once the team adds it",
    look: "Read the version",
    askChanges: "Ask for changes",
    askTitle: "What should change?",
    askHint: "A short note for the team. The work stays unpublished until they prepare it again.",
    send: "Send",
    cancel: "Cancel",
    changeAddress: "Change address",
    addressLabel: "Page address, also your @name",
    addressRule: "English letters, numbers and underscores; starts with a letter.",
    addressOldLink: (old: string) => `Links to tryboks.com/@${old} will stop opening.`,
    saveAddress: "Save address",
    addressSaved: (handle: string) => `Your page is now tryboks.com/@${handle}`,
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
      guideTitle: "Как это устроено",
      guideLook: "Откройте каждое произведение: прочитайте текст и, если есть, посмотрите Series.",
      guideAsk: "Что-то не так? Нажмите «Попросить правки»: редакция исправит, и произведение вернётся сюда.",
      guidePublish: "Всё нравится? «К публикации»: выберите произведения и опубликуйте. До этого их видите только вы и редакция.",
      guideNote: "Фото, имя и адрес страницы можно поменять в любой момент.",
      yourNote: "Ваша заметка редакции:",
      messagesTitle: "Переписка с редакцией",
      messagesHint: "Что-то не нравится в странице, оформлении или произведении, или есть вопрос? Напишите здесь: редакция ответит здесь же и сообщит, когда исправит.",
      fromYou: "Вы",
      fromTeam: "Редакция boks",
      aboutWork: (title: string) => `о «${title}»`,
      writePlaceholder: "Написать редакции…",
      noMessages: "Сообщений пока нет.",
      sentToTeam: "Отправлено редакции.",
      linkTitle: "Ссылка на вашу страницу",
      linkHint: "Так ссылка выглядит, когда вы ей делитесь.",
      linkLater: "Читателям она откроется после публикации страницы.",
      copyLink: "Скопировать ссылку",
      copied: "Ссылка скопирована.",
      still: "Статичная карточка (VK, WhatsApp и большинство)",
      moving: "Динамичная карточка (Telegram)",
      noCard: "Ссылка покажет фото вашей страницы.",
      reorder: "Изменить порядок",
      allPublished: "Всё здесь опубликовано. В этом порядке читатели видят произведения на вашей странице; его можно менять когда угодно.",
      seriesWaiting: "Series уже на вашей странице; в ленту и на полку Series её добавит редакция.",
      seriesLive: "Series на вашей странице, в ленте и на полке Series.",
      notYet: "Не войдут в эту публикацию:",
      notYetReason: { preparing: "редакция готовит", changes_requested: "ждём правок, которые вы попросили" },
      pageOpensAt: (handle: string) => `Страница откроется по адресу tryboks.com/@${handle}.`,
      waitingChanges: "Сейчас публиковать нечего: редакция вносит правки, которые вы попросили.",
      doneSeries: "На вашей странице они уже с Series; в ленту и на полку Series их добавит редакция.",
      seriesHeld: "Series готовится",
      watchSeries: "Смотреть Series",
      shownWithSeries: "Текст и Series сразу появятся на вашей странице; в ленте и на полке Series она появится, когда редакция её добавит",
      look: "Посмотреть версию",
      askChanges: "Попросить правки",
      askTitle: "Что изменить?",
      askHint: "Короткая заметка для редакции. Работа останется неопубликованной, пока её не подготовят снова.",
      send: "Отправить",
      cancel: "Отмена",
      changeAddress: "Изменить адрес",
      addressLabel: "Адрес страницы, он же ваше @имя",
      addressRule: "Латинские буквы, цифры и подчёркивание; начинается с буквы.",
      addressOldLink: (old: string) => `Ссылки на tryboks.com/@${old} перестанут открываться.`,
      saveAddress: "Сохранить адрес",
      addressSaved: (handle: string) => `Теперь ваша страница — tryboks.com/@${handle}`,
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

/** A cover for a line: its Series' first picture, or the bok's artwork. */
function coverOf(item: PageItem) {
  if (item.work?.seriesPiece) return linkOnlyCover(item.work.seriesPiece);
  return item.bokId ? getBokArtwork({ id: item.bokId }) : null;
}

/**
 * The last publication's answer. The cabinet mounts each view afresh, so the
 * "Published" screen reads it from here rather than from the view it left.
 */
let lastPublication: PublicationResult | null = null;

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
  const pw = useMessages(previewWords);
  const language = useUiLanguage();
  const [data, setData] = useState<MyAuthorSpace | null>(null);
  const [preview, setPreview] = useState<SpacePreview | null>(null);
  const [failed, setFailed] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
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
  const detail = useRef<HTMLElement | null>(null);

  /** Choose a line; on a phone the actions sit below the list, so bring them into view. */
  function choose(key: string) {
    setSelected(key);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 899px)").matches) {
      window.requestAnimationFrame(() => detail.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  const load = useCallback(async () => {
    try {
      const [mine, look] = await Promise.all([loadMyAuthorSpace(), loadSpacePreview(null).catch(() => null)]);
      setData(mine);
      setPreview(look);
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

  async function copyPageLink() {
    if (!data?.handle) return;
    try {
      await navigator.clipboard.writeText(`https://tryboks.com/@${data.handle}`);
      toast(w.copied);
    } catch {
      // Clipboard refused (insecure context, permissions): nothing to copy.
    }
  }

  const items = useMemo(() => data?.items ?? [], [data]);
  const ready = publishable(items);
  const pageDraft = data?.space?.status === "draft";
  // Something is always open on the right: the chosen line, or the first one
  // still waiting for the author.
  const current =
    items.find((item) => item.key === selected) ??
    items.find((item) => item.work && item.work.status !== "published") ??
    items[0] ??
    null;
  const waiting = items.filter((item) => item.work && (item.work.status === "preparing" || item.work.status === "changes_requested"));
  const orderable = items.filter((item) => !item.hidden).length;
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

  if (!data) {
    return (
      <main className="page detail-page">
        {header(w.title, "library")}
        <p className="desk-note" role="status">{failed || w.loading}</p>
      </main>
    );
  }

  if (view === "my-page-order") {
    return <OrderView w={w} data={data} header={header(w.orderTitle, "my-page")} onSaved={async () => { await load(); toast(w.orderSaved); go("my-page"); }} />;
  }

  if (view === "my-page-publish") {
    return (
      <PublishView
        w={w}
        items={ready}
        waiting={waiting}
        handle={data.handle}
        pageDraft={pageDraft}
        header={header(w.publishTitle, "my-page")}
        onRead={readItem}
        onAsk={(item) => { setNote(""); setAsking(item); }}
        reload={load}
        onDone={(answer) => { lastPublication = answer; setResult(answer); void load(); go("my-page-done"); }}
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
                  <span><strong>{item.title}</strong><small>{w.format[item.format]}{item.withSeries && " + Series"}</small></span>
                </li>
              );
            })}
          </ul>
          {result?.published.some((item) => item.withSeries) && <p className="desk-note">{w.doneSeries}</p>}
          <div className="sheet-buttons">
            <button type="button" className="btn btn-secondary" onClick={() => go("library")}>{w.toCabinet}</button>
            {handle && <a className="btn btn-red" href={`/@${handle}`}>{w.openPage} <Icon name="arrow" /></a>}
          </div>
        </section>
      </main>
    );
  }

  const name = preview?.name || (data.handle ? `@${data.handle}` : "");
  const photo = preview?.photo ? `data:image/jpeg;base64,${preview.photo}` : null;

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
            tryboks.com/@{data.handle} · <span className={`asp-chip asp-chip--${pageDraft ? "draft" : "published"}`}>{pageDraft ? w.draft : w.open}</span>
            {" "}<button type="button" className="amp-link" onClick={() => { setAddress(data.handle ?? ""); setAddressProblem(""); setEditingAddress(true); }}>{w.changeAddress}</button>
          </p>
          {editingAddress && (
            <form className="amp-address" onSubmit={(event) => { event.preventDefault(); void saveAddress(); }}>
              <label>
                <span>{w.addressLabel}</span>
                <span className="amp-address__field">
                  <span aria-hidden="true">tryboks.com/@</span>
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
        </div>
      </section>

      {undecided && (
        <section className="amp-guide">
          <h2 className="serif">{w.guideTitle}</h2>
          <ol>
            <li>{w.guideLook}</li>
            <li>{w.guideAsk}</li>
            <li>{w.guidePublish}</li>
          </ol>
          <p>{w.guideNote}</p>
        </section>
      )}

      <div className="amp-columns">
        <section className="amp-works">
          <header className="amp-works__head">
            <h2 className="serif">{w.works}</h2>
            {orderable > 1 && <button type="button" className="amp-link" onClick={() => go("my-page-order")}>{w.order}</button>}
          </header>
          {items.length === 0 && <p className="desk-note">{w.nothing}</p>}
          <ul className="amp-list">
            {items.map((item) => {
              const status = lineStatus(item);
              return (
                <li key={item.key}>
                  <button type="button" className={`amp-row${current?.key === item.key ? " is-selected" : ""}`} onClick={() => choose(item.key)}>
                    <Thumb id={item.bokId ?? item.key} title={item.title} image={coverOf(item)} />
                    <span className="amp-row__title">
                      <strong>{item.title}</strong>
                      <small>
                        <em>{w.format[item.format === "series" || item.work?.format === "series" ? "series" : "text"]}</em>
                        {item.work?.seriesPiece && " + Series"}
                        {item.seriesHeld && ` · ${w.seriesHeld}`}
                      </small>
                    </span>
                    <span className={`asp-chip asp-chip--${chipTone(status)}`}>{w.status[status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {ready.length > 0 || pageDraft || waiting.length > 0 ? (
            <>
              <button type="button" className="btn btn-red amp-publish" disabled={ready.length === 0 && !pageDraft} onClick={() => go("my-page-publish")}>
                {w.toPublish} <Icon name="arrow" />
              </button>
              {ready.length === 0 && items.length > 0 && (
                <p className="desk-note">{waiting.some((item) => item.work?.status === "changes_requested") ? w.waitingChanges : w.nothingReady}</p>
              )}
            </>
          ) : orderable > 1 ? (
            // Everything is published: what the author does here now is arrange the page.
            <>
              <button type="button" className="btn btn-secondary amp-publish" onClick={() => go("my-page-order")}>{w.reorder}</button>
              <p className="desk-note">{w.allPublished}</p>
            </>
          ) : null}
        </section>

        {current && (
          <aside className="amp-detail" ref={detail}>
            <h2 className="serif">{current.title}</h2>
            <p>
              <span className={`asp-chip asp-chip--${current.format === "series" || current.work?.format === "series" ? "series" : "text"}`}>{w.format[current.format === "series" || current.work?.format === "series" ? "series" : "text"]}{current.work?.seriesPiece && " + Series"}</span>{" "}
              <span className={`asp-chip asp-chip--${chipTone(lineStatus(current))}`}>{w.status[lineStatus(current)]}</span>
            </p>
            {current.work?.note && current.work.status === "changes_requested" && <p className="notice">{w.yourNote} {current.work.note}</p>}
            {current.work?.seriesPiece && current.work.status === "published" && (
              <p className="amp-detail__series">{current.work.seriesPublished ? w.seriesLive : w.seriesWaiting}</p>
            )}
            <div className="amp-detail__actions">
              {preview?.items.some((entry) => entry.key === current.key || (current.bokId && entry.bokId === current.bokId)) && (
                <button type="button" className="btn" onClick={() => readItem(current)}><Icon name="eye" /> {w.look}</button>
              )}
              {current.work?.seriesPiece && (
                <button type="button" className="btn btn-secondary" onClick={() => readItem(current, true)}>▶ {w.watchSeries}</button>
              )}
              {current.work && ["preparing", "ready", "changes_requested"].includes(current.work.status) && (
                <button type="button" className="btn btn-secondary" onClick={() => { setNote(""); setAsking(current); }}>{w.askChanges}</button>
              )}
              {current.bokId && (current.published || current.hidden) && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void setHidden(current, !current.hidden)}>
                  {current.hidden ? w.unhide : w.hide}
                </button>
              )}
              {current.work?.status === "published" && current.work.format === "series" && (
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void takeDownSeries(current)}>{w.takeDownSeries}</button>
              )}
            </div>
          </aside>
        )}
      </div>
      {data.space && (
        <section className="amp-section" id="messages">
          <h2 className="serif">{w.messagesTitle}{unread > 0 && <span className="amp-unread">{unread}</span>}</h2>
          <p>{w.messagesHint}</p>
          <Conversation
            messages={data.messages ?? []}
            mine="author"
            busy={busy}
            language={language}
            labels={{ author: w.fromYou, team: w.fromTeam, about: w.aboutWork, placeholder: w.writePlaceholder, send: w.send, empty: w.noMessages }}
            onSend={sendMessage}
          />
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
            <button type="button" className="btn btn-secondary" onClick={() => void copyPageLink()}>{w.copyLink}</button>
          </div>
        </section>
      )}
      {reading && <WorkPreview key={`${reading.key}:${readingSeries}`} item={reading} t={pw} watchFirst={readingSeries} onClose={() => setReading(null)} />}
      {asking && <AskSheet w={w} item={asking} note={note} setNote={setNote} busy={busy} onSend={() => void sendChanges()} onClose={() => setAsking(null)} />}
    </main>
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

function OrderView({ w, data, header, onSaved }: { w: Words; data: MyAuthorSpace; header: React.ReactNode; onSaved: () => Promise<void> }) {
  const language = useUiLanguage();
  // A hidden work is not on the page readers see, so it has no place to order.
  const initial = useMemo(() => data.items.filter((item) => !item.hidden).map((item) => item.key), [data.items]);
  const [keys, setKeys] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const dragging = useRef<number | null>(null);
  const byKey = new Map(data.items.map((item) => [item.key, item]));

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
    <main className="page detail-page amp">
      {header}
      <h1 className="serif amp-h1">{w.orderTitle}</h1>
      <p className="desk-note">{w.orderHint}{data.items.some((item) => !item.published) ? ` ${w.orderDraftHint}` : ""}</p>
      <ol className="amp-order">
        {keys.map((key, index) => {
          const item = byKey.get(key);
          if (!item) return null;
          const status = lineStatus(item);
          return (
            <li
              key={key}
              className="amp-order__row"
              draggable
              onDragStart={(event) => { dragging.current = index; event.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging.current !== null) setKeys(moveTo(keys, dragging.current, index));
                dragging.current = null;
              }}
            >
              <span className="amp-order__handle" aria-hidden="true" title={w.drag}>⋮⋮</span>
              <Thumb id={item.bokId ?? item.key} title={item.title} image={coverOf(item)} />
              <span className="amp-row__title">
                <strong>{item.title}</strong>
                <small><em>{w.format[item.format]}{item.work?.seriesPiece && " + Series"}</em> · {w.status[status]}</small>
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
      <button type="button" className="btn amp-save" disabled={busy || !orderChanged(initial, keys)} onClick={() => void save()}>{w.saveOrder}</button>
    </main>
  );
}

// ------------------------------------------------------------------ publication

function PublishView({
  w, items, waiting, handle, pageDraft, header, onRead, onAsk, reload, onDone, reading, asking,
}: {
  w: Words;
  items: PageItem[];
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
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.map((item) => item.key)));
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
                  <em>{w.format[item.work?.format ?? item.format]}{item.work?.seriesPiece && " + Series"}</em>
                  {" · "}{item.work?.seriesPiece ? w.shownWithSeries : w.shownIn[item.work?.format ?? item.format]}
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
