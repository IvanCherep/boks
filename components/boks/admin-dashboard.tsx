"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Download, LockKeyhole, Menu, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatCooldown,
  magicLinkCooldownRemainingMs,
  recordMagicLinkSent,
  useMagicLinkCooldown,
} from "@/components/boks/magic-link-cooldown";
import "@/app/admin-v44.css";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import type { AdminModerationItem, BoksUserContext } from "@/components/boks/client-types";
import { numberValue } from "@/components/boks/client-format";
import { ContentOperations } from "@/components/boks/admin/content-operations";
import { ModerationQueue } from "@/components/boks/admin/moderation-queue";
import { AdminGrowth } from "@/components/boks/admin/growth";
import { AdminOverview } from "@/components/boks/admin/overview";
import { AdminPeople } from "@/components/boks/admin/people";
import { FeedbackInbox } from "@/components/boks/admin/feedback-inbox";
import { GuestFunnelPanel } from "@/components/boks/admin/guest-funnel";
import { TrackedLinksPanel } from "@/components/boks/admin/tracked-links";
import { RecommendationLab } from "@/components/boks/admin/recommendation-lab";
import { InteractionSandbox } from "@/components/boks/admin/interaction-sandbox";
import { PoetrySandbox } from "@/components/boks/admin/poetry-sandbox";
import { AdminStudies } from "@/components/boks/admin/studies";
import {
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
  verifyBoksEmailCode,
  signOutBoksUser,
} from "@/lib/boks/supabase-client";

export const adminTabs = [
  { id: "overview", label: "This week", heading: "Overview", group: "Pulse" },
  { id: "guests", label: "Guests", heading: "Guest funnel", group: "Pulse" },
  { id: "links", label: "Links", heading: "Tracked links", group: "Pulse" },
  { id: "growth", label: "Growth", heading: "Growth & retention", group: "Pulse" },
  { id: "moderation", label: "Moderation", heading: "Review queue", group: "Editorial" },
  { id: "rights", label: "Rights", heading: "Rights & reports", group: "Editorial" },
  { id: "content", label: "Content", heading: "Content", group: "Editorial" },
  { id: "catalogue", label: "Catalogue", heading: "Catalogue", group: "Editorial" },
  { id: "people", label: "People", heading: "Accounts", group: "People" },
  { id: "feedback", label: "Feedback", heading: "Reader feedback", group: "People" },
  { id: "experiments", label: "Experiments", heading: "Experiments", group: "Research" },
  { id: "studies", label: "Studies", heading: "Studies", group: "Research" },
  { id: "interactions", label: "Interactions", heading: "Interactions", group: "Research" },
  { id: "poetry", label: "Poetry", heading: "Immersive poems", group: "Research" },
] as const;

export type AdminTab = (typeof adminTabs)[number]["id"];

/**
 * The moderation queue is the last thing still served by the old admin
 * snapshot. Everything else now reads attributed events through its own RPC, so
 * the snapshot is fetched only when the queue is open.
 */
const snapshotTabs = new Set<AdminTab>(["moderation"]);

const pageSize = 100;

export function AdminDashboard() {
  const { metrics, status, setStatus, phase, load } = useBoksData();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const activeTab = adminTabs.find((entry) => entry.id === tab)!;
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
      setSentEmail(email.trim());
      setAuthStatus("Check your email. Open the boks admin link on this device to sign in.");
    } catch (error) {
      setAuthStatus(friendlyAdminAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitEmailCode() {
    setBusy(true);
    setAuthStatus("");
    try {
      await verifyBoksEmailCode({ email: sentEmail, code: emailCode });
      await refreshAccess();
    } catch (error) {
      setAuthStatus(friendlyAdminAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  function navigate(next: AdminTab) {
    setTab(next);
    setSectionsOpen(false);
    window.scrollTo({ top: 0 });
  }

  const sectionNavigation = (
    <nav className="studio-navigation" aria-label="Studio sections">
      {["Pulse", "Editorial", "People", "Research"].map((group) => (
        <div key={group} className="studio-navigation__group">
          <p>{group}</p>
          {adminTabs.filter((entry) => entry.group === group).map((entry) => (
            <button key={entry.id} type="button" aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => navigate(entry.id)}>
              <span>{entry.id === "people" ? "Accounts" : entry.label}</span>
              {entry.id === "moderation" && numberValue(funnel.pendingReview) > 0 && (
                <span className="studio-navigation__count">{numberValue(funnel.pendingReview)}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );

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
      <main className="studio-access min-h-screen px-4 py-5 sm:px-8">
        <div className="mx-auto grid min-h-[70svh] max-w-xl place-items-center">
          <p className="text-[var(--muted-foreground)]">Checking admin access...</p>
        </div>
      </main>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <main className="studio-access min-h-screen px-4 py-5 sm:px-8">
        <section className="auth-panel mx-auto mt-12">
          <a href="/" className="studio-brand" aria-label="boks — back to reading"><BoksLogo /></a>
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
          {sentEmail && (
            <form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); void submitEmailCode(); }}>
              <label htmlFor="admin-email-code">Or enter the six-digit code from the same email</label>
              <Input id="admin-email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))} required />
              <Button type="submit" disabled={busy || emailCode.length !== 6}>Sign in with code</Button>
            </form>
          )}
          {authStatus && <p className="mt-4 text-sm text-[var(--muted-foreground)]">{authStatus}</p>}
        </section>
      </main>
    );
  }

  if (user.role !== "admin") {
    return <main className="studio-access studio-access-page"><header className="studio-access-header"><a href="/" aria-label="Back to reading"><ArrowLeft /></a><a href="/" className="studio-brand" aria-label="boks — back to reading"><BoksLogo /></a></header><section className="studio-access-body"><p className="studio-eyebrow">Studio</p><h1>Admin access required</h1><LockKeyhole className="studio-access-lock" /><h2>You are signed in<br />as @{user.handle || "reader"}.</h2><p>This account does not have admin access. An existing admin can give it access to the studio.</p><p className="studio-hint">Admin access is part of your account, not a setting on this device.</p><div className="studio-link-rows"><button type="button" onClick={() => { void signOutBoksUser().then(() => setUser(null)).catch((error) => setAuthStatus(error instanceof Error ? error.message : "Could not switch accounts.")); }}><span><strong>Continue with another email</strong><small>A one-time link or a six-digit code</small></span><span>↗</span></button></div><Button asChild><a href="/">Back to reading</a></Button>{authStatus && <p role="status">{authStatus}</p>}</section></main>;
  }

  return (
    // One boks view and one person view for the whole console: every tab opens
    // the same inspector rather than keeping a detail view of its own. Any
    // change made there reloads the snapshot whichever tab is open, because the
    // Moderation badge reads from it and hiding a boks from Content or People
    // changes the count too.
    <AdminInspectorProvider currentUserId={user.userId} onChange={() => loadSnapshot().catch((error) => setStatus(error.message))}>
    <main className="studio-shell">
      <aside className="studio-sidebar">
        <a href="/" className="studio-brand" aria-label="boks — back to reading"><BoksLogo /></a>
        {sectionNavigation}
        <a href="/" className="studio-back"><ArrowLeft aria-hidden="true" /> Back to reading</a>
      </aside>
      <div className="studio-main">
        <header className="studio-topbar">
          <button type="button" className="studio-mobile-back" aria-label={tab === "overview" ? "Back to reading" : "Back to overview"} onClick={() => { if (tab === "overview") window.location.assign("/"); else navigate("overview"); }}><ArrowLeft /></button>
          <a href="/" className="studio-brand studio-mobile-brand" aria-label="boks — back to reading"><BoksLogo /></a>
          <span className="studio-breadcrumb">{activeTab.group} / {activeTab.label}</span>
          <span className="studio-account">@{user.handle || "admin"}</span>
          <Button variant="ghost" size="icon" className="studio-menu-button" aria-label="Studio sections"
            aria-expanded={sectionsOpen} onClick={() => setSectionsOpen(true)}><Menu /></Button>
        </header>
        <div className="studio-content">
          <div className="studio-heading">
            <div><p className="studio-eyebrow">{tab === "overview" ? "Studio" : `${activeTab.group} / ${tab === "people" ? "Accounts" : activeTab.label}`}</p><h1>{activeTab.heading}</h1></div>
            {needsSnapshot && (
              <div className="studio-heading__actions">
                <Button variant="outline" onClick={() => loadSnapshot().catch((error) => setStatus(error.message))}>
                  <RefreshCw className="size-4" /> Refresh
                </Button>
                <Button variant="outline" onClick={downloadMetrics}><Download className="size-4" /> Export</Button>
              </div>
            )}
          </div>
        {tab === "overview" && <AdminOverview onNavigate={navigate} />}

        {tab === "moderation" && (
          <>
            {metrics.moderationQueue !== undefined && <section className="studio-editorial-tally">
              <strong>{numberValue(funnel.pendingReview)}</strong><span>waiting for review</span>
              <details><summary>Publication totals</summary><p>{numberValue(funnel.totalStories)} published · {numberValue(funnel.rejectedBoks)} refused · {numberValue(funnel.approvedAuthorBoks)} approved from authors</p></details>
            </section>}
            {/* The result of the last decision. It was set and never shown. */}
            {status && status !== "Loading" && status !== "Ready" && (
              <p className="text-sm text-[var(--muted-foreground)]" role="status" aria-live="polite">
                {status}
              </p>
            )}
            {metrics.moderationQueue === undefined ? (
              <p role="status">{phase === "failed" ? "The review queue could not be loaded. Use Refresh to try again." : "Loading the review queue…"}</p>
            ) : <ModerationQueue items={metrics.moderationQueue} busy={busy} onReview={moderateBok} onRefresh={() => loadSnapshot().catch((error) => setStatus(error.message))} />}
          </>
        )}

        {tab === "rights" && <RightsReview />}

        {tab === "experiments" && <RecommendationLab />}
        {tab === "studies" && <AdminStudies />}
        {tab === "interactions" && <InteractionSandbox />}
        {tab === "poetry" && <PoetrySandbox />}

        {tab === "guests" && <GuestFunnelPanel />}
        {tab === "links" && <TrackedLinksPanel />}
        {tab === "growth" && <AdminGrowth />}

        {tab === "content" && <ContentOperations />}

        {tab === "catalogue" && <CatalogueImport onOpenContent={(published) => navigate(published ? "content" : "moderation")} />}

        {tab === "people" && <AdminPeople currentUserId={user.userId} />}
        {tab === "feedback" && <FeedbackInbox />}

        {authStatus && <p className="text-sm text-[var(--muted-foreground)]">{authStatus}</p>}
        </div>
      </div>
      <Sheet open={sectionsOpen} onOpenChange={setSectionsOpen}>
        <SheetContent side="left" className="studio-section-sheet">
          <SheetHeader><SheetTitle>Studio</SheetTitle><SheetDescription>Choose a section.</SheetDescription></SheetHeader>
          {sectionNavigation}
          <a href="/" className="studio-back"><ArrowLeft aria-hidden="true" /> Back to reading</a>
        </SheetContent>
      </Sheet>
    </main>
    </AdminInspectorProvider>
  );
}
