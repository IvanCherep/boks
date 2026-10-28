"use client";

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
  const profileLink = typeof window === "undefined" ? "" : new URL(`/?author=${encodeURIComponent(handle.replace(/^@+/, ""))}`, window.location.origin).href;
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
    author?.writers.length ? t(countLabel(author.writers.length, "byline"), `Авторов боков: ${author.writers.length}`) : null,
    author?.authorUserId && !author.byline ? t(countLabel(author.followers, "follower"), `Подписчиков: ${author.followers}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReaderSheet
      label={author ? `${author.byline || "@" + author.authorHandle}` : t("Author", "Автор")}
      onClose={onClose}
      className="author-v44 social-page"
    >
      <header className="social-page-header"><button className="social-icon" type="button" onClick={onClose} aria-label={t("Back", "Назад")}><ArrowLeft /></button><span>{author?.byline ? t("Writer", "Писатель") : t("Author", "Автор")}</span><button type="button" className="social-icon" onClick={() => void shareProfile()} aria-label={t("Share profile", "Поделиться профилем")}><ReaderShareIcon /></button></header>
      <div className="author-profile-head flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`author-monogram${author?.byline ? " author-monogram--writer" : ""}`} aria-hidden="true">{author?.byline ? "“" : (author?.authorHandle || handle).replace(/^@+/, "")[0]?.toUpperCase()}<i>{author?.byline ? "”" : "✳"}</i></span>
          <span className="social-eyebrow">{author?.byline ? t("Writer", "Писатель") : t("Author", "Автор")}</span>
          <h2 className="author-profile-title" translate="no">
            {/* A name when there is one, otherwise the @handle stands alone
                rather than the sheet inventing a label. */}
            {author?.byline || `@${author?.authorHandle ?? handle.replace(/^@+/, "")}`}
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
            ) : (
              meta
            )}
          </p>
        </div>
      </div>

      {author?.byline && author.authorUserId && (
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
          <ul className="grid gap-2">
            {author.boks.map((bok) => (
              <li key={bok.id}>
                <button
                  type="button"
                  className={`author-bok${bok.id === currentStoryId ? " author-bok--current" : ""}`}
                  onClick={() => onOpenBok(bok.id)}
                >
                  <span className="font-medium">{bok.title}</span>
                  {/* In a publisher's catalogue the writer is what tells one
                      title from another; in a writer's own list it is noise. */}
                  {!author.byline && bok.authorName && (
                    <span className="mt-0.5 text-sm text-[var(--muted-foreground)]">{bok.authorName}</span>
                  )}
                  {bok.id === currentStoryId && <span className="author-bok-now">{t("reading now", "читаете сейчас")}</span>}
                </button>
              </li>
            ))}
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
