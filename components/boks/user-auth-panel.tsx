"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, LogOut, Shield, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { genres, moods } from "@/components/boks/constants";
import { anonymousReadLimits } from "@/components/boks/reader-behavior";
import type { BoksUserContext, ReaderLibraryItem } from "@/components/boks/client-types";
import {
  ensureBoksProfile,
  loadBoksUserContext,
  loadReaderLibrary,
  updateBoksProfile,
} from "@/components/boks/supabase-browser-data";
import { createOrUpgradeBoksUser, signInBoksUser, signOutBoksUser } from "@/lib/boks/supabase-client";

type UserAuthPanelProps = {
  open: boolean;
  reason: "manual" | "notice" | "required";
  guestReadCount: number;
  currentUser: BoksUserContext | null;
  onClose: () => void;
  onUserChanged: (user: BoksUserContext | null) => void;
};

export function UserAuthPanel({ open, reason, guestReadCount, currentUser, onClose, onUserChanged }: UserAuthPanelProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [library, setLibrary] = useState<ReaderLibraryItem[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("Reader");
  const [preferredGenre, setPreferredGenre] = useState(genres[0]);
  const [preferredMood, setPreferredMood] = useState(moods[0]);
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

  async function submitAuth() {
    if (!email.trim() || password.length < 6) {
      setStatus("Use an email and a password with at least 6 characters.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      if (mode === "signin") {
        await signInBoksUser(email.trim(), password);
        await ensureBoksProfile();
        setStatus("Signed in.");
      } else {
        await createOrUpgradeBoksUser(email.trim(), password);
        await ensureBoksProfile();
        setStatus("Account created. If Supabase asks for confirmation, verify the email before the next sign in.");
      }
      setEmail("");
      setPassword("");
      const context = await refreshUser();
      onUserChanged(context);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update account.");
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

  const signedIn = user && !user.isAnonymous;
  const required = reason === "required";
  const remainingGuestBoks = Math.max(0, anonymousReadLimits.requiredSignup - guestReadCount);
  const noticeText = required
    ? "You have read 15 boks as a guest. Sign up or sign in to keep reading."
    : reason === "notice"
      ? `${remainingGuestBoks} free boks left. Create an account to save your reading history and settings.`
      : "Create an account to save your reading history and settings.";

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label="boks account">
      <section className="auth-panel">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="brand-word">boks</p>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{signedIn ? "Your reading profile" : noticeText}</p>
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
        ) : signedIn ? (
          <div className="mt-6 grid gap-5">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--reader)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{user.email}</p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {user.views} read boks · {user.likes} liked
                  </p>
                </div>
                {user.role === "admin" && (
                  <Link className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--primary)]" href="/admin">
                    <Shield className="size-4" /> Admin
                  </Link>
                )}
              </div>
            </div>

            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-medium">
                Display name
                <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Genre
                  <select className="field-control" value={preferredGenre} onChange={(event) => setPreferredGenre(event.target.value)}>
                    {genres.map((genre) => (
                      <option key={genre} value={genre}>{genre}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Mood
                  <select className="field-control" value={preferredMood} onChange={(event) => setPreferredMood(event.target.value)}>
                    {moods.map((mood) => (
                      <option key={mood} value={mood}>{mood}</option>
                    ))}
                  </select>
                </label>
              </div>
              <Button onClick={saveSettings} disabled={busy}>
                <UserRound className="size-4" /> Save settings
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
          <div className="mt-6 grid gap-4">
            <div className="grid grid-cols-2 rounded-lg bg-[var(--muted)] p-1">
              <button className={`auth-tab ${mode === "signup" ? "is-active" : ""}`} onClick={() => setMode("signup")}>
                Sign up
              </button>
              <button className={`auth-tab ${mode === "signin" ? "is-active" : ""}`} onClick={() => setMode("signin")}>
                Sign in
              </button>
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Email
              <Input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Password
              <Input
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <Button onClick={submitAuth} disabled={busy}>
              <BookOpen className="size-4" /> {mode === "signup" ? "Create account" : "Sign in"}
            </Button>
            {!required && (
              <Button variant="ghost" onClick={onClose}>
                Continue as guest
              </Button>
            )}
          </div>
        )}

        {status && <p className="mt-4 text-sm text-[var(--muted-foreground)]">{status}</p>}
      </section>
    </div>
  );
}
