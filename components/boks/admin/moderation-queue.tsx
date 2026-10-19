"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { Textarea } from "@/components/ui/textarea";
import type { AdminBokDetail, AdminModerationItem } from "@/components/boks/client-types";
import { loadAdminBok } from "@/components/boks/supabase-browser-data";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";

/** One reading room, with the same real review action used by the old queue. */
export function ModerationQueue({ items, busy, onReview, onRefresh }: {
  items: AdminModerationItem[];
  busy: boolean;
  onRefresh: () => void;
  onReview: (item: AdminModerationItem, decision: "approve" | "reject", reason: string) => Promise<boolean>;
}) {
  const [queueStatus, setQueueStatus] = useState<"pending_review" | "rejected">("pending_review");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refusalOpen, setRefusalOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [evidence, setEvidence] = useState<AdminBokDetail | null>(null);
  const [evidenceError, setEvidenceError] = useState("");
  const [evidenceAttempt, setEvidenceAttempt] = useState(0);
  const { openBok, openPerson } = useAdminInspector();
  const visibleItems = items.filter((item) => item.status === queueStatus);
  const selected = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0];
  const id = selected?.id;

  useEffect(() => {
    if (!id) return;
    let active = true;
    void loadAdminBok(id).then((detail) => {
      if (active) { setEvidence(detail); setEvidenceError(""); }
    }).catch(() => {
      if (active) setEvidenceError("Could not load the rights record. Retry or open the complete record.");
    });
    return () => { active = false; };
  }, [id, evidenceAttempt]);

  async function review(item: AdminModerationItem, decision: "approve" | "reject") {
    const reason = reasons[item.id]?.trim() ?? "";
    if (decision === "reject" && !reason) {
      setStatus("Add a clear reason before sending a bok back. The author sees it.");
      return;
    }
    setStatus("");
    const saved = await onReview(item, decision, reason);
    if (!saved) return;
    setReasons((current) => { const next = { ...current }; delete next[item.id]; return next; });
    setReading(false);
    setRefusalOpen(false);
  }

  if (!selected) {
    return <section className="studio-empty"><span aria-hidden="true">b.</span><h2>{queueStatus === "pending_review" ? "No pending submissions" : "No refused submissions"}</h2><p>New boks will appear here when their authors submit them.</p>{items.some((item) => item.status !== queueStatus) && <Button variant="outline" onClick={() => setQueueStatus(queueStatus === "pending_review" ? "rejected" : "pending_review")}>{queueStatus === "pending_review" ? "View refused submissions" : "Back to pending submissions"}</Button>}</section>;
  }
  const rights = evidence?.id === selected.id ? evidence.rights : undefined;
  const wordCount = evidence?.id === selected.id ? evidence.wordCount : selected.wordCount;

  return (
    <section className={`studio-review ${reading ? "studio-review--reading" : ""}`}>
      <nav className="studio-review-queue" aria-label="Submissions">
        <div className="studio-queue-filter"><button type="button" aria-pressed={queueStatus === "pending_review"} onClick={() => { setQueueStatus("pending_review"); setReading(false); }}>Waiting</button><button type="button" aria-pressed={queueStatus === "rejected"} onClick={() => { setQueueStatus("rejected"); setReading(false); }}>Refused</button></div>
        {visibleItems.map((item, index) => (
          <button type="button" key={item.id} aria-current={selected.id === item.id ? "true" : undefined}
            onClick={() => { setSelectedId(item.id); setReading(true); setStatus(""); setEvidenceError(""); window.scrollTo({ top: 0, behavior: "instant" }); }}>
            <span>{String(index + 1).padStart(2, "0")} · {item.submittedAt ? new Date(item.submittedAt).toLocaleDateString() : "Not submitted"}</span>
            <h2>{item.title}</h2><p>{[item.authorName, item.authorHandle ? `@${item.authorHandle.replace(/^@+/, "")}` : ""].filter(Boolean).join(" · ")}</p>
            <small>{item.minutes} min · {item.status === "rejected" ? "Refused" : "Private submission"}</small>
            <p className="studio-review-excerpt">{item.body.slice(0, 140)}{item.body.length > 140 ? "…" : ""}</p>
            <span className="studio-review-open">Read & review <ArrowUpRight /></span>
          </button>
        ))}
        <p>Submissions stay private until approved.</p><Button variant="ghost" onClick={onRefresh} disabled={busy}><RefreshCw /> Refresh queue</Button>
      </nav>
      <article className="studio-review-text" key={selected.id}>
        <Button variant="ghost" className="studio-review-back" onClick={() => { setReading(false); window.scrollTo({ top: 0, behavior: "instant" }); }}><ArrowLeft /> Review queue</Button>
        <span className="studio-eyebrow">{selected.status === "rejected" ? "Refused submission" : "Private submission"}</span>
        <h2>{selected.title}</h2><p className="studio-review-byline">{selected.authorName || `@${selected.authorHandle}`}</p>
        <div>{selected.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <div className="studio-endmark" aria-hidden="true">b.</div>
      </article>
      <aside className="studio-review-evidence">
        <h3>Before publishing</h3>
        <div className={`studio-rights-note ${rights?.confirmed ? "is-confirmed" : ""}`}>
          <strong><ShieldCheck /> {rights === undefined ? "Loading rights…" : rights?.confirmed ? "Rights confirmed" : "Rights not confirmed"}</strong>
          {rights?.note && <p>{rights.note}</p>}
          {rights === null && <p>No rights record is available.</p>}
        </div>
        {evidenceError && <div role="alert"><p>{evidenceError}</p><Button variant="outline" onClick={() => setEvidenceAttempt((value) => value + 1)}>Retry rights</Button></div>}
        <dl><dt>Account</dt><dd>{selected.authorUserId ? <button type="button" className="inspector-link" onClick={() => openPerson(selected.authorUserId!)}>@{selected.authorHandle.replace(/^@+/, "")} ↗</button> : selected.authorHandle || "Unavailable"}</dd>
          <dt>Submitted</dt><dd>{selected.submittedAt ? new Date(selected.submittedAt).toLocaleString() : "—"}</dd>
          <dt>Length</dt><dd>{selected.minutes} min{Number.isFinite(wordCount) ? ` · ${wordCount} words` : ""}</dd></dl>
        {selected.reviewNote && <p className="studio-review-previous">Previous reason: {selected.reviewNote}</p>}
        <label htmlFor={`review-note-${selected.id}`}>Note to the author</label>
        <Textarea id={`review-note-${selected.id}`} value={reasons[selected.id] ?? ""} rows={5}
          onChange={(event) => setReasons((current) => ({ ...current, [selected.id]: event.target.value }))} />
        <small>Required if you send this back.</small>
        {status && <p role="alert">{status}</p>}
        <div className="studio-review-decisions">
          <Button disabled={busy} onClick={() => void review(selected, "approve")}><Check /> Approve & publish</Button>
          <Button variant="outline" disabled={busy} onClick={() => setRefusalOpen(true)}><XCircle /> Send back with note</Button>
        </div>
        <button type="button" className="inspector-link" onClick={() => openBok(selected.id)}>Open complete record <ArrowUpRight className="inline size-4" /></button>
      </aside>
      <Dialog open={refusalOpen} onOpenChange={(open) => !busy && setRefusalOpen(open)}><DialogContent className="studio-dialog" onInteractOutside={(event) => busy && event.preventDefault()} onEscapeKeyDown={(event) => busy && event.preventDefault()}><div className="studio-dialog-brand"><BoksLogo /></div><DialogHeader><p className="studio-eyebrow">Studio</p><DialogTitle>Request changes</DialogTitle><DialogDescription className="sr-only">Send the author a note so they can revise this bok.</DialogDescription></DialogHeader><div className="studio-paper-slip"><p className="studio-eyebrow">To @{selected.authorHandle.replace(/^@+/, "")}</p><h2>{selected.title}</h2></div><label className="studio-field">What needs to change?<Textarea value={reasons[selected.id] ?? ""} rows={6} autoFocus onChange={(event) => setReasons((current) => ({ ...current, [selected.id]: event.target.value }))} /></label><p className="studio-hint">The author will see this exact note and can revise the same bok.</p><p className="studio-meta">Nothing is published when you send this note.</p>{status && <p role="alert">{status}</p>}<DialogFooter><Button variant="outline" onClick={() => setRefusalOpen(false)} disabled={busy}>Cancel</Button><Button disabled={busy || !reasons[selected.id]?.trim()} onClick={() => void review(selected, "reject")}>Send back with note</Button></DialogFooter></DialogContent></Dialog>
    </section>
  );
}
