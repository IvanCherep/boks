"use client";

import { randomBoksId } from "@/lib/boks/browser-id";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Edit3,
  FilePlus2,
  Library,
  FileText,
  PenLine,
  Scissors,
  Send,
  Square,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { readableBoksError } from "@/lib/boks/errors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { estimateMinutes, groupDigits, wordCount } from "@/components/boks/client-format";
import { maxBokCharacters } from "@/lib/boks/contracts";
import { titleFromText } from "@/lib/boks/bok-title";
import {
  authorFileAccept,
  episodeTitle,
  isSupportedAuthorFile,
  readAuthorFile,
  splitIntoEpisodes,
} from "@/lib/boks/author/author-files";
import type {
  AuthorBokSubmission,
  AuthorBokSubmissionsPage,
  BoksUserContext,
} from "@/components/boks/client-types";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { Field, MetricTile } from "@/components/boks/shared-ui";
import {
  loadBoksUserContext,
  loadMyBokSubmissionsPage,
  loadMyDefaultAuthorName,
  submitBokForReview,
} from "@/components/boks/supabase-browser-data";
import { UserAuthPanel } from "@/components/boks/user-auth-panel";
import { AuthorWorks } from "@/components/boks/author-works";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

const ruPieces = (n: number) => plural("ru", n, { one: "текст", few: "текста", many: "текстов", other: "текста" });
const ruParts = (n: number) => plural("ru", n, { one: "часть", few: "части", many: "частей", other: "части" });
const ruFiles = (n: number) => plural("ru", n, { one: "файл", few: "файла", many: "файлов", other: "файла" });
const ruCharacters = (n: number) => plural("ru", n, { one: "символ", few: "символа", many: "символов", other: "символа" });

/** 24285 -> "24,285" in English, "24 285" in Russian. */
function groupFor(language: UiLanguage, value: number) {
  const grouped = groupDigits(value);
  return language === "ru" ? grouped.replace(/,/g, "\u00a0") : grouped;
}

/** The cabinet's words. The author's own text, title and byline are never translated. */
const messages = defineMessages(
  {
    statusSignIn: "Sign in to submit your texts.",
    statusSignUp: "Sign up or sign in to submit your texts.",
    statusWrite: "Write a text, or upload your files, and submit them for review.",
    statusRevising: "The text is in the editor. Confirm the rights again and submit it.",
    statusSuspended: "This account is suspended and cannot submit texts.",
    statusSubmitted: "Submitted for review. Readers will see it once an admin approves it.",
    loadFailed: "Could not load the author cabinet.",
    submitFailed: "Could not submit this text.",
    title: "Author cabinet",
    intro:
      "Publish as much as you like: write one text here, or upload a whole folder of files at once. There is no limit on how many texts you submit. Each one is checked by a boks admin before readers see it.",
    needAccount: "Authors need a boks account.",
    needAccountWhy: "It lets you follow every text: waiting, published, or refused with a reason.",
    continueEmail: "Continue with email",
    suspended: "This account is suspended and cannot publish.",
    contactAdmin: "Contact a boks administrator for details.",
    publishingAs: "Publishing as",
    publishingAsWhy: "Every text you publish carries it, so readers can always find your other work.",
    readerHandle: "reader",
    authorName: "Author name (optional)",
    authorNameKept:
      "A name printed above your @nickname, on every text you send - typed or uploaded. Kept from last time; clear it to publish under the @nickname alone.",
    authorNameEmpty:
      "Leave it empty to publish under your @nickname. Fill it in to print a name above it, on every text you send.",
    optional: "Optional",
    status: "Status",
    modeWorks: "My texts",
    withdrawnCount: "Withdrawn",
    modeWrite: "Write a text",
    modeFiles: "Upload files",
    revising: "Revising",
    openQuote: "“",
    closeQuote: "”",
    revisingWhy: "Submitting sends this same text to review again.",
    startNew: "Start a new text instead",
    titleLabel: "Title (optional)",
    titleHintEmpty: "Leave it empty and the first line of the text becomes the title.",
    titleHintFromLine: (title: string) => `Left empty, the title will be “${title}”.`,
    text: "Text",
    textPlaceholder: "Paste or type your text here. A blank line between paragraphs.",
    rights: "I hold the rights to publish this text and accept the publishing terms.",
    rightsBatch: (n: number) =>
      `I hold the rights to publish ${n === 1 ? "this text" : `all ${n} of these texts`} and accept the publishing terms.`,
    rightsWhy:
      "Your own work, or work you are allowed to publish - public domain, an open licence, or permission you have been given.",
    licence:
      "You keep ownership of your work. By submitting, you give boks a worldwide, non-exclusive, royalty-free licence to host, show, distribute, recommend and promote it on boks and in materials about boks. You can ask us to remove it at any time.",
    licenceLink: "Read the Terms: Author content",
    rightsSource: "Where the rights come from (optional)",
    rightsSourceHint:
      "Only boks admins see this. A line is enough: “my own work”, “my translation”, “Project Gutenberg #1342, public domain”.",
    submit: "Submit for review",
    fifteen: "Fifteen minutes",
    minutes: "Minutes",
    words: "Words",
    characters: (used: number, max: number) => `${groupFor("en", used)} of ${groupFor("en", max)} characters`,
    overLength: (over: number) => `That is ${groupFor("en", over)} characters past the 15-minute promise.`,
    splitOffer: (parts: number) => `Split into ${parts} parts and add them to the upload queue`,
    fits: "A bok is one break. Fits.",
    // Upload
    dropTitle: "Drop files here, or choose them",
    dropHint:
      "Formats: .docx (Word), .txt and .md. One file is one text. The title is taken from the file's first line - you can change it below before sending.",
    chooseFiles: "Choose files",
    reading: "Reading files…",
    unsupported: (names: string) => `This format is not supported: ${names}. Save it as .docx or .txt and add it again.`,
    unreadable: (names: string) => `Could not read: ${names}.`,
    skippedDuplicates: (n: number) =>
      n === 1 ? "One file was already in the queue and was skipped." : `${n} files were already in the queue and were skipped.`,
    added: (n: number) => (n === 1 ? "Added 1 text to the queue." : `Added ${n} texts to the queue.`),
    queueTitle: "Upload queue",
    queueEmpty: "The queue is empty. Choose files above - as many as you have.",
    queueSummary: (ready: number, attention: number) =>
      attention ? `${ready} ready to send · ${attention} need attention` : `${ready} ready to send`,
    clearQueue: "Clear queue",
    itemTitle: "Title",
    itemReady: "Ready",
    itemEmpty: "No text in this file",
    itemTooLong: "Longer than 15 minutes",
    itemSending: "Sending…",
    itemFailed: "Not sent",
    itemFromFile: (name: string) => `from ${name}`,
    itemMeta: (minutes: number, characters: number) => `${minutes} min · ${groupFor("en", characters)} characters`,
    splitItem: (parts: number) => `Split into ${parts} parts`,
    editItem: "Open in editor",
    removeItem: "Remove from queue",
    sendAll: (n: number) => (n === 1 ? "Submit 1 text for review" : `Submit ${n} texts for review`),
    stop: "Stop",
    progress: (done: number, total: number) => `Sending: ${done} of ${total}…`,
    batchDone: (sent: number, failed: number) =>
      failed
        ? `Sent ${sent}. Not sent: ${failed}. The reason is shown on each text in the queue.`
        : sent === 1
          ? "Sent 1 text for review. Readers will see it once an admin approves it."
          : `Sent ${sent} texts for review. Readers will see each once an admin approves it.`,
    batchStopped: (sent: number, left: number) => `Stopped. Sent ${sent}; ${left} still in the queue.`,
    leaveWarning: "Your upload queue has not been sent. Leave anyway?",
    // History
    published: "Published",
    inReview: "In review",
    needsWork: "Needs work",
  },
  {
    ru: {
      statusSignIn: "Войдите, чтобы отправлять свои тексты.",
      statusSignUp: "Зарегистрируйтесь или войдите, чтобы отправлять свои тексты.",
      statusWrite: "Напишите текст или загрузите файлы и отправьте их на проверку.",
      statusRevising: "Текст открыт в редакторе. Ещё раз подтвердите права и отправьте его.",
      statusSuspended: "Этот аккаунт заблокирован и не может отправлять тексты.",
      statusSubmitted: "Отправлено на проверку. Читатели увидят текст после одобрения администратора.",
      loadFailed: "Не удалось загрузить кабинет автора.",
      submitFailed: "Не удалось отправить этот текст.",
      title: "Кабинет автора",
      intro:
        "Публикуйте сколько угодно: напишите текст здесь или загрузите сразу всю папку с файлами. Ограничений на количество текстов нет. Каждый текст проверяет администратор boks, прежде чем его увидят читатели.",
      needAccount: "Авторам нужен аккаунт boks.",
      needAccountWhy: "Так вы видите судьбу каждого текста: ждёт проверки, опубликован или отклонён - и почему.",
      continueEmail: "Продолжить с email",
      suspended: "Этот аккаунт заблокирован и не может публиковать.",
      contactAdmin: "Подробности - у администратора boks.",
      publishingAs: "Публикация от имени",
      publishingAsWhy: "Это имя стоит на каждом вашем тексте, чтобы читатели всегда могли найти другие ваши работы.",
      readerHandle: "reader",
      authorName: "Имя автора (необязательно)",
      authorNameKept:
        "Имя, которое печатается над вашим @никнеймом на каждом отправленном тексте - написанном здесь или загруженном. Оставлено как в прошлый раз; сотрите, чтобы публиковаться только под @никнеймом.",
      authorNameEmpty:
        "Оставьте пустым, чтобы публиковаться под @никнеймом. Заполните, чтобы над ним стояло имя - на каждом отправленном тексте.",
      optional: "Необязательно",
      status: "Статус",
      modeWorks: "Мои тексты",
      withdrawnCount: "Сняты вами",
      modeWrite: "Написать текст",
      modeFiles: "Загрузить файлы",
      revising: "Правка",
      openQuote: "«",
      closeQuote: "»",
      revisingWhy: "При отправке этот же текст снова уйдёт на проверку.",
      startNew: "Начать новый текст",
      titleLabel: "Название (необязательно)",
      titleHintEmpty: "Если оставить пустым, названием станет первая строка текста.",
      titleHintFromLine: (title: string) => `Если оставить пустым, название будет «${title}».`,
      text: "Текст",
      textPlaceholder: "Вставьте или напишите текст. Между абзацами - пустая строка.",
      rights: "У меня есть права на публикацию этого текста, и я принимаю условия публикации.",
      rightsBatch: (n: number) =>
        n === 1
          ? "У меня есть права на публикацию этого текста, и я принимаю условия публикации."
          : `У меня есть права на публикацию всех этих текстов (${n}), и я принимаю условия публикации.`,
      rightsWhy:
        "Ваше собственное произведение или то, что вам можно публиковать: общественное достояние, открытая лицензия или полученное разрешение.",
      licence:
        "Права на произведение остаются за вами. Отправляя текст, вы предоставляете boks всемирную неисключительную безвозмездную лицензию на его размещение, показ, распространение, рекомендацию и продвижение в boks и в материалах о boks. Вы в любой момент можете попросить удалить текст.",
      licenceLink: "Условия использования: «Авторский контент»",
      rightsSource: "Откуда права (необязательно)",
      rightsSourceHint:
        "Это видят только администраторы boks. Достаточно строки: «моё произведение», «мой перевод», «Project Gutenberg #1342, общественное достояние».",
      submit: "Отправить на проверку",
      fifteen: "Пятнадцать минут",
      minutes: "Минуты",
      words: "Слова",
      characters: (used: number, max: number) => `${groupFor("ru", used)} из ${groupFor("ru", max)} ${ruCharacters(max)}`,
      overLength: (over: number) => `Это на ${groupFor("ru", over)} ${ruCharacters(over)} больше, чем помещается в 15 минут.`,
      splitOffer: (parts: number) => `Разделить на ${parts} ${ruParts(parts)} и добавить в очередь загрузки`,
      fits: "Бок - это один перерыв. Помещается.",
      dropTitle: "Перетащите файлы сюда или выберите их",
      dropHint:
        "Форматы: .docx (Word), .txt и .md. Один файл - один текст. Название берётся из первой строки файла - его можно поменять ниже перед отправкой.",
      chooseFiles: "Выбрать файлы",
      reading: "Читаем файлы…",
      unsupported: (names: string) => `Этот формат не поддерживается: ${names}. Сохраните как .docx или .txt и добавьте снова.`,
      unreadable: (names: string) => `Не удалось прочитать: ${names}.`,
      skippedDuplicates: (n: number) =>
        n === 1
          ? "Один файл уже был в очереди и пропущен."
          : `${n} ${ruFiles(n)} уже были в очереди и пропущены.`,
      added: (n: number) => `В очередь ${plural("ru", n, { one: "добавлен", few: "добавлено", many: "добавлено", other: "добавлено" })} ${n} ${ruPieces(n)}.`,
      queueTitle: "Очередь загрузки",
      queueEmpty: "Очередь пуста. Выберите файлы выше - сколько угодно.",
      queueSummary: (ready: number, attention: number) =>
        attention ? `Готово к отправке: ${ready} · требуют внимания: ${attention}` : `Готово к отправке: ${ready}`,
      clearQueue: "Очистить очередь",
      itemTitle: "Название",
      itemReady: "Готов",
      itemEmpty: "В файле нет текста",
      itemTooLong: "Дольше 15 минут",
      itemSending: "Отправляем…",
      itemFailed: "Не отправлен",
      itemFromFile: (name: string) => `из файла ${name}`,
      itemMeta: (minutes: number, characters: number) => `${minutes} мин · ${groupFor("ru", characters)} ${ruCharacters(characters)}`,
      splitItem: (parts: number) => `Разделить на ${parts} ${ruParts(parts)}`,
      editItem: "Открыть в редакторе",
      removeItem: "Убрать из очереди",
      sendAll: (n: number) => `Отправить на проверку: ${n} ${ruPieces(n)}`,
      stop: "Остановить",
      progress: (done: number, total: number) => `Отправляем: ${done} из ${total}…`,
      batchDone: (sent: number, failed: number) =>
        failed
          ? `Отправлено: ${sent}. Не удалось отправить: ${failed}. Причина указана у текста в очереди.`
          : `Отправлено на проверку: ${sent} ${ruPieces(sent)}. Читатели увидят каждый после одобрения администратора.`,
      batchStopped: (sent: number, left: number) => `Остановлено. Отправлено: ${sent}; в очереди осталось: ${left}.`,
      leaveWarning: "Очередь загрузки не отправлена. Всё равно уйти?",
      published: "Опубликовано",
      inReview: "На проверке",
      needsWork: "Нужны правки",
    },
  }
);

type Words = (typeof messages)["en"];

/** A status line is kept as words to look up, so it follows a change of language. */
type StatusLine = (words: Words, language: UiLanguage) => string;

const authorDraftKey = "boks-author-draft";

type AuthorDraft = { title: string; body: string; authorName: string };

/** One piece waiting in the upload queue, read from a file or split from a long text. */
type QueueItem = {
  key: string;
  fileName: string;
  title: string;
  text: string;
  /** From the file's front matter; empty means the cabinet's byline. */
  authorName: string;
  state: "ready" | "sending" | "failed";
  error?: StatusLine;
};

type ItemProblem = "empty" | "tooLong" | null;

function itemProblem(item: Pick<QueueItem, "text" | "title">): ItemProblem {
  if (!item.text.trim() || !(item.title.trim() || titleFromText(item.text))) return "empty";
  if (item.text.length > maxBokCharacters) return "tooLong";
  return null;
}

/**
 * The piece being written, kept on this device until it is submitted. A
 * writer who is not signed in writes first and signs in to submit, which
 * means following an email link and a fresh page load - and the text lived
 * only in memory, so it was gone when they came back.
 */
function readAuthorDraft(): AuthorDraft | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(authorDraftKey) ?? "null") as Partial<AuthorDraft> | null;
    if (!parsed || (!parsed.title && !parsed.body)) return null;
    return { title: parsed.title ?? "", body: parsed.body ?? "", authorName: parsed.authorName ?? "" };
  } catch {
    return null;
  }
}

function writeAuthorDraft(draft: AuthorDraft | null) {
  try {
    if (!draft || (!draft.title.trim() && !draft.body.trim())) window.localStorage.removeItem(authorDraftKey);
    else window.localStorage.setItem(authorDraftKey, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the draft simply is not kept.
  }
}

const emptyCounts: AuthorBokSubmissionsPage["counts"] = {
  all: 0,
  pending_review: 0,
  published: 0,
  rejected: 0,
  withdrawn: 0,
  archived: 0,
};

/** The rights statement and the licence it grants, shared by both ways of sending. */
function RightsBlock({
  words,
  label,
  confirmed,
  note,
  onConfirmed,
  onNote,
}: {
  words: Words;
  label: string;
  confirmed: boolean;
  note: string;
  onConfirmed: (value: boolean) => void;
  onNote: (value: string) => void;
}) {
  return (
    <div className="author-rights rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
      <label className="flex cursor-pointer items-start gap-3 text-sm font-medium leading-6">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0"
          checked={confirmed}
          onChange={(event) => onConfirmed(event.target.checked)}
        />
        <span>
          {label}
          <span className="mt-1 block font-normal text-[var(--muted-foreground)]">{words.rightsWhy}</span>
        </span>
      </label>
      <p className="author-licence mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
        {words.licence}{" "}
        <a href="/terms#author-content" target="_blank" rel="noreferrer" className="font-medium text-[var(--primary)] underline">
          {words.licenceLink}
        </a>
      </p>
      <div className="mt-3">
        <Field label={words.rightsSource} hint={words.rightsSourceHint}>
          <Textarea
            className="min-h-[72px]"
            value={note}
            placeholder={words.optional}
            onChange={(event) => onNote(event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

export function AuthorConsole() {
  const words = useMessages(messages);
  const uiLanguage = useUiLanguage();
  const [statusLine, setStatus] = useState<StatusLine | null>(() => (w: Words) => w.statusSignIn);
  const status = statusLine ? statusLine(words, uiLanguage) : "";

  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [mode, setMode] = useState<"works" | "write" | "files">("write");
  const [authorForm, setAuthorForm] = useState({
    title: "",
    body: "",
    authorName: "",
    /**
     * Deliberately not remembered between pieces. An attestation is about one
     * bok, and a box that stays ticked stops being a statement about anything.
     */
    rightsConfirmed: false,
    rightsNote: "",
  });
  const [isSubmitting, setSubmitting] = useState(false);
  const [defaultAuthorName, setDefaultAuthorName] = useState("");
  const visitorId = useRef("anonymous");
  const formSection = useRef<HTMLElement | null>(null);
  // The refused boks being revised, which is resubmitted in place.
  const [revising, setRevising] = useState<{ id: string; title: string } | null>(null);
  const sessionId = useRef("session");

  // The upload queue.
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueRights, setQueueRights] = useState({ confirmed: false, note: "" });
  const [queueStatus, setQueueStatus] = useState<StatusLine | null>(null);
  const [readingFiles, setReadingFiles] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stopRequested = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // "My texts": its counts, and a key that reloads it after a send.
  const [worksCounts, setWorksCounts] = useState<AuthorBokSubmissionsPage["counts"]>(emptyCounts);
  const [worksKey, setWorksKey] = useState(0);
  // Until the author picks a tab, one with texts opens on them.
  const modeChosen = useRef(false);

  const authorMinutes = estimateMinutes(authorForm.body);
  const authorWords = wordCount(authorForm.body);
  const authorCharacters = authorForm.body.length;
  const overLength = authorCharacters > maxBokCharacters;
  const overLengthParts = overLength ? splitIntoEpisodes(authorForm.body).length : 0;
  // What an empty title becomes: the text's first line. The database applies
  // the same rule (`boks_title_from_text`); this is so the author sees it.
  const titleFromFirstLine = titleFromText(authorForm.body);
  const signedInAuthor = user && !user.isAnonymous ? user : null;
  const sending = progress !== null;
  const readyItems = queue.filter((item) => item.state !== "sending" && itemProblem(item) === null);
  const attentionCount = queue.length - readyItems.length;

  // Restore a draft left on this device, then keep it saved as it changes.
  useEffect(() => {
    const draft = readAuthorDraft();
    if (!draft) return;
    // A text left half-written on this device opens in the editor, not the list.
    modeChosen.current = true;
    const handle = window.setTimeout(() => {
      setAuthorForm((current) => ({
        ...current,
        title: current.title || draft.title,
        body: current.body || draft.body,
        authorName: current.authorName || draft.authorName,
      }));
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(
      () => writeAuthorDraft({ title: authorForm.title, body: authorForm.body, authorName: authorForm.authorName }),
      400
    );
    return () => window.clearTimeout(handle);
  }, [authorForm.title, authorForm.body, authorForm.authorName]);

  // Files read into the queue live only in this tab: warn before it is closed.
  useEffect(() => {
    if (!queue.length && !sending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = words.leaveWarning;
      return words.leaveWarning;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [queue.length, sending, words.leaveWarning]);

  const receiveCounts = useCallback((counts: AuthorBokSubmissionsPage["counts"]) => {
    setWorksCounts(counts);
    if (!modeChosen.current && counts.all > 0) {
      modeChosen.current = true;
      setMode("works");
    }
  }, []);

  // The tab bar's counts, read even while "My texts" is not the open tab.
  const refreshCounts = useCallback(() => {
    loadMyBokSubmissionsPage({ limit: 1 })
      .then((page) => receiveCounts(page.counts))
      .catch(() => undefined);
  }, [receiveCounts]);

  function chooseMode(next: "works" | "write" | "files") {
    modeChosen.current = true;
    setMode(next);
  }

  const refreshAuthor = useCallback(async () => {
    const context = await loadBoksUserContext();
    setUser(context);

    if (context && !context.isAnonymous) {
      const byline = await loadMyDefaultAuthorName();
      setWorksKey((key) => key + 1);
      refreshCounts();
      setDefaultAuthorName(byline);
      // Prefilled rather than merely hinted, so publishing again is one less
      // decision. An author who wants a different byline overwrites it.
      setAuthorForm((current) => ({ ...current, authorName: current.authorName || byline }));
      setStatus(() => (w: Words) => w.statusWrite);
    } else {
      setWorksCounts(emptyCounts);
      setDefaultAuthorName("");
      setStatus(() => (w: Words) => w.statusSignUp);
    }

    return context;
  }, [refreshCounts]);

  useEffect(() => {
    visitorId.current = getBrowserId("boks-author");
    sessionId.current = `${Date.now()}-${randomBoksId()}`;
    refreshAuthor().catch((error) => setStatus(() => (w: Words) => readableBoksError(error, w.loadFailed)));
  }, [refreshAuthor]);

  function refreshHistory() {
    setWorksKey((key) => key + 1);
    refreshCounts();
  }

  function openAuth() {
    setAuthPanelOpen(true);
  }

  function editSubmission(submission: AuthorBokSubmission) {
    modeChosen.current = true;
    setMode("write");
    setAuthorForm((current) => ({
      title: submission.title,
      body: submission.body,
      // Reworking a rejected piece keeps the byline it was written under.
      authorName: submission.authorName || current.authorName,
      // The attestation is not carried over. A piece may have been refused
      // over its rights, and a box that arrives already ticked would be the
      // reader's word put in their mouth. The note is admin-only and never
      // comes back to the author, so there is nothing to restore.
      rightsConfirmed: false,
      rightsNote: "",
    }));
    setRevising({ id: submission.id, title: submission.title });
    setStatus(() => (w: Words) => w.statusRevising);
    // The form opens in place of the list; bring it into view.
    window.setTimeout(() => formSection.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function blockedFromSending() {
    if (!signedInAuthor) {
      openAuth();
      return true;
    }
    if (signedInAuthor.bannedAt) {
      const reason = signedInAuthor.banReason;
      setStatus(() => (w: Words) => reason || w.statusSuspended);
      return true;
    }
    return false;
  }

  async function submitForReview() {
    if (blockedFromSending()) return;

    setSubmitting(true);
    setStatus(null);
    try {
      await submitBokForReview({
        ...authorForm,
        minutes: authorMinutes,
        bokId: revising?.id ?? null,
      });
      setRevising(null);
      setAuthorForm((current) => ({
        title: "",
        body: "",
        // The byline survives the reset: an author who publishes a series
        // should not retype their pen name for every piece. The attestation
        // does not - it has to be made again for the next piece.
        authorName: current.authorName,
        rightsConfirmed: false,
        rightsNote: "",
      }));
      refreshHistory();
      setStatus(() => (w: Words) => w.statusSubmitted);
    } catch (error) {
      setStatus(() => (w: Words) => readableBoksError(error, w.submitFailed));
    } finally {
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------ the queue

  function newItem(piece: { fileName: string; title: string; text: string; authorName: string }): QueueItem {
    return { key: randomBoksId(), state: "ready", ...piece };
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setMode("files");
    setReadingFiles(true);
    setQueueStatus(null);
    const unsupported: string[] = [];
    const unreadable: string[] = [];
    const read: QueueItem[] = [];
    for (const file of files) {
      if (!isSupportedAuthorFile(file.name)) {
        unsupported.push(file.name);
        continue;
      }
      try {
        read.push(newItem(await readAuthorFile(file)));
      } catch {
        unreadable.push(file.name);
      }
    }
    // Files sorted by name, the way a numbered folder is meant to be read.
    read.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }));

    // The same file chosen twice is the commonest mistake with a folder of
    // files; the database would refuse the second copy anyway.
    const seen = new Set(queue.map((item) => item.text));
    let skipped = 0;
    const fresh = read.filter((item) => {
      if (item.text && seen.has(item.text)) {
        skipped += 1;
        return false;
      }
      seen.add(item.text);
      return true;
    });
    setQueue((current) => [...current, ...fresh]);
    setReadingFiles(false);
    setQueueStatus(() => (w: Words) =>
      [
        fresh.length ? w.added(fresh.length) : "",
        skipped ? w.skippedDuplicates(skipped) : "",
        unsupported.length ? w.unsupported(unsupported.join(", ")) : "",
        unreadable.length ? w.unreadable(unreadable.join(", ")) : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function updateItem(key: string, change: Partial<QueueItem>) {
    setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));
  }

  function removeItem(key: string) {
    setQueue((current) => current.filter((item) => item.key !== key));
  }

  function splitItem(item: QueueItem) {
    const base = item.title.trim() || titleFromText(item.text);
    const parts = splitIntoEpisodes(item.text).map((text, index) =>
      newItem({ fileName: item.fileName, title: episodeTitle(base, index, uiLanguage), text, authorName: item.authorName })
    );
    setQueue((current) => current.flatMap((entry) => (entry.key === item.key ? parts : [entry])));
  }

  function splitEditorText() {
    const base = authorForm.title.trim() || titleFromFirstLine;
    const parts = splitIntoEpisodes(authorForm.body).map((text, index) =>
      newItem({ fileName: "", title: episodeTitle(base, index, uiLanguage), text, authorName: "" })
    );
    setQueue((current) => [...current, ...parts]);
    setAuthorForm((current) => ({ ...current, title: "", body: "" }));
    setMode("files");
    setQueueStatus(() => (w: Words) => w.added(parts.length));
  }

  function openItemInEditor(item: QueueItem) {
    setRevising(null);
    setAuthorForm((current) => ({
      ...current,
      title: item.title,
      body: item.text,
      authorName: item.authorName || current.authorName,
      rightsConfirmed: false,
    }));
    removeItem(item.key);
    setMode("write");
    formSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function sendQueue() {
    if (blockedFromSending()) return;
    const batch = readyItems;
    if (!batch.length) return;

    stopRequested.current = false;
    setQueueStatus(null);
    setProgress({ done: 0, total: batch.length });
    let sent = 0;
    let failed = 0;
    for (const item of batch) {
      if (stopRequested.current) break;
      updateItem(item.key, { state: "sending", error: undefined });
      try {
        await submitBokForReview({
          title: item.title,
          body: item.text,
          minutes: estimateMinutes(item.text),
          authorName: item.authorName || authorForm.authorName,
          rightsConfirmed: queueRights.confirmed,
          rightsNote: queueRights.note,
          bokId: null,
        });
        sent += 1;
        removeItem(item.key);
      } catch (error) {
        failed += 1;
        updateItem(item.key, {
          state: "failed",
          error: (w: Words, language: UiLanguage) => readableBoksError(error, w.submitFailed, language),
        });
      }
      setProgress({ done: sent + failed, total: batch.length });
    }
    const stopped = stopRequested.current;
    const left = batch.length - sent - failed;
    setProgress(null);
    // A fresh statement for whatever is added next.
    setQueueRights((current) => ({ ...current, confirmed: false }));
    setQueueStatus(() => (w: Words) => (stopped ? w.batchStopped(sent, left + failed) : w.batchDone(sent, failed)));
    refreshHistory();
  }


  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-5">
        <section className="panel p-5 sm:p-7">
          <a href="/" className="brand-word">boks</a>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">{words.title}</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">{words.intro}</p>
          {!signedInAuthor && (
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
              <p className="text-sm font-semibold">{words.needAccount}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{words.needAccountWhy}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {/* One button: signing in and signing up are the same act -
                    an address, and an account if there is not one yet. */}
                <Button onClick={() => openAuth()}>{words.continueEmail}</Button>
              </div>
            </div>
          )}
          <div className="mt-7 grid gap-4">
            {signedInAuthor?.bannedAt && (
              <div className="rounded-lg border border-[var(--destructive)]/35 bg-[var(--destructive)]/5 p-4 text-sm leading-6">
                {words.suspended} {signedInAuthor.banReason || words.contactAdmin}
              </div>
            )}
            {signedInAuthor && (
              <p className="byline-note">
                {words.publishingAs} <strong>@{signedInAuthor.handle || words.readerHandle}</strong>.{" "}
                {words.publishingAsWhy}
              </p>
            )}
            <div className="author-modes author-modes--three" role="tablist" aria-label={words.title}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "works"}
                className="author-mode"
                onClick={() => chooseMode("works")}
              >
                <Library className="size-4" /> {words.modeWorks}
                {worksCounts.all > 0 && <span className="author-mode__count author-mode__count--quiet">{worksCounts.all}</span>}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "write"}
                className="author-mode"
                onClick={() => chooseMode("write")}
              >
                <PenLine className="size-4" /> {words.modeWrite}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "files"}
                className="author-mode"
                onClick={() => chooseMode("files")}
              >
                <Upload className="size-4" /> {words.modeFiles}
                {queue.length > 0 && <span className="author-mode__count">{queue.length}</span>}
              </button>
            </div>
          </div>
        </section>

        {mode === "works" ? (
          <AuthorWorks
            signedIn={Boolean(signedInAuthor)}
            refreshKey={worksKey}
            onEdit={editSubmission}
            onCounts={receiveCounts}
          />
        ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section ref={formSection} className="panel p-5 sm:p-7">
          <div className="grid gap-4">
            <Field label={words.authorName} hint={defaultAuthorName ? words.authorNameKept : words.authorNameEmpty}>
              <Input
                value={authorForm.authorName}
                placeholder={words.optional}
                onChange={(event) => setAuthorForm({ ...authorForm, authorName: event.target.value })}
              />
            </Field>

            {mode === "write" ? (
              <>
                {revising && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--reader)] p-3 text-sm">
                    <span>
                      {words.revising} <strong>{words.openQuote}{revising.title}{words.closeQuote}</strong>. {words.revisingWhy}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRevising(null);
                        setAuthorForm((current) => ({ ...current, title: "", body: "", rightsConfirmed: false, rightsNote: "" }));
                        setStatus(() => (w: Words) => w.statusWrite);
                      }}
                    >
                      {words.startNew}
                    </Button>
                  </div>
                )}
                <Field
                  label={words.titleLabel}
                  hint={
                    authorForm.title.trim() || !titleFromFirstLine
                      ? words.titleHintEmpty
                      : words.titleHintFromLine(titleFromFirstLine)
                  }
                >
                  <Input
                    value={authorForm.title}
                    placeholder={titleFromFirstLine || words.optional}
                    onChange={(event) => setAuthorForm({ ...authorForm, title: event.target.value })}
                  />
                </Field>
                <Field label={words.text}>
                  <Textarea
                    className="min-h-[380px] text-base leading-7"
                    value={authorForm.body}
                    placeholder={words.textPlaceholder}
                    onChange={(event) => setAuthorForm({ ...authorForm, body: event.target.value })}
                  />
                </Field>
                {overLength && (
                  <div className="rounded-lg border border-[var(--destructive)]/35 bg-[var(--destructive)]/5 p-3 text-sm leading-6">
                    <p>{words.overLength(authorCharacters - maxBokCharacters)}</p>
                    {!revising && (
                      <Button type="button" variant="outline" size="sm" className="mt-2 h-auto whitespace-normal py-1.5 text-left" onClick={splitEditorText}>
                        <Scissors className="size-4" /> {words.splitOffer(overLengthParts)}
                      </Button>
                    )}
                  </div>
                )}

                <RightsBlock
                  words={words}
                  label={words.rights}
                  confirmed={authorForm.rightsConfirmed}
                  note={authorForm.rightsNote}
                  onConfirmed={(value) => setAuthorForm({ ...authorForm, rightsConfirmed: value })}
                  onNote={(value) => setAuthorForm({ ...authorForm, rightsNote: value })}
                />

                <Button
                  className="h-11 w-full sm:w-fit"
                  onClick={submitForReview}
                  disabled={
                    isSubmitting ||
                    // A title is optional; words in the text are not.
                    !titleFromFirstLine ||
                    !authorForm.rightsConfirmed ||
                    overLength ||
                    Boolean(signedInAuthor?.bannedAt)
                  }
                >
                  <Send className="size-4" /> {words.submit}
                </Button>
                {/* The result of the last action, next to the button that caused it. */}
                {status && (
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]" role="status" aria-live="polite">
                    {status}
                  </p>
                )}
              </>
            ) : (
              <>
                <div
                  className={`author-drop ${dragging ? "author-drop--active" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void addFiles(Array.from(event.dataTransfer.files));
                  }}
                >
                  <FilePlus2 className="size-7 text-[var(--muted-foreground)]" aria-hidden="true" />
                  <p className="text-base font-semibold">{words.dropTitle}</p>
                  <p className="max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">{words.dropHint}</p>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    accept={authorFileAccept}
                    className="sr-only"
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void addFiles(files);
                    }}
                  />
                  <Button type="button" variant="outline" disabled={readingFiles || sending} onClick={() => fileInput.current?.click()}>
                    <Upload className="size-4" /> {readingFiles ? words.reading : words.chooseFiles}
                  </Button>
                </div>

                <div className="grid gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-semibold tracking-normal">{words.queueTitle}</h2>
                    {queue.length > 0 && (
                      <span className="text-sm text-[var(--muted-foreground)]">
                        {words.queueSummary(readyItems.length, attentionCount)}
                      </span>
                    )}
                  </div>
                  {queue.length === 0 ? (
                    <p className="text-sm leading-6 text-[var(--muted-foreground)]">{words.queueEmpty}</p>
                  ) : (
                    <ol className="author-queue">
                      {queue.map((item) => {
                        const problem = itemProblem(item);
                        const parts = problem === "tooLong" ? splitIntoEpisodes(item.text).length : 0;
                        const derived = titleFromText(item.text);
                        const badge =
                          item.state === "sending"
                            ? { tone: "pending_review", label: words.itemSending }
                            : item.state === "failed"
                              ? { tone: "rejected", label: words.itemFailed }
                              : problem === "empty"
                                ? { tone: "rejected", label: words.itemEmpty }
                                : problem === "tooLong"
                                  ? { tone: "rejected", label: words.itemTooLong }
                                  : { tone: "published", label: words.itemReady };
                        return (
                          <li key={item.key} className="submission-card author-queue__item">
                            <div className="flex items-start gap-2">
                              <FileText className="mt-2.5 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
                              <div className="min-w-0 flex-1">
                                <Input
                                  aria-label={words.itemTitle}
                                  value={item.title}
                                  placeholder={derived || words.itemTitle}
                                  disabled={sending}
                                  onChange={(event) => updateItem(item.key, { title: event.target.value })}
                                />
                                <p className="mt-1.5 break-words text-xs text-[var(--muted-foreground)]">
                                  {words.itemMeta(estimateMinutes(item.text), item.text.length)}
                                  {item.fileName ? ` · ${words.itemFromFile(item.fileName)}` : ""}
                                  {item.authorName ? ` · ${item.authorName}` : ""}
                                </p>
                              </div>
                              <span className={`review-badge review-badge--${badge.tone}`}>{badge.label}</span>
                            </div>
                            {item.state === "failed" && item.error && (
                              <p className="mt-2 text-sm leading-6 text-[var(--destructive)]">{item.error(words, uiLanguage)}</p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {problem === "tooLong" && (
                                <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => splitItem(item)}>
                                  <Scissors className="size-4" /> {words.splitItem(parts)}
                                </Button>
                              )}
                              <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={() => openItemInEditor(item)}>
                                <Edit3 className="size-4" /> {words.editItem}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" disabled={sending} onClick={() => removeItem(item.key)}>
                                <X className="size-4" /> {words.removeItem}
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {queue.length > 1 && !sending && (
                    <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setQueue([])}>
                      {words.clearQueue}
                    </Button>
                  )}
                </div>

                {queue.length > 0 && (
                  <RightsBlock
                    words={words}
                    label={words.rightsBatch(readyItems.length || queue.length)}
                    confirmed={queueRights.confirmed}
                    note={queueRights.note}
                    onConfirmed={(value) => setQueueRights((current) => ({ ...current, confirmed: value }))}
                    onNote={(value) => setQueueRights((current) => ({ ...current, note: value }))}
                  />
                )}

                {queue.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="h-11 w-full sm:w-fit"
                      onClick={sendQueue}
                      disabled={sending || !readyItems.length || !queueRights.confirmed || Boolean(signedInAuthor?.bannedAt)}
                    >
                      <Send className="size-4" /> {words.sendAll(readyItems.length)}
                    </Button>
                    {sending && (
                      <Button type="button" variant="outline" className="h-11" onClick={() => (stopRequested.current = true)}>
                        <Square className="size-4" /> {words.stop}
                      </Button>
                    )}
                  </div>
                )}
                {progress && (
                  <div role="status" aria-live="polite" className="grid gap-2">
                    <p className="text-sm text-[var(--muted-foreground)]">{words.progress(progress.done, progress.total)}</p>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                      <div
                        className="h-full rounded-full bg-[var(--primary)] transition-[width]"
                        style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {!progress && queueStatus && (
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]" role="status" aria-live="polite">
                    {queueStatus(words, uiLanguage)}
                  </p>
                )}
                {!signedInAuthor && queue.length > 0 && (
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">{words.statusSignIn}</p>
                )}
              </>
            )}
          </div>
        </section>
        <aside className="grid content-start gap-4">
          {mode === "write" && (
            <div className="panel p-5">
              <h2 className="text-lg font-semibold tracking-normal">{words.fifteen}</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <MetricTile label={words.minutes} value={authorMinutes} />
                <MetricTile label={words.words} value={authorWords} />
              </div>
              {/* Characters, because that is the limit the database enforces. */}
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                {words.characters(authorCharacters, maxBokCharacters)}
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (authorCharacters / maxBokCharacters) * 100)}%`,
                    background: overLength ? "var(--destructive)" : "var(--primary)",
                  }}
                />
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                {overLength ? words.overLength(authorCharacters - maxBokCharacters) : words.fits}
              </p>
            </div>
          )}
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">{words.status}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{status}</p>
            {signedInAuthor && worksCounts.all > 0 && (
              <dl className="author-counts mt-4">
                {[
                  { label: words.published, value: worksCounts.published },
                  { label: words.inReview, value: worksCounts.pending_review },
                  { label: words.needsWork, value: worksCounts.rejected },
                  { label: words.withdrawnCount, value: worksCounts.withdrawn },
                ].map((row) => (
                  <div key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </aside>
        </div>
        )}
      </div>
      <UserAuthPanel
        open={authPanelOpen}
        surface="author"
        reason="manual"
        guestReadCount={0}
        currentUser={user}
        onClose={() => setAuthPanelOpen(false)}
        onOpenReadBoks={() => undefined}
        onUserChanged={(nextUser) => {
          // Not closed here: the panel is where a nickname is saved, and
          // dismissing it on save hides the confirmation.
          setUser(nextUser);
          refreshAuthor().catch((error) => setStatus(() => (w: Words) => readableBoksError(error, w.loadFailed)));
        }}
      />
    </main>
  );
}
