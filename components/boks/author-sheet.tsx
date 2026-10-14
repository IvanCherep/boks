"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReaderSheet } from "@/components/boks/reader-sheet";
import type { AuthorProfile } from "@/components/boks/client-types";
import { loadBoksAuthor, setAuthorFollow } from "@/components/boks/supabase-browser-data";
import { haptic } from "@/components/boks/reader-haptics";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

/** Names and titles keep their own language; only the sheet is translated. */
const messages = defineMessages(
  {
    loading: "Loading",
    unavailable: "This author is not available.",
    openFailed: "Could not open this author.",
    followFailed: "Could not update following.",
    boks: (n: number) => `${n} ${n === 1 ? "bok" : "boks"}`,
    writers: (n: number) => `${n} ${n === 1 ? "writer" : "writers"}`,
    followers: (n: number) => `${n} ${n === 1 ? "follower" : "followers"}`,
    sheetLabel: (name: string) => `${name}, author`,
    author: "Author",
    publishedBy: "published by",
    close: "Close author",
    followExplainer: (handle: string, byline: string) =>
      `Following @${handle} brings you everything they publish, not only ${byline}. Another account publishing ${byline} is followed separately.`,
    followingHandle: (handle: string) => `Following @${handle}`,
    followHandle: (handle: string) => `Follow @${handle}`,
    following: "Following",
    follow: "Follow",
    openingCatalog: "From the opening catalog. There is no account behind this byline yet.",
    nothingYet: "Nothing published yet.",
    writersHeading: "Writers",
    newest: "Newest",
    readingNow: "reading now",
    showingNewest: (shown: number, total: number) => `Showing the newest ${shown} of ${total}.`,
  },
  {
    ru: {
      loading: "Загрузка",
      unavailable: "Этот автор недоступен.",
      openFailed: "Не удалось открыть автора.",
      followFailed: "Не удалось обновить подписку.",
      boks: (n: number) =>
        `${n} ${plural("ru", n, { one: "текст", few: "текста", many: "текстов", other: "текста" })}`,
      writers: (n: number) => `${n} ${plural("ru", n, { one: "автор", few: "автора", many: "авторов", other: "автора" })}`,
      followers: (n: number) =>
        `${n} ${plural("ru", n, { one: "подписчик", few: "подписчика", many: "подписчиков", other: "подписчика" })}`,
      sheetLabel: (name: string) => `${name}, автор`,
      author: "Автор",
      publishedBy: "публикует",
      close: "Закрыть автора",
      followExplainer: (handle: string, byline: string) =>
        `Подписка на @${handle} - это всё, что публикует этот аккаунт, а не только ${byline}. Другой аккаунт, публикующий ${byline}, - отдельная подписка.`,
      followingHandle: (handle: string) => `Вы подписаны на @${handle}`,
      followHandle: (handle: string) => `Подписаться на @${handle}`,
      following: "Вы подписаны",
      follow: "Подписаться",
      openingCatalog: "Из стартового каталога. За этой подписью пока нет аккаунта.",
      nothingYet: "Пока ничего не опубликовано.",
      writersHeading: "Авторы",
      newest: "Новое",
      readingNow: "читаете сейчас",
      showingNewest: (shown: number, total: number) => `Показаны ${shown} новейших из ${total}.`,
    },
  }
);

type SheetStatus =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "openFailed"; message?: string }
  | { kind: "followFailed"; message?: string };

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
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  const words = useMessages(messages);
  const [sheetStatus, setStatus] = useState<SheetStatus>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  // Keyed by handle in the parent, so a different author mounts a fresh sheet
  // rather than resetting this one's state on the way in.
  useEffect(() => {
    let cancelled = false;

    loadBoksAuthor(handle, authorName)
      .then((profile) => {
        if (cancelled) return;
        setAuthor(profile);
        setStatus(profile ? { kind: "none" } : { kind: "unavailable" });
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus({ kind: "openFailed", message: error instanceof Error ? error.message : undefined });
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
      setStatus({ kind: "followFailed", message: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const status =
    sheetStatus.kind === "none"
      ? ""
      : sheetStatus.kind === "openFailed" || sheetStatus.kind === "followFailed"
        ? (sheetStatus.message ?? words[sheetStatus.kind])
        : words[sheetStatus.kind];

  const meta = [
    author ? words.boks(author.totalBoks) : null,
    author?.writers.length ? words.writers(author.writers.length) : null,
    author?.authorUserId && !author.byline ? words.followers(author.followers) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ReaderSheet
      label={author ? words.sheetLabel(author.authorName || "@" + author.authorHandle) : words.author}
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
            {author?.byline ? (
              <>
                {/* In writer mode the handle is the publisher, and it is a way
                    back rather than a caption: this writer is one of the many
                    that account publishes, and the account is what a reader
                    follows. */}
                {words.publishedBy}{" "}
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
              [author?.authorName ? `@${author.authorHandle}` : null, meta].filter(Boolean).join(" · ")
            )}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={words.close}>
          <X className="size-4" />
        </Button>
      </div>

      {author?.byline && author.authorUserId && (
        <p className="px-4 pt-2 text-sm leading-6 text-[var(--muted-foreground)]">
          {words.followExplainer(author.authorHandle, author.byline)}
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
                ? words.followingHandle(author.authorHandle)
                : words.followHandle(author.authorHandle)
              : author.following
                ? words.following
                : words.follow}
          </Button>
        </div>
      ) : (
        author && (
          <p className="px-4 pt-2 text-sm text-[var(--muted-foreground)]">
            {words.openingCatalog}
          </p>
        )
      )}

      <div className="comment-list min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {status && <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">{status}</p>}
        {author && !author.boks.length && !status && (
          <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">{words.nothingYet}</p>
        )}

        {/* A publisher's catalogue is indexed by its writers. A flat list of
            457 titles is not something anyone reads; "24 writers" is. */}
        {author && author.writers.length > 1 && (
          <div className="mb-3">
            <h3 className="text-sm font-semibold">{words.writersHeading}</h3>
            <ul className="mt-2 grid gap-1">
              {author.writers.map((writer) => (
                <li key={writer.name}>
                  <button type="button" className="author-writer" onClick={() => onOpenWriter?.(writer.name)}>
                    <span className="font-medium">{writer.name}</span>
                    <span className="text-sm text-[var(--muted-foreground)]">{words.boks(writer.boks)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <h3 className="mt-4 text-sm font-semibold">{words.newest}</h3>
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
                  {bok.id === currentStoryId && <span className="author-bok-now">{words.readingNow}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {author && author.boks.length > 0 && author.boks.length < author.totalBoks && (
          <p className="pt-3 text-center text-sm text-[var(--muted-foreground)]">
            {words.showingNewest(author.boks.length, author.totalBoks)}
          </p>
        )}
      </div>
    </ReaderSheet>
  );
}

