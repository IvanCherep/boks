"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3, Edit3, Send, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readableBoksError } from "@/lib/boks/errors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { estimateMinutes, groupDigits, wordCount } from "@/components/boks/client-format";
import { maxBokCharacters } from "@/lib/boks/contracts";
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
import { describeBokSubmissionQuota } from "@/lib/boks/author/submission-quota";
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
  const [quota, setQuota] = useState<AuthorBokQuota>(() => describeBokSubmissionQuota(0));
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<AuthPanelMode>("signup");
  const [authorForm, setAuthorForm] = useState({
    title: "",
    hook: "",
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
  const sessionId = useRef("session");
  const authorMinutes = estimateMinutes(authorForm.body);
  const authorWords = wordCount(authorForm.body);
  const authorCharacters = authorForm.body.length;
  const overLength = authorCharacters > maxBokCharacters;
  const publishedCount = submissions.filter((row) => row.status === "published").length;
  const pendingCount = submissions.filter((row) => row.status === "pending_review").length;
  const rejectedCount = submissions.filter((row) => row.status === "rejected").length;
  const signedInAuthor = user && !user.isAnonymous ? user : null;

  useEffect(() => {
    visitorId.current = getBrowserId("boks-author");
    sessionId.current = `${Date.now()}-${crypto.randomUUID()}`;
    refreshAuthor().catch((error) => setStatus(readableBoksError(error, "Could not load author cabinet.")));
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
      setStatus(rows.length ? "Your boks review history is below." : "Write a bok and submit it for review.");
    } else {
      setSubmissions([]);
      setQuota(describeBokSubmissionQuota(0));
      setDefaultAuthorName("");
      setStatus("Sign up or sign in to submit a bok.");
    }

    return context;
  }

  function openAuth(initialMode: AuthPanelMode) {
    setAuthInitialMode(initialMode);
    setAuthPanelOpen(true);
  }

  function editSubmission(submission: AuthorBokSubmission) {
    setAuthorForm((current) => ({
      title: submission.title,
      hook: submission.hook,
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
    setStatus("Rejected bok loaded into the editor. Confirm the rights again and submit.");
  }

  async function submitForReview() {
    if (!signedInAuthor) {
      openAuth("signup");
      return;
    }

    if (signedInAuthor.bannedAt) {
      setStatus(signedInAuthor.banReason || "This account is suspended and cannot submit boks.");
      return;
    }

    if (quota.exhausted) {
      setStatus(quota.message);
      return;
    }

    setSubmitting(true);
    setStatus("");
    try {
      await submitBokForReview({
        ...authorForm,
        minutes: authorMinutes,
      });
      // The byline survives the reset: an author who publishes a series should
      // not retype their pen name for every piece.
      setAuthorForm((current) => ({
        title: "",
        hook: "",
        body: "",
        // The byline survives the reset: an author who publishes a series
        // should not retype their pen name for every piece. The attestation
        // does not - it has to be made again for the next piece.
        authorName: current.authorName,
        rightsConfirmed: false,
        rightsNote: "",
      }));
      await refreshAuthor();
      setStatus("Submitted for review. An admin will approve it before readers see it.");
    } catch (error) {
      setStatus(readableBoksError(error, "Could not submit this bok."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel p-5 sm:p-7">
          <a href="/" className="brand-word">boks</a>
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
            {signedInAuthor?.bannedAt && (
              <div className="rounded-lg border border-[var(--destructive)]/35 bg-[var(--destructive)]/5 p-4 text-sm leading-6">
                This account is suspended and cannot publish. {signedInAuthor.banReason || "Contact a boks administrator for details."}
              </div>
            )}
            {signedInAuthor && (
              <p className="byline-note">
                Publishing as <strong>@{signedInAuthor.handle || "reader"}</strong>. Every bok you
                publish carries that, so readers can always find your other work.
              </p>
            )}
            <Field
              label="Author name (optional)"
              hint={
                defaultAuthorName
                  ? "A name to print above your @nickname. Left as you had it last time; clear it to publish under the @nickname alone."
                  : "Leave this empty to publish under your @nickname. Fill it in if you want a name printed above it."
              }
            >
              <Input
                value={authorForm.authorName}
                placeholder="Optional"
                onChange={(event) => setAuthorForm({ ...authorForm, authorName: event.target.value })}
              />
            </Field>
            <Field label="Title">
              <Input value={authorForm.title} onChange={(event) => setAuthorForm({ ...authorForm, title: event.target.value })} />
            </Field>
            <Field label="Opening hook">
              <Textarea value={authorForm.hook} onChange={(event) => setAuthorForm({ ...authorForm, hook: event.target.value })} />
            </Field>
            <Field label="Story">
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
                  I hold the rights to publish this bok.
                  <span className="mt-1 block font-normal text-[var(--muted-foreground)]">
                    Your own work, or work you are allowed to publish - public domain, an open
                    licence, or permission you have been given.
                  </span>
                </span>
              </label>

              <div className="mt-3">
                <Field
                  label="Where the rights come from (optional)"
                  hint="Only boks admins see this. A line is enough: &ldquo;Project Gutenberg #1342, public domain&rdquo;, &ldquo;my translation&rdquo;, &ldquo;permission from the estate&rdquo;."
                >
                  <Textarea
                    className="min-h-[72px]"
                    value={authorForm.rightsNote}
                    placeholder="Optional"
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
                !authorForm.title.trim() ||
                !authorForm.body.trim() ||
                !authorForm.rightsConfirmed ||
                overLength ||
                Boolean(signedInAuthor && quota.exhausted) ||
                Boolean(signedInAuthor?.bannedAt)
              }
            >
              <Send className="size-4" /> Submit for review
            </Button>
          </div>
        </section>
        <aside className="grid content-start gap-4">
          {/* Only once it is close enough to matter. A counter reading "0 of 3"
              is a rule nobody was about to break. */}
          {quota.usedToday >= quota.limit - 1 && (
            <div className="panel p-5">
              <h2 className="text-lg font-semibold tracking-normal">Daily submissions</h2>
              <div className={`author-quota mt-4 ${quota.exhausted ? "author-quota--exhausted" : ""}`}>
                <p className="text-sm font-semibold">
                  {quota.usedToday} of {quota.limit} used today
                </p>
                <div className="quota-pips" aria-hidden="true">
                  {Array.from({ length: quota.limit }, (_, index) => (
                    <span key={index} className={`quota-pip ${index < quota.usedToday ? "quota-pip--spent" : ""}`} />
                  ))}
                </div>
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">{quota.message}</p>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">
                The limit keeps the review queue readable. It resets at midnight UTC.
              </p>
            </div>
          )}
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Fifteen minutes</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricTile label="Minutes" value={authorMinutes} />
              <MetricTile label="Words" value={authorWords} />
            </div>
            {/* Characters, because that is the limit the database enforces. */}
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {groupDigits(authorCharacters)} of {groupDigits(maxBokCharacters)} characters
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
                ? `That is ${groupDigits(authorCharacters - maxBokCharacters)} characters past the promise. Split it into episodes.`
                : "A bok is one break. Fits."}
            </p>
          </div>
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Status</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{status}</p>
            {signedInAuthor && submissions.length > 0 && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <MetricTile label="Published" value={publishedCount} />
                <MetricTile label="In review" value={pendingCount} />
                <MetricTile label="Needs work" value={rejectedCount} />
              </div>
            )}
          </div>
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Your boks</h2>
            <div className="mt-4 grid gap-3">
              {submissions.length ? submissions.map((submission) => (
                <article key={submission.id} className="submission-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">{submission.title}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {submission.minutes} min
                        {submission.authorName ? ` · ${submission.authorName}` : ""}
                        {submission.status === "published"
                          ? ` · ${submission.likes} liked · ${submission.comments} replied`
                          : ""}
                      </p>
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
                  {signedInAuthor
                    ? "Nothing submitted yet. Your first bok will appear here with its likes and replies."
                    : "Submitted boks will appear here after you sign in."}
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
          // Not closed here: the panel is where a nickname is saved, and
          // dismissing it on save hides the confirmation.
          setUser(nextUser);
          refreshAuthor().catch((error) => setStatus(readableBoksError(error, "Could not load author cabinet.")));
        }}
      />
    </main>
  );
}
