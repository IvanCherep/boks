"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, Shield, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCooldown,
  magicLinkCooldownRemainingMs,
  recordMagicLinkSent,
  useMagicLinkCooldown,
} from "@/components/boks/magic-link-cooldown";
import { Input } from "@/components/ui/input";
import type { AdminModerationItem, BoksUserContext } from "@/components/boks/client-types";
import { numberValue } from "@/components/boks/client-format";
import { ContentOperations } from "@/components/boks/admin/content-operations";
import { ModerationQueue } from "@/components/boks/admin/moderation-queue";
import { AdminGrowth } from "@/components/boks/admin/growth";
import { AdminOverview } from "@/components/boks/admin/overview";
import { AdminPeople } from "@/components/boks/admin/people";
import { FeedbackInbox } from "@/components/boks/admin/feedback-inbox";
import { RecommendationLab } from "@/components/boks/admin/recommendation-lab";
import { MetricTile } from "@/components/boks/shared-ui";
import {
  claimInitialBoksAdmin,
  loadBoksUserContext,
  reviewBokSubmission,
} from "@/components/boks/supabase-browser-data";
import { CatalogueImport } from "@/components/boks/admin/catalogue-import";
import { RightsReview } from "@/components/boks/admin/rights-review";
import { AdminInspectorProvider } from "@/components/boks/admin/admin-inspector";
import { useBoksData } from "@/components/boks/use-boks-data";
import {
  consumeBoksMagicLinkRedirectNotice,
  explainBoksMagicLinkError,
  requestBoksMagicLink,
} from "@/lib/boks/supabase-client";

const adminTabs = [
  { id: "overview", label: "This week" },
  { id: "growth", label: "Growth" },
  { id: "moderation", label: "Moderation" },
  { id: "rights", label: "Rights" },
  { id: "content", label: "Content" },
  { id: "catalogue", label: "Catalogue" },
  { id: "people", label: "People" },
  { id: "feedback", label: "Feedback" },
  { id: "experiments", label: "Experiments" },
] as const;

type AdminTab = (typeof adminTabs)[number]["id"];

/**
 * The moderation queue is the last thing still served by the old admin
 * snapshot. Everything else now reads attributed events through its own RPC, so
 * the snapshot is fetched only when the queue is open.
 */
const snapshotTabs = new Set<AdminTab>(["moderation"]);

const pageSize = 100;

export function AdminDashboard() {
  const { metrics, status, setStatus, load } = useBoksData();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [email, setEmail] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [busy, setBusy] = useState(false);
  // The same wait the reader sign-in shows, from the same source of truth.
  const adminCooldownSeconds = useMagicLinkCooldown(email);
  const adminWaiting = adminCooldownSeconds > 0;
  const funnel = metrics.funnel ?? {};
  const needsSnapshot = snapshotTabs.has(tab);

  function friendlyAdminAuthError(error: unknown) {
    return explainBoksMagicLinkError(error, { flow: "admin" });
  }

  useEffect(() => {
    refreshAccess().catch((error) => {
      setAuthStatus(error instanceof Error ? error.message : "Could not check admin access.");
      setAuthChecked(true);
    });
  }, []);

  // Loaded once on arrival as well as with the Moderation tab: the tab's
  // waiting-count badge comes from it, and it used to appear only after the
  // tab had been opened - the one place it was needed was the one it was not.
  useEffect(() => {
    if (!authChecked || user?.role !== "admin") return;
    const handle = window.setTimeout(() => {
      loadSnapshot().catch((error) => setStatus(error.message));
    }, 180);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, needsSnapshot, user?.role]);

  function loadSnapshot() {
    return load({ view: "admin", limit: pageSize, offset: 0, q: "", sort: "newest" });
  }

  async function refreshAccess() {
    const context = await loadBoksUserContext();
    setUser(context);
    setAuthChecked(true);
    // A sign-in link that did not work lands here too; say why rather than
    // showing the sign-in form again with no explanation.
    const linkNotice = consumeBoksMagicLinkRedirectNotice();
    if (linkNotice && !(context && !context.isAnonymous)) setAuthStatus(linkNotice);
    return context;
  }

  async function submitSignIn() {
    if (!email.trim()) {
      setAuthStatus("Enter your admin email.");
      return;
    }

    const remaining = magicLinkCooldownRemainingMs(email);
    if (remaining > 0) {
      setAuthStatus(`One link a minute per address. ${Math.ceil(remaining / 1000)} seconds to go.`);
      return;
    }

    setBusy(true);
    setAuthStatus("");
    try {
      await requestBoksMagicLink({
        email,
        redirectPath: "/admin",
        shouldCreateUser: false,
      });
      recordMagicLinkSent(email);
      setAuthStatus("Check your email. Open the boks admin link on this device to sign in.");
    } catch (error) {
      setAuthStatus(friendlyAdminAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function claimFirstAdmin() {
    setBusy(true);
    setAuthStatus("");
    try {
      setUser(await claimInitialBoksAdmin());
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : "Could not claim first admin.");
    } finally {
      setBusy(false);
    }
  }

  /** True when the decision went through, so the queue keeps a typed reason otherwise. */
  async function moderateBok(item: AdminModerationItem, decision: "approve" | "reject", reason: string) {
    setBusy(true);
    setStatus("");
    try {
      await reviewBokSubmission({ bokId: item.id, decision, reason });
      await loadSnapshot();
      setStatus(
        decision === "approve"
          ? `“${item.title}” approved and published.`
          : `“${item.title}” refused. The author can see the reason.`
      );
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not review bok.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function downloadMetrics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      catalog: funnel,
      moderationQueue: metrics.moderationQueue,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `boks-moderation-${new Date().toISOString().slice(0, 10)}.json`;
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
          <a href="/" className="brand-word">boks</a>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal">Admin sign in</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Enter an admin email. boks will send a one-time sign-in link; there is no password to remember.
          </p>
          <form
            className="mt-6 grid gap-3"
            autoComplete="on"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSignIn();
            }}
          >
            <Input
              id="boks-admin-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" disabled={busy || adminWaiting}>
              <Shield className="size-4" />
              {busy
                ? "Sending…"
                : adminWaiting
                  ? `Send again in ${formatCooldown(adminCooldownSeconds)}`
                  : "Send admin link"}
            </Button>
          </form>
          {authStatus && <p className="mt-4 text-sm text-[var(--muted-foreground)]">{authStatus}</p>}
        </section>
      </main>
    );
  }

  if (user.role !== "admin") {
    return (
      <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
        <section className="auth-panel mx-auto mt-12">
          <a href="/" className="brand-word">boks</a>
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
    // One boks view and one person view for the whole console: every tab opens
    // the same inspector rather than keeping a detail view of its own.
    <AdminInspectorProvider onChange={() => needsSnapshot && loadSnapshot().catch((error) => setStatus(error.message))}>
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <a href="/" className="brand-word">boks</a>
            <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">Business console</h1>
            <p className="mt-3 max-w-3xl text-[var(--muted-foreground)]">
              Reader behaviour, content supply, moderation and the running experiment.
            </p>
          </div>
          {needsSnapshot && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => loadSnapshot().catch((error) => setStatus(error.message))}>
                <RefreshCw className="size-4" /> Refresh
              </Button>
              <Button onClick={downloadMetrics}>
                <Download className="size-4" /> Export
              </Button>
            </div>
          )}
        </header>

        <nav className="admin-tabs" aria-label="Console sections">
          {adminTabs.map((entry) => (
            <button
              key={entry.id}
              className={`admin-tab ${tab === entry.id ? "is-active" : ""}`}
              aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.id === "moderation" && numberValue(funnel.pendingReview) > 0 && (
                <span className="admin-tab__count">{numberValue(funnel.pendingReview)}</span>
              )}
            </button>
          ))}
        </nav>

        {tab === "overview" && <AdminOverview />}

        {tab === "moderation" && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile label="Published boks" value={numberValue(funnel.totalStories)} />
              <MetricTile label="Waiting for review" value={numberValue(funnel.pendingReview)} />
              <MetricTile label="Refused" value={numberValue(funnel.rejectedBoks)} />
              <MetricTile label="Approved from authors" value={numberValue(funnel.approvedAuthorBoks)} />
            </section>
            {/* The result of the last decision. It was set and never shown. */}
            {status && status !== "Loading" && status !== "Ready" && (
              <p className="text-sm text-[var(--muted-foreground)]" role="status" aria-live="polite">
                {status}
              </p>
            )}
            <ModerationQueue items={metrics.moderationQueue ?? []} busy={busy} onReview={moderateBok} />
          </>
        )}

        {tab === "rights" && <RightsReview />}

        {tab === "experiments" && <RecommendationLab />}

        {tab === "growth" && <AdminGrowth />}

        {tab === "content" && <ContentOperations />}

        {tab === "catalogue" && <CatalogueImport />}

        {tab === "people" && <AdminPeople currentUserId={user.userId} />}
        {tab === "feedback" && <FeedbackInbox />}

        {authStatus && <p className="text-sm text-[var(--muted-foreground)]">{authStatus}</p>}
      </div>
    </main>
    </AdminInspectorProvider>
  );
}
