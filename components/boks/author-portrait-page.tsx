"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AuthorProfile } from "@/components/boks/client-types";
import type { AuthorPortrait } from "@/components/boks/author-portraits";
import { bokArtworkFocus, getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { seriesPieceFor } from "@/components/boks/series/series-catalogue";
import { useReaderPreferences } from "@/components/boks/reader-preferences";

/**
 * An author's portrait page (design v48, docs in `author-portraits.ts`).
 *
 * The portrait fills the first screen with the name set over it, one action -
 * Follow - and a small Share. Below, on the portrait's dark ground, the
 * author's boks as equal square covers, each one a plain way into the piece.
 * Share passes the public profile link only.
 *
 * It replaces the author sheet for an author who has a portrait, and keeps the
 * sheet's behaviour: Escape and Back close it, Follow is the real follow.
 */
export function AuthorPortraitPage({
  portrait,
  author,
  profileLink,
  following,
  busy,
  currentStoryId,
  onToggleFollow,
  onOpenBok,
  onClose,
}: {
  portrait: AuthorPortrait;
  author: AuthorProfile | null;
  profileLink: string;
  following: boolean;
  busy: boolean;
  currentStoryId?: string;
  onToggleFollow: () => void;
  onOpenBok: (storyId: string) => void;
  onClose: () => void;
}) {
  const { t } = useReaderPreferences();
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  const [copyFallback, setCopyFallback] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const name = `${portrait.given} ${portrait.family}`;
  const displayLink = profileLink.replace(/^https?:\/\//, "");

  useEffect(() => {
    // The layer itself takes focus, so a screen reader starts at the portrait
    // and no button shows a focus ring before anyone has pressed a key.
    page.current?.focus({ preventScroll: true });
  }, []);

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
      await navigator.share({ title: `${name} · boks`, url: profileLink });
      setSharing(false);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) await copyLink();
    }
  }

  const boks = author?.boks ?? [];
  const canShareNatively = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div ref={page} className="ap" role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}>
      <section className="ap-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="ap-hero__photo" src={portrait.photo} alt={t(`Portrait of ${name}`, `Портрет: ${name}`)}
          style={{ "--ap-focus": portrait.focus ?? "50% 30%" } as CSSProperties} fetchPriority="high" />
        <div className="ap-hero__shade" aria-hidden="true" />
        <header className="ap-hero__header">
          <button type="button" className="ap-icon ap-back" onClick={onClose} aria-label={t("Back", "Назад")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" /></svg>
          </button>
          <span className="ap-brand" aria-hidden="true">boks</span>
          <button type="button" className="ap-icon" onClick={() => { setCopyFallback(false); setSharing(true); }} aria-label={t("Share this author", "Поделиться автором")}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 11v10h14V11" /></svg>
          </button>
        </header>
        <div className="ap-hero__id">
          <h1 translate="no">
            <span className="ap-hero__given">{portrait.given}</span>
            <span className="ap-hero__family">{portrait.family}<span className="ap-dot">.</span></span>
          </h1>
          <span className="ap-handle">@{portrait.handle}</span>
        </div>
        <div className="ap-hero__bottom">
          <button type="button" className={`ap-follow${following ? " is-following" : ""}`} aria-pressed={following}
            onClick={onToggleFollow} disabled={busy || !author?.authorUserId}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={following ? "m4 12 5 5L20 6" : "M12 4v16M4 12h16"} /></svg>
            <span>{following ? t("Following", "Вы подписаны") : t("Follow", "Подписаться")}</span>
          </button>
        </div>
      </section>

      <section className="ap-library" aria-labelledby="ap-library-title">
        <div className="ap-library__inner">
          <h2 id="ap-library-title" className="ap-library__title">{t("Boks", "Боки")}<span>.</span></h2>
          {!author && <p className="ap-library__status" role="status">{t("Loading…", "Загружаем…")}</p>}
          <ul className="ap-grid" aria-label={t(`All boks by ${name}`, `Все боки: ${name}`)}>
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
                      {series && <span className="ap-card__kind">Series</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <footer className="ap-footer">
            <span className="ap-brand ap-brand--footer" aria-hidden="true">boks</span>
            <span className="ap-footer__person">
              <span>@{portrait.handle}</span>
              <button type="button" className="ap-icon" onClick={() => { setCopyFallback(false); setSharing(true); }} aria-label={t("Share this author", "Поделиться автором")}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 11v10h14V11" /></svg>
              </button>
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={portrait.thumb} width={56} height={56} alt="" />
              <div><strong translate="no">{name}</strong><span>@{portrait.handle}</span></div>
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
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M5 11v10h14V11" /></svg>
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
