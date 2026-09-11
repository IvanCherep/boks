"use client";

import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, KeyRound, LogOut, Mail, Shield, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { genres, moods } from "@/components/boks/constants";
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

type UserAuthPanelProps = {
  open: boolean;
  reason: "manual" | "notice" | "required";
  initialMode: AuthPanelMode;
  guestReadCount: number;
  currentUser: BoksUserContext | null;
  onClose: () => void;
  onUserChanged: (user: BoksUserContext | null) => void;
};

export function UserAuthPanel({
  open,
  reason,
  initialMode,
  guestReadCount,
  currentUser,
  onClose,
  onUserChanged,
}: UserAuthPanelProps) {
  const [mode, setMode] = useState<AuthPanelMode>(initialMode);
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [library, setLibrary] = useState<ReaderLibraryItem[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("Reader");
  const [preferredGenre, setPreferredGenre] = useState(genres[0]);
  const [preferredMood, setPreferredMood] = useState(moods[0]);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);

  const refreshUser = useCallback(async () => {
    const context = await loadBoksUserContext();
    setUser(context);
    setDisplayName(context?.displayName || "Reader");
    setPreferredGenre(context?.preferredGenre || genres[0]);
    setPreferredMood(context?.preferredMood || moods[0]);

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
        setPreferredGenre(currentUser.preferredGenre || genres[0]);
        setPreferredMood(currentUser.preferredMood || moods[0]);
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
        await ensureBoksProfile(displayName);
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
      const next = await updateBoksProfile({ displayName, preferredGenre, preferredMood });
      setUser(next);
      onUserChanged(next);
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
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
    ? "You have used the guest reading limit. Create an account or sign in to continue."
    : reason === "notice"
      ? `${remainingGuestBoks} free boks left. Create an account to save your reading history.`
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
                    {accountUser?.views} read boks · {accountUser?.likes} liked
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
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium" htmlFor="boks-preferred-genre">
                  Genre
                  <select
                    id="boks-preferred-genre"
                    className="field-control"
                    value={preferredGenre}
                    onChange={(event) => setPreferredGenre(event.target.value)}
                  >
                    {genres.map((genre) => (
                      <option key={genre} value={genre}>{genre}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium" htmlFor="boks-preferred-mood">
                  Mood
                  <select
                    id="boks-preferred-mood"
                    className="field-control"
                    value={preferredMood}
                    onChange={(event) => setPreferredMood(event.target.value)}
                  >
                    {moods.map((mood) => (
                      <option key={mood} value={mood}>{mood}</option>
                    ))}
                  </select>
                </label>
              </div>
              <Button onClick={saveSettings} disabled={busy}>
                <UserRound className="size-4" /> Save settings
              </Button>
              <Button variant="outline" onClick={() => switchMode("setPassword")} disabled={busy}>
                <KeyRound className="size-4" /> Change password
              </Button>
            </div>

            <div>
              <h2 className="text-base font-semibold tracking-normal">Recently read</h2>
              <div className="mt-3 grid max-h-[240px] gap-2 overflow-y-auto pr-1">
                {library.length ? library.map((item) => (
                  <div key={`${item.storyId}-${item.readAt}`} className="rounded-lg bg-[var(--muted)] p-3">
                    <p className="font-medium">{item.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {item.authorName} · {item.minutes} min{item.liked ? " · liked" : ""}
                    </p>
                  </div>
                )) : (
                  <p className="text-sm text-[var(--muted-foreground)]">Your read boks will appear here.</p>
                )}
              </div>
            </div>

            <Button variant="outline" onClick={signOut} disabled={busy}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        ) : (
          <form className="mt-6 grid gap-4" autoComplete="on" onSubmit={submitAuth}>
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
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-auth-name">
                Name
                <Input
                  id="boks-auth-name"
                  name="name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            )}

            {mode !== "setPassword" && (
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-auth-email">
                Email
                <Input
                  id="boks-auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
            )}

            {mode !== "recover" && (
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-auth-password">
                {mode === "setPassword" ? "New password" : "Password"}
                <Input
                  id="boks-auth-password"
                  name={mode === "signin" ? "current-password" : "new-password"}
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  minLength={mode === "signin" ? 6 : 8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            )}

            {(mode === "signup" || mode === "setPassword") && (
              <label className="grid gap-1 text-sm font-medium" htmlFor="boks-auth-confirm-password">
                Confirm password
                <Input
                  id="boks-auth-confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
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
