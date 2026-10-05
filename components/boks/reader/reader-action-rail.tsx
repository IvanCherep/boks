"use client";

import { Clapperboard, Heart, MessageCircle, Music, Share2, Trash2 } from "lucide-react";
import { ActionButton } from "@/components/boks/shared-ui";

/**
 * What the boks on screen can be done with: like, comments, share, its
 * reading format when it has one, music, and - for an admin - hide.
 *
 * Likes and replies carry their counts to the right of the icon, always. The
 * like total is public as an aggregate - how many, never who - and is
 * reconciled with this reader's own like so the number moves the moment the
 * heart does. A share has no count: it cannot be seen once the link leaves the
 * app.
 */
export function ReaderActionRail({
  inert,
  liked,
  likeCount,
  commentCount,
  formatLabel,
  musicOn,
  canHide,
  onLike,
  onComments,
  onShare,
  onOpenFormat,
  onToggleMusic,
  onHide,
}: {
  /** True while a sheet or format is over the boks. */
  inert: boolean;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  /** The format button's label, or null when this boks has no format to offer. */
  formatLabel: string | null;
  musicOn: boolean;
  /** Admins only, and only as a convenience - the database is the authority. */
  canHide: boolean;
  onLike: () => void;
  onComments: () => void;
  onShare: () => void;
  onOpenFormat: () => void;
  onToggleMusic: () => void;
  onHide: () => void;
}) {
  return (
    <aside className="action-rail reader-ui pointer-events-none" inert={inert ? true : undefined}>
      <ActionButton label={liked ? "Remove like" : "Like"} value={likeCount} onClick={onLike} active={liked}>
        {/* Filled when liked: the state has to read at a glance, not only
            through a tinted background. */}
        <Heart className="size-5" fill={liked ? "currentColor" : "none"} />
      </ActionButton>
      <ActionButton label="Comments" value={commentCount} onClick={onComments}>
        <MessageCircle className="size-5" />
      </ActionButton>
      <ActionButton label="Share" onClick={onShare}>
        <Share2 className="size-5" />
      </ActionButton>
      {formatLabel && (
        <ActionButton label={formatLabel} onClick={onOpenFormat}>
          <Clapperboard className="size-5" />
        </ActionButton>
      )}
      {/* Something to read to: one track for the whole catalogue, off until asked for. */}
      <ActionButton
        label={musicOn ? "Turn the music off" : "Play music while you read"}
        onClick={onToggleMusic}
        active={musicOn}
      >
        <Music className="size-5" />
      </ActionButton>
      {canHide && (
        <ActionButton label="Hide this bok from readers (admin)" onClick={onHide} tone="danger">
          <Trash2 className="size-5" />
        </ActionButton>
      )}
    </aside>
  );
}
