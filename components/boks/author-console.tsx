"use client";

import { randomBoksId } from "@/lib/boks/browser-id";
import { useEffect, useRef, useState } from "react";
import { Clock3, Edit3, Send, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readableBoksError } from "@/lib/boks/errors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { estimateMinutes, groupDigits, wordCount } from "@/components/boks/client-format";
import { maxBokCharacters } from "@/lib/boks/contracts";
import { titleFromText } from "@/lib/boks/bok-title";
import type {
  AuthorBokQuota,
  AuthorBokSubmission,
  BoksUserContext,
  BokReviewStatus,
} from "@/components/boks/client-types";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { Field, MetricTile } from "@/components/boks/shared-ui";
import {
  loadBoksUserContext,
  loadMyBokQuota,
  loadMyBokSubmissions,
  loadMyDefaultAuthorName,
  submitBokForReview,
} from "@/components/boks/supabase-browser-data";
import { bokSubmissionQuotaMessage, describeBokSubmissionQuota } from "@/lib/boks/author/submission-quota";
import { UserAuthPanel } from "@/components/boks/user-auth-panel";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/** The cabinet's words. The author's own text, title and byline are never translated. */
const messages = defineMessages(
  {
    statusSignIn: "Sign in to submit a bok.",
    statusSignUp: "Sign up or sign in to submit a bok.",
    statusHistory: "Your boks review history is below.",
    statusWrite: "Write a bok and submit it for review.",
    statusRevising: "Refused bok loaded into the editor. Confirm the rights again and submit.",
    statusSuspended: "This account is suspended and cannot submit boks.",
    statusSubmitted: "Submitted for review. An admin will approve it before readers see it.",
    loadFailed: "Could not load author cabinet.",
    submitFailed: "Could not submit this bok.",
    reviewWaiting: "Waiting for review",
    reviewPublished: "Published",
    reviewRejected: "Needs changes",
    reviewArchived: "Archived",
    reviewDraft: "Draft",
    title: "Author cabinet",
    intro: "Submit one focused bok for review. Readers will see it only after boks admin approval.",
    needAccount: "Authors need a boks account.",
    needAccountWhy: "This lets you track whether each bok is waiting, approved, or refused with a reason.",
    continueEmail: "Continue with email",
    suspended: "This account is suspended and cannot publish.",
    contactAdmin: "Contact a boks administrator for details.",
    publishingAs: "Publishing as",
    publishingAsWhy: "Every bok you publish carries that, so readers can always find your other work.",
    readerHandle: "reader",
    authorName: "Author name (optional)",
    authorNameKept:
      "A name to print above your @nickname. Left as you had it last time; clear it to publish under the @nickname alone.",
    authorNameEmpty:
      "Leave this empty to publish under your @nickname. Fill it in if you want a name printed above it.",
    optional: "Optional",
    revising: "Revising",
    revisingWhy: "Submitting sends this same bok back for review.",
    startNew: "Start a new bok instead",
    titleLabel: "Title (optional)",
    titleHintEmpty: "Leave it empty and the first line of the text becomes the title.",
    titleHintFromLine: (title: string) => `Left empty, the title will be “${title}”.`,
    text: "Text",
    rights: "I hold the rights to publish this bok.",
    rightsWhy:
      "Your own work, or work you are allowed to publish - public domain, an open licence, or permission you have been given.",
    rightsSource: "Where the rights come from (optional)",
    rightsSourceHint:
      "Only boks admins see this. A line is enough: “Project Gutenberg #1342, public domain”, “my translation”, “permission from the estate”.",
    submit: "Submit for review",
    daily: "Daily submissions",
    usedToday: (used: number, limit: number) => `${used} of ${limit} used today`,
    dailyWhy: "The limit keeps the review queue readable. It resets at midnight UTC.",
    fifteen: "Fifteen minutes",
    minutes: "Minutes",
    words: "Words",
    characters: (used: string, max: string) => `${used} of ${max} characters`,
    overLength: (over: string) => `That is ${over} characters past the promise. Split it into episodes.`,
    fits: "A bok is one break. Fits.",
    status: "Status",
    published: "Published",
    inReview: "In review",
    needsWork: "Needs work",
    yourBoks: "Your boks",
    min: "min",
    liked: (n: number) => `${n} liked`,
    replied: (n: number) => `${n} replied`,
    revise: "Revise",
    nothingYet: "Nothing submitted yet. Your first bok will appear here with its likes and replies.",
    afterSignIn: "Submitted boks will appear here after you sign in.",
  },
  {
    ru: {
      statusSignIn: "Войдите, чтобы отправить текст.",
      statusSignUp: "Зарегистрируйтесь или войдите, чтобы отправить текст.",
      statusHistory: "Ниже - история проверки ваших текстов.",
      statusWrite: "Напишите текст и отправьте его на проверку.",
      statusRevising: "Отклонённый текст открыт в редакторе. Ещё раз подтвердите права и отправьте.",
      statusSuspended: "Этот аккаунт заблокирован и не может отправлять тексты.",
      statusSubmitted: "Отправлено на проверку. Читатели увидят текст после одобрения администратора.",
      loadFailed: "Не удалось загрузить кабинет автора.",
      submitFailed: "Не удалось отправить этот текст.",
      reviewWaiting: "Ждёт проверки",
      reviewPublished: "Опубликован",
      reviewRejected: "Нужны правки",
      reviewArchived: "В архиве",
      reviewDraft: "Черновик",
      title: "Кабинет автора",
      intro: "Отправьте на проверку один цельный текст. Читатели увидят его только после одобрения администратора boks.",
      needAccount: "Авторам нужен аккаунт boks.",
      needAccountWhy: "Так вы увидите, ждёт ли каждый текст проверки, одобрен он или отклонён - и почему.",
      continueEmail: "Продолжить с email",
      suspended: "Этот аккаунт заблокирован и не может публиковать.",
      contactAdmin: "Подробности - у администратора boks.",
      publishingAs: "Публикация от имени",
      publishingAsWhy: "Это имя стоит на каждом вашем тексте, чтобы читатели всегда могли найти другие ваши работы.",
      readerHandle: "reader",
      authorName: "Имя автора (необязательно)",
      authorNameKept:
        "Имя, которое печатается над вашим @никнеймом. Оставлено как в прошлый раз; сотрите, чтобы публиковаться только под @никнеймом.",
      authorNameEmpty:
        "Оставьте пустым, чтобы публиковаться под @никнеймом. Заполните, если хотите, чтобы над ним стояло имя.",
      optional: "Необязательно",
      revising: "Правка",
      revisingWhy: "При отправке этот же текст вернётся на проверку.",
      startNew: "Начать новый текст",
      titleLabel: "Название (необязательно)",
      titleHintEmpty: "Если оставить пустым, названием станет первая строка текста.",
      titleHintFromLine: (title: string) => `Если оставить пустым, название будет «${title}».`,
      text: "Текст",
      rights: "У меня есть права на публикацию этого текста.",
      rightsWhy:
        "Ваше собственное произведение или то, что вам можно публиковать: общественное достояние, открытая лицензия или полученное разрешение.",
      rightsSource: "Откуда права (необязательно)",
      rightsSourceHint:
        "Это видят только администраторы boks. Достаточно строки: «Project Gutenberg #1342, общественное достояние», «мой перевод», «разрешение наследников».",
      submit: "Отправить на проверку",
      daily: "Отправки за день",
      usedToday: (used: number, limit: number) => `Сегодня использовано ${used} из ${limit}`,
      dailyWhy: "Лимит помогает справляться с очередью проверки. Он обнуляется в полночь по UTC.",
      fifteen: "Пятнадцать минут",
      minutes: "Минуты",
      words: "Слова",
      characters: (used: string, max: string) => `${used} из ${max} символов`,
      overLength: (over: string) => `Это на ${over} символов больше обещанного. Разделите текст на эпизоды.`,
      fits: "Бок - это один перерыв. Помещается.",
      status: "Статус",
      published: "Опубликовано",
      inReview: "На проверке",
      needsWork: "Нужны правки",
      yourBoks: "Ваши тексты",
      min: "мин",
      liked: (n: number) =>
        `${n} ${plural("ru", n, { one: "лайк", few: "лайка", many: "лайков", other: "лайка" })}`,
      replied: (n: number) =>
        `${n} ${plural("ru", n, { one: "ответ", few: "ответа", many: "ответов", other: "ответа" })}`,
      revise: "Исправить",
      nothingYet: "Пока ничего не отправлено. Здесь появится ваш первый текст - с лайками и ответами.",
      afterSignIn: "Отправленные тексты появятся здесь, когда вы войдёте.",
    },
  }
);

type Words = (typeof messages)["en"];

/** A status line is kept as words to look up, so it follows a change of language. */
type StatusLine = (words: Words, language: UiLanguage) => string;

const authorDraftKey = "boks-author-draft";

type AuthorDraft = { title: string; body: string; authorName: string };

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

function reviewStatusLabel(status: BokReviewStatus, words: Words) {
  if (status === "pending_review") return words.reviewWaiting;
  if (status === "published") return words.reviewPublished;
  if (status === "rejected") return words.reviewRejected;
  if (status === "archived") return words.reviewArchived;
  return words.reviewDraft;
}

function ReviewStatusIcon({ status }: { status: BokReviewStatus }) {
  if (status === "published") return <ShieldCheck className="size-4" />;
  if (status === "rejected") return <XCircle className="size-4" />;
  return <Clock3 className="size-4" />;
}

export function AuthorConsole() {
  const words = useMessages(messages);
  const uiLanguage = useUiLanguage();
  const [statusLine, setStatus] = useState<StatusLine | null>(() => (w: Words) => w.statusSignIn);
  const status = statusLine ? statusLine(words, uiLanguage) : "";

  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [submissions, setSubmissions] = useState<AuthorBokSubmission[]>([]);
  const [quota, setQuota] = useState<AuthorBokQuota>(() => describeBokSubmissionQuota(0));
  const quotaMessage = bokSubmissionQuotaMessage(quota, uiLanguage);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
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
  const authorMinutes = estimateMinutes(authorForm.body);
  const authorWords = wordCount(authorForm.body);
  const authorCharacters = authorForm.body.length;
  const overLength = authorCharacters > maxBokCharacters;
  // What an empty title becomes: the text's first line. The database applies
  // the same rule (`boks_title_from_text`); this is so the author sees it.
  const titleFromFirstLine = titleFromText(authorForm.body);
  const publishedCount = submissions.filter((row) => row.status === "published").length;
  const pendingCount = submissions.filter((row) => row.status === "pending_review").length;
  const rejectedCount = submissions.filter((row) => row.status === "rejected").length;
  const signedInAuthor = user && !user.isAnonymous ? user : null;

  // Restore a draft left on this device, then keep it saved as it changes.
  useEffect(() => {
    const draft = readAuthorDraft();
    if (!draft) return;
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

  useEffect(() => {
    visitorId.current = getBrowserId("boks-author");
    sessionId.current = `${Date.now()}-${randomBoksId()}`;
    refreshAuthor().catch((error) => setStatus(() => (w: Words) => readableBoksError(error, w.loadFailed)));
  }, []);

  async function refreshAuthor() {
    const context = await loadBoksUserContext();
    setUser(context);

    if (context && !context.isAnonymous) {
      const [rows, currentQuota, byline] = await Promise.all([
        loadMyBokSubmissions(),
        loadMyBokQuota(),
        loadMyDefaultAuthorName(),
      ]);
      setSubmissions(rows);
      setQuota(currentQuota);
      setDefaultAuthorName(byline);
      // Prefilled rather than merely hinted, so publishing again is one less
      // decision. An author who wants a different byline overwrites it.
      setAuthorForm((current) => ({ ...current, authorName: current.authorName || byline }));
      setStatus(() => (w: Words) => (rows.length ? w.statusHistory : w.statusWrite));
    } else {
      setSubmissions([]);
      setQuota(describeBokSubmissionQuota(0));
      setDefaultAuthorName("");
      setStatus(() => (w: Words) => w.statusSignUp);
    }

    return context;
  }

  function openAuth() {
    setAuthPanelOpen(true);
  }

  function editSubmission(submission: AuthorBokSubmission) {
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
    // Revise sits under the history, far below the form it fills.
    formSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitForReview() {
    if (!signedInAuthor) {
      openAuth();
      return;
    }

    if (signedInAuthor.bannedAt) {
      const reason = signedInAuthor.banReason;
      setStatus(() => (w: Words) => reason || w.statusSuspended);
      return;
    }

    if (quota.exhausted) {
      const exhausted = quota;
      setStatus(() => (_w: Words, language: UiLanguage) => bokSubmissionQuotaMessage(exhausted, language));
      return;
    }

    setSubmitting(true);
    setStatus(null);
    try {
      await submitBokForReview({
        ...authorForm,
        minutes: authorMinutes,
        bokId: revising?.id ?? null,
      });
      setRevising(null);
      // The byline survives the reset: an author who publishes a series should
      // not retype their pen name for every piece.
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
      await refreshAuthor();
      setStatus(() => (w: Words) => w.statusSubmitted);
    } catch (error) {
      setStatus(() => (w: Words) => readableBoksError(error, w.submitFailed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section ref={formSection} className="panel p-5 sm:p-7">
          <a href="/" className="brand-word">boks</a>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">{words.title}</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            {words.intro}
          </p>
          {!signedInAuthor && (
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
              <p className="text-sm font-semibold">{words.needAccount}</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                {words.needAccountWhy}
              </p>
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
            <Field
              label={words.authorName}
              hint={defaultAuthorName ? words.authorNameKept : words.authorNameEmpty}
            >
              <Input
                value={authorForm.authorName}
                placeholder={words.optional}
                onChange={(event) => setAuthorForm({ ...authorForm, authorName: event.target.value })}
              />
            </Field>
            {revising && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--reader)] p-3 text-sm">
                <span>
                  {words.revising} <strong>&ldquo;{revising.title}&rdquo;</strong>. {words.revisingWhy}
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
              <Textarea className="min-h-[380px] text-base leading-7" value={authorForm.body} onChange={(event) => setAuthorForm({ ...authorForm, body: event.target.value })} />
            </Field>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
              <label className="flex cursor-pointer items-start gap-3 text-sm font-medium leading-6">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={authorForm.rightsConfirmed}
                  onChange={(event) => setAuthorForm({ ...authorForm, rightsConfirmed: event.target.checked })}
                />
                <span>
                  {words.rights}
                  <span className="mt-1 block font-normal text-[var(--muted-foreground)]">{words.rightsWhy}</span>
                </span>
              </label>

              <div className="mt-3">
                <Field
                  label={words.rightsSource}
                  hint={words.rightsSourceHint}
                >
                  <Textarea
                    className="min-h-[72px]"
                    value={authorForm.rightsNote}
                    placeholder={words.optional}
                    onChange={(event) => setAuthorForm({ ...authorForm, rightsNote: event.target.value })}
                  />
                </Field>
              </div>
            </div>

            <Button
              className="h-11 w-full sm:w-fit"
              onClick={submitForReview}
              disabled={
                isSubmitting ||
                // A title is optional; words in the text are not.
                !titleFromFirstLine ||
                !authorForm.rightsConfirmed ||
                overLength ||
                Boolean(signedInAuthor && quota.exhausted) ||
                Boolean(signedInAuthor?.bannedAt)
              }
            >
              <Send className="size-4" /> {words.submit}
            </Button>
            {/* The result of the last action, next to the button that caused
                it. On a phone the Status panel is below the whole form, so a
                refusal ("Daily limit reached") changed nothing visible. */}
            {status && (
              <p className="text-sm leading-6 text-[var(--muted-foreground)]" role="status" aria-live="polite">
                {status}
              </p>
            )}
          </div>
        </section>
        <aside className="grid content-start gap-4">
          {/* Only once it is close enough to matter. A counter reading "0 of 3"
              is a rule nobody was about to break. */}
          {quota.usedToday >= quota.limit - 1 && (
            <div className="panel p-5">
              <h2 className="text-lg font-semibold tracking-normal">{words.daily}</h2>
              <div className={`author-quota mt-4 ${quota.exhausted ? "author-quota--exhausted" : ""}`}>
                <p className="text-sm font-semibold">
                  {words.usedToday(quota.usedToday, quota.limit)}
                </p>
                <div className="quota-pips" aria-hidden="true">
                  {Array.from({ length: quota.limit }, (_, index) => (
                    <span key={index} className={`quota-pip ${index < quota.usedToday ? "quota-pip--spent" : ""}`} />
                  ))}
                </div>
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">{quotaMessage}</p>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">
                {words.dailyWhy}
              </p>
            </div>
          )}
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">{words.fifteen}</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricTile label={words.minutes} value={authorMinutes} />
              <MetricTile label={words.words} value={authorWords} />
            </div>
            {/* Characters, because that is the limit the database enforces. */}
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {words.characters(groupDigits(authorCharacters), groupDigits(maxBokCharacters))}
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
              {overLength
                ? words.overLength(groupDigits(authorCharacters - maxBokCharacters))
                : words.fits}
            </p>
          </div>
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">{words.status}</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{status}</p>
            {signedInAuthor && submissions.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <MetricTile label={words.published} value={publishedCount} />
                <MetricTile label={words.inReview} value={pendingCount} />
                <MetricTile label={words.needsWork} value={rejectedCount} />
              </div>
            )}
          </div>
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">{words.yourBoks}</h2>
            <div className="mt-4 grid gap-3">
              {submissions.length ? submissions.map((submission) => (
                <article key={submission.id} className="submission-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">{submission.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {submission.minutes} {words.min}
                        {submission.authorName ? ` · ${submission.authorName}` : ""}
                        {submission.status === "published"
                          ? ` · ${words.liked(submission.likes)} · ${words.replied(submission.comments)}`
                          : ""}
                      </p>
                    </div>
                    <span className={`review-badge review-badge--${submission.status}`}>
                      <ReviewStatusIcon status={submission.status} />
                      {reviewStatusLabel(submission.status, words)}
                    </span>
                  </div>
                  {submission.reviewNote && (
                    <p className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm leading-6 text-[var(--muted-foreground)]">
                      {submission.reviewNote}
                    </p>
                  )}
                  {submission.status === "rejected" && (
                    <Button className="mt-3 w-full" variant="outline" onClick={() => editSubmission(submission)}>
                      <Edit3 className="size-4" /> {words.revise}
                    </Button>
                  )}
                </article>
              )) : (
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                  {signedInAuthor
                    ? words.nothingYet
                    : words.afterSignIn}
                </p>
              )}
            </div>
          </div>
        </aside>
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
