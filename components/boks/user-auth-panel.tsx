"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Mail, MessageCircle, Pause, Search } from "lucide-react";
import { ReaderBackIcon as ArrowLeft, ReaderSettingsIcon as Settings2 } from "./reader/reader-icons";
import { Button } from "@/components/ui/button";
import { readableBoksError } from "@/lib/boks/errors";
import {
  effectiveReadingLanguages,
  normalizeReadingLanguages,
  readingLanguageNames,
  rememberReadingLanguages,
} from "@/components/boks/reading-languages";
import {
  formatCooldown,
  magicLinkCooldownRemainingMs,
  recordMagicLinkSent,
  useMagicLinkCooldown,
} from "@/components/boks/magic-link-cooldown";
import { Input } from "@/components/ui/input";
import {
  describeBoksHandleProblem,
  maxHandleLength,
} from "@/lib/boks/contracts";
import { anonymousReadLimits } from "@/components/boks/reader-behavior";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { recordJourneyEvent, signupReason } from "@/lib/boks/journey";
import type { BoksUserContext, ReaderLibraryItem } from "@/components/boks/client-types";
import {
  loadBoksUserContext,
  loadFollowedAuthors,
  loadReaderLibrary,
  setAuthorFollow,
  setMyReadingLanguages,
  updateBoksProfile,
  type FollowedAuthor,
  deleteMyBoksAccount,
} from "@/components/boks/supabase-browser-data";
import { clearLocalReaderState } from "@/components/boks/reader-behavior";
import {
  readerLibraryActivityAt,
  readerLibraryActivityTime,
  selectReaderLibraryItems,
  type ReaderLibraryView,
} from "@/components/boks/reader-library";
import {
  boksEmailCodeLength,
  completePendingBoksMagicLinkProfile,
  explainBoksEmailCodeError,
  normalizeBoksEmailCode,
  verifyBoksEmailCode,
  explainBoksMagicLinkError,
  requestBoksMagicLink,
  signOutBoksUser,
} from "@/lib/boks/supabase-client";
import { atHandle } from "@/components/boks/reader/handles";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { bokArtworkFocus, getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { ReaderTabs } from "@/components/boks/series/series-view";
import { YouSettings } from "@/components/boks/you-settings";
import { loadFollowedPages, setAuthorPageFollow } from "@/components/boks/author-spaces/data";
import { bokCoverPalette } from "@/components/boks/reader/bok-cover-palette";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { currentUiLanguage, useMessages } from "./ui-language";

const activityMessages = defineMessages({
  likedAt: (time: string) => `Liked at ${time}`,
  readAt: (time: string) => `Read at ${time}`,
}, { ru: {
  likedAt: (time: string) => `Понравилось в ${time}`,
  readAt: (time: string) => `Прочитано в ${time}`,
} });

/**
 * What a failure says when the error itself has nothing readable. Read with
 * `currentUiLanguage()` at the moment of failure, since some are set from
 * effects and callbacks.
 */
const failureMessages = defineMessages({
  loadAccount: "Could not load account.",
  changeLanguages: "Could not change your languages.",
  saveSettings: "Could not save settings.",
  deleteAccount: "Could not delete the account.",
  signOut: "Could not sign out.",
  cooldown: (seconds: number) => `One link a minute per address. ${seconds} seconds to go.`,
}, { ru: {
  loadAccount: "Не удалось загрузить аккаунт.",
  changeLanguages: "Не удалось изменить языки чтения.",
  saveSettings: "Не удалось сохранить настройки.",
  deleteAccount: "Не удалось удалить аккаунт.",
  signOut: "Не удалось выйти.",
  cooldown: (seconds: number) =>
    `Не чаще одной ссылки в минуту на адрес. Осталось ${seconds} ${plural("ru", seconds, { one: "секунда", few: "секунды", many: "секунд", other: "секунды" })}.`,
} });

function failure() {
  return failureMessages[currentUiLanguage()];
}

// boks routes are separate surfaces with separate data loads, so they are
// linked with plain anchors. vinext's `next/link` client navigation throws
// `TypeError: e is not a function` in this build and silently does nothing,
// which is how "Write a bok" and "Admin" ended up dead. A full navigation is
// also the correct behavior here: moving between reader, author and admin
// should reset the surface.

export const currentBoksTermsVersion = "2026-09-11";

/**
 * One way in.
 *
 * There used to be a Sign up tab and a Sign in tab, and they were the same act
 * with two names: a reader types an address, and whether that address already
 * has an account is something the server knows and the reader should not have
 * to. Choosing wrong was not a wrong guess, it was a refusal - Sign in with a
 * new address answered "No boks account exists for this email yet", which is
 * what https://github.com/IvanCherep/boks/issues/6 came in as "it does not
 * send". Now the address is entered once and an account is made if there is
 * none.
 */
type SentMagicLink = {
  email: string;
};

/**
 * Keeps the field to what a nickname may contain, while it is being typed.
 *
 * It must not tidy the end of the string: stripping a trailing underscore on
 * every keystroke makes an underscore impossible to type at all, because
 * `ivan_` is trimmed back to `ivan` before the next letter arrives. Leading
 * characters are different - a nickname has to start with a letter, and
 * dropping what cannot be first is what lets someone paste `@ivan` or `9ivan`
 * and carry on.
 */
function normalizeHandleInput(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, maxHandleLength);
}

type UserAuthPanelProps = {
  open: boolean;
  surface?: "reader" | "author";
  intent?: "general" | "like" | "comment" | "follow";
  reason: "manual" | "notice" | "required";
  notice?: string;
  guestReadCount: number;
  currentUser: BoksUserContext | null;
  onClose: () => void;
  onOpenReadBoks: (storyId: string, openComments?: boolean) => void;
  onUserChanged: (user: BoksUserContext | null) => void;
  /** The caller returns to an open surface after a code is verified in this tab. */
  onEmailCodeVerified?: () => void;
  /** Saved reading languages, for the reader to rebuild its feed with. */
  onReadingLanguagesChanged?: (languages: readonly string[]) => void;
  /** So the Follow control in the reader stays in step with this list. */
  onFollowsChanged?: (authorUserIds: string[]) => void;
  onOpenFeed?: () => void;
  onOpenSeries?: () => void;
  initialSection?: "home" | "typography" | "languages" | "feedback";
};

export function UserAuthPanel({
  open,
  surface = "reader",
  intent = "general",
  reason,
  notice = "",
  guestReadCount,
  currentUser,
  onClose,
  onOpenReadBoks,
  onUserChanged,
  onEmailCodeVerified,
  onReadingLanguagesChanged,
  onFollowsChanged,
  onOpenFeed,
  onOpenSeries,
  initialSection,
}: UserAuthPanelProps) {
  const { preferences, t } = useReaderPreferences();
  const activityWords = useMessages(activityMessages);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"feedback" | undefined>();
  const panelRef = useRef<HTMLElement>(null);
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [library, setLibrary] = useState<ReaderLibraryItem[]>([]);
  const [follows, setFollows] = useState<FollowedAuthor[]>([]);
  const [unfollowing, setUnfollowing] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  /**
   * Whose stored nickname the field currently shows. Held so a context refresh
   * cannot reseed the field over a draft; reset when the panel closes, so
   * reopening shows what is actually saved rather than an abandoned edit.
   */
  const seededHandleFor = useRef<string | null>(null);
  const [readingLanguages, setReadingLanguages] = useState<string[]>(() => effectiveReadingLanguages(undefined));

  /**
   * Fills the settings fields from an account, once per account.
   *
   * One function because there are two paths in - the prop and the panel's own
   * refresh - and seeding from only one of them left the language pills
   * showing "off" while the feed was filtering on the browser's languages. A
   * control that disagrees with what it controls is worse than no control.
   */
  const seedSettingsFor = useCallback((context: BoksUserContext | null) => {
    if (context?.userId === seededHandleFor.current) return;
    seededHandleFor.current = context?.userId ?? null;
    setHandle(context?.handle || "");
    setReadingLanguages(effectiveReadingLanguages(context?.readingLanguages));
  }, []);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryView, setLibraryView] = useState<ReaderLibraryView>("read");
  const [status, setStatus] = useState("");
  const [sentMagicLink, setSentMagicLink] = useState<SentMagicLink | null>(null);
  /** The code from that same email, for the contexts where the link cannot land. */
  const [emailCode, setEmailCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState("");
  const [codeRecovery, setCodeRecovery] = useState(false);
  const [authRequestFailed, setAuthRequestFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const visibleLibrary = useMemo(() => {
    return selectReaderLibraryItems(library, libraryView, libraryQuery);
  }, [library, libraryQuery, libraryView]);
  const libraryCounts = useMemo(() => ({
    read: selectReaderLibraryItems(library, "read").length,
    liked: selectReaderLibraryItems(library, "liked").length,
    commented: selectReaderLibraryItems(library, "commented").length,
  }), [library]);

  /**
   * Unfollowing from the list.
   *
   * Optimistic, because the row disappearing is the only confirmation there is
   * and a round trip makes the tap feel broken. Restored if the write fails.
   */
  async function unfollowAuthor(authorUserId: string) {
    const previous = follows;
    const accounts = (list: FollowedAuthor[]) => list.filter((author) => !author.pageId).map((author) => author.authorUserId);
    const followed = follows.find((author) => author.authorUserId === authorUserId);
    setUnfollowing(authorUserId);
    const next = follows.filter((author) => author.authorUserId !== authorUserId);
    setFollows(next);
    onFollowsChanged?.(accounts(next));

    try {
      if (followed?.pageId) await setAuthorPageFollow(followed.pageId, false);
      else await setAuthorFollow(authorUserId, false);
    } catch {
      setFollows(previous);
      onFollowsChanged?.(accounts(previous));
    } finally {
      setUnfollowing(null);
    }
  }

  const refreshUser = useCallback(async (loadActivity = true) => {
    const context = (await completePendingBoksMagicLinkProfile(currentBoksTermsVersion)) ?? (await loadBoksUserContext());
    setUser(context);
    seedSettingsFor(context);

    if (!loadActivity) return context;

    if (context && !context.isAnonymous) {
      const [items, followed, pages] = await Promise.all([
        loadReaderLibrary(120, context.userId),
        loadFollowedAuthors(),
        loadFollowedPages().catch(() => []),
      ]);
      setLibrary(items);
      // Accounts and the classics' editorial pages, newest follow first.
      setFollows([
        ...followed,
        ...pages.map((page) => ({
          authorUserId: `page:${page.pageId}`,
          authorName: page.authorName,
          authorHandle: page.authorHandle,
          followedAt: page.followedAt,
          published: page.published,
          pageId: page.pageId,
          photoVersion: page.photoVersion,
        })),
      ].sort((a, b) => String(b.followedAt).localeCompare(String(a.followedAt))));
    } else {
      setLibrary([]);
      setFollows([]);
    }
    return context;
  }, [seedSettingsFor]);

  useEffect(() => {
    if (open) return;
    seededHandleFor.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setStatus("");
      setSentMagicLink(null);
      setAuthRequestFailed(false);
      setCodeRecovery(false);
      setSettingsSection(undefined);
      setShowAuth(reason !== "manual" || intent !== "general" || surface === "author");
      setShowSettings(Boolean(initialSection));
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, reason, intent, surface, initialSection]);

  useEffect(() => {
    if (!open || !notice) return;
    const handle = window.setTimeout(() => setStatus(notice), 0);
    return () => window.clearTimeout(handle);
  }, [notice, open]);

  /**
   * The parent hands down a fresh context object whenever anything refreshes
   * it - a like, a feed reload, the auth listener firing on tab focus. Seeding
   * the nickname field from every one of those wiped whatever was half-typed,
   * which is why a new nickname could not be saved: the draft was replaced by
   * the stored handle before Save was ever pressed. The field is seeded when
   * the panel opens and when the account actually changes to a different
   * person, and is left alone after that.
   */
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setUser(currentUser);
      if (currentUser && !currentUser.isAnonymous) seedSettingsFor(currentUser);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, currentUser, seedSettingsFor]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setAccountLoading(true);
      refreshUser()
        .catch((error) => setStatus(readableBoksError(error, failure().loadAccount)))
        .finally(() => setAccountLoading(false));
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, refreshUser]);

  function friendlyAuthError(error: unknown) {
    if (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message)) {
      return t("Check your connection, then try again.", "Проверьте соединение и попробуйте ещё раз.");
    }
    return explainBoksMagicLinkError(error, { flow: "signup" });
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setStatus(t("Enter your email.", "Введите email."));
      return;
    }

    const remaining = magicLinkCooldownRemainingMs(email);
    if (remaining > 0) {
      // The button is disabled while waiting, so reaching here means a second
      // tab or a stale render. Say the number rather than fail silently.
      setStatus(failure().cooldown(Math.ceil(remaining / 1000)));
      return;
    }

    setBusy(true);
    setStatus("");
    setAuthRequestFailed(false);
    try {
      const cleanEmail = email.trim().toLowerCase();
      await requestBoksMagicLink({
        email: cleanEmail,
        handle,
        // Always. Whether this address already has an account is the server's
        // to know; a reader who types theirs is asking to get in either way.
        acceptedTermsVersion: currentBoksTermsVersion,
        shouldCreateUser: true,
        // Back to where the reader asked from: an author who signs up from
        // /author to submit a piece used to land on the reader instead.
        redirectPath: surface === "author" ? "/author" : "/",
      });
      recordMagicLinkSent(cleanEmail);
      // The step between "asked to sign up" and "has an account": the form is
      // only ever shown to someone without one, so every request is a guest's.
      // A request that never becomes an account is the email not arriving, or
      // not being opened - which is a different fix from the prompt itself.
      recordJourneyEvent(
        { event: "signup_request", reason: signupReason({ reason, intent }) },
        { visitorId: getBrowserId("boks-reader") }
      );
      setEmail(cleanEmail);
      setSentMagicLink({ email: cleanEmail });
      setCodeRecovery(false);
      setStatus("");
    } catch (error) {
      setStatus(friendlyAuthError(error));
      setAuthRequestFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMagicLink();
  }

  function editEmail() {
    setSentMagicLink(null);
    setCodeRecovery(false);
    setAuthRequestFailed(false);
    setStatus("");
    setEmailCode("");
    setCodeError("");
    window.setTimeout(() => document.getElementById(emailInputId)?.focus(), 0);
  }

  /**
   * The code from the email, typed here rather than followed there.
   *
   * Verifying creates the session in this browser, which is the whole point:
   * the link creates it wherever the mail app decided to open it. Everything
   * after that is the path the link already takes - `refreshUser` finishes the
   * account off the pending sign-up draft.
   */
  async function submitEmailCode(event: React.FormEvent) {
    event.preventDefault();
    if (!sentMagicLink || codeBusy) return;

    setCodeBusy(true);
    setCodeError("");
    try {
      await verifyBoksEmailCode({ email: sentMagicLink.email, code: emailCode });
      // A reader returning to a conversation needs the account, not its library.
      const context = await refreshUser(!onEmailCodeVerified);
      onUserChanged(context);
      setSentMagicLink(null);
      setEmailCode("");
      if (context && !context.isAnonymous && !context.bannedAt) onEmailCodeVerified?.();
    } catch (error) {
      setCodeError(explainBoksEmailCodeError(error));
    } finally {
      setCodeBusy(false);
    }
  }

  /**
   * Saved immediately rather than behind the Save button: it is one tap, it
   * changes what the reader sees next, and a language choice waiting on a
   * second confirmation reads as not having worked.
   */
  async function saveLanguages(next: readonly string[]) {
    const cleaned = normalizeReadingLanguages(next);
    // At least one. An empty choice was meant as "no filter", but an empty
    // stored list reads as "never chose" and fell back to the browser's
    // languages, so the pills and the feed disagreed after a reload.
    if (!cleaned.length) return;
    const previous = readingLanguages;
    setReadingLanguages(cleaned);
    rememberReadingLanguages(cleaned);
    if (!user || user.isAnonymous) {
      onReadingLanguagesChanged?.(cleaned);
      setStatus(t("Reading languages saved on this device.", "Языки чтения сохранены на этом устройстве."));
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      await setMyReadingLanguages(cleaned);
      const refreshed = await loadBoksUserContext();
      setUser(refreshed);
      onUserChanged(refreshed);
      onReadingLanguagesChanged?.(cleaned);
      setStatus(t(`Reading in ${cleaned.map((l) => readingLanguageNames[l as "en" | "ru"]).join(" and ")}.`, "Языки чтения сохранены."));
    } catch (error) {
      // A failed save must not leave the pill showing a choice that was not kept.
      setReadingLanguages(previous);
      rememberReadingLanguages(previous);
      setStatus(readableBoksError(error, failure().changeLanguages));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    // Refused here as well as in the database, so the reader is told what is
    // wrong without waiting for a round trip - with the same sentence either
    // way, so the two cannot appear to disagree.
    const problem = describeBoksHandleProblem(handle);
    if (problem) {
      setStatus(problem);
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const next = await updateBoksProfile({ handle });
      setUser(next);
      onUserChanged(next);
      setStatus(t("Settings saved.", "Настройки сохранены."));
    } catch (error) {
      setStatus(readableBoksError(error, failure().saveSettings));
    } finally {
      setBusy(false);
    }
  }

  function openReadBoks(storyId: string, openComments = false) {
    onOpenReadBoks(storyId, openComments);
    onClose();
  }

  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");

  async function deleteAccount() {
    setBusy(true);
    setDeleteError("");
    try {
      await deleteMyBoksAccount(deleteConfirmation);
      // The account is gone on the server; clear what this device holds.
      await signOutBoksUser().catch(() => undefined);
      clearLocalReaderState();
      window.location.reload();
    } catch (error) {
      setDeleteError(readableBoksError(error, failure().deleteAccount));
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setStatus("");
    try {
      await signOutBoksUser();
      clearLocalReaderState();
      // A fresh page, rather than patching this one: the reader holds the
      // account's feed, likes, reading profile and session in memory, and
      // after an in-place sign-out the next swipe wrote the old profile back
      // to this device and ranked the next feed with it.
      window.location.reload();
    } catch (error) {
      setStatus(readableBoksError(error, failure().signOut));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Escape closes the panel, exactly when the cross is offered. A panel that
   * asks for an account before reading can go on has no cross, and Escape
   * does not get round it either. Listened to on the window in the capture
   * phase, so it works wherever focus is - the panel opens from a tap and
   * does not take focus - and the reader underneath never sees the key.
   */
  useEffect(() => {
    if (!open) return;
    const closable = reason !== "required" || Boolean(user && !user.isAnonymous);
    if (!closable) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, reason, user, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>(showAuth ? "input" : "button, input")?.focus(), 0);
    return () => { window.clearTimeout(timer); previous?.focus(); };
  }, [open, showAuth, showSettings]);

  // Ticks down for the address being asked about, and survives a reload,
  // because the server's limit does too.
  const cooldownSeconds = useMagicLinkCooldown(sentMagicLink?.email ?? email);
  const waiting = cooldownSeconds > 0;

  if (!open) return null;

  const accountUser = user && !user.isAnonymous ? user : null;
  // Save is offered only when there is something to save, so the button never
  // asks for a round trip that would change nothing.
  // How much the catalogue holds per language, so a filter that would empty the
  // feed says so before the reader taps it rather than after.
  const signedIn = Boolean(accountUser);
  const required = reason === "required";
  const showingAccount = Boolean(accountUser);
  const remainingGuestBoks = Math.max(0, anonymousReadLimits.requiredSignup - guestReadCount);
  const noticeText = required
    ? surface === "author" ? t("Your email, to submit boks for review.", "Войдите, чтобы отправлять боки на проверку.")
      : t("You have read 15 boks without an account. Sign in to keep reading for free.", "Вы прочитали 15 боков без аккаунта. Войдите, чтобы продолжить читать бесплатно.")
    : reason === "notice" ? t(`You can read ${remainingGuestBoks} more boks without an account. An account keeps your reading history.`, `Без аккаунта можно прочитать ещё ${remainingGuestBoks} ${plural("ru", remainingGuestBoks, { one: "бок", few: "бока", many: "боков", other: "бока" })}. Аккаунт сохраняет историю чтения.`)
    : intent === "like" ? t("Sign in to like this bok.", "Войдите, чтобы поставить лайк.")
    : intent === "comment" ? t("Sign in to comment with your @handle.", "Войдите, чтобы комментировать под своим @именем.")
    : intent === "follow" ? t("Sign in to follow this account.", "Войдите, чтобы подписаться.")
    : surface === "author" ? t("Sign in with your email: we will send a code, and your author cabinet opens.", "Войдите по своей почте: мы пришлём код, и откроется кабинет автора.")
    : t("Sign in to keep your reading history, like boks and comment.", "Войдите, чтобы сохранять историю чтения, ставить лайки и общаться.");
  const authVisible = showAuth || reason !== "manual" || intent !== "general" || surface === "author";
  const title = libraryView === "liked" ? t("Liked boks.", "Понравившиеся боки.") : libraryView === "commented" ? t("My comments.", "Мои комментарии.") : t("Your activity.", "Ваша активность.");
  const emailInputId = "boks-email";
  const emailCodeInputId = "boks-email-code";
  const settingsVisible = !showingAccount && !authVisible && !accountLoading || showingAccount && showSettings;
  const gate = required && surface === "reader" && !showingAccount && !sentMagicLink;
  const dateLabel = (value: string | null) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return t("Today", "Сегодня");
    today.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return t("Yesterday", "Вчера");
    return date.toLocaleDateString(preferences.locale, { day: "numeric", month: "short" });
  };
  const terms = <p className="auth-terms-line">{t("By continuing you accept the", "Продолжая, вы принимаете")} <a href="/terms" target="_blank" rel="noreferrer">{t("Terms", "Условия")}</a>{t(", including the author content licence, and the", ", включая лицензию на авторские тексты, и")} <a href="/privacy" target="_blank" rel="noreferrer">{t("Privacy policy", "Политику конфиденциальности")}</a>.</p>;

  return (
    <div className="auth-overlay social-overlay" role="dialog" aria-modal="true" aria-label={t("boks account", "Аккаунт boks")}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const elements = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea, a[href], summary, select');
        const visible = Array.from(elements ?? []).filter((element) => element.getClientRects().length > 0);
        const first = visible[0], last = visible[visible.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
      <section className={`auth-panel social-page you-page${!showingAccount && authVisible ? " auth-v44-page" : ""}${gate ? " auth-v44-gate" : ""}`} ref={panelRef}>
        {settingsVisible ? <>
          <YouSettings initialSection={settingsSection ?? initialSection} user={accountUser} busy={busy} handle={handle} setHandle={value => setHandle(normalizeHandleInput(value))} languages={readingLanguages} saveLanguages={saveLanguages} saveHandle={saveSettings} follows={follows} unfollowing={unfollowing} unfollow={unfollowAuthor} deleteConfirmation={deleteConfirmation} setDeleteConfirmation={setDeleteConfirmation} deleteError={deleteError} deleteAccount={deleteAccount} signOut={signOut} onSignIn={() => setShowAuth(true)} onActivity={() => setShowSettings(false)} onClose={onClose} onFeed={surface === "reader" ? onOpenFeed : undefined} onSeries={surface === "reader" ? onOpenSeries : undefined} />
          {status && <p className="social-status" role="status">{status}</p>}
        </> : <>
          {gate ? <header className="auth-wall-mark">boks<span>{t("ALWAYS FREE", "ВСЕГДА БЕСПЛАТНО")}</span></header> : <header className="social-page-header">
            {(!required || signedIn) ? <button className="social-icon" type="button" onClick={() => sentMagicLink ? editEmail() : showAuth && reason === "manual" && intent === "general" ? setShowAuth(false) : onClose()} aria-label={t("Back", "Назад")}><ArrowLeft /></button> : <span />}
            <span>{showingAccount && !accountUser?.bannedAt ? t("Your activity", "Ваша активность") : sentMagicLink ? t("Check your email", "Проверьте почту") : t("Your account", "Ваш аккаунт")}</span>
            {showingAccount ? <button className="social-icon" type="button" onClick={() => { setSettingsSection(undefined); setShowSettings(true); }} aria-label={t("Settings", "Настройки")}><Settings2 /></button> : <span />}
          </header>}
          {accountLoading && !user ? <p className="social-status" role="status">{t("Checking account…", "Проверяем аккаунт…")}</p> : showingAccount && accountUser?.bannedAt ? <>
            <div className="you-suspension-icon" aria-hidden="true"><Pause /></div>
            <h1 className="social-display">{t("Account", "Аккаунт")}<br />{t("restricted.", "ограничен.")}</h1>
            <p className="social-muted">{t("Likes, comments, follows, reports and publishing are temporarily unavailable. You can continue reading.", "Лайки, комментарии, подписки, жалобы и публикация временно недоступны. Вы можете продолжать читать.")}</p>
            {accountUser.banReason && <div className="you-deletion-note"><strong>{t("Reason from the boks team", "Причина от команды boks")}</strong><p>{accountUser.banReason}</p></div>}
            <Button className="you-wide-button" onClick={onClose}>{t("Back to my bok", "Вернуться к боку")}</Button>
            <Button className="you-wide-button" variant="outline" onClick={() => { setSettingsSection("feedback"); setShowSettings(true); }}>{t("Ask about this decision", "Узнать об этом решении")}</Button>
            <p className="social-note">{t("Only you and admins see this notice. Your reading place is kept.", "Это уведомление видите только вы и администраторы. Место чтения сохранено.")}</p>
          </> : showingAccount ? <>
            <span className="social-eyebrow" translate="no">@{accountUser?.handle}</span>
            <h1 className="social-display">{title}</h1>
            <div className="you-activity">
              <label className="relative block" htmlFor="boks-library-search"><span className="sr-only">{t("Search your boks", "Поиск среди ваших боков")}</span><Search className="pointer-events-none absolute top-1/2 -translate-y-1/2" /><Input id="boks-library-search" name="search-read-boks" type="search" autoComplete="off" placeholder={t("A title, an author", "Название или автор")} value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} /></label>
              <div className="library-tabs" role="tablist" aria-label={t("Your activity", "Ваша активность")}>
                {([["read", t("Read", "Прочитано")], ["liked", t("Liked", "Нравится")], ["commented", t("Comments", "Комментарии")]] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={libraryView === value} aria-controls="boks-library-results" className={`library-tab${libraryView === value ? " is-active" : ""}`} onClick={() => setLibraryView(value)}>{label}<span className="sr-only"> · {libraryCounts[value]}</span></button>)}
              </div>
              <div id="boks-library-results" role="tabpanel" className="activity-list">
                {visibleLibrary.length ? visibleLibrary.map((item, index) => {
                  const artwork = getBokArtwork({ id: item.storyId, title: item.title, authorName: item.authorName });
                  const palette = bokCoverPalette(item.storyId);
                  const activityDate = dateLabel(readerLibraryActivityAt(item, libraryView));
                  const previousDate = index > 0 ? dateLabel(readerLibraryActivityAt(visibleLibrary[index - 1], libraryView)) : "";
                  const activityTime = readerLibraryActivityTime(readerLibraryActivityAt(item, libraryView), preferences.locale);
                  if (libraryView === "commented") return <button key={item.storyId} type="button" className="activity-comment" onClick={() => openReadBoks(item.storyId, true)}>
                    <span className="activity-date">{activityDate} · <span translate="no">{item.title}</span></span>
                    {item.commentPreview && <blockquote translate="no">“{item.commentPreview}”</blockquote>}
                    <span className="activity-comment-foot"><MessageCircle />{t("Your comment", "Ваш комментарий")}<span>{t("Open conversation →", "Открыть обсуждение →")}</span></span>
                  </button>;
                  return <div key={`${item.storyId}-${readerLibraryActivityAt(item, libraryView)}`}>
                    {activityDate !== previousDate && <p className="activity-date">{activityDate}</p>}
                    <button type="button" className="library-item activity-bok" onClick={() => openReadBoks(item.storyId)}>
                      <span className="activity-art" aria-hidden="true" style={{ backgroundColor: palette.paper, color: palette.ink }}>{artwork ? <img src={artwork} alt="" style={{ objectPosition: bokArtworkFocus(item.storyId) }} /> : <i>b.</i>}</span>
                      <span className="activity-bok-copy"><strong translate="no">{item.title}</strong><small translate="no">{item.authorName || atHandle(item.authorHandle)}</small><em>{libraryView === "liked" ? activityTime ? activityWords.likedAt(activityTime) : t("Liked", "Нравится") : activityTime ? activityWords.readAt(activityTime) : t("Read", "Прочитано")}</em></span><ChevronRight />
                    </button>
                  </div>;
                }) : <p className="social-note">{libraryQuery.trim() ? t("No matching boks.", "Ничего не найдено.") : libraryView === "read" ? t("Boks you read will appear here.", "Здесь появятся прочитанные боки.") : libraryView === "liked" ? t("Boks you like will appear here.", "Здесь появятся понравившиеся боки.") : t("Boks you comment on will appear here.", "Здесь появятся боки с вашими комментариями.")}</p>}
              </div>
              <p className="social-note">{t("Your latest 120 boks. Search titles and bylines in this list.", "Последние 120 боков. Поиск по названиям и авторам в этом списке.")}</p>
            </div>
          </> : sentMagicLink ? <>
            {codeRecovery ? <div className="auth-recovery-art" aria-hidden="true">↶</div> : <div className="auth-mail-art" aria-hidden="true"><Mail /><span>6</span></div>}
            <h1 className="social-display">{codeRecovery ? t("New code.", "Новый код.") : t("Enter code.", "Введите код.")}</h1>
            <p className="social-muted">{codeRecovery ? t("Request a new one. We’ll bring you back to the same bok.", "Запросите новый код. Вы вернётесь к тому же боку.") : t("Enter the code sent to", "Введите код, отправленный на")}<br /><strong>{sentMagicLink.email}</strong></p>
            {codeRecovery ? <Button className="you-wide-button" onClick={() => void sendMagicLink()} disabled={busy || waiting}>{waiting ? t(`Send again in ${formatCooldown(cooldownSeconds)}`, `Повторить через ${formatCooldown(cooldownSeconds)}`) : busy ? t("Sending…", "Отправляем…") : t("Send new code", "Новый код")}</Button> : <form onSubmit={submitEmailCode}>
              <label className="auth-code-field"><span className="sr-only">{t("Six-digit email code", "Шестизначный код")}</span><input id={emailCodeInputId} value={emailCode} onChange={event => { setEmailCode(normalizeBoksEmailCode(event.target.value)); setCodeError(""); }} inputMode="numeric" autoComplete="one-time-code" maxLength={boksEmailCodeLength} placeholder="– – – – – –" aria-label={t("Six-digit email code", "Шестизначный код")} autoFocus /></label>
              {codeError && <p className="auth-error-message" role="alert">{codeError}</p>}
              <Button className="you-wide-button" type="submit" disabled={codeBusy || emailCode.length < boksEmailCodeLength}>{codeBusy ? t("Signing in…", "Входим…") : t("Sign in", "Войти")}</Button>
            </form>}
            <div className="auth-links"><button type="button" onClick={editEmail}>{t("Use another email", "Другой email")}</button><button type="button" onClick={() => { setCodeRecovery(!codeRecovery); setCodeError(""); }}>{codeRecovery ? t("Enter code", "Ввести код") : t("Code expired?", "Код истёк?")}</button></div>
            {!codeRecovery && <button className="auth-resend" type="button" onClick={() => void sendMagicLink()} disabled={busy || waiting}>{waiting ? t(`Send again in ${formatCooldown(cooldownSeconds)}`, `Повторить через ${formatCooldown(cooldownSeconds)}`) : t("Send again", "Отправить ещё раз")}</button>}
            <p className="social-note">{t("The email also has a sign-in link. Check spam if it hasn’t arrived.", "В письме также есть ссылка для входа. Если письмо не пришло, проверьте спам.")}</p>
          </> : <>
            {gate ? <div className="auth-fifteen" aria-hidden="true">15<span>{t("boks read.", "боков прочитано.")}</span></div> : authRequestFailed ? <div className="auth-offline-art" aria-hidden="true"><span>·</span><i>—</i><span>·</span></div> : <div className="auth-signin-art" aria-hidden="true"><span>b</span><i>↗</i></div>}
            <h1 className="social-display">{authRequestFailed ? t("Couldn’t send the code.", "Не удалось отправить код.") : gate ? t("Sign in to continue.", "Войдите, чтобы продолжить.") : t("Sign in.", "Войти.")}</h1>
            <p className="social-muted">{gate || intent !== "general" || surface === "author" ? noticeText : authRequestFailed ? t("We couldn’t connect to send it. Your email is still here.", "Не удалось подключиться. Ваш email сохранён здесь.") : t("Enter your email to sign in or create an account. We’ll send you a code.", "Введите email для входа или создания аккаунта. Мы отправим код.")}</p>
            <form className="auth-email-form" autoComplete="on" onSubmit={submitAuth}>
              <label className="you-field" htmlFor={emailInputId}>{t("Email", "Электронная почта")}<Input id={emailInputId} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required placeholder="you@example.com" value={email} onChange={event => { setEmail(event.target.value); setStatus(""); }} /></label>
              {authRequestFailed && status && <p className="auth-error-message" role="alert">{status}</p>}
              <Button className="you-wide-button" type="submit" disabled={busy || waiting}>{busy ? t("Sending…", "Отправляем…") : waiting ? t(`Send again in ${formatCooldown(cooldownSeconds)}`, `Повторить через ${formatCooldown(cooldownSeconds)}`) : authRequestFailed ? t("Try again", "Попробовать ещё раз") : t("Continue", "Продолжить")}</Button>
              {terms}
            </form>
          </>}
          {!showingAccount && <>{!required && <button className="auth-back" type="button" onClick={onClose}>{t("Back to reading", "Вернуться к чтению")}</button>}<p className="social-note auth-support"><a href={supportMailto}>{t("Contact support", "Связаться с поддержкой")}</a> · {supportEmail}</p></>}
          {status && !authRequestFailed && <p className="social-status" role="status" aria-live="polite">{status}</p>}
          {surface === "reader" && showingAccount && !accountUser?.bannedAt && onOpenFeed && onOpenSeries && <ReaderTabs className="reader-tabs--pinned you-tabs" active="you" seriesIsNew={false} onFeed={onOpenFeed} onSeries={onOpenSeries} onYou={() => panelRef.current?.scrollTo({ top: 0, behavior: "smooth" })} />}
        </>}
      </section>
    </div>
  );
}
