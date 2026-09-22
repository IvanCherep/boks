"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, Heart, LogOut, Mail, MessageCircle, PenLine, Search, Shield, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readableBoksError } from "@/lib/boks/errors";
import {
  effectiveReadingLanguages,
  normalizeReadingLanguages,
  readingLanguageNames,
  rememberReadingLanguages,
  supportedReadingLanguages,
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
  isValidBoksHandle,
  maxHandleLength,
  minHandleLength,
} from "@/lib/boks/contracts";
import { anonymousReadLimits } from "@/components/boks/reader-behavior";
import { ThemeSetting } from "@/components/boks/theme-setting";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import { FeedbackForm } from "@/components/boks/feedback-form";
import { readFeedbackState } from "@/components/boks/feedback";
import { getBrowserId } from "@/components/boks/reader-behavior";
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
  selectReaderLibraryItems,
  type ReaderLibraryView,
} from "@/components/boks/reader-library";
import {
  completePendingBoksMagicLinkProfile,
  explainBoksMagicLinkError,
  requestBoksMagicLink,
  signOutBoksUser,
} from "@/lib/boks/supabase-client";

// boks routes are separate surfaces with separate data loads, so they are
// linked with plain anchors. vinext's `next/link` client navigation throws
// `TypeError: e is not a function` in this build and silently does nothing,
// which is how "Write a bok" and "Admin" ended up dead. A full navigation is
// also the correct behavior here: moving between reader, author and admin
// should reset the surface.

export const currentBoksTermsVersion = "2026-09-11";

export type AuthPanelMode = "signin" | "signup";


type SentMagicLink = {
  email: string;
  mode: AuthPanelMode;
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
  initialMode: AuthPanelMode;
  notice?: string;
  guestReadCount: number;
  currentUser: BoksUserContext | null;
  onClose: () => void;
  onOpenReadBoks: (storyId: string) => void;
  onUserChanged: (user: BoksUserContext | null) => void;
  /** Saved reading languages, for the reader to rebuild its feed with. */
  onReadingLanguagesChanged?: (languages: readonly string[]) => void;
  /** So the Follow control in the reader stays in step with this list. */
  onFollowsChanged?: (authorUserIds: string[]) => void;
};

/**
 * The way in to the feedback box from Settings.
 *
 * A disclosure rather than a separate screen: the box is two sentences and a
 * text field, and a reader who came here to say something should not have to
 * navigate to say it. Drawn for guests as well - the server accepts a note
 * without an account on purpose.
 */
function FeedbackDisclosure() {
  return (
    <details className="settings-disclosure">
      <summary>Send feedback</summary>
      <div className="settings-disclosure__body">
        <FeedbackForm surface="settings" boksRead={readFeedbackState().reads} visitorId={getBrowserId("boks-reader")} />
      </div>
    </details>
  );
}

export function UserAuthPanel({
  open,
  surface = "reader",
  intent = "general",
  reason,
  initialMode,
  notice = "",
  guestReadCount,
  currentUser,
  onClose,
  onOpenReadBoks,
  onUserChanged,
  onReadingLanguagesChanged,
  onFollowsChanged,
}: UserAuthPanelProps) {
  const [mode, setMode] = useState<AuthPanelMode>(initialMode);
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
  const [readingLanguages, setReadingLanguages] = useState<string[]>([]);

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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [status, setStatus] = useState("");
  const [sentMagicLink, setSentMagicLink] = useState<SentMagicLink | null>(null);
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
    setUnfollowing(authorUserId);
    const next = follows.filter((author) => author.authorUserId !== authorUserId);
    setFollows(next);
    onFollowsChanged?.(next.map((author) => author.authorUserId));

    try {
      await setAuthorFollow(authorUserId, false);
    } catch {
      setFollows(previous);
      onFollowsChanged?.(previous.map((author) => author.authorUserId));
    } finally {
      setUnfollowing(null);
    }
  }

  const refreshUser = useCallback(async () => {
    const context = (await completePendingBoksMagicLinkProfile(currentBoksTermsVersion)) ?? (await loadBoksUserContext());
    setUser(context);
    seedSettingsFor(context);

    if (context && !context.isAnonymous) {
      const [items, followed] = await Promise.all([loadReaderLibrary(), loadFollowedAuthors()]);
      setLibrary(items);
      setFollows(followed);
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
      setMode(initialMode);
      setStatus("");
      setSentMagicLink(null);
      setTermsAccepted(false);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, initialMode]);

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
        .catch((error) => setStatus(readableBoksError(error, "Could not load account.")))
        .finally(() => setAccountLoading(false));
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, refreshUser]);

  function switchMode(nextMode: AuthPanelMode) {
    setMode(nextMode);
    setStatus("");
    setSentMagicLink(null);
  }

  function friendlyAuthError(error: unknown) {
    return explainBoksMagicLinkError(error, { flow: mode });
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setStatus("Enter your email.");
      return;
    }

    if (mode === "signup" && !termsAccepted) {
      setStatus("Please accept the Terms to create an account.");
      return;
    }

    const remaining = magicLinkCooldownRemainingMs(email);
    if (remaining > 0) {
      // The button is disabled while waiting, so reaching here means a second
      // tab or a stale render. Say the number rather than fail silently.
      setStatus(`One link a minute per address. ${Math.ceil(remaining / 1000)} seconds to go.`);
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const cleanEmail = email.trim().toLowerCase();
      await requestBoksMagicLink({
        email: cleanEmail,
        handle,
        acceptedTermsVersion: mode === "signup" ? currentBoksTermsVersion : null,
        shouldCreateUser: mode === "signup",
        // Back to where the reader asked from: an author who signs up from
        // /author to submit a piece used to land on the reader instead.
        redirectPath: surface === "author" ? "/author" : "/",
      });
      recordMagicLinkSent(cleanEmail);
      setEmail(cleanEmail);
      setSentMagicLink({ email: cleanEmail, mode });
      setStatus("");
    } catch (error) {
      setStatus(friendlyAuthError(error));
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
    setStatus("");
    window.setTimeout(() => document.getElementById(emailInputId)?.focus(), 0);
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
    setBusy(true);
    setStatus("");
    try {
      await setMyReadingLanguages(cleaned);
      const refreshed = await loadBoksUserContext();
      setUser(refreshed);
      onUserChanged(refreshed);
      onReadingLanguagesChanged?.(cleaned);
      setStatus(`Reading in ${cleaned.map((l) => readingLanguageNames[l as "en" | "ru"]).join(" and ")}.`);
    } catch (error) {
      // A failed save must not leave the pill showing a choice that was not kept.
      setReadingLanguages(previous);
      rememberReadingLanguages(previous);
      setStatus(readableBoksError(error, "Could not change your languages."));
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
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(readableBoksError(error, "Could not save settings."));
    } finally {
      setBusy(false);
    }
  }

  function openReadBoks(storyId: string) {
    onOpenReadBoks(storyId);
    onClose();
  }

  const [deletingAccount, setDeletingAccount] = useState(false);
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
      setDeleteError(readableBoksError(error, "Could not delete the account."));
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
      setStatus(readableBoksError(error, "Could not sign out."));
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

  // Ticks down for the address being asked about, and survives a reload,
  // because the server's limit does too.
  const cooldownSeconds = useMagicLinkCooldown(sentMagicLink?.email ?? email);
  const waiting = cooldownSeconds > 0;

  if (!open) return null;

  const accountUser = user && !user.isAnonymous ? user : null;
  // Save is offered only when there is something to save, so the button never
  // asks for a round trip that would change nothing.
  const handleChanged = handle !== (accountUser?.handle ?? "");
  // How much the catalogue holds per language, so a filter that would empty the
  // feed says so before the reader taps it rather than after.
  const languageCoverage = user?.languageCoverage ?? {};
  const signedIn = Boolean(accountUser);
  const required = reason === "required";
  const showingAccount = Boolean(accountUser);
  const remainingGuestBoks = Math.max(0, anonymousReadLimits.requiredSignup - guestReadCount);
  const noticeText = required
    ? surface === "author"
      ? "Sign up or sign in to submit boks for review and track decisions."
      : "You have read 15 boks without an account. Reading stays free: sign up or sign in to keep going, with your history and recommendations saved from here on."
    : reason === "notice"
      ? `You can read ${remainingGuestBoks} more boks without an account. Reading stays free; an account saves your history and helps personalize your feed.`
      : intent === "like"
        ? "Create a free account. Likes help boks tune recommendations to your taste and keep your reading history connected to you."
        : intent === "comment"
          ? "Create a free account. It keeps comments connected to your @nickname and helps boks understand what stories work for you."
        : intent === "follow"
          ? "Create a free account to follow authors. Following keeps their new boks coming to you and tells the feed whose work you want more of."
      : surface === "author"
        ? "Create an account to submit boks for review."
        : "Create a free account to save your reading history and improve recommendations.";
  const title = showingAccount
    ? "Settings"
    : mode === "signin"
      ? "Email sign in"
      : "Create your boks account";
  const emailInputId = mode === "signin" ? "boks-signin-email" : "boks-signup-email";

  return (
    <div
      className="auth-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="boks account"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <section className="auth-panel">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="brand-word">boks</p>
            <h1 className="mt-4 text-2xl font-semibold tracking-normal text-[var(--foreground)]">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {showingAccount ? "Your account, reading history, and boks preferences." : noticeText}
            </p>
          </div>
          {(!required || signedIn) && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close account panel">
              <X className="size-4" />
            </Button>
          )}
        </header>

        {accountLoading && !user ? (
          <div className="mt-6 rounded-lg bg-[var(--muted)] p-4 text-sm text-[var(--muted-foreground)]">
            Checking account...
          </div>
        ) : showingAccount ? (
          <div className="mt-6 grid gap-5">
            {accountUser?.bannedAt && (
              <div className="rounded-lg border border-[var(--destructive)]/35 bg-[var(--destructive)]/5 p-4" role="status">
                <p className="text-sm font-semibold">This account is suspended</p>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                  You can keep reading, but reactions, comments, follows, reports, and publishing are unavailable.
                  {accountUser.banReason ? ` Reason: ${accountUser.banReason}` : ""}
                </p>
              </div>
            )}
            <div className="rounded-lg border border-[var(--border)] bg-[var(--reader)] p-4">
              <p className="text-sm text-[var(--muted-foreground)]">Signed in on this device as</p>
              <p className="mt-1 truncate text-lg font-semibold">@{accountUser?.handle || "reader"}</p>
              <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">{accountUser?.email}</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {accountUser?.views} read boks · {accountUser?.likes} liked
              </p>

              {/* Reachable without scrolling past settings and two lists: on a
                  borrowed phone, leaving is the whole reason the panel is open. */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={signOut} disabled={busy}>
                  <LogOut className="size-4" /> Sign out of this device
                </Button>
                {!accountUser?.bannedAt && (
                  <a className="surface-link" href="/author">
                    <PenLine className="size-4" /> Write a bok
                  </a>
                )}
                {accountUser?.role === "admin" && (
                  <a className="surface-link" href="/admin">
                    <Shield className="size-4" /> Admin
                  </a>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <p className="text-sm font-medium">Languages you read</p>
              <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                boks only recommends what you can read. Started from your browser&apos;s languages;
                change it whenever you like. Keep at least one.
              </p>
              <div className="flex flex-wrap gap-2">
                {supportedReadingLanguages.map((language) => {
                  const on = readingLanguages.includes(language);
                  const held = languageCoverage[language] ?? 0;
                  return (
                    <button
                      key={language}
                      type="button"
                      className={`report-kind${on ? " report-kind--on" : ""}`}
                      aria-pressed={on}
                      disabled={busy || (on && readingLanguages.length === 1)}
                      title={on && readingLanguages.length === 1 ? "Keep at least one language" : undefined}
                      onClick={() =>
                        void saveLanguages(
                          on
                            ? readingLanguages.filter((entry) => entry !== language)
                            : [...readingLanguages, language]
                        )
                      }
                    >
                      {readingLanguageNames[language]}
                      <span className="ml-1 opacity-70">{held}</span>
                    </button>
                  );
                })}
              </div>
              {readingLanguages.length > 0 &&
                readingLanguages.every((language) => (languageCoverage[language] ?? 0) === 0) && (
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                    There is nothing in {readingLanguages.map((l) => readingLanguageNames[l as "en" | "ru"]).join(" or ")} yet,
                    so your feed will be empty until there is. We would rather say so than quietly
                    show you another language.
                  </p>
                )}
            </div>

            <ThemeSetting />

            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-handle">
                Unique @nickname
                <span className="text-sm font-normal text-[var(--muted-foreground)]">
                  English letters, numbers and underscores. Starts with a letter.
                </span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
                    @
                  </span>
                  {/*
                    Not `name="username"` with `autoComplete="username"`, which
                    is what this was. That is an invitation to the password
                    manager, and it filled the saved sign-in address in:
                    `normalizeHandleInput` then stripped the @ and the dot, so
                    `ivanystal@gmail.com` became the plausible-looking
                    `ivanystalgmailcom`, Save lit up, and one tap would have
                    renamed the account that publishes every boks in the
                    catalogue. A nickname is not a credential and must not be
                    autofilled like one.
                  */}
                  <Input
                    id="boks-handle"
                    name="boks-nickname"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="pl-7"
                    minLength={minHandleLength}
                    maxLength={maxHandleLength}
                    value={handle}
                    aria-invalid={handle.length > 0 && !isValidBoksHandle(handle)}
                    onChange={(event) => setHandle(normalizeHandleInput(event.target.value))}
                  />
                </div>
              </label>
              {/*
                The button names the nickname it will save. A rename is not
                reversible in any way a reader can see - it is the byline on
                everything they have published and the link other people
                share - so the destination belongs on the control, where a
                value the reader did not type cannot be saved without being
                read first.
              */}
              <Button onClick={saveSettings} disabled={busy || !handleChanged}>
                <UserRound className="size-4" />{" "}
                {handleChanged ? `Save @${handle || "…"}` : `Saved as @${handle}`}
              </Button>
            </div>

            <div>
              <h2 className="text-base font-semibold tracking-normal">
                Following{follows.length ? ` · ${follows.length}` : ""}
              </h2>
              <div className="mt-3 grid max-h-[210px] gap-2 overflow-y-auto pr-1">
                {follows.length ? (
                  follows.map((author) => (
                    <div key={author.authorUserId} className="follow-row">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{author.authorName || `@${author.authorHandle}`}</p>
                        <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
                          @{author.authorHandle}
                          {author.published ? ` · ${author.published} bok${author.published === 1 ? "" : "s"}` : ""}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => unfollowAuthor(author.authorUserId)}
                        disabled={unfollowing === author.authorUserId}
                      >
                        {unfollowing === author.authorUserId ? "…" : "Unfollow"}
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Authors you follow will appear here. Their new boks reach you sooner.
                  </p>
                )}
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold tracking-normal">Your boks</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                Open one here, then keep reading from your recommendations.
              </p>
              <div className="library-tabs mt-3" role="tablist" aria-label="Your boks">
                {(
                  [
                    ["read", "Read", BookOpen],
                    ["liked", "Liked", Heart],
                    ["commented", "Comments", MessageCircle],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={libraryView === value}
                    aria-controls="boks-library-results"
                    className={`library-tab${libraryView === value ? " is-active" : ""}`}
                    onClick={() => setLibraryView(value)}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span>{label}</span>
                    <span className="library-tab__count">{libraryCounts[value]}</span>
                  </button>
                ))}
              </div>
              <label className="relative mt-3 block" htmlFor="boks-library-search">
                <span className="sr-only">Search {libraryView} boks</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  id="boks-library-search"
                  name="search-read-boks"
                  type="search"
                  autoComplete="off"
                  placeholder={`Search ${libraryView === "commented" ? "commented" : libraryView} boks`}
                  className="pl-9"
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                />
              </label>
              <div
                id="boks-library-results"
                role="tabpanel"
                className="mt-3 grid max-h-[280px] gap-2 overflow-y-auto pr-1"
              >
                {visibleLibrary.length ? visibleLibrary.map((item) => (
                  <button
                    key={`${item.storyId}-${readerLibraryActivityAt(item, libraryView)}`}
                    type="button"
                    className="library-item"
                    onClick={() => openReadBoks(item.storyId)}
                  >
                    <span className="font-medium">{item.title}</span>
                    <span className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {item.authorName || (item.authorHandle ? `@${item.authorHandle.replace(/^@+/, "")}` : "boks author")} · {item.minutes} min
                    </span>
                  </button>
                )) : (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {libraryQuery.trim()
                      ? `No ${libraryView === "commented" ? "commented" : libraryView} boks match this search.`
                      : libraryView === "read"
                        ? "Boks you read will appear here."
                        : libraryView === "liked"
                          ? "Boks you like will appear here."
                          : "Boks you comment on will appear here."}
                  </p>
                )}
              </div>
            </div>

            {accountUser?.role !== "admin" && (
              <div className="grid gap-2">
                <h2 className="text-base font-semibold tracking-normal">Delete account</h2>
                {!deletingAccount ? (
                  <div>
                    <Button variant="outline" onClick={() => setDeletingAccount(true)} disabled={busy}>
                      Delete my account…
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-2 rounded-lg border border-[var(--destructive)]/35 p-3">
                    <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                      This deletes your account, email, likes, comments, follows and reading history. Boks you
                      published are hidden and no longer carry your name. It cannot be undone.
                    </p>
                    <label className="grid gap-1 text-sm font-medium" htmlFor="boks-delete-confirm">
                      Type @{accountUser?.handle} to confirm
                      <Input
                        id="boks-delete-confirm"
                        autoComplete="off"
                        spellCheck={false}
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                      />
                    </label>
                    {deleteError && (
                      <p className="text-sm text-[var(--destructive)]" role="alert">
                        {deleteError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        onClick={() => void deleteAccount()}
                        disabled={
                          busy ||
                          deleteConfirmation.trim().replace(/^@+/, "").toLowerCase() !==
                            (accountUser?.handle ?? "").toLowerCase()
                        }
                      >
                        Delete my account
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setDeletingAccount(false);
                          setDeleteConfirmation("");
                          setDeleteError("");
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <FeedbackDisclosure />

            <details className="settings-disclosure">
              <summary>About</summary>
              <div className="settings-disclosure__body">
                <p>boks is a focused feed for short literature.</p>
                <p>
                  Something broken, or a question? Write to{" "}
                  <a className="auth-link" href={supportMailto}>{supportEmail}</a>.
                </p>
                <details className="settings-disclosure settings-disclosure--nested">
                  <summary>Open source licenses</summary>
                  <div className="settings-disclosure__body">
                    <p><strong>Source Serif 4</strong></p>
                    <p>
                      Copyright Google Inc. Licensed under the SIL Open Font License 1.1.
                    </p>
                    <a href="/licenses/source-serif-4-OFL.txt" target="_blank" rel="noreferrer">
                      Read the complete license
                    </a>
                    <p className="mt-3"><strong>Software</strong></p>
                    <p>
                      boks is built on open-source software - React, Supabase, Radix, Lucide and others - under the
                      MIT, ISC, BSD and Apache 2.0 licenses.
                    </p>
                    <a href="/licenses/third-party-notices.txt" target="_blank" rel="noreferrer">
                      Every package and its license
                    </a>
                    <p className="mt-3"><strong>Texts</strong></p>
                    <p>
                      The catalogue is literature in the public domain, transcribed by the volunteers of Wikisource.
                    </p>
                    <a href="/terms#catalogue" target="_blank" rel="noreferrer">
                      Where the texts come from
                    </a>
                  </div>
                </details>
              </div>
            </details>

          </div>
        ) : sentMagicLink ? (
          <div className="auth-sent mt-6" role="status" aria-live="polite">
            <div className="auth-sent-icon" aria-hidden="true">
              <CheckCircle2 className="size-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-normal">Check your email</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                We sent a boks link to <strong>{sentMagicLink.email}</strong>. Open it on this device, in
                this browser, to {sentMagicLink.mode === "signup" ? "finish your free account" : "sign in"}.
              </p>
              {/* The common way this fails on a phone: the mail app opens the
                  link in its own browser, where this sign-in was never started. */}
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                If your mail app opens links inside itself, choose &ldquo;Open in browser&rdquo; or copy the link
                here.
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                boks is free. The account keeps your reading history, comments, and recommendations connected to you.
              </p>
              {/* Whoever never gets the email cannot reach anyone from inside
                  the app, which is the one place they are stuck. */}
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                No email after a few minutes? Check spam, then write to{" "}
                <a className="auth-link" href={supportMailto}>{supportEmail}</a>.
              </p>
            </div>
            <div className="mt-5 grid gap-2">
              <Button type="button" variant="outline" onClick={editEmail}>
                Use another email
              </Button>
              <Button type="button" onClick={() => void sendMagicLink()} disabled={busy || waiting}>
                <Mail className="size-4" />
                {waiting ? `Send again in ${formatCooldown(cooldownSeconds)}` : "Send again"}
              </Button>
              {waiting && (
                <p className="text-sm leading-6 text-[var(--muted-foreground)]" role="status" aria-live="polite">
                  One link a minute per address. Asking for a new link makes the
                  older ones stop working, so always open the newest email.
                </p>
              )}
              {!required && (
                <Button type="button" variant="ghost" onClick={onClose}>
                  Continue reading
                </Button>
              )}
            </div>
          </div>
        ) : (
          <form key={mode} className="mt-6 grid gap-4" autoComplete="on" data-auth-mode={mode} onSubmit={submitAuth}>
            <div className="grid grid-cols-2 rounded-lg bg-[var(--muted)] p-1">
              <button type="button" className={`auth-tab ${mode === "signup" ? "is-active" : ""}`} onClick={() => switchMode("signup")}>
                Sign up
              </button>
              <button type="button" className={`auth-tab ${mode === "signin" ? "is-active" : ""}`} onClick={() => switchMode("signin")}>
                Sign in
              </button>
            </div>

            <label className="grid gap-1 text-sm font-medium" htmlFor={emailInputId}>
              Email
              <Input
                key={emailInputId}
                id={emailInputId}
                name="email"
                type="email"
                inputMode="email"
                autoComplete={mode === "signin" ? "username" : "email"}
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setStatus("");
                }}
              />
            </label>

            {mode === "signup" && (
              <label className="auth-legal-check">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                />
                <span>
                  I agree to the{" "}
                  <a href="/terms" target="_blank" rel="noreferrer">
                    Terms
                  </a>
                  , including the author content license, and have read the{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer">
                    Privacy
                  </a>{" "}
                  page.
                </span>
              </label>
            )}

            <Button type="submit" disabled={busy || waiting}>
              <Mail className="size-4" />
              {busy
                ? "Sending…"
                : waiting
                  ? `Send again in ${formatCooldown(cooldownSeconds)}`
                  : mode === "signup"
                    ? "Send sign-up link"
                    : "Send sign-in link"}
            </Button>
            {waiting && (
              <p className="text-sm leading-6 text-[var(--muted-foreground)]" role="status" aria-live="polite">
                A link was just sent to this address. One a minute, so a second
                request cannot invalidate the first.
              </p>
            )}

            {!required && (
              <Button type="button" variant="ghost" onClick={onClose}>
                Continue reading
              </Button>
            )}
          </form>
        )}

        {/* A guest has no settings page, and should not need an account to
            read in the dark. */}
        {!showingAccount && !sentMagicLink && !(accountLoading && !user) && <ThemeSetting compact />}

        {/* A guest has no settings panel, so the box lives here too - and a
            guest's note is the one this product can least afford to lose. */}
        {!showingAccount && !sentMagicLink && <FeedbackDisclosure />}

        {/* The address stays reachable - some people want a reply, and whoever
            cannot sign in has nowhere else to turn - but it is deliberately
            quieter than the box above it. Opening a mail client is work, and
            work is how feedback stops arriving. */}
        {!showingAccount && (
          <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
            Would rather write an email, or need a reply?{" "}
            <a className="auth-link" href={supportMailto}>{supportEmail}</a>.
          </p>
        )}

        {status && (
          <p className="mt-4 text-sm leading-6 text-[var(--muted-foreground)]" role="status" aria-live="polite">
            {status}
          </p>
        )}
      </section>
    </div>
  );
}
