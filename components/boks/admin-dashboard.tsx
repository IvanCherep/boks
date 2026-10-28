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
import { FragmentCutter } from "@/components/boks/admin/fragment-cutter";
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
import { defineMessages, plural } from "@/lib/i18n/messages";
import { uiLanguages } from "@/lib/i18n/ui-language";
import {
  currentUiLanguage,
  setUiLanguagePreference,
  useMessages,
  useUiLanguage,
  useUiLanguagePreference,
} from "@/components/boks/ui-language";

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
  { id: "cutter", label: "Cutter", heading: "Fragment cutter", group: "Research" },
] as const;

export type AdminTab = (typeof adminTabs)[number]["id"];

type AdminGroup = (typeof adminTabs)[number]["group"];

const groups: AdminGroup[] = ["Pulse", "Editorial", "People", "Research"];

// `adminTabs` keeps the English names as the tab's identity; what a person
// reads comes from here, keyed by id and group.
const words = defineMessages(
  {
    groups: { Pulse: "Pulse", Editorial: "Editorial", People: "People", Research: "Research" } as Record<AdminGroup, string>,
    labels: Object.fromEntries(adminTabs.map((entry) => [entry.id, entry.id === "people" ? "Accounts" : entry.label])) as Record<AdminTab, string>,
    headings: Object.fromEntries(adminTabs.map((entry) => [entry.id, entry.heading])) as Record<AdminTab, string>,
    studio: "Studio",
    sections: "Studio sections",
    chooseSection: "Choose a section.",
    backToReading: "Back to reading",
    backToOverview: "Back to overview",
    brandHome: "boks — back to reading",
    language: "Interface language",
    checkingAccess: "Checking admin access...",
    couldNotCheckAccess: "Could not check admin access.",
    signInTitle: "Admin sign in",
    signInLead: "Enter an admin email. boks will send a one-time sign-in link; there is no password to remember.",
    enterEmail: "Enter your admin email.",
    oneLinkAMinute: (seconds: number) => `One link a minute per address. ${seconds} seconds to go.`,
    checkEmail: "Check your email. Open the boks admin link on this device to sign in.",
    emailPlaceholder: "Email",
    sending: "Sending…",
    sendAgainIn: (wait: string) => `Send again in ${wait}`,
    sendLink: "Send admin link",
    codeLabel: "Or enter the six-digit code from the same email",
    signInWithCode: "Sign in with code",
    accessRequired: "Admin access required",
    signedInAs: "You are signed in",
    asHandle: (handle: string) => `as @${handle}.`,
    noAccess: "This account does not have admin access. An existing admin can give it access to the studio.",
    accessHint: "Admin access is part of your account, not a setting on this device.",
    anotherEmail: "Continue with another email",
    anotherEmailHint: "A one-time link or a six-digit code",
    couldNotSwitch: "Could not switch accounts.",
    approved: (title: string) => `“${title}” approved and published.`,
    refused: (title: string) => `“${title}” refused. The author can see the reason.`,
    couldNotReview: "Could not review bok.",
    refresh: "Refresh",
    export: "Export",
    waitingForReview: "waiting for review",
    publicationTotals: "Publication totals",
    totals: (published: number, refused: number, approved: number) =>
      `${published} published · ${refused} refused · ${approved} approved from authors`,
    queueFailed: "The review queue could not be loaded. Use Refresh to try again.",
    queueLoading: "Loading the review queue…",
  },
  {
    ru: {
      groups: { Pulse: "Пульс", Editorial: "Редакция", People: "Люди", Research: "Исследования" },
      labels: {
        overview: "Эта неделя",
        guests: "Гости",
        links: "Ссылки",
        growth: "Рост",
        moderation: "Модерация",
        rights: "Права",
        content: "Контент",
        catalogue: "Каталог",
        people: "Аккаунты",
        feedback: "Отзывы",
        experiments: "Эксперименты",
        studies: "Исследования",
        interactions: "Интерактив",
        poetry: "Поэзия",
        cutter: "Нарезка",
      },
      headings: {
        overview: "Обзор",
        guests: "Воронка гостей",
        links: "Отслеживаемые ссылки",
        growth: "Рост и удержание",
        moderation: "Очередь проверки",
        rights: "Права и жалобы",
        content: "Контент",
        catalogue: "Каталог",
        people: "Аккаунты",
        feedback: "Отзывы читателей",
        experiments: "Эксперименты",
        studies: "Исследования",
        interactions: "Интерактив",
        poetry: "Иммерсивные стихи",
        cutter: "Нарезка фрагментов",
      },
      studio: "Админка",
      sections: "Разделы студии",
      chooseSection: "Выберите раздел.",
      backToReading: "Назад к чтению",
      backToOverview: "Назад к обзору",
      brandHome: "boks: назад к чтению",
      language: "Язык интерфейса",
      checkingAccess: "Проверяем доступ администратора...",
      couldNotCheckAccess: "Не удалось проверить доступ администратора.",
      signInTitle: "Вход для администратора",
      signInLead: "Введите адрес администратора. boks пришлёт одноразовую ссылку для входа, пароль запоминать не нужно.",
      enterEmail: "Введите адрес администратора.",
      oneLinkAMinute: (seconds: number) =>
        `Не больше одной ссылки в минуту на адрес. Осталось ${seconds} ${plural("ru", seconds, { one: "секунда", few: "секунды", many: "секунд", other: "секунды" })}.`,
      checkEmail: "Проверьте почту. Откройте ссылку boks для администратора на этом устройстве.",
      emailPlaceholder: "Почта",
      sending: "Отправляем…",
      sendAgainIn: (wait: string) => `Отправить снова через ${wait}`,
      sendLink: "Отправить ссылку",
      codeLabel: "Или введите шестизначный код из того же письма",
      signInWithCode: "Войти по коду",
      accessRequired: "Нужен доступ администратора",
      signedInAs: "Вы вошли",
      asHandle: (handle: string) => `как @${handle}.`,
      noAccess: "У этого аккаунта нет доступа администратора. Открыть ему студию может любой действующий администратор.",
      accessHint: "Доступ администратора привязан к аккаунту, а не к настройке на этом устройстве.",
      anotherEmail: "Войти с другим адресом",
      anotherEmailHint: "Одноразовая ссылка или шестизначный код",
      couldNotSwitch: "Не удалось сменить аккаунт.",
      approved: (title: string) => `«${title}» одобрен и опубликован.`,
      refused: (title: string) => `«${title}» отклонён. Автор увидит причину.`,
      couldNotReview: "Не удалось проверить бок.",
      refresh: "Обновить",
      export: "Экспорт",
      waitingForReview: "ждут проверки",
      publicationTotals: "Итоги публикаций",
      totals: (published: number, refused: number, approved: number) =>
        `опубликовано: ${published} · отклонено: ${refused} · одобрено от авторов: ${approved}`,
      queueFailed: "Не удалось загрузить очередь проверки. Нажмите «Обновить», чтобы попробовать снова.",
      queueLoading: "Загружаем очередь проверки…",
    },
  }
);

/** EN / RU for the console; the same stored choice as the reader's account panel. */
function LanguageSwitch() {
  const t = useMessages(words);
  const preference = useUiLanguagePreference();
  const current = useUiLanguage();
  return (
    <div className="studio-back" role="group" aria-label={t.language} style={{ marginTop: 0 }}>
      {uiLanguages.map((language) => {
        const active = preference === "system" ? current === language : preference === language;
        return (
          <button key={language} type="button" lang={language} aria-pressed={active}
            className={active ? "font-semibold text-[var(--studio-ink)]" : undefined}
            onClick={() => setUiLanguagePreference(language)}>
            {language.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The moderation queue is the last thing still served by the old admin
 * snapshot. Everything else now reads attributed events through its own RPC, so
 * the snapshot is fetched only when the queue is open.
 */
const snapshotTabs = new Set<AdminTab>(["moderation"]);

const pageSize = 100;

export function AdminDashboard() {
  const t = useMessages(words);
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
      setAuthStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotCheckAccess);
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
      setAuthStatus(t.enterEmail);
      return;
    }

    const remaining = magicLinkCooldownRemainingMs(email);
    if (remaining > 0) {
      setAuthStatus(t.oneLinkAMinute(Math.ceil(remaining / 1000)));
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
      setAuthStatus(t.checkEmail);
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
    <nav className="studio-navigation" aria-label={t.sections}>
      {groups.map((group) => (
        <div key={group} className="studio-navigation__group">
          <p>{t.groups[group]}</p>
          {adminTabs.filter((entry) => entry.group === group).map((entry) => (
            <button key={entry.id} type="button" aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => navigate(entry.id)}>
              <span>{t.labels[entry.id]}</span>
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
          ? t.approved(item.title)
          : t.refused(item.title)
      );
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.couldNotReview);
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
          <p className="text-[var(--muted-foreground)]">{t.checkingAccess}</p>
        </div>
      </main>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <main className="studio-access min-h-screen px-4 py-5 sm:px-8">
        <section className="auth-panel mx-auto mt-12">
          <a href="/" className="studio-brand" aria-label={t.brandHome}><BoksLogo /></a>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal">{t.signInTitle}</h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            {t.signInLead}
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
              placeholder={t.emailPlaceholder}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" disabled={busy || adminWaiting}>
              <Shield className="size-4" />
              {busy
                ? t.sending
                : adminWaiting
                  ? t.sendAgainIn(formatCooldown(adminCooldownSeconds))
                  : t.sendLink}
            </Button>
          </form>
          {sentEmail && (
            <form className="mt-5 grid gap-3" onSubmit={(event) => { event.preventDefault(); void submitEmailCode(); }}>
              <label htmlFor="admin-email-code">{t.codeLabel}</label>
              <Input id="admin-email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
                value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, ""))} required />
              <Button type="submit" disabled={busy || emailCode.length !== 6}>{t.signInWithCode}</Button>
            </form>
          )}
          {authStatus && <p className="mt-4 text-sm text-[var(--muted-foreground)]">{authStatus}</p>}
        </section>
      </main>
    );
  }

  if (user.role !== "admin") {
    return <main className="studio-access studio-access-page"><header className="studio-access-header"><a href="/" aria-label={t.backToReading}><ArrowLeft /></a><a href="/" className="studio-brand" aria-label={t.brandHome}><BoksLogo /></a></header><section className="studio-access-body"><p className="studio-eyebrow">{t.studio}</p><h1>{t.accessRequired}</h1><LockKeyhole className="studio-access-lock" /><h2>{t.signedInAs}<br />{t.asHandle(user.handle || "reader")}</h2><p>{t.noAccess}</p><p className="studio-hint">{t.accessHint}</p><div className="studio-link-rows"><button type="button" onClick={() => { void signOutBoksUser().then(() => setUser(null)).catch((error) => setAuthStatus(error instanceof Error ? error.message : t.couldNotSwitch)); }}><span><strong>{t.anotherEmail}</strong><small>{t.anotherEmailHint}</small></span><span>↗</span></button></div><Button asChild><a href="/">{t.backToReading}</a></Button>{authStatus && <p role="status">{authStatus}</p>}</section></main>;
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
        <a href="/" className="studio-brand" aria-label={t.brandHome}><BoksLogo /></a>
        {sectionNavigation}
        <a href="/" className="studio-back"><ArrowLeft aria-hidden="true" /> {t.backToReading}</a>
        <LanguageSwitch />
      </aside>
      <div className="studio-main">
        <header className="studio-topbar">
          <button type="button" className="studio-mobile-back" aria-label={tab === "overview" ? t.backToReading : t.backToOverview} onClick={() => { if (tab === "overview") window.location.assign("/"); else navigate("overview"); }}><ArrowLeft /></button>
          <a href="/" className="studio-brand studio-mobile-brand" aria-label={t.brandHome}><BoksLogo /></a>
          <span className="studio-breadcrumb">{t.groups[activeTab.group]} / {t.labels[tab]}</span>
          <span className="studio-account">@{user.handle || "admin"}</span>
          <Button variant="ghost" size="icon" className="studio-menu-button" aria-label={t.sections}
            aria-expanded={sectionsOpen} onClick={() => setSectionsOpen(true)}><Menu /></Button>
        </header>
        <div className="studio-content">
          <div className="studio-heading">
            <div><p className="studio-eyebrow">{tab === "overview" ? t.studio : `${t.groups[activeTab.group]} / ${t.labels[tab]}`}</p><h1>{t.headings[tab]}</h1></div>
            {needsSnapshot && (
              <div className="studio-heading__actions">
                <Button variant="outline" onClick={() => loadSnapshot().catch((error) => setStatus(error.message))}>
                  <RefreshCw className="size-4" /> {t.refresh}
                </Button>
                <Button variant="outline" onClick={downloadMetrics}><Download className="size-4" /> {t.export}</Button>
              </div>
            )}
          </div>
        {tab === "overview" && <AdminOverview onNavigate={navigate} />}

        {tab === "moderation" && (
          <>
            {metrics.moderationQueue !== undefined && <section className="studio-editorial-tally">
              <strong>{numberValue(funnel.pendingReview)}</strong><span>{t.waitingForReview}</span>
              <details><summary>{t.publicationTotals}</summary><p>{t.totals(numberValue(funnel.totalStories), numberValue(funnel.rejectedBoks), numberValue(funnel.approvedAuthorBoks))}</p></details>
            </section>}
            {/* The result of the last decision. It was set and never shown. */}
            {status && status !== "Loading" && status !== "Ready" && (
              <p className="text-sm text-[var(--muted-foreground)]" role="status" aria-live="polite">
                {status}
              </p>
            )}
            {metrics.moderationQueue === undefined ? (
              <p role="status">{phase === "failed" ? t.queueFailed : t.queueLoading}</p>
            ) : <ModerationQueue items={metrics.moderationQueue} busy={busy} onReview={moderateBok} onRefresh={() => loadSnapshot().catch((error) => setStatus(error.message))} />}
          </>
        )}

        {tab === "rights" && <RightsReview />}

        {tab === "experiments" && <RecommendationLab />}
        {tab === "studies" && <AdminStudies />}
        {tab === "interactions" && <InteractionSandbox />}
        {tab === "poetry" && <PoetrySandbox />}
        {tab === "cutter" && <FragmentCutter />}

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
          <SheetHeader><SheetTitle>{t.studio}</SheetTitle><SheetDescription>{t.chooseSection}</SheetDescription></SheetHeader>
          {sectionNavigation}
          <a href="/" className="studio-back"><ArrowLeft aria-hidden="true" /> {t.backToReading}</a>
          <LanguageSwitch />
        </SheetContent>
      </Sheet>
    </main>
    </AdminInspectorProvider>
  );
}
