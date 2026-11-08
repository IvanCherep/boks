"use client";

import { authorShareUrl } from "@/lib/boks/share-link";
import { useEffect, useState } from "react";
import { ReaderBackIcon as ArrowLeft, ReaderShareIcon } from "./reader/reader-icons";
import { Button } from "@/components/ui/button";
import { ReaderSheet } from "@/components/boks/reader-sheet";
import type { AuthorProfile } from "@/components/boks/client-types";
import { loadBoksAuthor, setAuthorFollow } from "@/components/boks/supabase-browser-data";
import { haptic } from "@/components/boks/reader-haptics";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { plural } from "@/lib/i18n/messages";
import { currentUiLanguage } from "@/components/boks/ui-language";
import { bokArtworkFocus, getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { bokCoverStyle } from "@/components/boks/reader/bok-cover-palette";
import { seriesPieceFor } from "@/components/boks/series/series-catalogue";
import type { CSSProperties } from "react";

/**
 * Everything one author has written, reached by tapping their byline.
 *
 * A byline used to be a dead end: you could see who wrote a boks and follow
 * them, but not open them. "What else has this person written" is the first
 * thing anyone asks after finishing something they liked, and it had no answer.
 *
 * Presented as the same bottom sheet as the responses, because it is the same
 * kind of thing - a layer over the reading, dismissed the same way, rather than
 * a place you navigate to and have to come back from.
 */

export type AuthorSheetProps = {
  handle: string;
  /**
   * The writer, when the reader tapped a byline rather than the @handle. An
   * account can publish many writers, and "more by this writer" is what the
   * tap means.
   */
  authorName?: string;
  /** Highlighted in the list, so the reader keeps their place. */
  currentStoryId?: string;
  canFollow: boolean;
  onClose: () => void;
  onOpenBok: (storyId: string) => void;
  onRequestAccount: () => void;
  onFollowChanged?: (authorUserId: string, following: boolean) => void;
  /** Opens one writer from a publisher's list. */
  onOpenWriter?: (authorName: string) => void;
  /**
   * Leaves writer mode for the account that published them. Following, and
   * everything else a reader can do with an author, belongs to the account,
   * so a writer's list has to have a way back to it.
   */
  onOpenAccount?: () => void;
};

export function AuthorSheet({
  handle,
  authorName,
  currentStoryId,
  canFollow,
  onClose,
  onOpenBok,
  onRequestAccount,
  onFollowChanged,
  onOpenWriter,
  onOpenAccount,
}: AuthorSheetProps) {
  const { t } = useReaderPreferences();
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  const [status, setStatus] = useState("Loading");
  const [busy, setBusy] = useState(false);
  const [profileLinkFallback, setProfileLinkFallback] = useState(false);
  const profileLink = typeof window === "undefined" ? "" : authorShareUrl(handle, window.location.origin);
  async function copyProfileLink() {
    try { await navigator.clipboard.writeText(profileLink); setStatus(t("Profile link copied.", "Ссылка на профиль скопирована.")); }
    catch { setProfileLinkFallback(true); }
  }
  async function shareProfile() {
    if (!navigator.share) return copyProfileLink();
    try { await navigator.share({ title: `@${handle.replace(/^@+/, "")}`, url: profileLink }); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setProfileLinkFallback(true); }
  }

  // Keyed by handle in the parent, so a different author mounts a fresh sheet
  // rather than resetting this one's state on the way in.
  // How many boks the whole account publishes, when the sheet shows one writer
  // in it: the "follow brings everything this account publishes" note only
  // means something when the account publishes more than this writer.
  const [accountTotal, setAccountTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!authorName) return;
    let cancelled = false;
    loadBoksAuthor(handle).then((account) => { if (!cancelled) setAccountTotal(account?.totalBoks ?? null); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [handle, authorName]);

  useEffect(() => {
    let cancelled = false;

    loadBoksAuthor(handle, authorName)
      .then((profile) => {
        if (cancelled) return;
        setAuthor(profile);
        setStatus(profile ? "" : "This author is not available.");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : currentUiLanguage() === "ru" ? "Не удалось открыть автора." : "Could not open this author.");
      });

    return () => {
      cancelled = true;
    };
  }, [handle, authorName]);

  async function toggleFollow() {
    if (!author?.authorUserId) return;
    if (!canFollow) {
      onRequestAccount();
      return;
    }

    const next = !author.following;
    if (next) haptic("confirm");
    setBusy(true);
    setAuthor({
      ...author,
      following: next,
      followers: Math.max(0, author.followers + (next ? 1 : -1)),
    });

    try {
      const saved = await setAuthorFollow(author.authorUserId, next);
      setAuthor((current) =>
        current ? { ...current, following: saved.following, followers: saved.followers } : current
      );
      onFollowChanged?.(author.authorUserId, saved.following);
    } catch (error) {
      setAuthor((current) =>
        current
          ? { ...current, following: !next, followers: Math.max(0, current.followers + (next ? -1 : 1)) }
          : current
      );
      setStatus(error instanceof Error ? error.message : t("Could not update following.", "Не удалось изменить подписку."));
    } finally {
      setBusy(false);
    }
  }

  const meta = [
    author ? t(countLabel(author.totalBoks, "bok"), `Боков: ${author.totalBoks}`) : null,
    author && author.writers.length > 1 ? t(countLabel(author.writers.length, "byline"), `Авторов боков: ${author.writers.length}`) : null,
    author?.authorUserId && !author.byline ? t(countLabel(author.followers, "follower"), `Подписчиков: ${author.followers}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // An account that publishes one writer is that writer's own: it is titled
  // by their name, with the handle under it, not by the handle alone.
  const ownName = !author?.byline && author?.writers.length === 1 ? author.writers[0].name : null;
  const manyWriters = Boolean(author && !author.byline && author.writers.length > 1);

  // The author's own pictures, fanned out at the top: up to three covers with art.
  const fan = (author?.boks ?? []).filter((bok) => getBokArtwork({ id: bok.id })).slice(0, 3);

  return (
    <ReaderSheet
      label={author ? `${author.byline || ownName || "@" + author.authorHandle}` : t("Author", "Автор")}
      onClose={onClose}
      className="author-v44 social-page"
    >
      <header className="social-page-header"><button className="social-icon" type="button" onClick={onClose} aria-label={t("Back", "Назад")}><ArrowLeft /></button><span>{author?.byline ? t("Writer", "Писатель") : t("Author", "Автор")}</span><button type="button" className="social-icon" onClick={() => void shareProfile()} aria-label={t("Share profile", "Поделиться профилем")}><ReaderShareIcon /></button></header>
      <div className="author-profile-head flex items-start justify-between gap-3">
        <div className="min-w-0">
          {fan.length > 0 ? (
            <span className={`author-fan author-fan--${fan.length}`} aria-hidden="true">
              {fan.map((bok) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={bok.id} src={getBokArtwork({ id: bok.id })!} alt="" style={{ objectPosition: bokArtworkFocus(bok.id) }} />
              ))}
            </span>
          ) : <span className={`author-monogram${author?.byline ? " author-monogram--writer" : ""}`} aria-hidden="true">{author?.byline ? "“" : (author?.authorHandle || handle).replace(/^@+/, "")[0]?.toUpperCase()}<i>{author?.byline ? "”" : "✳"}</i></span>}
          <span className="social-eyebrow">{author?.byline ? t("Writer", "Писатель") : t("Author", "Автор")}</span>
          <h2 className="author-profile-title" translate="no">
            {/* A name when there is one, otherwise the @handle stands alone
                rather than the sheet inventing a label. */}
            {author?.byline || ownName || `@${author?.authorHandle ?? handle.replace(/^@+/, "")}`}
          </h2>
          {/* Built as a list and joined, so a missing name never leaves the
              line starting with a separator. */}
          <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
            {author?.byline ? (
              <>
                {/* In writer mode the handle is the publisher, and it is a way
                    back rather than a caption: this writer is one of the many
                    that account publishes, and the account is what a reader
                    follows. */}
                {t("Published by", "Опубликовано")} {" "}
                {onOpenAccount ? (
                  <button type="button" className="author-account-link" onClick={onOpenAccount}>
                    @{author.authorHandle}
                  </button>
                ) : (
                  `@${author.authorHandle}`
                )}
                {meta && ` · ${meta}`}
              </>
            ) : ownName ? (
              <>@{author?.authorHandle}{meta && ` · ${meta}`}</>
            ) : (
              meta
            )}
          </p>
        </div>
      </div>

      {author?.byline && author.authorUserId && accountTotal !== null && accountTotal > author.totalBoks && (
        <p className="px-4 pt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          {t(`Following @${author.authorHandle} brings you everything this account publishes, not only ${author.byline}.`, `Подписка на @${author.authorHandle} распространяется на все боки этого аккаунта, а не только на ${author.byline}.`)}
        </p>
      )}

      {author?.authorUserId ? (
        <div className="author-profile-actions px-4 pt-3">
          <Button
            className="w-full"
            variant={author.following ? "outline" : "default"}
            onClick={toggleFollow}
            disabled={busy}
            aria-pressed={author.following}
          >
            {/* In writer mode the account is the publisher, not the writer.
                A bare "Follow" under the heading "Anton Chekhov" would read
                as following Chekhov, which is not what it does. */}
            {author.byline
              ? author.following
                ? t(`Following @${author.authorHandle}`, `Вы подписаны на @${author.authorHandle}`)
                : t(`Follow @${author.authorHandle}`, `Подписаться на @${author.authorHandle}`)
              : author.following
                ? t("Following", "Вы подписаны")
                : t("Follow", "Подписаться")}
          </Button>
          {!author.byline && <Button variant="outline" onClick={() => void copyProfileLink()}>{t("Copy profile link", "Ссылка на профиль")}</Button>}
        </div>
      ) : (
        author && (
          <p className="px-4 pt-2 text-sm text-[var(--muted-foreground)]">
            {t("There is no account behind this byline yet.", "Эта подпись пока не связана с аккаунтом.")}
          </p>
        )
      )}

      {profileLinkFallback && <input className="share-link-fallback" value={profileLink} readOnly aria-label={t("Profile link", "Ссылка на профиль")} onFocus={event => event.currentTarget.select()} />}
      <div className="author-public-list">
        {status && <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">{status === "Loading" ? t("Loading…", "Загружаем…") : status === "This author is not available." ? t(status, "Этот автор недоступен.") : status}</p>}
        {author && !author.boks.length && !status && (
          <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">{t("Nothing published yet.", "Публикаций пока нет.")}</p>
        )}

        {/* A publisher's catalogue is indexed by its writers. A flat list of
            457 titles is not something anyone reads; "24 writers" is. */}
        {author && author.writers.length > 1 && (
          <div className="mb-3">
            <h3 className="text-sm font-semibold">{t("Bylines", "Авторы боков")}</h3>
            <ul className="mt-2 grid gap-1">
              {author.writers.map((writer) => (
                <li key={writer.name}>
                  <button type="button" className="author-writer" onClick={() => onOpenWriter?.(writer.name)}>
                    <span className="font-medium">{writer.name}</span>
                    <span className="text-sm text-[var(--muted-foreground)]">{t(countLabel(writer.boks, "bok"), `${writer.boks} ${plural("ru", writer.boks, { one: "бок", few: "бока", many: "боков", other: "бока" })}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-sm font-semibold">{t("Newest", "Новое")}</h3>
          </div>
        )}

        {author && author.boks.length > 0 && (
          <>
          <div className="author-list-label"><span>{t("Published boks", "Опубликованные боки")}</span><span>{author.totalBoks}</span></div>
          <ul className="author-covers">
            {author.boks.map((bok) => {
              const artwork = getBokArtwork({ id: bok.id });
              const series = seriesPieceFor(bok.id);
              const current = bok.id === currentStoryId;
              return (
                <li key={bok.id}>
                  <button
                    type="button"
                    className={`author-cover${artwork ? " author-cover--art" : ""}${current ? " author-cover--current" : ""}`}
                    style={bokCoverStyle(bok.id) as CSSProperties}
                    onClick={() => onOpenBok(bok.id)}
                  >
                    {artwork ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="author-cover__art" src={artwork} alt="" loading="lazy" decoding="async" style={{ objectPosition: bokArtworkFocus(bok.id) }} />
                    ) : (
                      <span className="author-cover__letter" aria-hidden="true">{bok.title.trim().charAt(0)}</span>
                    )}
                    {series && <span className="author-cover__badge">{t("Listen", "Слушать")}</span>}
                    <span className="author-cover__body">
                      <span className="author-cover__title">{bok.title}</span>
                      <span className="author-cover__meta">
                        {/* In a publisher's catalogue the writer is what tells one
                            title from another; in a writer's own list it is noise. */}
                        {[manyWriters ? bok.authorName : null, current ? t("reading now", "читаете сейчас") : t(`${Math.max(1, bok.minutes)} min`, `${Math.max(1, bok.minutes)} мин`)]
                          .filter(Boolean)
                          .map((part, index) => <span key={index}>{index > 0 && " · "}{part}</span>)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          </>
        )}
        {author && author.boks.length > 0 && author.boks.length < author.totalBoks && (
          <p className="pt-3 text-center text-sm text-[var(--muted-foreground)]">
            {t(`Showing the newest ${author.boks.length} of ${author.totalBoks}.`, `Показаны последние ${author.boks.length} из ${author.totalBoks}.`)}
          </p>
        )}
      </div>
    </ReaderSheet>
  );
}

function countLabel(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
