"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AuthorBokStats,
  AuthorBokStatusFilter,
  AuthorBokSubmission,
  AuthorBokSubmissionsPage,
  BokReviewStatus,
} from "@/components/boks/client-types";
import { loadMyBokStats, loadMyBokSubmissionsPage } from "@/components/boks/supabase-browser-data";
import type { UiLanguage } from "@/lib/i18n/ui-language";
import type { CabinetWords } from "./messages";
import { Icon, LanguageSwitch, Thumb, Topbar, useLatest } from "./ui";

const pageSize = 20;

export const emptyCounts: AuthorBokSubmissionsPage["counts"] = {
  all: 0,
  pending_review: 0,
  published: 0,
  rejected: 0,
  withdrawn: 0,
  archived: 0,
};

/** The status class the design colours by. */
export function statusClass(status: BokReviewStatus) {
  return status === "pending_review" ? "review" : status;
}

export function statusLabel(status: BokReviewStatus, w: CabinetWords) {
  if (status === "pending_review") return w.statusReview;
  if (status === "published") return w.statusPublished;
  if (status === "rejected") return w.statusRejected;
  if (status === "withdrawn") return w.statusWithdrawn;
  if (status === "archived") return w.statusArchived;
  return w.statusDraft;
}

export function formatDate(value: string | null | undefined, language: UiLanguage) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(language === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function WorkRow({
  item,
  w,
  onOpen,
  onMenu,
}: {
  item: AuthorBokSubmission;
  w: CabinetWords;
  onOpen: (item: AuthorBokSubmission) => void;
  onMenu: (item: AuthorBokSubmission) => void;
}) {
  const status = statusClass(item.status);
  let meta: ReactNode;
  if (item.status === "published") {
    meta = (
      <div className="work-meta">
        <span aria-label={w.readersLabel(item.readers ?? 0)}>
          <Icon name="eye" />
          {item.readers ?? 0}
        </span>
        <span aria-label={w.likesLabel(item.likes)}>
          <Icon name="heart" />
          {item.likes}
        </span>
        <span aria-label={w.commentsLabel(item.comments)}>
          <Icon name="comment" />
          {item.comments}
        </span>
      </div>
    );
  } else if (item.status === "rejected") {
    meta = (
      <p className="reason">
        {w.reason} <Icon name="arrow" />
      </p>
    );
  } else {
    meta = (
      <div className="work-meta work-meta-text">
        {item.status === "pending_review" ? w.upcoming : item.status === "archived" ? w.support : item.status === "withdrawn" ? w.restore : ""}
      </div>
    );
  }
  return (
    <article className={`work-row status-${status}`}>
      <button type="button" className="thumb-link" aria-label={item.title} onClick={() => onOpen(item)}>
        <Thumb id={item.id} title={item.title} />
      </button>
      <button type="button" className="work-info" onClick={() => onOpen(item)}>
        <span className={`status ${status}`}>{statusLabel(item.status, w)}</span>
        <h3>{item.title}</h3>
        {meta}
      </button>
      <button type="button" className="icon-btn work-menu-trigger" aria-label={`${w.actions}: ${item.title}`} onClick={() => onMenu(item)}>
        <Icon name="more" />
      </button>
    </article>
  );
}

const filters: { id: AuthorBokStatusFilter; key: "all" | "published" | "review" | "rejected" | "withdrawn" | "archived" }[] = [
  { id: "all", key: "all" },
  { id: "published", key: "published" },
  { id: "pending_review", key: "review" },
  { id: "rejected", key: "rejected" },
  { id: "withdrawn", key: "withdrawn" },
  { id: "archived", key: "archived" },
];

export type LibraryIdentity = { handle: string; initials: string; photo: string | null };

/**
 * The cabinet's first screen (design v51): the dark head with the author's
 * page, the unfinished text, and every bok they sent - filtered, searched and
 * loaded twenty at a time by the database (`get_my_bok_submissions`).
 */
export function Library({
  w,
  identity,
  suspended,
  suspendedReason,
  refreshKey,
  hasDraft,
  onNew,
  onContinueDraft,
  onEditPage,
  onOpen,
  onMenu,
  onCounts,
  pageEntry,
}: {
  w: CabinetWords;
  identity: LibraryIdentity;
  suspended: boolean;
  suspendedReason: string | null;
  refreshKey: number;
  hasDraft: boolean;
  onNew: () => void;
  onContinueDraft: () => void;
  onEditPage: () => void;
  onOpen: (item: AuthorBokSubmission) => void;
  onMenu: (item: AuthorBokSubmission) => void;
  onCounts?: (counts: AuthorBokSubmissionsPage["counts"]) => void;
  /** "My page": prepared works and the page's order (`my-page.tsx`). */
  pageEntry?: ReactNode;
}) {
  const [page, setPage] = useState<AuthorBokSubmissionsPage | null>(null);
  const [filter, setFilter] = useState<AuthorBokStatusFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const onCountsRef = useLatest(onCounts);

  const load = useCallback(async (options: { filter: AuthorBokStatusFilter; query: string; append?: number }) => {
    const ticket = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const next = await loadMyBokSubmissionsPage({
        status: options.filter,
        query: options.query,
        limit: pageSize,
        offset: options.append ?? 0,
      });
      if (ticket !== request.current) return;
      setPage((current) => (options.append && current ? { ...next, items: [...current.items, ...next.items] } : next));
      onCountsRef.current?.(next.counts);
    } catch {
      if (ticket === request.current) setFailed(true);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [onCountsRef]);

  const filterRef = useLatest(filter);
  const queryRef = useLatest(query);

  useEffect(() => {
    void load({ filter: filterRef.current, query: queryRef.current.trim() });
  }, [refreshKey, load, filterRef, queryRef]);

  // Search waits for the author to stop typing.
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) {
      firstQuery.current = false;
      return;
    }
    const handle = window.setTimeout(() => void load({ filter: filterRef.current, query: query.trim() }), 300);
    return () => window.clearTimeout(handle);
  }, [query, load, filterRef]);

  function choose(next: AuthorBokStatusFilter) {
    setFilter(next);
    void load({ filter: next, query: query.trim() });
  }

  function clearAll() {
    setQuery("");
    setFilter("all");
    void load({ filter: "all", query: "" });
  }

  const counts = page?.counts ?? emptyCounts;
  const empty = page !== null && counts.all === 0 && !failed;
  const items = page?.items ?? [];
  const left = Math.max(0, (page?.total ?? 0) - items.length);

  return (
    <main className="page library-page">
      <section className="cabinet-hero">
        <header className="topbar cabinet-bar">
          <a className="brand" href="/" aria-label="boks">
            boks
          </a>
          <span className="workspace-label">{w.workspace}</span>
          <span className="account-handle">@{identity.handle}</span>
          <LanguageSwitch label={w.languageSwitch} />
        </header>
        <div className="page-head">
          <div>
            <p className="eyebrow">{w.author}</p>
            <h1>
              {w.cabinet}
              <span className="dot">.</span>
            </h1>
          </div>
          <button type="button" className="btn btn-red new-bok" aria-label={w.add} disabled={suspended} onClick={onNew}>
            <Icon name="plus" />
            <span className="desktop-label">{w.newShort}</span>
          </button>
        </div>
        <div className="profile-shortcut">
          <button type="button" className="profile-edit-entry" onClick={onEditPage} disabled={suspended}>
            <span className="mini-ex" aria-hidden="true">
              {identity.photo ? <img src={identity.photo} alt="" /> : identity.initials}
            </span>
            <div>
              <strong>{w.publicPage}</strong>
              <small>{w.profileManage}</small>
            </div>
            <Icon name="write" />
          </button>
          <a className="icon-btn profile-view-link" href={`/@${identity.handle}`} aria-label={w.openPage} title={w.openPage}>
            <Icon name="arrow" />
          </a>
        </div>
      </section>
      <section className="library-body">
        {suspended && (
          <aside className="notice">
            <strong>{w.noticeTitle}</strong>
            <p>{suspendedReason || w.noticeBody}</p>
          </aside>
        )}
        {!suspended && pageEntry}
        {hasDraft && !suspended && (
          <button type="button" className="draft-strip" onClick={onContinueDraft}>
            <span className="draft-icon">
              <Icon name="write" />
            </span>
            <span>
              <strong>{w.draftTitle}</strong>
              <small>{w.draftHint}</small>
            </span>
            <span className="draft-continue">
              {w.continue}
              <Icon name="arrow" />
            </span>
          </button>
        )}
        {empty && pageEntry ? null : empty ? (
          <section className="empty">
            <div className="empty-letter">b.</div>
            <h2>{w.emptyTitle}</h2>
            <p>{w.emptyBody}</p>
            {!suspended && (
              <button type="button" className="btn btn-red" onClick={onNew}>
                <Icon name="plus" />
                {w.add}
              </button>
            )}
          </section>
        ) : (
          <>
            <nav className="filter-strip" aria-label={w.cabinet}>
              {filters
                .filter((option) => option.id === "all" || counts[option.id] > 0 || filter === option.id)
                .map((option) => (
                  <button key={option.id} type="button" aria-pressed={filter === option.id} onClick={() => choose(option.id)}>
                    {w[option.key]}
                    <em>{counts[option.id]}</em>
                  </button>
                ))}
            </nav>
            <div className="searchrow">
              <Icon name="search" />
              <input
                id="work-search"
                type="search"
                aria-label={w.search}
                placeholder={w.search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button type="button" className="icon-btn clear-search" aria-label={w.clearSearch} hidden={!query} onClick={() => setQuery("")}>
                <Icon name="x" />
              </button>
              <span className="search-count">{page?.total ?? ""}</span>
            </div>
            <div id="work-list" aria-busy={loading}>
              {failed ? (
                <div className="empty">
                  <h2>{w.loadError}</h2>
                  <button type="button" className="btn" style={{ marginTop: 24 }} onClick={() => void load({ filter, query: query.trim() })}>
                    {w.retry}
                  </button>
                </div>
              ) : page === null ? (
                <>
                  <p className="desk-note">{w.loading}</p>
                  <div className="skeleton" />
                  <div className="skeleton" />
                  <div className="skeleton" />
                </>
              ) : items.length ? (
                items.map((item) => <WorkRow key={item.id} item={item} w={w} onOpen={onOpen} onMenu={onMenu} />)
              ) : loading ? (
                <p className="desk-note">{w.loading}</p>
              ) : (
                <div className="empty">
                  <h2>{w.noMatch}</h2>
                  <p>{w.noMatchBody}</p>
                  <button type="button" className="btn btn-secondary" onClick={clearAll}>
                    {w.clear}
                  </button>
                </div>
              )}
            </div>
            <div className="list-foot">
              {left > 0 && !failed && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={loading}
                  onClick={() => void load({ filter, query: query.trim(), append: items.length })}
                >
                  {w.more} <Icon name="plus" />
                </button>
              )}
            </div>
          </>
        )}
        <footer className="desk-foot">
          <span className="brand">boks</span>
          <a href="/">
            {w.toReading}
            <Icon name="arrow" />
          </a>
        </footer>
      </section>
    </main>
  );
}

/**
 * What readers did with one bok (`get_my_bok_stats`): the same definitions
 * as the admin inspector, minus the author's own reading. Every number is a
 * measurement; a rate with no denominator is a dash, never a false 0%.
 */
export function StatsView({
  bokId,
  item,
  w,
  language,
  onBack,
  onMenu,
  onInfo,
}: {
  bokId: string;
  item: AuthorBokSubmission | null;
  w: CabinetWords;
  language: UiLanguage;
  onBack: () => void;
  onMenu: () => void;
  onInfo: (kind: "readers" | "numbers") => void;
}) {
  const [stats, setStats] = useState<AuthorBokStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadMyBokStats(bokId)
      .then((result) => active && setStats(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [bokId]);

  const title = item?.title ?? stats?.title ?? "";
  const status = item?.status ?? stats?.status ?? "published";
  const m = stats?.metrics;
  const rate = m?.finishRate == null ? "—" : `${m.finishRate}%`;

  return (
    <main className="page detail-page stats-page">
      <Topbar title={w.bookStats} backLabel={w.back} languageLabel={w.languageSwitch} onBack={onBack} />
      <section className="detail-title">
        <Thumb id={bokId} title={title || "b"} />
        <div>
          <span className={`status ${statusClass(status)}`}>{statusLabel(status, w)}</span>
          <h1>{title}</h1>
          {item?.authorName && <small>{item.authorName}</small>}
        </div>
        <button type="button" className="icon-btn" aria-label={w.actions} onClick={onMenu} disabled={!item}>
          <Icon name="more" />
        </button>
      </section>
      {failed ? (
        <p className="desk-note">{w.statsFailed}</p>
      ) : !m ? (
        <p className="desk-note">{w.loading}</p>
      ) : (
        <>
          <div className="stats-period">
            <span>{w.lifetime}</span>
            <small>{m.lastReadAt ? w.lastRead(formatDate(m.lastReadAt, language)) : w.neverRead}</small>
          </div>
          <section className="readers-feature">
            <div className="row between">
              <span>{w.readers}</span>
              <button type="button" className="icon-btn" aria-label={w.metricTitle} onClick={() => onInfo("readers")}>
                ?
              </button>
            </div>
            <strong className="big-number">{m.readers}</strong>
            <small>{w.readerDetail}</small>
            <div className="week-number">
              <strong>{m.readersWeek}</strong>
              {w.week}
            </div>
          </section>
          <section className="stats-grid">
            <div className="stat">
              <label>{w.impressions}</label>
              <strong>{m.impressions}</strong>
            </div>
            <div className="stat">
              <label>{w.starts}</label>
              <strong>{m.starts}</strong>
            </div>
            <div className="stat">
              <label>{w.completes}</label>
              <strong>
                {m.completes}
                <span className="finish-rate">{rate}</span>
              </strong>
              <div className="meter">
                <i style={{ width: `${Math.min(100, m.finishRate ?? 0)}%` }} />
              </div>
              <small>{w.ratio(m.completes, m.starts)}</small>
            </div>
            <div className="stat">
              <label>{w.minutes}</label>
              <strong>{m.minutes}</strong>
              <small>{w.minutesHint}</small>
            </div>
          </section>
          <div className="metric-social">
            <span>
              <Icon name="heart" />
              <strong>{m.likes}</strong>
              {w.likes}
            </span>
            <span>
              <Icon name="comment" />
              <strong>{m.comments}</strong>
              {w.comments}
            </span>
            <span>
              <Icon name="share" />
              <strong>{m.shares}</strong>
              {w.shares}
            </span>
          </div>
          <button type="button" className="btn btn-quiet metric-help" onClick={() => onInfo("numbers")}>
            {w.statHelp} <Icon name="arrow" />
          </button>
          <div className="comment-heading">
            <h2>{w.latestComments}</h2>
            <span>{w.last50}</span>
          </div>
          {stats.comments.length ? (
            stats.comments.map((comment) => (
              <article key={comment.id} className="comment-item">
                <span className="comment-letter">{(comment.handle || "r").slice(0, 1)}</span>
                <div>
                  <div className="comment-byline">
                    <strong>@{comment.handle || "reader"}</strong>
                    <small>
                      {comment.isReply ? `${w.reply} · ` : ""}
                      {formatDate(comment.createdAt, language)}
                    </small>
                  </div>
                  <p>{comment.body}</p>
                  {comment.likes > 0 && (
                    <small>
                      <Icon name="heart" /> {comment.likes}
                    </small>
                  )}
                </div>
              </article>
            ))
          ) : (
            <p className="desk-note">{w.noComments}</p>
          )}
        </>
      )}
    </main>
  );
}
