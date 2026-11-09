"use client";

import { authorShareUrl } from "@/lib/boks/share-link";
import { useEffect, useRef, useState } from "react";
import type { AuthorProfile } from "@/components/boks/client-types";
import { loadAuthorPageIdentity, loadBoksAuthor, setAuthorFollow } from "@/components/boks/supabase-browser-data";
import type { AuthorPageIdentity } from "@/components/boks/client-types";
import { haptic } from "@/components/boks/reader-haptics";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { currentUiLanguage } from "@/components/boks/ui-language";
import { authorPortraitFor } from "@/components/boks/author-portraits";
import { AuthorPortraitPage } from "@/components/boks/author-portrait-page";

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
  /** Follow as soon as the author is loaded: a guest tapped Follow and has just signed in. */
  followOnOpen?: boolean;
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
  followOnOpen = false,
}: AuthorSheetProps) {
  const { t } = useReaderPreferences();
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  // The name and photo the author set in the cabinet, if any.
  const [page, setPage] = useState<AuthorPageIdentity | null>(null);
  // Why the page has no boks to show: still loading, unavailable, or a failed follow.
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const profileLink = typeof window === "undefined" ? "" : authorShareUrl(handle, window.location.origin);

  // Keyed by handle in the parent, so a different author mounts a fresh sheet
  // rather than resetting this one's state on the way in.
  useEffect(() => {
    let cancelled = false;

    // Opened from a byline (the reader, a series shelf): when the account
    // publishes only this writer, it is the writer's own account, and the
    // reader gets that page - name, followers, everything - not the "one
    // writer inside a publisher" view.
    const load = async () => {
      const [profile, account] = await Promise.all([
        loadBoksAuthor(handle, authorName),
        authorName ? loadBoksAuthor(handle).catch(() => null) : Promise.resolve(null),
      ]);
      const own = account && account.writers.length <= 1 ? account : null;
      return own ?? profile;
    };

    load()
      .then((shown) => {
        if (cancelled) return;
        setAuthor(shown);
        setStatus(shown ? "" : currentUiLanguage() === "ru" ? "Этот автор недоступен." : "This author is not available.");
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus(error instanceof Error ? error.message : currentUiLanguage() === "ru" ? "Не удалось открыть автора." : "Could not open this author.");
      });

    return () => {
      cancelled = true;
    };
  }, [handle, authorName]);

  useEffect(() => {
    let cancelled = false;
    loadAuthorPageIdentity(handle.replace(/^@+/, ""))
      .then((identity) => !cancelled && setPage(identity))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const followedOnOpen = useRef(false);
  useEffect(() => {
    if (!followOnOpen || followedOnOpen.current || !author?.authorUserId || !canFollow) return;
    followedOnOpen.current = true;
    if (author.following) return;
    const timer = window.setTimeout(() => void toggleFollow(), 0);
    return () => window.clearTimeout(timer);
    // Once, when the author has loaded; `toggleFollow` reads the current author.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followOnOpen, author, canFollow]);

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

  // Who the page is about. A writer inside a publisher's catalogue (Блок in
  // @boks) by their byline; otherwise the name the author set for their page;
  // an author with a registered portrait by its public name; an account that
  // publishes one writer by that writer's name; a publisher of many by its
  // @handle. Before the profile loads, the byline the reader tapped stands in,
  // so the page opens at once. The photo: the author's own, then a registered one.
  const writerView = Boolean(author?.byline);
  const portrait = !writerView ? authorPortraitFor(handle) : null;
  const ownName = !writerView && author?.writers.length === 1 ? author.writers[0].name : null;
  const bareHandle = (author?.authorHandle || handle).replace(/^@+/, "");
  const pageName = !writerView ? page?.name?.trim() || null : null;
  const pagePhoto = !writerView && page?.photoVersion ? `/a/${bareHandle}/photo?v=${page.photoVersion}` : null;
  const name = author?.byline
    || pageName
    || (portrait ? `${portrait.given} ${portrait.family}` : null)
    || ownName
    || (!author ? authorName : null)
    || `@${bareHandle}`;
  const identity = pagePhoto
    ? { handle: bareHandle, name, photo: pagePhoto, thumb: pagePhoto, focus: "50% 50%" }
    : { handle: bareHandle, name, photo: portrait?.photo, thumb: portrait?.thumb, focus: portrait?.focus };

  return (
    <AuthorPortraitPage
      identity={identity}
      author={author}
      profileLink={profileLink}
      following={Boolean(author?.following)}
      busy={busy}
      currentStoryId={currentStoryId}
      status={status}
      publishedBy={author?.byline ? author.authorHandle : null}
      onToggleFollow={() => void toggleFollow()}
      onOpenBok={onOpenBok}
      onOpenWriter={onOpenWriter}
      onOpenAccount={onOpenAccount}
      onClose={onClose}
    />
  );
}
