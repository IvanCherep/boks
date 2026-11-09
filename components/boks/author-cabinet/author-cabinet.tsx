"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthorBokSubmission, AuthorProfile, BoksUserContext } from "@/components/boks/client-types";
import {
  deleteMyBok,
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
import { Icon, Sheet, SheetAction, Thumb, Topbar, useLatest, useToast } from "./ui";

/**
 * The author cabinet, `/author` (design v51, 2026-11-09).
 *
 * One page with a view per step, kept in the address (`#write`,
 * `#stats/<id>`, `#profile-edit`…) so Back and a reload behave. Views whose
 * state lives only in this tab (a queue being sent, a crop) fall back to the
 * library after a reload.
 */

type View = "library" | `stats/${string}` | PublishingView | ProfileView;

const publishingViews = new Set<string>(["write", "preview", "review", "upload", "queue", "split", "sending", "result"]);
const profileViews = new Set<string>(["profile-edit", "profile-photo", "profile-preview"]);

function viewFromHash(): View {
  const hash = typeof window === "undefined" ? "" : decodeURIComponent(window.location.hash.slice(1));
  if (hash.startsWith("stats/") && hash.length > 6) return hash as View;
  if (publishingViews.has(hash) || profileViews.has(hash)) return hash as View;
  return "library";
}

type SheetState =
  | { kind: "new" }
  | { kind: "menu"; item: AuthorBokSubmission }
  | { kind: "confirm"; action: "withdraw" | "restore" | "delete"; item: AuthorBokSubmission }
  | { kind: "info"; title: string; body: string };

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
  const libraryScroll = useRef(0);

  const author = user && !user.isAnonymous ? user : null;
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

  const profile = useProfileEditor({
    w,
    language,
    enabled: Boolean(author),
    go: (next) => go(next),
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
    return (
      <div className="acab">
        <main className="page detail-page">
          <Topbar title={w.workspace} backLabel={w.back} languageLabel={w.languageSwitch} onBack={() => (window.location.href = "/")} />
          <section className="empty">
            <div className="empty-letter">b.</div>
            <h1>{w.signInTitle}</h1>
            <p>{w.signInBody}</p>
            <button type="button" className="btn" style={{ marginTop: 24 }} onClick={() => setAuthOpen(true)}>
              {w.emailAction} <Icon name="arrow" />
            </button>
          </section>
        </main>
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

  const savedIdentity = profile.saved ? profile.identity(false) : null;
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
          onNew={() => setSheet({ kind: "new" })}
          onContinueDraft={() => publishing.startWriting(false)}
          onEditPage={() => go("profile-edit")}
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
