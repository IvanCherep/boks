"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Clock3, Edit3, Send, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { estimateMinutes, wordCount } from "@/components/boks/client-format";
import { genres, moods } from "@/components/boks/constants";
import type { AuthorBokSubmission, BoksUserContext, BokReviewStatus } from "@/components/boks/client-types";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { Field, MetricTile } from "@/components/boks/shared-ui";
import {
  loadBoksUserContext,
  loadMyBokSubmissions,
  submitBokForReview,
} from "@/components/boks/supabase-browser-data";
import { type AuthPanelMode, UserAuthPanel } from "@/components/boks/user-auth-panel";

function reviewStatusLabel(status: BokReviewStatus) {
  if (status === "pending_review") return "Waiting for review";
  if (status === "published") return "Published";
  if (status === "rejected") return "Needs changes";
  if (status === "archived") return "Archived";
  return "Draft";
}

function ReviewStatusIcon({ status }: { status: BokReviewStatus }) {
  if (status === "published") return <ShieldCheck className="size-4" />;
  if (status === "rejected") return <XCircle className="size-4" />;
  return <Clock3 className="size-4" />;
}

export function AuthorConsole() {
  const [status, setStatus] = useState("Sign in to submit a bok.");
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [submissions, setSubmissions] = useState<AuthorBokSubmission[]>([]);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<AuthPanelMode>("signup");
  const [authorForm, setAuthorForm] = useState({
    title: "",
    authorName: "",
    authorHandle: "",
    hook: "",
    body: "",
    genre: "literary",
    mood: "quiet",
  });
  const [isSubmitting, setSubmitting] = useState(false);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const authorMinutes = estimateMinutes(authorForm.body);
  const authorWords = wordCount(authorForm.body);
  const signedInAuthor = user && !user.isAnonymous ? user : null;

  useEffect(() => {
    visitorId.current = getBrowserId("boks-author");
    sessionId.current = `${Date.now()}-${crypto.randomUUID()}`;
    refreshAuthor().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load author cabinet."));
  }, []);

  async function refreshAuthor() {
    const context = await loadBoksUserContext();
    setUser(context);

    if (context && !context.isAnonymous) {
      const rows = await loadMyBokSubmissions();
      setSubmissions(rows);
      setStatus(rows.length ? "Your boks review history is below." : "Write a bok and submit it for review.");
    } else {
      setSubmissions([]);
      setStatus("Sign up or sign in to submit a bok.");
    }

    return context;
  }

  function openAuth(initialMode: AuthPanelMode) {
    setAuthInitialMode(initialMode);
    setAuthPanelOpen(true);
  }

  function editSubmission(submission: AuthorBokSubmission) {
    setAuthorForm({
      title: submission.title,
      authorName: signedInAuthor?.displayName || authorForm.authorName,
      authorHandle: authorForm.authorHandle,
      hook: submission.hook,
      body: submission.body,
      genre: submission.genre,
      mood: submission.mood,
    });
    setStatus("Rejected bok loaded into the editor. Update it and submit again.");
  }

  async function submitForReview() {
    if (!signedInAuthor) {
      openAuth("signup");
      return;
    }

    setSubmitting(true);
    setStatus("");
    try {
      await submitBokForReview({
        ...authorForm,
        minutes: authorMinutes,
      });
      setAuthorForm({
        title: "",
        authorName: authorForm.authorName,
        authorHandle: authorForm.authorHandle,
        hook: "",
        body: "",
        genre: "literary",
        mood: "quiet",
      });
      await refreshAuthor();
      setStatus("Submitted for review. An admin will approve it before readers see it.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not submit this bok.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel p-5 sm:p-7">
          <Link href="/" prefetch={false} className="brand-word">boks</Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">Author cabinet</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Submit one focused bok for review. Readers will see it only after boks admin approval.
          </p>
          {!signedInAuthor && (
            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
              <p className="text-sm font-semibold">Authors need a boks account.</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                This lets you track whether each bok is waiting, approved, or refused with a reason.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => openAuth("signup")}>Create account</Button>
                <Button variant="outline" onClick={() => openAuth("signin")}>Sign in</Button>
              </div>
            </div>
          )}
          <div className="mt-7 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title">
                <Input value={authorForm.title} onChange={(event) => setAuthorForm({ ...authorForm, title: event.target.value })} />
              </Field>
              <Field label="Author name">
                <Input value={authorForm.authorName} onChange={(event) => setAuthorForm({ ...authorForm, authorName: event.target.value })} />
              </Field>
            </div>
            <Field label="Handle">
              <Input placeholder="@name" value={authorForm.authorHandle} onChange={(event) => setAuthorForm({ ...authorForm, authorHandle: event.target.value })} />
            </Field>
            <Field label="Opening hook">
              <Textarea value={authorForm.hook} onChange={(event) => setAuthorForm({ ...authorForm, hook: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Genre">
                <select className="field-control" value={authorForm.genre} onChange={(event) => setAuthorForm({ ...authorForm, genre: event.target.value })}>
                  {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
                </select>
              </Field>
              <Field label="Mood">
                <select className="field-control" value={authorForm.mood} onChange={(event) => setAuthorForm({ ...authorForm, mood: event.target.value })}>
                  {moods.map((mood) => <option key={mood} value={mood}>{mood}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Story">
              <Textarea className="min-h-[380px] text-base leading-7" value={authorForm.body} onChange={(event) => setAuthorForm({ ...authorForm, body: event.target.value })} />
            </Field>
            <Button className="h-11 w-full sm:w-fit" onClick={submitForReview} disabled={isSubmitting || !authorForm.title.trim() || !authorForm.body.trim() || authorMinutes > 15}>
              <Send className="size-4" /> Submit for review
            </Button>
          </div>
        </section>
        <aside className="grid content-start gap-4">
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Length guardrail</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricTile label="Words" value={authorWords} />
              <MetricTile label="Minutes" value={authorMinutes} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
              <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, (authorMinutes / 15) * 100)}%` }} />
            </div>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {authorMinutes > 15 ? "Split this into episodes." : "Fits the feed."}
            </p>
          </div>
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Status</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{status}</p>
            <a className="mt-4 inline-flex text-sm font-medium text-[var(--primary)]" href="/admin">Open admin</a>
          </div>
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Your boks</h2>
            <div className="mt-4 grid gap-3">
              {submissions.length ? submissions.map((submission) => (
                <article key={submission.id} className="submission-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">{submission.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{submission.minutes} min · {submission.genre} · {submission.mood}</p>
                    </div>
                    <span className={`review-badge review-badge--${submission.status}`}>
                      <ReviewStatusIcon status={submission.status} />
                      {reviewStatusLabel(submission.status)}
                    </span>
                  </div>
                  {submission.reviewNote && (
                    <p className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm leading-6 text-[var(--muted-foreground)]">
                      {submission.reviewNote}
                    </p>
                  )}
                  {submission.status === "rejected" && (
                    <Button className="mt-3 w-full" variant="outline" onClick={() => editSubmission(submission)}>
                      <Edit3 className="size-4" /> Revise
                    </Button>
                  )}
                </article>
              )) : (
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                  Submitted boks will appear here after you sign in.
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
        initialMode={authInitialMode}
        guestReadCount={0}
        currentUser={user}
        onClose={() => setAuthPanelOpen(false)}
        onOpenReadBoks={() => undefined}
        onUserChanged={(nextUser) => {
          setUser(nextUser);
          setAuthPanelOpen(false);
          refreshAuthor().catch((error) => setStatus(error instanceof Error ? error.message : "Could not load author cabinet."));
        }}
      />
    </main>
  );
}
