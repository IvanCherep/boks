"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AuthorProfile } from "@/components/boks/client-types";
import { authorInitials, mountAuthorRings, splitAuthorName, type RingsController } from "@/components/boks/author-rings";
import { bokArtworkFocus, getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { seriesPieceFor } from "@/components/boks/series/series-catalogue";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { plural } from "@/lib/i18n/messages";

/**
 * An author's page (design v49), for every author.
 *
 * The first screen: the portrait - or, with no photo, a paper medallion with
 * the initials - inside living annual rings (`author-rings.ts`), the name set
 * large, the handle, and one action, Follow. A small Share opens the public
 * profile link. Below, on the same dark ground, the boks as equal square
 * covers; a publisher of many writers also gets an index of them.
 *
 * Replaces the author sheet, and keeps its behaviour: Escape and Back close
 * it, Follow is the real follow.
 */
export type AuthorPageIdentity = {
  handle: string;
  /** The public name; "@handle" when there is none. */
  name: string;
  photo?: string | null;
  thumb?: string | null;
  focus?: string;
};

export function AuthorPortraitPage({
  identity,
  author,
  profileLink,
  following,
  busy,
  currentStoryId,
  status,
  publishedBy,
  onToggleFollow,
  onOpenBok,
  onOpenWriter,
  onOpenAccount,
  onClose,
}: {
  identity: AuthorPageIdentity;
  author: AuthorProfile | null;
  profileLink: string;
  following: boolean;
  busy: boolean;
  currentStoryId?: string;
  /** Shown in place of the library: the author is unavailable, or a follow failed. */
  status?: string;
  /** The account that publishes this writer, when it is not their own (`@boks`). */
  publishedBy?: string | null;
  onToggleFollow: () => void;
  onOpenBok: (storyId: string) => void;
  onOpenWriter?: (name: string) => void;
  onOpenAccount?: () => void;
  onClose: () => void;
}) {
  const { t, preferences } = useReaderPreferences();
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const [copyFallback, setCopyFallback] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rings = useRef<RingsController | null>(null);
  // An account with no public name is set by its handle, without the @ (the
  // line under it says "@boks"), and its medallion carries one letter.
  const nameless = identity.name.startsWith("@");
  const { given, family } = splitAuthorName(nameless ? identity.name.replace(/^@+/, "") : identity.name);
  const initials = nameless ? Array.from(identity.handle.toLocaleUpperCase())[0] ?? "" : authorInitials(identity.name, identity.handle);
  const displayLink = profileLink.replace(/^https?:\/\//, "");
  // A long family name is set smaller rather than run off the screen.
  const fit = Math.min(1, 9 / Math.max(1, Array.from(family).length));

  useEffect(() => {
    // The layer takes focus, so no button shows a ring before a key is pressed.
    page.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!canvas.current || !field.current) return;
    rings.current = mountAuthorRings(canvas.current, { host: field.current, root: page.current });
    return () => { rings.current?.destroy(); rings.current = null; };
  }, []);

  useEffect(() => {
    if (sharing) rings.current?.pause();
    else rings.current?.resume();
  }, [sharing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (sharing) setSharing(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sharing, onClose]);

  // Covers rise in as they come into view; reduced motion shows them at once (CSS).
  useEffect(() => {
    const root = page.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("is-in"); observer.unobserve(entry.target); }
      }),
      { root, threshold: 0.07 }
    );
    root.querySelectorAll(".ap-reveal:not(.is-in)").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [author]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(profileLink);
      setNotice(t("Link copied", "Ссылка скопирована"));
      setSharing(false);
    } catch {
      setCopyFallback(true);
    }
  }

  async function shareLink() {
    try {
      await navigator.share({ title: `${identity.name} · boks`, url: profileLink });
      setSharing(false);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) await copyLink();
    }
  }

  const openShare = () => { setCopyFallback(false); setSharing(true); };
  const boks = author?.boks ?? [];
  const writers = author && !author.byline && author.writers.length > 1 ? author.writers : [];
  const canShareNatively = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const shareIcon = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 4 19 8-19 8 4-8zm4 8h15" /></svg>;
  const avatar = (size: "large" | "small") => identity.photo
    // eslint-disable-next-line @next/next/no-img-element
    ? <img className={size === "large" ? "ap-portrait__photo" : undefined} src={size === "large" ? identity.photo : identity.thumb ?? identity.photo} alt=""
        style={{ objectPosition: identity.focus ?? "50% 43%" }} {...(size === "large" ? { fetchPriority: "high" as const } : { width: 56, height: 56 })} />
    : <span className={size === "large" ? "ap-portrait__initials" : "ap-sheet__initials"} aria-hidden="true">{initials}</span>;

  return (
    <div ref={page} className="ap" role="dialog" aria-modal="true" aria-label={identity.name} tabIndex={-1}>
      <section className={`ap-hero${identity.photo ? "" : " ap-hero--initials"}`}>
        <div className="ap-hero__atmosphere" aria-hidden="true" />
        <header className="ap-hero__header">
          <button type="button" className="ap-icon ap-back" onClick={onClose} aria-label={t("Back", "Назад")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" /></svg>
          </button>
          <span className="ap-brand" aria-hidden="true">boks</span>
          <button type="button" className="ap-icon" onClick={openShare} aria-label={t("Share this author", "Поделиться автором")}>{shareIcon}</button>
        </header>
        <div className="ap-rings">
          <div ref={field} className="ap-rings__field" aria-hidden="true"><canvas ref={canvas} /></div>
          <figure className={`ap-portrait${identity.photo ? "" : " ap-portrait--initials"}`} aria-hidden={!identity.photo}>
            {avatar("large")}
          </figure>
        </div>
        <div className="ap-hero__copy">
          <h1 translate="no" style={{ "--ap-fit": fit } as CSSProperties}>
            {given && <span className="ap-hero__given">{given}</span>}
            <span className="ap-hero__family">{family}<span className="ap-dot">.</span></span>
          </h1>
          <span className="ap-handle">
            {publishedBy && onOpenAccount
              ? <>{t("Published by", "Публикует")} <button type="button" className="ap-handle__link" onClick={onOpenAccount}>@{publishedBy}</button></>
              : `@${identity.handle}`}
          </span>
          <div className="ap-hero__actions">
            <button type="button" className={`ap-follow${following ? " is-following" : ""}`} aria-pressed={following}
              onClick={onToggleFollow} disabled={busy || !author?.authorUserId}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={following ? "m4 12 5 5L20 6" : "M12 4v16M4 12h16"} /></svg>
              <span>{following ? t("Following", "Вы подписаны") : publishedBy ? t(`Follow @${publishedBy}`, `Подписаться на @${publishedBy}`) : t("Follow", "Подписаться")}</span>
            </button>
          </div>
        </div>
      </section>

      <section className="ap-library" aria-labelledby="ap-library-title">
        <div className="ap-library__inner">
          <h2 id="ap-library-title" className="ap-library__title">{t("Boks", "Боки")}<span>.</span></h2>
          {(status || !author) && <p className="ap-library__status" role="status">{status || t("Loading…", "Загружаем…")}</p>}
          {writers.length > 0 && onOpenWriter && (
            <ul className="ap-writers" aria-label={t("Writers", "Авторы")}>
              {writers.map((writer) => (
                <li key={writer.name}>
                  <button type="button" onClick={() => onOpenWriter(writer.name)}>
                    {writer.name}<span>{preferences.locale === "ru" ? `${writer.boks} ${plural("ru", writer.boks, { one: "бок", few: "бока", many: "боков", other: "бока" })}` : `${writer.boks} ${writer.boks === 1 ? "bok" : "boks"}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul className="ap-grid" aria-label={t(`All boks by ${identity.name}`, `Все боки: ${identity.name}`)}>
            {boks.map((bok, index) => {
              const artwork = getBokArtwork({ id: bok.id });
              const series = Boolean(seriesPieceFor(bok.id));
              return (
                <li key={bok.id}>
                  <button type="button" className={`ap-card ap-reveal${bok.id === currentStoryId ? " is-current" : ""}`}
                    style={{ "--ap-delay": `${(index % 3) * 55}ms` } as CSSProperties} onClick={() => onOpenBok(bok.id)}>
                    <span className="ap-card__art" aria-hidden="true">
                      {artwork ? <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img className="ap-card__glow" src={artwork} alt="" loading="lazy" decoding="async" />
                        <span className="ap-card__window">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img className="ap-card__image" src={artwork} alt="" loading="lazy" decoding="async" style={{ objectPosition: bokArtworkFocus(bok.id) }} />
                        </span>
                      </> : <span className="ap-card__window"><span className="ap-card__type">{bok.title.trim().charAt(0).toUpperCase()}</span></span>}
                    </span>
                    <span className="ap-card__label">
                      <span className="ap-card__title">{bok.title}</span>
                      {writers.length > 0 && bok.authorName && <span className="ap-card__byline">{bok.authorName}</span>}
                      {series && <span className="ap-card__kind">Series</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {author && boks.length < author.totalBoks && (
            <p className="ap-library__status">{t(`The newest ${boks.length} of ${author.totalBoks}.`, `Последние ${boks.length} из ${author.totalBoks}.`)}</p>
          )}
          <footer className="ap-footer">
            <span className="ap-brand ap-brand--footer" aria-hidden="true">boks</span>
            <span className="ap-footer__person">
              <span>@{identity.handle}</span>
              <button type="button" className="ap-icon" onClick={openShare} aria-label={t("Share this author", "Поделиться автором")}>{shareIcon}</button>
            </span>
          </footer>
        </div>
      </section>

      {sharing && (
        <div className="ap-scrim" onClick={(event) => { if (event.target === event.currentTarget) setSharing(false); }}>
          <section className="ap-sheet" role="dialog" aria-modal="true" aria-label={t("Share this author", "Поделиться автором")}>
            <span className="ap-sheet__handle" aria-hidden="true" />
            <header className="ap-sheet__header">
              <h2>{t("Share this author", "Поделиться автором")}</h2>
              <button type="button" className="ap-icon ap-icon--light" onClick={() => setSharing(false)} aria-label={t("Close", "Закрыть")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
              </button>
            </header>
            <div className="ap-sheet__author">
              {avatar("small")}
              <div><strong translate="no">{identity.name}</strong><span>@{identity.handle}</span></div>
            </div>
            <div className="ap-sheet__link">
              <span>{t("Profile link", "Ссылка на профиль")}</span>
              {copyFallback
                ? <input readOnly value={profileLink} aria-label={t("Profile link", "Ссылка на профиль")} onFocus={(event) => event.currentTarget.select()} autoFocus />
                : <a href={profileLink} target="_blank" rel="noopener noreferrer">{displayLink}</a>}
            </div>
            <div className="ap-sheet__actions">
              <button type="button" className="ap-sheet__primary" onClick={() => void copyLink()}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7V3h12v14h-4M3 7h14v14H3z" /></svg>
                <span>{t("Copy link", "Скопировать ссылку")}</span>
              </button>
              {canShareNatively && (
                <button type="button" className="ap-sheet__secondary" onClick={() => void shareLink()}>
                  {shareIcon}
                  <span>{t("Share link", "Поделиться ссылкой")}</span>
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      <div className={`ap-toast${notice ? " is-visible" : ""}`} role="status" aria-live="polite">{notice}</div>
    </div>
  );
}
