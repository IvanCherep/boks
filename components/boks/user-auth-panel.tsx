"use client";

import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, KeyRound, LogOut, Mail, Search, Shield, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { anonymousReadLimits } from "@/components/boks/reader-behavior";
import type { BoksUserContext, ReaderLibraryItem } from "@/components/boks/client-types";
import {
  acceptBoksTerms,
  ensureBoksProfile,
  loadBoksUserContext,
  loadReaderLibrary,
  updateBoksProfile,
} from "@/components/boks/supabase-browser-data";
import {
  createOrUpgradeBoksUser,
  requestBoksPasswordReset,
  signInBoksUser,
  signOutBoksUser,
  updateBoksPassword,
} from "@/lib/boks/supabase-client";

export const currentBoksTermsVersion = "2026-09-11";

export type AuthPanelMode = "signin" | "signup" | "recover" | "setPassword";

function normalizeHandleInput(value: string) {
  return value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
}

type UserAuthPanelProps = {
  open: boolean;
  surface?: "reader" | "author";
  intent?: "general" | "like" | "comment";
  reason: "manual" | "notice" | "required";
  initialMode: AuthPanelMode;
  guestReadCount: number;
  currentUser: BoksUserContext | null;
  onClose: () => void;
  onOpenReadBoks: (storyId: string) => void;
  onUserChanged: (user: BoksUserContext | null) => void;
};

export function UserAuthPanel({
  open,
  surface = "reader",
  intent = "general",
  reason,
  initialMode,
  guestReadCount,
  currentUser,
  onClose,
  onOpenReadBoks,
  onUserChanged,
}: UserAuthPanelProps) {
  const [mode, setMode] = useState<AuthPanelMode>(initialMode);
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [library, setLibrary] = useState<ReaderLibraryItem[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("Reader");
  const [handle, setHandle] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const normalizedLibraryQuery = libraryQuery.trim().toLowerCase();
  const visibleLibrary = useMemo(() => {
    if (!normalizedLibraryQuery) return library;
    return library.filter((item) =>
      `${item.title} ${item.authorName}`.toLowerCase().includes(normalizedLibraryQuery)
    );
  }, [library, normalizedLibraryQuery]);

  const refreshUser = useCallback(async () => {
    const context = await loadBoksUserContext();
    setUser(context);
    setDisplayName(context?.displayName || "Reader");
    setHandle(context?.handle || "");

    if (context && !context.isAnonymous) {
      const items = await loadReaderLibrary();
      setLibrary(items);
    } else {
      setLibrary([]);
    }
    return context;
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setMode(initialMode);
      setStatus("");
      setPassword("");
      setConfirmPassword("");
      setTermsAccepted(false);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, initialMode]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setUser(currentUser);
      if (currentUser && !currentUser.isAnonymous) {
        setDisplayName(currentUser.displayName || "Reader");
        setHandle(currentUser.handle || "");
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, currentUser]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      setAccountLoading(true);
      refreshUser()
        .catch((error) => setStatus(error instanceof Error ? error.message : "Could not load account"))
        .finally(() => setAccountLoading(false));
    }, 0);
    return () => window.clearTimeout(handle);
  }, [open, refreshUser]);

  function switchMode(nextMode: AuthPanelMode) {
    setMode(nextMode);
    setStatus("");
    setPassword("");
    setConfirmPassword("");
  }

  function friendlyAuthError(error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("invalid login")) return "Email or password is incorrect.";
    if (message.toLowerCase().includes("already registered")) return "This email already has an account. Sign in instead.";
    if (message.toLowerCase().includes("password")) return message;
    return message || "Could not complete this account step.";
  }

  function validateNewPassword() {
    if (password.length < 8) {
      setStatus("Use at least 8 characters for the password.");
      return false;
    }
    if (password !== confirmPassword) {
      setStatus("Passwords do not match.");
      return false;
    }
    return true;
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "recover") {
      await submitPasswordReset();
      return;
    }

    if (mode === "setPassword") {
      await submitNewPassword();
      return;
    }

    if (!email.trim()) {
      setStatus("Enter your email.");
      return;
    }

    if (mode === "signup" && !validateNewPassword()) return;
    if (mode === "signin" && password.length < 6) {
      setStatus("Enter your password.");
      return;
    }
    if (mode === "signup" && !termsAccepted) {
      setStatus("Please accept the Terms to create an account.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      if (mode === "signin") {
        await signInBoksUser(email.trim(), password);
        await ensureBoksProfile();
        setStatus("Signed in. Your reading history is available.");
      } else {
        await createOrUpgradeBoksUser(email.trim(), password);
        await updateBoksProfile({ displayName, handle });
        await acceptBoksTerms(currentBoksTermsVersion);
        setStatus("Account created. You can keep reading.");
      }

      setEmail("");
      setPassword("");
      setConfirmPassword("");
      const context = await refreshUser();
      onUserChanged(context);
    } catch (error) {
      setStatus(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitPasswordReset() {
    if (!email.trim()) {
      setStatus("Enter the email for your boks account.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      await requestBoksPasswordReset(email.trim());
      setStatus("If this email has a boks account, a reset link has been sent.");
    } catch (error) {
      setStatus(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword() {
    if (!validateNewPassword()) return;

    setBusy(true);
    setStatus("");
    try {
      await updateBoksPassword(password);
      await ensureBoksProfile();
      setPassword("");
      setConfirmPassword("");
      const context = await refreshUser();
      onUserChanged(context);
      setStatus("Password updated. You can keep reading.");
    } catch (error) {
      setStatus(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    setStatus("");
    try {
      const next = await updateBoksProfile({ displayName, handle });
      setUser(next);
      onUserChanged(next);
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  function openReadBoks(storyId: string) {
    onOpenReadBoks(storyId);
    onClose();
  }

  async function signOut() {
    setBusy(true);
    setStatus("");
    try {
      await signOutBoksUser();
      setUser(null);
      setLibrary([]);
      onUserChanged(null);
      setStatus("Signed out.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const accountUser = user && !user.isAnonymous ? user : null;
  const signedIn = Boolean(accountUser);
  const required = reason === "required";
  const showingAccount = Boolean(accountUser && mode !== "setPassword");
  const remainingGuestBoks = Math.max(0, anonymousReadLimits.requiredSignup - guestReadCount);
  const noticeText = required
    ? surface === "author"
      ? "Sign up or sign in to submit boks for review and track decisions."
      : "You have used the guest reading limit. Create an account or sign in to continue."
    : reason === "notice"
      ? `${remainingGuestBoks} free boks left. Create an account to save your reading history.`
      : intent === "like"
        ? "Sign up is free. Likes help boks tune recommendations to your taste and keep your reading history connected to you."
        : intent === "comment"
          ? "Sign up is free. It keeps comments connected to your profile name and helps boks understand what stories work for you."
      : surface === "author"
        ? "Create an account to submit boks for review."
        : "Create an account to save your reading history and settings.";
  const title = showingAccount
    ? "Your reading profile"
    : mode === "signin"
      ? "Welcome back"
      : mode === "recover"
        ? "Reset your password"
        : mode === "setPassword"
          ? "Choose a new password"
          : "Create your boks account";
  const emailInputId =
    mode === "signin" ? "boks-signin-username" : mode === "recover" ? "boks-recovery-username" : "boks-signup-email";
  const passwordInputId =
    mode === "signin" ? "boks-signin-password" : mode === "setPassword" ? "boks-new-password" : "boks-signup-password";
  const emailAutocomplete = mode === "signin" || mode === "recover" ? "username" : "email";

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="boks account">
      <section className="auth-panel">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="brand-word">boks</p>
            <h1 className="mt-4 text-2xl font-semibold tracking-normal text-[var(--foreground)]">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
              {showingAccount ? "Manage the account connected to this reading feed." : noticeText}
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
            <div className="rounded-lg border border-[var(--border)] bg-[var(--reader)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{accountUser?.email}</p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    @{accountUser?.handle || "reader"} · {accountUser?.views} read boks · {accountUser?.likes} liked
                  </p>
                </div>
                {accountUser?.role === "admin" && (
                  <Link className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]" href="/admin">
                    <Shield className="size-4" /> Admin
                  </Link>
                )}
              </div>
            </div>

            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-display-name">
                Display name
                <Input
                  id="boks-display-name"
                  name="name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-handle">
                Unique @nickname
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
                    @
                  </span>
                  <Input
                    id="boks-handle"
                    name="username"
                    autoComplete="username"
                    className="pl-7"
                    minLength={3}
                    maxLength={24}
                    value={handle}
                    onChange={(event) => setHandle(normalizeHandleInput(event.target.value))}
                  />
                </div>
              </label>
              <Button onClick={saveSettings} disabled={busy}>
                <UserRound className="size-4" /> Save settings
              </Button>
              <Button variant="outline" onClick={() => switchMode("setPassword")} disabled={busy}>
                <KeyRound className="size-4" /> Change password
              </Button>
            </div>

            <div>
              <h2 className="text-base font-semibold tracking-normal">Recently read</h2>
              <label className="relative mt-3 block" htmlFor="boks-library-search">
                <span className="sr-only">Search read boks</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  id="boks-library-search"
                  name="search-read-boks"
                  type="search"
                  autoComplete="off"
                  placeholder="Search read boks"
                  className="pl-9"
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                />
              </label>
              <div className="mt-3 grid max-h-[240px] gap-2 overflow-y-auto pr-1">
                {visibleLibrary.length ? visibleLibrary.map((item) => (
                  <button
                    key={`${item.storyId}-${item.readAt}`}
                    type="button"
                    className="library-item"
                    onClick={() => openReadBoks(item.storyId)}
                  >
                    <span className="font-medium">{item.title}</span>
                    <span className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {item.authorName} · {item.minutes} min{item.liked ? " · liked" : ""}
                    </span>
                  </button>
                )) : (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {library.length ? "No read boks match this search." : "Your read boks will appear here."}
                  </p>
                )}
              </div>
            </div>

            <Button variant="outline" onClick={signOut} disabled={busy}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        ) : (
          <form key={mode} className="mt-6 grid gap-4" autoComplete="on" data-auth-mode={mode} onSubmit={submitAuth}>
            {mode !== "recover" && mode !== "setPassword" && (
              <div className="grid grid-cols-2 rounded-lg bg-[var(--muted)] p-1">
                <button type="button" className={`auth-tab ${mode === "signup" ? "is-active" : ""}`} onClick={() => switchMode("signup")}>
                  Sign up
                </button>
                <button type="button" className={`auth-tab ${mode === "signin" ? "is-active" : ""}`} onClick={() => switchMode("signin")}>
                  Sign in
                </button>
              </div>
            )}

            {mode === "signup" && (
              <>
                <label className="grid gap-1 text-sm font-medium" htmlFor="boks-signup-name">
                  Name
                  <Input
                    id="boks-signup-name"
                    name="name"
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium" htmlFor="boks-signup-handle">
                  Unique @nickname
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
                      @
                    </span>
                    <Input
                      id="boks-signup-handle"
                      name="username"
                      autoComplete="username"
                      className="pl-7"
                      minLength={3}
                      maxLength={24}
                      placeholder="boks_reader"
                      value={handle}
                      onChange={(event) => setHandle(normalizeHandleInput(event.target.value))}
                    />
                  </div>
                </label>
              </>
            )}

            {mode !== "setPassword" && (
              <label className="grid gap-1 text-sm font-medium" htmlFor={emailInputId}>
                Email
                <Input
                  key={emailInputId}
                  id={emailInputId}
                  name={mode === "signin" || mode === "recover" ? "username" : "email"}
                  type="email"
                  inputMode="email"
                  autoComplete={emailAutocomplete}
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            )}

            {mode !== "recover" && (
              <label className="grid gap-1 text-sm font-medium" htmlFor={passwordInputId}>
                {mode === "setPassword" ? "New password" : "Password"}
                <Input
                  key={passwordInputId}
                  id={passwordInputId}
                  name={mode === "signin" ? "password" : "new-password"}
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  enterKeyHint="done"
                  minLength={mode === "signin" ? 6 : 8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}

            {(mode === "signup" || mode === "setPassword") && (
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-confirm-new-password">
                Confirm password
                <Input
                  id="boks-confirm-new-password"
                  name="confirm-new-password"
                  type="password"
                  autoComplete="new-password"
                  enterKeyHint="done"
                  minLength={8}
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            )}

            {mode === "signup" && (
              <label className="auth-legal-check">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                />
                <span>
                  I agree to the{" "}
                  <Link href="/terms" target="_blank" rel="noreferrer">
                    Terms
                  </Link>
                  , including the author content license.
                </span>
              </label>
            )}

            <Button type="submit" disabled={busy}>
              {mode === "recover" ? (
                <>
                  <Mail className="size-4" /> Send reset link
                </>
              ) : mode === "setPassword" ? (
                <>
                  <KeyRound className="size-4" /> Update password
                </>
              ) : (
                <>
                  <BookOpen className="size-4" /> {mode === "signup" ? "Create account" : "Sign in"}
                </>
              )}
            </Button>

            {mode === "signin" && (
              <button type="button" className="auth-secondary-action" onClick={() => switchMode("recover")}>
                Forgot password?
              </button>
            )}
            {(mode === "recover" || (mode === "setPassword" && !signedIn)) && (
              <button type="button" className="auth-secondary-action" onClick={() => switchMode("signin")}>
                Back to sign in
              </button>
            )}
            {mode === "setPassword" && signedIn && (
              <button type="button" className="auth-secondary-action" onClick={() => switchMode("signin")}>
                Back to profile
              </button>
            )}
            {!required && mode !== "setPassword" && (
              <Button type="button" variant="ghost" onClick={onClose}>
                Continue reading
              </Button>
            )}
          </form>
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
