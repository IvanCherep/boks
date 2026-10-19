"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Archive, ExternalLink, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBokDetail, AdminBokStatus } from "@/components/boks/client-types";
import { deleteSupabaseComment, loadAdminBok } from "@/components/boks/supabase-browser-data";
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
  const [reading, setReading] = useState(false);
  const [action, setAction] = useState<BokLifecycleTarget | null>(null);
  const [confirmingComment, setConfirmingComment] = useState<number | null>(null);
  const [deletingComment, setDeletingComment] = useState<number | null>(null);

  async function deleteComment(commentId: number) {
    setDeletingComment(commentId);
    try {
      const result = await deleteSupabaseComment(commentId);
      setNotice(result.repliesRemoved ? "Comment and its replies deleted." : "Comment deleted.");
      setConfirmingComment(null);
      onChanged();
      await refresh();
    } catch (caught) {
      setError(readableBoksError(caught, "Could not delete the comment."));
    } finally {
      setDeletingComment(null);
    }
  }

  const refresh = useCallback(async () => {
    try {
      setBok(await loadAdminBok(id));
      setError("");
    } catch (caught) {
      setError(readableBoksError(caught, "Could not open this bok."));
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
      <header className="studio-inspector-heading">
        <p className="studio-eyebrow">Bok / inspector</p><BokStatusBadge status={bok.status} />
        <h2>{bok.title}</h2>
        {bok.authorUserId ? <button className="studio-author-link" type="button" onClick={() => openPerson(bok.authorUserId!)}>{bok.authorName}{handle ? ` · @${handle}` : ""}<span>↗</span></button> : <p className="studio-meta">{bok.authorName}</p>}
      </header>
      {(notice || error) && <p className="studio-meta" aria-live="polite">{error || notice}</p>}
      <section className="inspector-metrics" aria-label="Reading metrics">
        <Metric label="reading minutes" value={m.minutes} /><Metric label="readers" value={m.readers} />
        <Metric label="read / started" value={`${m.completes} / ${m.starts}`} detail={m.starts < 10 || m.finishRate === null ? undefined : `${m.finishRate}%`} />
        <Metric label="comments" value={m.comments} />
      </section>
      <h3 className="inspector-heading">Record</h3>
      <dl className="inspector-facts" aria-label="Current record">
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
        {!reading ? <><p className="studio-inspector-quote">{bok.body.split("\n").find((paragraph) => paragraph.trim())}</p><button className="studio-author-link" type="button" onClick={() => setReading(true)}>Read the complete bok <span>↗</span></button></> : <><button type="button" className="studio-text-link" onClick={() => setReading(false)}>← Back to record</button><div className="inspector-text" lang={bok.language || undefined}>{bok.body.split("\n").map((paragraph, index) => <p key={index}>{paragraph || " "}</p>)}<div className="studio-endmark">b.</div></div></>}
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
                <div className="mt-1 flex items-center gap-3 text-xs">
                  {confirmingComment === comment.id ? (
                    <>
                      <span>Delete this comment{comment.parentCommentId ? "" : " and any replies"}?</span>
                      <button
                        type="button"
                        className="inspector-link text-[var(--destructive)]"
                        onClick={() => void deleteComment(comment.id)}
                        disabled={deletingComment === comment.id}
                      >
                        {deletingComment === comment.id ? "Deleting…" : "Delete"}
                      </button>
                      <button type="button" className="inspector-link" onClick={() => setConfirmingComment(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className="inspector-link" onClick={() => setConfirmingComment(comment.id)}>
                      Delete
                    </button>
                  )}
                </div>
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
      <details className="studio-details"><summary>Measurement details <span>＋</span></summary><div className="studio-details-body">
        <section className="inspector-metrics"><Metric label="impressions" value={m.impressions} /><Metric label="skips" value={m.skips} /><Metric label="likes" value={m.likes} /><Metric label="shares" value={m.shares} /><Metric label="reports" value={m.reports} detail={`${m.openReports} open`} /></section>
        <p className="studio-meta">Last read {formatAdminDate(m.lastReadAt)} · {bok.language} · {bok.genre} · {bok.mood}{bok.imported ? " · imported" : ""}{bok.isSeed ? " · seed" : ""}</p>
      </div></details>
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
