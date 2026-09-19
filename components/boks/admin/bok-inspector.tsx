"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Archive, ExternalLink, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBokDetail, AdminBokStatus } from "@/components/boks/client-types";
import { loadAdminBok } from "@/components/boks/supabase-browser-data";
import { readableBoksError } from "@/lib/boks/errors";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import {
  BokLifecycleDialog,
  type BokLifecycleTarget,
} from "@/components/boks/admin/bok-lifecycle-dialog";

export const bokStatusLabel: Record<AdminBokStatus, string> = {
  draft: "Draft",
  pending_review: "Waiting for review",
  published: "Published",
  rejected: "Refused",
  archived: "Deleted",
};

export function BokStatusBadge({ status }: { status: AdminBokStatus }) {
  return <span className={`review-badge review-badge--${status}`}>{bokStatusLabel[status]}</span>;
}

export function formatAdminDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

/**
 * One boks, in any status, for an admin: what it says, who wrote it, how it
 * was reviewed or removed, how it is read, and what readers said about it.
 * Every list in the console that shows a boks opens this.
 */
export function BokInspector({
  id,
  onChanged,
  onErased,
}: {
  id: string;
  /** Something about this boks changed; lists showing it should reload. */
  onChanged: () => void;
  /** The boks no longer exists. */
  onErased: () => void;
}) {
  const { openPerson } = useAdminInspector();
  const [bok, setBok] = useState<AdminBokDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [action, setAction] = useState<BokLifecycleTarget | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBok(await loadAdminBok(id));
      setError("");
    } catch (caught) {
      setError(readableBoksError(caught, "Could not open this boks."));
    }
  }, [id]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  async function afterAction(done: BokLifecycleTarget) {
    setAction(null);
    onChanged();
    if (done.kind === "delete") {
      onErased();
      return;
    }
    setNotice(done.kind === "archive" ? "Hidden from readers. It is listed under Content → Deleted." : "Restored to the reader feed.");
    await refresh();
  }

  if (error && !bok) return <p className="p-6 text-sm text-[var(--destructive)]">{error}</p>;
  if (!bok) return <p className="p-6 text-sm text-[var(--muted-foreground)]">Loading…</p>;

  const m = bok.metrics;
  const target = { id: bok.id, title: bok.title };
  const handle = bok.authorHandle.replace(/^@+/, "");

  return (
    <div className="inspector-body">
      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <BokStatusBadge status={bok.status} />
          {bok.language && <span className="inspector-chip">{bok.language}</span>}
          <span className="inspector-chip">{bok.genre}</span>
          <span className="inspector-chip">{bok.mood}</span>
          {bok.imported && <span className="inspector-chip">imported</span>}
          {bok.isSeed && <span className="inspector-chip">seed</span>}
        </div>
        <h2 className="text-2xl font-semibold tracking-normal">{bok.title}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {bok.authorName}
          {handle && (
            <>
              {" · "}
              {bok.authorUserId ? (
                <button type="button" className="inspector-link" onClick={() => openPerson(bok.authorUserId!)}>
                  @{handle}
                </button>
              ) : (
                <>@{handle}</>
              )}
            </>
          )}
          {bok.authorEmail ? ` · ${bok.authorEmail}` : ""}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {bok.status === "published" && (
            <Button asChild size="sm" variant="outline">
              <a href={`/b/${bok.id}`} target="_blank" rel="noreferrer">
                <ExternalLink /> Open in reader
              </a>
            </Button>
          )}
          {bok.status !== "archived" ? (
            <Button size="sm" variant="outline" onClick={() => setAction({ kind: "archive", bok: target })}>
              <Archive /> Hide
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setAction({ kind: "restore", bok: target })}>
                <RotateCcw /> Restore
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "delete", bok: target })}>
                <Trash2 /> Delete permanently
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => refresh()}>
            <RefreshCw /> Refresh
          </Button>
        </div>
        {(notice || error) && (
          <p className="text-sm text-[var(--muted-foreground)]" aria-live="polite">
            {error || notice}
          </p>
        )}
      </header>

      <section className="inspector-metrics" aria-label="Reading metrics">
        <Metric label="Reading minutes" value={m.minutes} />
        <Metric label="Readers" value={m.readers} />
        <Metric label="Impressions" value={m.impressions} />
        <Metric label="Finished" value={m.completes} detail={`of ${m.starts} starts${m.finishRate !== null ? ` · ${m.finishRate}%` : ""}`} />
        <Metric label="Skips" value={m.skips} />
        <Metric label="Likes" value={m.likes} />
        <Metric label="Comments" value={m.comments} />
        <Metric label="Shares" value={m.shares} />
        <Metric label="Reports" value={m.reports} detail={m.openReports ? `${m.openReports} open` : undefined} />
      </section>
      <p className="text-xs text-[var(--muted-foreground)]">Last read {formatAdminDate(m.lastReadAt)}</p>

      <dl className="inspector-facts" aria-label="History">
        <Fact label="Length">{bok.estimatedMinutes} min · {bok.wordCount} words</Fact>
        <Fact label="Created">{formatAdminDate(bok.createdAt)}</Fact>
        {bok.submittedAt && <Fact label="Submitted">{formatAdminDate(bok.submittedAt)}</Fact>}
        {bok.reviewedAt && (
          <Fact label="Reviewed">
            {formatAdminDate(bok.reviewedAt)}
            {bok.reviewedBy ? ` by @${bok.reviewedBy}` : ""}
          </Fact>
        )}
        {bok.reviewNote && bok.status !== "archived" && <Fact label="Review note">{bok.reviewNote}</Fact>}
        {bok.archivedAt && (
          <Fact label="Hidden">
            {formatAdminDate(bok.archivedAt)}
            {bok.archivedBy ? ` by @${bok.archivedBy}` : ""}
            {bok.archiveReason ? ` — ${bok.archiveReason}` : ""}
          </Fact>
        )}
        <Fact label="Rights">
          {bok.rights ? (bok.rights.confirmed ? "Confirmed" : "Not confirmed") : "No record"}
          {bok.rights?.note ? ` — ${bok.rights.note}` : ""}
        </Fact>
      </dl>

      <section className="grid gap-2" aria-label="Text">
        <h3 className="inspector-heading">Text</h3>
        {bok.hook && <p className="text-sm italic text-[var(--soft-foreground)]">{bok.hook}</p>}
        <div className="inspector-text">
          {bok.body.split("\n").map((paragraph, index) => (
            <p key={index}>{paragraph || " "}</p>
          ))}
        </div>
      </section>

      <section className="grid gap-2" aria-label="Comments">
        <h3 className="inspector-heading">
          Comments <span>{m.comments}</span>
        </h3>
        {bok.comments.length ? (
          <ul className="inspector-list">
            {bok.comments.map((comment) => (
              <li key={comment.id}>
                <div className="inspector-list__meta">
                  <button type="button" className="inspector-link" onClick={() => openPerson(comment.userId)}>
                    @{comment.handle || "reader"}
                  </button>
                  <span>{comment.parentCommentId ? "reply · " : ""}{formatAdminDate(comment.createdAt)}</span>
                  {comment.likes > 0 && <span>♥ {comment.likes}</span>}
                </div>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">No comments.</p>
        )}
      </section>

      <section className="grid gap-2" aria-label="Liked by">
        <h3 className="inspector-heading">
          Liked by <span>{m.likes}</span>
        </h3>
        {bok.likers.length ? (
          <div className="flex flex-wrap gap-2">
            {bok.likers.map((liker) => (
              <button
                key={liker.userId}
                type="button"
                className="inspector-chip inspector-chip--link"
                onClick={() => openPerson(liker.userId)}
                title={formatAdminDate(liker.likedAt)}
              >
                @{liker.handle || "reader"}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">No likes.</p>
        )}
      </section>

      <BokLifecycleDialog target={action} onClose={() => setAction(null)} onDone={afterAction} />
    </div>
  );
}

export function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return (
    <div className="inspector-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="inspector-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
