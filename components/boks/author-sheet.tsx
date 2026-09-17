"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReaderSheet } from "@/components/boks/reader-sheet";
import type { AuthorProfile } from "@/components/boks/client-types";
import { loadBoksAuthor, setAuthorFollow } from "@/components/boks/supabase-browser-data";
import { haptic } from "@/components/boks/reader-haptics";

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
}: AuthorSheetProps) {
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  const [status, setStatus] = useState("Loading");
  const [busy, setBusy] = useState(false);

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
        setStatus(error instanceof Error ? error.message : "Could not open this author.");
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
      setStatus(error instanceof Error ? error.message : "Could not update following.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReaderSheet
      label={author ? `${author.authorName || "@" + author.authorHandle}, author` : "Author"}
      onClose={onClose}
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-1 sm:pt-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-normal">
            {/* A name when there is one, otherwise the @handle stands alone
                rather than the sheet inventing a label. */}
            {author?.authorName || `@${author?.authorHandle ?? handle.replace(/^@+/, "")}`}
          </h2>
          {/* Built as a list and joined, so a missing name never leaves the
              line starting with a separator. */}
          <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
            {[
              // In writer mode the handle is the publisher, and saying so is
              // the point; otherwise it is the account's own name.
              author?.byline ? `published by @${author.authorHandle}` : author?.authorName ? `@${author.authorHandle}` : null,
              author ? countLabel(author.totalBoks, "bok") : null,
              author?.writers.length ? countLabel(author.writers.length, "writer") : null,
              author?.authorUserId && !author.byline ? countLabel(author.followers, "follower") : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close author">
          <X className="size-4" />
        </Button>
      </div>

      {author?.byline && author.authorUserId && (
        <p className="px-4 pt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          Following @{author.authorHandle} brings you everything they publish, not only{" "}
          {author.byline}.
        </p>
      )}

      {author?.authorUserId ? (
        <div className="px-4 pt-3">
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
                ? `Following @${author.authorHandle}`
                : `Follow @${author.authorHandle}`
              : author.following
                ? "Following"
                : "Follow"}
          </Button>
        </div>
      ) : (
        author && (
          <p className="px-4 pt-2 text-sm text-[var(--muted-foreground)]">
            From the opening catalog. There is no account behind this byline yet.
          </p>
        )
      )}

      <div className="comment-list min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {status && <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}
        {author && !author.boks.length && !status && (
          <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">Nothing published yet.</p>
        )}

        {/* A publisher's catalogue is indexed by its writers. A flat list of
            457 titles is not something anyone reads; "24 writers" is. */}
        {author && author.writers.length > 1 && (
          <div className="mb-3">
            <h3 className="text-sm font-semibold">Writers</h3>
            <ul className="mt-2 grid gap-1">
              {author.writers.map((writer) => (
                <li key={writer.name}>
                  <button type="button" className="author-writer" onClick={() => onOpenWriter?.(writer.name)}>
                    <span className="font-medium">{writer.name}</span>
                    <span className="text-sm text-[var(--muted-foreground)]">{countLabel(writer.boks, "bok")}</span>
                  </button>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-sm font-semibold">Newest</h3>
          </div>
        )}

        {author && author.boks.length > 0 && (
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
                  {bok.hook && (
                    <span className="mt-1 line-clamp-2 text-sm text-[var(--muted-foreground)]">{bok.hook}</span>
                  )}
                  {bok.id === currentStoryId && <span className="author-bok-now">reading now</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ReaderSheet>
  );
}

function countLabel(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
