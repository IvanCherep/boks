"use client";

import { readPendingEmailCode } from "@/components/boks/pending-email-code";
import { SeriesRecorder } from "@/components/boks/admin/series-recorder/series-recorder";
import { SeriesEntry } from "./series-entry";
import { seriesRecorderOpenTo } from "@/lib/boks/series-recorder/switch";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { linkOnlyCover } from "@/lib/boks/link-only";
import { AuthorLanding } from "@/components/boks/author-landing/author-landing";
import { dropUnclaimedLandingFrame } from "@/components/boks/author-landing/early-frame";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthorBokSubmission, AuthorProfile, BoksUserContext } from "@/components/boks/client-types";
import {
  deleteMyBok,
  loadMyAuthorAccess,
  loadMySeriesAccess,
  type SeriesAccess,
  type AuthorAccess,
  loadBoksAuthor,
  loadBoksUserContext,
  loadMyDefaultAuthorName,
  restoreMyBok,
  withdrawMyBok,
} from "@/components/boks/supabase-browser-data";
import { UserAuthPanel } from "@/components/boks/user-auth-panel";
import { AuthorPortraitPage } from "@/components/boks/author-portrait-page";
import { authorInitials } from "@/components/boks/author-rings";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { authorShareUrl } from "@/lib/boks/share-link";
import { readableBoksError } from "@/lib/boks/errors";
import { cabinetMessages, type CabinetWords } from "./messages";
import { Library, StatsView, statusClass, statusLabel } from "./library";
import { usePublishing, type PublishingView } from "./publishing";
import { useProfileEditor, type ProfileView } from "./profile-editor";
import { Icon, Sheet, SheetAction, Thumb, useLatest, useToast } from "./ui";
import { MyPage, myPageViews, type MyPageView } from "./my-page";
import { openInComposer } from "./composer";
import { loadPublishing } from "./composer-data";
import { InviteScreen, InviteSignIn } from "./invite";
import { loadMyAuthorSpace, loadMyInvites, type InviteOffer, type MyAuthorSpace } from "@/components/boks/author-spaces/data";
import { inviteTokenFromHash, pendingInviteKey } from "@/lib/boks/author/invite-link";
import { signOutBoksUser } from "@/lib/boks/supabase-client";

/**
 * The author cabinet, `/author` (design v51, 2026-11-09).
 *
 * One page with a view per step, kept in the address (`#write`,
 * `#stats/<id>`, `#profile-edit`…) so Back and a reload behave. Views whose
 * state lives only in this tab (a queue being sent, a crop) fall back to the
 * library after a reload.
 */

type View = "library" | `stats/${string}` | PublishingView | ProfileView | MyPageView | "invite" | "series";

const publishingViews = new Set<string>(["write", "preview", "review", "upload", "queue", "split", "sending", "result"]);
const profileViews = new Set<string>(["profile-edit", "profile-photo", "profile-preview"]);

function viewFromHash(): View {
  const hash = typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1));
  if (hash.startsWith("stats/") && hash.length > 6) return hash as View;
  if (publishingViews.has(hash) || profileViews.has(hash) || myPageViews.has(hash)) return hash as View;
  if (hash === "invite" || hash.startsWith("invite=")) return "invite";
  if (hash === "series") return "series";
  return "library";
}

type SheetState =
  | { kind: "new" }
  | { kind: "menu"; item: AuthorBokSubmission }
  | { kind: "confirm"; action: "withdraw" | "restore" | "delete"; item: AuthorBokSubmission }
  | { kind: "info"; title: string; body: string };

/** The line under "My page" in the library: what waits for the author. */
function myPageHint(page: MyAuthorSpace, w: CabinetWords) {
  if (page.unread) return w.myPageReply(page.unread);
  const ready = page.items.filter((item) => item.work?.status === "ready").length;
  const preparing = page.items.filter((item) => item.work && ["preparing", "changes_requested"].includes(item.work.status)).length;
  if (ready) return w.myPageReady(ready);
  if (preparing) return w.myPagePreparing(preparing);
  return w.myPageOrder;
}

export function AuthorCabinet() {
  const w = useMessages(cabinetMessages);
  const language = useUiLanguage();
  const toast = useToast();
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [defaultByline, setDefaultByline] = useState("");
  const [view, setView] = useState<View>("library");
  const [selected, setSelected] = useState<AuthorBokSubmission | null>(null);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewAuthor, setPreviewAuthor] = useState<AuthorProfile | null>(null);
  // An invitation link's token (`#invite=<token>`), kept for this tab while
  // the person signs in, then forgotten (`invite.tsx`).
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [myPage, setMyPage] = useState<MyAuthorSpace | null>(null);
  /** Pages the team prepared for this account's email: offered here, no link needed. */
  const [offers, setOffers] = useState<InviteOffer[]>([]);
  const [offer, setOffer] = useState<InviteOffer | null>(null);
  /**
   * Whether this account has a cabinet yet (`get_my_author_access`): null
   * while asking, and when the question failed - the cabinet is then shown,
   * as it was before the page for authors existed.
   */
  const [access, setAccess] = useState<{ loaded: boolean; value: AuthorAccess | null }>({ loaded: false, value: null });
  /** Boks Series the team has granted this account (`docs/series-recorder.md`); null when none or unknown. */
  const [series, setSeries] = useState<SeriesAccess | null>(null);
  // Authors' own Boks Series are hidden while the switch is off (`lib/boks/series-recorder/switch.ts`); Studio keeps them.
  const seriesOpen = Boolean(series?.allowed && seriesRecorderOpenTo(series));
  /** An author with an open page publishes from My page, straight away (`docs/author-publishing.md`). */
  const [direct, setDirect] = useState(false);
  const libraryScroll = useRef(0);

  const author = user && !user.isAnonymous ? user : null;
  // Back from the mail app to a reloaded tab: straight to the code again (pending-email-code.ts).
  useEffect(() => {
    if (!userLoaded || author) return;
    const pending = readPendingEmailCode("author");
    if (!pending || pending.dismissed) return;
    const timer = window.setTimeout(() => setAuthOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [userLoaded, author]);
  const suspended = Boolean(author?.bannedAt);

  const refreshUser = useCallback(async () => {
    const context = await loadBoksUserContext();
    setUser(context);
    setUserLoaded(true);
    if (context && !context.isAnonymous) {
      setDefaultByline(await loadMyDefaultAuthorName().catch(() => ""));
      setRefreshKey((key) => key + 1);
    }
    return context;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshUser().catch(() => setUserLoaded(true)), 0);
    return () => window.clearTimeout(timer);
  }, [refreshUser]);

  // ------------------------------------------------------------ navigation

  const viewRef = useLatest(view);

  const show = useCallback((next: View, mode: "push" | "replace" | "none" = "push") => {
    if (viewRef.current === "library") libraryScroll.current = window.scrollY;
    const hash = next === "library" ? window.location.pathname + window.location.search : `#${next}`;
    if (mode === "push") window.history.pushState(null, "", hash);
    else if (mode === "replace") window.history.replaceState(null, "", hash);
    setView(next);
    setSheet(null);
    window.requestAnimationFrame(() => window.scrollTo(0, next === "library" ? libraryScroll.current : 0));
  }, []);

  const publishing = usePublishing({
    w,
    language,
    defaultByline,
    canSend: Boolean(author) && !suspended,
    onNeedAccount: () => setAuthOpen(true),
    onSent: () => setRefreshKey((key) => key + 1),
    go: (next) => go(next),
    toast: toast.show,
  });

  /** Where the page editor's Back leads: My page when it was opened from there. */
  const profileBack = useRef<View>("library");
  const profile = useProfileEditor({
    w,
    language,
    enabled: Boolean(author),
    go: (next) => go(next === "library" ? profileBack.current : next),
    toast: toast.show,
  });

  const profileRef = useLatest(profile);

  /** Every move between views; leaving the page editor with changes asks first. */
  function go(next: View) {
    if (profileViews.has(view) && !profileViews.has(next) && !profile.requestLeave(() => show(next))) return;
    show(next);
  }

  // The browser's Back and Forward.
  useEffect(() => {
    const onPop = () => {
      const next = viewFromHash();
      const current = viewRef.current;
      if (profileViews.has(current) && !profileViews.has(next)) {
        const allowed = profileRef.current.requestLeave(() => show(next, "replace"));
        if (!allowed) {
          window.history.pushState(null, "", `#${current}`);
          return;
        }
      }
      if (current === "library") libraryScroll.current = window.scrollY;
      setView(next);
      setSheet(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [show]);

  // An invitation: take the token out of the address bar and history.
  useEffect(() => {
    const fromLink = inviteTokenFromHash(window.location.hash);
    let token = fromLink;
    if (fromLink) {
      try {
        window.sessionStorage.setItem(pendingInviteKey, fromLink);
      } catch {
        // Kept in this tab's state only.
      }
      window.history.replaceState(null, "", `${window.location.pathname}#invite`);
    } else {
      try {
        token = window.sessionStorage.getItem(pendingInviteKey);
      } catch {
        token = null;
      }
    }
    const timer = token
      ? window.setTimeout(() => {
          setInviteToken(token);
          setView("invite");
        }, 0)
      : 0;
    // A link opened in a tab where the cabinet is already open changes only
    // the hash: the page does not load again, so listen for it.
    const onHash = () => {
      const next = inviteTokenFromHash(window.location.hash);
      if (!next) return;
      try {
        window.sessionStorage.setItem(pendingInviteKey, next);
      } catch {
        // Kept in this tab's state only.
      }
      window.history.replaceState(null, "", `${window.location.pathname}#invite`);
      setInviteToken(next);
      setView("invite");
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // What the "My page" entry in the library says.
  useEffect(() => {
    if (!user || user.isAnonymous) return;
    let active = true;
    loadMyAuthorSpace().then((answer) => active && setMyPage(answer)).catch(() => undefined);
    loadPublishing(null).then((answer) => active && setDirect(answer.direct)).catch(() => undefined);
    // Access and invitations together: an account the team has invited never sees the page for authors.
    void Promise.all([loadMyAuthorAccess().catch(() => null), loadMyInvites().catch(() => [] as InviteOffer[]), loadMySeriesAccess()]).then(([value, invites, seriesAccess]) => {
      if (!active) return;
      setSeries(seriesAccess);
      setOffers(invites);
      setAccess({ loaded: true, value });
    });
    return () => {
      active = false;
    };
  }, [user, refreshKey]);

  // An author the team prepared a page for comes for that page: after the
  // code from the email, open it straight away - the invitation when there is
  // one to accept, else My page while something waits for their decision.
  // Only from the bare cabinet address, once, and never for someone who
  // already publishes here (their library is what they come for).
  const steered = useRef(false);
  useEffect(() => {
    if (steered.current || !access.loaded || view !== "library" || window.location.hash) return;
    if (access.value?.admin) return;
    const firstTime = (access.value?.published ?? 0) === 0;
    if (firstTime && offers.length > 0 && !inviteToken) {
      steered.current = true;
      const timer = window.setTimeout(() => { setOffer(offers[0]); setView("invite"); }, 0);
      return () => window.clearTimeout(timer);
    }
    // An author who publishes straight away works from My page: it is their home.
    if (direct) {
      steered.current = true;
      const timer = window.setTimeout(() => show("my-page", "replace"), 0);
      return () => window.clearTimeout(timer);
    }
    // Also later: a reply from the team, or a work back from changes, is what they come for.
    const waiting = myPage?.space && ((myPage.unread ?? 0) > 0 || myPage.items.some((item) => item.work && ["ready", "changes_requested", "preparing"].includes(item.work.status)));
    if (waiting) {
      steered.current = true;
      const timer = window.setTimeout(() => show("my-page", "replace"), 0);
      return () => window.clearTimeout(timer);
    }
  }, [access, offers, myPage, view, inviteToken, show, direct]);

  // `#series` while the recorder is hidden for authors: back to My page (or the library without one).
  useEffect(() => {
    if (view !== "series" || !access.loaded || seriesOpen) return;
    const timer = window.setTimeout(() => show(direct || myPage?.space ? "my-page" : "library", "replace"), 0);
    return () => window.clearTimeout(timer);
  }, [view, access.loaded, seriesOpen, direct, myPage, show]);

  // The address the page was opened at.
  useEffect(() => {
    const first = viewFromHash();
    if (first !== "library") {
      const timer = window.setTimeout(() => setView(first), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  // A view that needs what a reload lost goes back to the library.
  const shown: View =
    (publishingViews.has(view) && !publishing.canShow(view as PublishingView)) ||
    (profileViews.has(view) && (!profile.canShow(view as ProfileView) || !author)) ||
    (view === "invite" && !inviteToken && !offer) ||
    (view !== "library" && !author)
      ? "library"
      : view;

  // The preview of one's own page reads the published boks it will list.
  useEffect(() => {
    if (shown !== "profile-preview" || !profile.saved?.handle) return;
    let active = true;
    loadBoksAuthor(profile.saved.handle)
      .then((answer) => active && setPreviewAuthor(answer))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [shown, profile.saved?.handle]);

  // ------------------------------------------------------------ bok actions

  function openItem(item: AuthorBokSubmission) {
    setSelected(item);
    if (item.status === "published") go(`stats/${item.id}`);
    else setSheet({ kind: "menu", item });
  }

  async function act(item: AuthorBokSubmission, action: "withdraw" | "restore" | "delete") {
    setBusy(true);
    try {
      if (action === "withdraw") {
        await withdrawMyBok(item.id);
        toast.show(w.withdrawnDone(item.title));
      } else if (action === "restore") {
        await restoreMyBok(item.id);
        const from = item.withdrawnFromStatus;
        toast.show(from === "published" ? w.restoredPublished(item.title) : from === "rejected" ? w.restoredRejected(item.title) : w.restoredReview(item.title));
      } else {
        await deleteMyBok(item.id, confirmTitle);
        toast.show(w.deleted(item.title));
      }
      setSheet(null);
      setConfirmTitle("");
      setRefreshKey((key) => key + 1);
      if (view.startsWith("stats/")) go("library");
    } catch (error) {
      toast.show(readableBoksError(error, w.actionFailed, language));
    } finally {
      setBusy(false);
    }
  }

  function revise(item: AuthorBokSubmission) {
    setSheet(null);
    publishing.revise({ id: item.id, title: item.title, body: item.body, authorName: item.authorName, reviewNote: item.status === "rejected" ? item.reviewNote : null });
  }

  function menuBody(item: AuthorBokSubmission) {
    const read = <SheetAction icon="book" label={w.view} onClick={() => (window.location.href = `/b/${item.id}`)} />;
    const stats = <SheetAction icon="stats" label={w.stats} onClick={() => go(`stats/${item.id}`)} />;
    const confirm = (action: "withdraw" | "restore" | "delete") => () => {
      setConfirmTitle("");
      setSheet({ kind: "confirm", action, item });
    };
    if (suspended) {
      return (
        <>
          <div className="notice">
            <p>{w.noticeBody}</p>
          </div>
          {item.status === "published" && read}
          {item.status === "published" && stats}
        </>
      );
    }
    switch (item.status) {
      case "published":
        return (
          <>
            {read}
            {stats}
            <SheetAction icon="undo" label={w.withdraw} onClick={confirm("withdraw")} />
          </>
        );
      case "pending_review":
        return <SheetAction icon="undo" label={w.withdrawReview} onClick={confirm("withdraw")} />;
      case "rejected":
        return (
          <>
            {item.reviewNote && (
              <div className="notice">
                <strong>{w.reason}</strong>
                <p>{item.reviewNote}</p>
              </div>
            )}
            {item.body && <SheetAction icon="write" label={w.revise} onClick={() => revise(item)} />}
            <SheetAction icon="undo" label={w.withdrawRejected} onClick={confirm("withdraw")} />
          </>
        );
      case "withdrawn":
        return (
          <>
            <SheetAction icon="undo" label={w.restore} onClick={confirm("restore")} />
            {item.body && <SheetAction icon="write" label={w.edit} onClick={() => revise(item)} />}
            <SheetAction icon="trash" label={w.erase} danger onClick={confirm("delete")} />
          </>
        );
      case "archived":
        return (
          <>
            <div className="notice">
              <p>{item.reviewNote ? `${item.reviewNote} ` : ""}{w.archivedBody}</p>
            </div>
            {stats}
            <SheetAction icon="comment" label={w.support} onClick={() => setSheet({ kind: "info", title: w.support, body: w.supportBody })} />
          </>
        );
      default:
        return null;
    }
  }

  function confirmCopy(action: "withdraw" | "restore" | "delete", item: AuthorBokSubmission, words: CabinetWords) {
    if (action === "delete") return { title: words.deleteTitle, body: words.deleteBody, button: words.erase };
    if (action === "restore") {
      const from = item.withdrawnFromStatus;
      return {
        title: words.restoreTitle,
        body: from === "published" ? words.restorePublishedBody : from === "rejected" ? words.restoreRejectedBody : words.restoreReviewBody,
        button: words.restore,
      };
    }
    if (item.status === "pending_review") return { title: words.withdrawReviewTitle, body: words.withdrawReviewBody, button: words.confirm };
    if (item.status === "rejected") return { title: words.withdrawRejectedTitle, body: words.withdrawRejectedBody, button: words.confirm };
    return { title: words.withdrawTitle, body: words.withdrawBody, button: words.confirm };
  }

  // ------------------------------------------------------------ sheets

  let sheetNode: React.ReactNode = null;
  if (sheet?.kind === "new") {
    sheetNode = (
      <Sheet title={w.newTitle} closeLabel={w.close} onClose={() => setSheet(null)}>
        <SheetAction icon="write" label={w.write} hint={w.writeHint} onClick={() => publishing.startWriting(!publishing.hasDraft)} />
        <SheetAction icon="upload" label={w.upload} hint={w.uploadHint} onClick={() => go("upload")} />
      </Sheet>
    );
  } else if (sheet?.kind === "menu") {
    const item = sheet.item;
    sheetNode = (
      <Sheet
        title={item.title}
        closeLabel={w.close}
        onClose={() => setSheet(null)}
        head={{ thumb: <Thumb id={item.id} title={item.title} />, byline: item.authorName || `@${author?.handle ?? ""}` }}
      >
        <span className={`status ${statusClass(item.status)}`}>{statusLabel(item.status, w)}</span>
        <div style={{ height: 10 }} />
        {menuBody(item)}
      </Sheet>
    );
  } else if (sheet?.kind === "confirm") {
    const { item, action } = sheet;
    const copy = confirmCopy(action, item, w);
    const isDelete = action === "delete";
    sheetNode = (
      <Sheet title={copy.title} closeLabel={w.close} onClose={() => setSheet(null)}>
        <p>{copy.body}</p>
        <p className="serif" style={{ fontSize: 25, marginTop: 16 }}>
          {item.title}
        </p>
        {isDelete && (
          <input
            className="input-confirm"
            aria-label={item.title}
            placeholder={item.title}
            autoComplete="off"
            value={confirmTitle}
            onChange={(event) => setConfirmTitle(event.target.value)}
          />
        )}
        <div className="sheet-buttons">
          <button type="button" className="btn btn-secondary" onClick={() => setSheet(null)}>
            {w.cancel}
          </button>
          <button
            type="button"
            className={`btn ${isDelete ? "btn-red" : ""}`}
            disabled={busy || (isDelete && confirmTitle.trim() !== item.title.trim())}
            onClick={() => void act(item, action)}
          >
            {copy.button}
          </button>
        </div>
      </Sheet>
    );
  } else if (sheet?.kind === "info") {
    sheetNode = (
      <Sheet title={sheet.title} closeLabel={w.close} onClose={() => setSheet(null)}>
        <p>{sheet.body}</p>
      </Sheet>
    );
  }

  // A guest's page for authors may have started before the app (early-frame.ts): once this account
  // is known to see something else, it goes. The page claims its frame first (children's effects run first).
  useEffect(() => {
    if (!userLoaded || (author && !access.loaded && !inviteToken)) return;
    dropUnclaimedLandingFrame();
  });

  // ------------------------------------------------------------ screens

  if (!userLoaded) {
    return (
      <div className="acab">
        <main className="page detail-page">
          <p className="desk-note">{w.loading}</p>
        </main>
      </div>
    );
  }

  if (!author) {
    // A guest sees what boks offers an author; signing in comes with the application.
    // The page stands outside the cabinet's own styles (`.acab`), which restyle every button.
    return (
      <div className={inviteToken ? "acab" : undefined}>
        {inviteToken ? <InviteSignIn token={inviteToken} onSignIn={() => setAuthOpen(true)} /> : <AuthorLanding access={null} signedIn={false} onSignIn={() => setAuthOpen(true)} />}
        <UserAuthPanel
          open={authOpen}
          surface="author"
          reason="manual"
          guestReadCount={0}
          currentUser={user}
          onClose={() => setAuthOpen(false)}
          onOpenReadBoks={() => undefined}
          onUserChanged={(next) => {
            setUser(next);
            void refreshUser();
          }}
        />
      </div>
    );
  }

  // No cabinet yet: nothing published, no author page, no invitation, not Studio (`docs/author-applications.md`).
  if (!access.loaded && !inviteToken) {
    return (
      <div className="acab">
        <main className="page detail-page">
          <p className="desk-note">{w.loading}</p>
        </main>
      </div>
    );
  }
  const withoutCabinet = access.value && !access.value.admin && access.value.published === 0 && !access.value.hasPage
    && offers.length === 0 && !inviteToken && !myPage?.space && !seriesOpen;
  if (withoutCabinet) return <AuthorLanding access={access.value} signedIn />;

  // The recorder, on its own page: Studio's paper and ink, outside the cabinet's own styles.
  if (shown === "series" && seriesOpen) {
    return (
      <div className="series-host">
        <div className="series-host__bar">
          <button type="button" onClick={() => go("library")}><Icon name="back" /> {w.seriesBack}</button>
          <h1>boks</h1>
        </div>
        <SeriesRecorder mode="author" />
      </div>
    );
  }

  const savedIdentity = profile.saved ? profile.identity(false) : null;
  // A bok's cover as the page shows it: its own Series' first picture (a link-only
  // piece known from My page), else the catalogue's artwork (`getBokArtwork`).
  const pieces = new Map((myPage?.items ?? []).filter((item) => item.bokId && item.work?.seriesPiece).map((item) => [item.bokId!, item.work!.seriesPiece!]));
  // A published bok's own picture (`bok_covers`), served once it is published.
  const ownCovers = new Map((myPage?.items ?? []).filter((item) => item.bokId && item.published && item.coverVersion).map((item) => [item.bokId!, item.coverVersion!]));
  const bokCover = (bokId: string) => (pieces.has(bokId) ? linkOnlyCover(pieces.get(bokId)!) : getBokArtwork({ id: bokId, coverVersion: ownCovers.get(bokId) }));
  const libraryIdentity = {
    handle: author.handle || "",
    initials: savedIdentity?.initials || Array.from(authorInitials("", author.handle)).slice(0, 1).join("") || "b",
    photo: savedIdentity?.photo ?? null,
  };

  let content: React.ReactNode = null;
  if (shown.startsWith("stats/")) {
    const id = shown.slice(6);
    const item = selected?.id === id ? selected : null;
    content = (
      <StatsView
        coverOf={bokCover}
        key={id}
        bokId={id}
        item={item}
        w={w}
        language={language}
        onBack={() => go("library")}
        onMenu={() => item && setSheet({ kind: "menu", item })}
        onInfo={(kind) =>
          setSheet(kind === "readers" ? { kind: "info", title: w.readers, body: w.readerHint } : { kind: "info", title: w.statHelp, body: w.statHint })
        }
      />
    );
  } else if (shown === "invite" && (inviteToken || offer)) {
    content = (
      <InviteScreen
        key={inviteToken ?? offer?.inviteId}
        token={inviteToken}
        offer={inviteToken ? null : offer}
        email={user?.email ?? null}
        onAccepted={() => {
          setInviteToken(null);
          setOffer(null);
          setRefreshKey((key) => key + 1);
          // Accepting can change the account's @name, name and photo: read them again.
          void refreshUser();
          profileRef.current.reload();
          show("my-page", "replace");
        }}
        onSwitchAccount={() => {
          void signOutBoksUser().finally(() => {
            setUser(null);
            setAuthOpen(true);
          });
        }}
        onDismiss={() => {
          setInviteToken(null);
          setOffer(null);
          show("library", "replace");
        }}
      />
    );
  } else if (myPageViews.has(shown)) {
    content = (
      <MyPage
        key={`${shown}-${refreshKey}`}
        view={shown as MyPageView}
        // What was published or hidden on My page shows in the library at once.
        go={(next) => { if (next === "library") setRefreshKey((key) => key + 1); go(next); }}
        toast={toast.show}
        onEditProfile={() => {
          profileBack.current = "my-page";
          go("profile-edit");
        }}
        onIdentityChanged={() => {
          void refreshUser();
          profileRef.current.reload();
        }}
      />
    );
  } else if (publishingViews.has(shown)) {
    content = publishing.render(shown as PublishingView);
  } else if (shown === "profile-edit" || shown === "profile-photo") {
    content = profile.render(shown);
  } else if (shown === "profile-preview") {
    const draft = profile.identity(true);
    content = (
      <>
        <AuthorPortraitPage
          identity={{ handle: draft.handle, name: draft.name || `@${draft.handle}`, photo: draft.photo, thumb: draft.photo, focus: "50% 50%" }}
          author={previewAuthor}
          profileLink={typeof window === "undefined" ? "" : authorShareUrl(draft.handle, window.location.origin)}
          following={false}
          busy={false}
          onToggleFollow={() => undefined}
          onOpenBok={() => undefined}
          onClose={() => go("profile-edit")}
        />
        <div className="acab-preview-label" role="status">
          {profile.unsaved ? w.previewDraft : w.previewSaved}
        </div>
      </>
    );
  }

  return (
    <div className="acab">
      <div hidden={shown !== "library"}>
        <Library
          w={w}
          identity={libraryIdentity}
          suspended={suspended}
          suspendedReason={author.banReason ?? null}
          refreshKey={refreshKey}
          hasDraft={publishing.hasDraft}
          onNew={() => {
            if (!direct) { setSheet({ kind: "new" }); return; }
            openInComposer(null);
            go("my-page-new");
          }}
          onContinueDraft={() => publishing.startWriting(false)}
          onEditPage={() => {
            profileBack.current = "library";
            go("profile-edit");
          }}
          coverOf={bokCover}
          pageEntry={offers.length > 0 || seriesOpen || (myPage && (myPage.space || myPage.items.length > 1)) ? (
            <>
            {seriesOpen && series && <SeriesEntry access={series} onOpen={() => go("series")} />}
            {offers.map((item) => (
              <button key={item.inviteId} type="button" className="draft-strip amp-strip amp-strip--attention" onClick={() => { setOffer(item); setView("invite"); }}>
                <span className="draft-icon">
                  <Icon name="book" />
                </span>
                <span>
                  <strong>{item.existingPage ? w.offerExistingTitle : w.offerTitle(item.name ?? "")}</strong>
                  <small>{w.offerHint(item.works)}</small>
                </span>
                <span className="draft-continue">
                  {w.open}
                  <Icon name="arrow" />
                </span>
              </button>
            ))}
            {myPage && (myPage.space || myPage.items.length > 1) && (
            <button type="button" className={`draft-strip amp-strip${myPage.unread || myPage.items.some((item) => item.work?.status === "ready") ? " amp-strip--attention" : ""}`} onClick={() => go("my-page")}>
              <span className="draft-icon">
                <Icon name="book" />
              </span>
              <span>
                <strong>{w.myPage}</strong>
                <small>{myPageHint(myPage, w)}</small>
              </span>
              <span className="draft-continue">
                {w.open}
                <Icon name="arrow" />
              </span>
            </button>
            )}
            </>
          ) : null}
          onOpen={openItem}
          onMenu={(item) => {
            setSelected(item);
            setSheet({ kind: "menu", item });
          }}
        />
      </div>
      {content}
      {sheetNode}
      {profile.sheet}
      {toast.node}
    </div>
  );
}
