"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Download, RefreshCw, Search, Shield, UserPlus, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AdminModerationItem, BoksUserContext } from "@/components/boks/client-types";
import { numberValue, pct, secondsLabel, storySignal } from "@/components/boks/client-format";
import { AdminPanel, Breakdown, MetricTile, Target } from "@/components/boks/shared-ui";
import {
  claimInitialBoksAdmin,
  ensureBoksProfile,
  loadBoksUserContext,
  reviewBokSubmission,
  setBoksAdminRole,
} from "@/components/boks/supabase-browser-data";
import { useBoksData } from "@/components/boks/use-boks-data";
import { signInBoksUser } from "@/lib/boks/supabase-client";

export function AdminDashboard() {
  const { metrics, status, setStatus, load } = useBoksData();
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("signal");
  const [page, setPage] = useState(0);
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const pageSize = 100;
  const funnel = metrics.funnel ?? {};
  const pagination = metrics.pagination ?? {
    limit: pageSize,
    offset: page * pageSize,
    total: metrics.stories.length,
    hasMore: false,
    sort,
    query,
  };
  const impressions = numberValue(funnel.impressions);
  const starts = numberValue(funnel.starts);
  const completes = numberValue(funnel.completes);
  const pageStart = pagination.total ? pagination.offset + 1 : 0;
  const pageEnd = Math.min(pagination.offset + pagination.limit, pagination.total);
  const algorithmRows = metrics.algorithmMetrics ?? [];
  const algorithmNameById = new Map((metrics.algorithms ?? []).map((algorithm) => [algorithm.id, algorithm.name]));
  const userRows = metrics.users ?? [];
  const moderationQueue = metrics.moderationQueue ?? [];

  useEffect(() => {
    refreshAccess().catch((error) => {
      setAuthStatus(error instanceof Error ? error.message : "Could not check admin access.");
      setAuthChecked(true);
    });
  }, []);

  useEffect(() => {
    if (!authChecked || user?.role !== "admin") return;
    const handle = window.setTimeout(() => {
      load({
        view: "admin",
        limit: pageSize,
        offset: page * pageSize,
        q: query,
        sort,
      }).catch((error) => setStatus(error.message));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [authChecked, load, page, query, setStatus, sort, user?.role]);

  async function refreshAccess() {
    const context = await loadBoksUserContext();
    setUser(context);
    setAuthChecked(true);
    return context;
  }

  async function submitSignIn() {
    if (!email.trim() || password.length < 6) {
      setAuthStatus("Use an email and a password with at least 6 characters.");
      return;
    }

    setBusy(true);
    setAuthStatus("");
    try {
      await signInBoksUser(email.trim(), password);
      await ensureBoksProfile();
      await refreshAccess();
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function claimFirstAdmin() {
    setBusy(true);
    setAuthStatus("");
    try {
      const context = await claimInitialBoksAdmin();
      setUser(context);
      await load({ view: "admin", limit: pageSize, offset: 0, q: query, sort });
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Could not claim first admin.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdminRole(userId: string, isAdmin: boolean) {
    setBusy(true);
    setAuthStatus("");
    try {
      await setBoksAdminRole(userId, isAdmin);
      await load({ view: "admin", limit: pageSize, offset: page * pageSize, q: query, sort });
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Could not update admin role.");
    } finally {
      setBusy(false);
    }
  }

  async function moderateBok(item: AdminModerationItem, decision: "approve" | "reject") {
    const reason = reviewReasons[item.id]?.trim() ?? "";
    if (decision === "reject" && !reason) {
      setStatus("Add a clear reason before refusing a bok.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      await reviewBokSubmission({
        bokId: item.id,
        decision,
        reason,
      });
      setReviewReasons((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      await load({ view: "admin", limit: pageSize, offset: page * pageSize, q: query, sort });
      setStatus(decision === "approve" ? "Bok approved and published." : "Bok refused. The author can see the reason.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not review bok.");
    } finally {
      setBusy(false);
    }
  }

  function downloadMetrics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      funnel,
      stories: metrics.stories,
      pagination,
      genres: metrics.genres,
      moods: metrics.moods,
      algorithms: metrics.algorithms,
      algorithmMetrics: metrics.algorithmMetrics,
      moderationQueue: metrics.moderationQueue,
      recentEvents: metrics.recentEvents,
      users: metrics.users,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "boks-metrics.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!authChecked) {
    return (
      <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
        <div className="mx-auto grid min-h-[70svh] max-w-xl place-items-center">
          <p className="text-[var(--muted-foreground)]">Checking admin access...</p>
        </div>
      </main>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
        <section className="auth-panel mx-auto mt-12">
          <Link href="/" prefetch={false} className="brand-word">boks</Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal">Admin sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Business metrics and role changes are available only to permanent admin users.
          </p>
          <div className="mt-6 grid gap-3">
            <Input type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <Input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
            <Button onClick={submitSignIn} disabled={busy}>
              <Shield className="size-4" /> Sign in
            </Button>
          </div>
          {authStatus && <p className="mt-4 text-sm text-[var(--muted-foreground)]">{authStatus}</p>}
        </section>
      </main>
    );
  }

  if (user.role !== "admin") {
    return (
      <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
        <section className="auth-panel mx-auto mt-12">
          <Link href="/" prefetch={false} className="brand-word">boks</Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal">Admin access</h1>
          {user.hasAnyAdmin ? (
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">
              This account is signed in as a reader. Ask an existing admin to grant access from this panel.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                No admin exists yet. The first permanent account can become admin here; after that, only admins can grant admin access.
              </p>
              <Button className="mt-6" onClick={claimFirstAdmin} disabled={busy}>
                <UserPlus className="size-4" /> Claim first admin
              </Button>
            </>
          )}
          {authStatus && <p className="mt-4 text-sm text-[var(--muted-foreground)]">{authStatus}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/" prefetch={false} className="brand-word">boks</Link>
            <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">Business console</h1>
            <p className="mt-3 max-w-3xl text-[var(--muted-foreground)]">
              Funnel health, story-level signal, content inventory, and cohort taste.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                load({
                  view: "admin",
                  limit: pageSize,
                  offset: page * pageSize,
                  q: query,
                  sort,
                }).catch((error) => setStatus(error.message))
              }
            >
              <RefreshCw className="size-4" /> Refresh
            </Button>
            <Button onClick={downloadMetrics}>
              <Download className="size-4" /> Export
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          <MetricTile label="Stories" value={numberValue(funnel.totalStories)} />
          <MetricTile label="Visitors" value={numberValue(funnel.visitors)} />
          <MetricTile label="Impressions" value={impressions} />
          <MetricTile label="Starts" value={starts} />
          <MetricTile label="Completes" value={completes} />
          <MetricTile label="Likes" value={numberValue(funnel.likes)} />
          <MetricTile label="Pending" value={numberValue(funnel.pendingReview)} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr_1fr]">
          <AdminPanel title="Funnel">
            <Target label="Start rate" value={pct(starts, impressions)} target="40%" />
            <Target label="Finish after start" value={pct(completes, starts)} target="55%" />
            <Target label="Reaction per finish" value={pct(numberValue(funnel.likes) + numberValue(funnel.shares), completes)} target="20%" />
          </AdminPanel>
          <AdminPanel title="Genre signal">
            <Breakdown rows={metrics.genres ?? []} labelKey="genre" />
          </AdminPanel>
          <AdminPanel title="Mood signal">
            <Breakdown rows={metrics.moods ?? []} labelKey="mood" />
          </AdminPanel>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--border)] p-4">
            <h2 className="text-xl font-semibold tracking-normal">Review queue</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              New boks stay private until an admin approves them. Refused boks return to the author with your reason.
            </p>
          </div>
          <div className="moderation-list">
            {moderationQueue.length ? moderationQueue.map((item) => (
              <article key={item.id} className="moderation-item">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`review-badge review-badge--${item.status}`}>
                        {item.status === "rejected" ? <XCircle className="size-4" /> : <RefreshCw className="size-4" />}
                        {item.status === "rejected" ? "Refused" : "Waiting"}
                      </span>
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : "not submitted"}
                      </span>
                    </div>
                    <h3 className="mt-3 break-words text-lg font-semibold tracking-normal">{item.title}</h3>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {item.authorName} {item.authorHandle ? `· ${item.authorHandle}` : ""} · {item.authorEmail || "unknown email"} · {item.minutes} min · {item.genre} · {item.mood}
                    </p>
                    {item.hook && <p className="mt-3 text-sm leading-6 text-[var(--soft-foreground)]">{item.hook}</p>}
                    <div className="moderation-copy mt-3 max-h-[220px] overflow-y-auto rounded-lg bg-[var(--reader)] p-3 text-sm leading-7">
                      {item.body.split("\n").map((paragraph) => (
                        <p key={paragraph} className="mb-3 last:mb-0">{paragraph}</p>
                      ))}
                    </div>
                    {item.reviewNote && (
                      <p className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm leading-6 text-[var(--muted-foreground)]">
                        Previous reason: {item.reviewNote}
                      </p>
                    )}
                  </div>
                  <div className="grid content-start gap-3">
                    <Textarea
                      aria-label={`Refusal reason for ${item.title}`}
                      placeholder="Reason if refused"
                      value={reviewReasons[item.id] ?? ""}
                      onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" disabled={busy} onClick={() => moderateBok(item, "reject")}>
                        <XCircle className="size-4" /> Refuse
                      </Button>
                      <Button disabled={busy} onClick={() => moderateBok(item, "approve")}>
                        <Check className="size-4" /> Approve
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            )) : (
              <div className="p-4 text-sm text-[var(--muted-foreground)]">No boks are waiting for review.</div>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--border)] p-4">
            <h2 className="text-xl font-semibold tracking-normal">User management</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Grant admin access from here only. Reader accounts remain readers until an admin changes them.
            </p>
          </div>
          <div className="user-table">
            <div className="user-row user-head">
              <span>User</span>
              <span>Role</span>
              <span>Reads</span>
              <span>Likes</span>
              <span>Last sign in</span>
              <span>Action</span>
            </div>
            {userRows.length ? userRows.map((row) => (
              <div key={row.userId} className="user-row">
                <span>
                  <strong>{row.email || row.displayName || row.userId}</strong>
                  <small>{row.userId}</small>
                </span>
                <span>{row.role}</span>
                <span>{numberValue(row.views)}</span>
                <span>{numberValue(row.likes)}</span>
                <span>{row.lastSignInAt ? new Date(row.lastSignInAt).toLocaleDateString() : "never"}</span>
                <span>
                  <Button
                    variant={row.role === "admin" ? "outline" : "default"}
                    disabled={busy || row.userId === user.userId}
                    onClick={() => toggleAdminRole(row.userId, row.role !== "admin")}
                  >
                    {row.role === "admin" ? "Remove" : "Make admin"}
                  </Button>
                </span>
              </div>
            )) : (
              <div className="p-4 text-sm text-[var(--muted-foreground)]">No permanent user profiles yet.</div>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-[var(--border)] p-4">
            <h2 className="text-xl font-semibold tracking-normal">Recommendation lab</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Automatic cohorts compared by behavior, timing, and story quality signal.
            </p>
          </div>
          <div className="experiment-table">
            <div className="experiment-row experiment-head">
              <span>Algorithm</span>
              <span>Segment</span>
              <span>Visitors</span>
              <span>Start</span>
              <span>Finish</span>
              <span>Reaction</span>
              <span>Skip</span>
              <span>Read</span>
              <span>Pace</span>
              <span>Like time</span>
              <span>Score</span>
            </div>
            {algorithmRows.length ? (
              algorithmRows.map((row) => {
                const id = String(row.algorithmId);
                return (
                  <div key={`${id}-${String(row.userSegment)}`} className="experiment-row">
                    <span>
                      <strong>{algorithmNameById.get(id) ?? id}</strong>
                      <small>{id}</small>
                    </span>
                    <span>{String(row.userSegment)}</span>
                    <span>{numberValue(row.visitors)}</span>
                    <span>{numberValue(row.startRate)}%</span>
                    <span>{numberValue(row.finishRate)}%</span>
                    <span>{numberValue(row.reactionRate)}%</span>
                    <span>{numberValue(row.skipRate)}%</span>
                    <span>{secondsLabel(row.avgReadSeconds)}</span>
                    <span>{numberValue(row.paceIndex).toFixed(2)}x</span>
                    <span>{secondsLabel(row.avgSecondsToLike)}</span>
                    <span>{numberValue(row.engagementScore)}</span>
                  </div>
                );
              })
            ) : (
              <div className="p-4 text-sm text-[var(--muted-foreground)]">
                No algorithm-attributed events yet. Ask testers to read from the updated feed.
              </div>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
            <div>
              <h2 className="text-xl font-semibold tracking-normal">Content operations</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                {pageStart}-{pageEnd} of {pagination.total} · {status}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  className="w-[220px] pl-9"
                  placeholder="Search stories"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <select
                className="field-control w-[180px]"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(0);
                }}
              >
                <option value="signal">Signal</option>
                <option value="finish">Finish rate</option>
                <option value="starts">Starts</option>
                <option value="comments">Comments</option>
                <option value="newest">Newest</option>
                <option value="title">Title</option>
              </select>
            </div>
          </div>
          <div className="admin-table">
            <div className="admin-row admin-head">
              <span>Story</span>
              <span>Start</span>
              <span>Finish</span>
              <span>Love</span>
              <span>Comments</span>
              <span>Signal</span>
            </div>
            {metrics.stories.map((story) => {
              const storyStarts = numberValue(story.starts);
              const storyCompletes = numberValue(story.completes);
              const comments = numberValue(story.commentsCount ?? story.comments);
              return (
                <div key={String(story.id)} className="admin-row">
                  <span>
                    <strong>{String(story.title)}</strong>
                    <small>{String(story.genre)} · {String(story.mood)} · {String(story.minutes)} min</small>
                  </span>
                  <span>{storyStarts}</span>
                  <span>{pct(storyCompletes, storyStarts)}%</span>
                  <span>{numberValue(story.likes)}</span>
                  <span>{comments}</span>
                  <span>{storySignal(story)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-4">
            <p className="text-sm text-[var(--muted-foreground)]">
              Showing {metrics.stories.length} stories per request. Search and sort are handled by the server.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                Previous
              </Button>
              <Button variant="outline" disabled={!pagination.hasMore} onClick={() => setPage((value) => value + 1)}>
                Next
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
