"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Check, Flag, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MetricTile } from "@/components/boks/shared-ui";
import { shortTimeAgo } from "@/components/boks/client-format";
import { readableBoksError } from "@/lib/boks/errors";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import type { BoksRightsReview } from "@/components/boks/client-types";
import {
  loadBoksRightsReview,
  reviewBokReport,
  setBokRights,
} from "@/components/boks/supabase-browser-data";

/**
 * Copyright, from an admin's side: the complaints readers filed, and the boks
 * nobody has vouched for.
 *
 * They are one panel rather than two because they are the same question asked
 * from opposite ends - "may this be here?" - and an admin acting on a report
 * needs to see what the author claimed about the rights in the same glance.
 */
const pageSize = 25;

export function RightsReview() {
  const [review, setReview] = useState<BoksRightsReview>({
    openReports: 0,
    reportsTotal: 0,
    limit: pageSize,
    reportsOffset: 0,
    unattestedOffset: 0,
    unattested: 0,
    reports: [],
    unattestedBoks: [],
  });
  const [reportsPage, setReportsPage] = useState(0);
  const [unattestedPage, setUnattestedPage] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const latestRequest = useRef(0);
  const [scope, setScope] = useState<"open" | "all">("open");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedBokId, setSelectedBokId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rightsNotes, setRightsNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // The reader can only open a published boks; a reported or unattested one is
  // often not. The admin boks view opens any of them.
  const { openBok } = useAdminInspector();

  const refresh = useCallback(async (next: "open" | "all", reportPage = reportsPage, rightsPage = unattestedPage) => {
    const request = ++latestRequest.current;
    setLoading(true);
    try {
      const payload = await loadBoksRightsReview(next, pageSize, reportPage * pageSize, rightsPage * pageSize);
      if (request !== latestRequest.current) return;
      setLoadError("");
      // Removing the last item on a page returns to the last real page.
      const lastReportPage = Math.max(0, Math.ceil(payload.reportsTotal / pageSize) - 1);
      const lastRightsPage = Math.max(0, Math.ceil(payload.unattested / pageSize) - 1);
      if (reportPage > lastReportPage || rightsPage > lastRightsPage) {
        setReportsPage(Math.min(reportPage, lastReportPage));
        setUnattestedPage(Math.min(rightsPage, lastRightsPage));
        return;
      }
      setReview(payload);
      setLoaded(true);
    } catch (error) {
      if (request !== latestRequest.current) return;
      setLoadError(readableBoksError(error, "Could not load the rights review. Your notes are kept."));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [reportsPage, unattestedPage]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void refresh(scope);
    }, 0);
    return () => { window.clearTimeout(handle); latestRequest.current += 1; };
  }, [refresh, scope]);

  function changeScope(next: "open" | "all") {
    setScope(next);
    setReportsPage(0);
    setStatus("");
  }

  async function resolve(reportId: string, decision: "actioned" | "dismissed") {
    const note = notes[reportId]?.trim() ?? "";
    if (decision === "actioned" && !note) {
      setStatus("Say why the bok is coming down. The author is shown this.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const result = await reviewBokReport({ reportId, decision, note });
      setStatus(
        decision === "actioned"
          ? `Taken down. The bok is now ${result.bokStatus} and its author sees your reason.`
          : "Dismissed. The bok stays up and the author is not told."
      );
      setNotes((current) => {
        const next = { ...current };
        delete next[reportId];
        return next;
      });
      await refresh(scope);
    } catch (error) {
      setStatus(readableBoksError(error, "Could not resolve that report."));
    } finally {
      setBusy(false);
    }
  }

  async function attest(reelId: string, confirmed: boolean) {
    const note = rightsNotes[reelId]?.trim() ?? "";
    if (confirmed && !note) {
      setStatus("Write down where the rights come from before marking it cleared.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      await setBokRights({ reelId, confirmed, note });
      setStatus(confirmed ? "Recorded as cleared." : "Left unattested.");
      await refresh(scope);
    } catch (error) {
      setStatus(readableBoksError(error, "Could not record that."));
    } finally {
      setBusy(false);
    }
  }

  const selectedReport = review.reports.find(report => report.id === selectedReportId);
  const selectedBok = review.unattestedBoks.find(bok => bok.reelId === selectedBokId);
  function back() { setSelectedReportId(null); setSelectedBokId(null); setStatus(""); window.scrollTo({ top: 0, behavior: "instant" }); }

  return (
    <section className="studio-rights grid gap-4" data-studio-detail={selectedReport || selectedBok ? "true" : undefined}>
      {(selectedReport || selectedBok) && <>
        <button type="button" className="studio-text-link" onClick={back}><ArrowLeft size={17} /> Rights & reports</button>
        <div className="studio-subview-heading"><p className="studio-eyebrow">Editorial / rights</p><h1>{selectedReport ? selectedReport.kind === "copyright" ? "Copyright report" : "Reader report" : "Record a rights source"}</h1></div>
      </>}
      {loading && <p role="status">Loading rights review…</p>}
      {loadError && <p role="alert">{loadError} {loaded && "The last loaded page is still shown."}</p>}
      {!selectedReport && !selectedBok && <>
        {loaded && <div className="studio-metric-pair"><MetricTile label="Open reports" value={review.openReports} /><MetricTile label="Unattested boks" value={review.unattested} /></div>}
        <div className="studio-filter-line">
          <div className="admin-segmented" aria-label="Report status"><button type="button" aria-pressed={scope === "open"} onClick={() => changeScope("open")} disabled={busy}>Open</button><button type="button" aria-pressed={scope === "all"} onClick={() => changeScope("all")} disabled={busy}>All reports</button></div>
          <Button variant="ghost" onClick={() => void refresh(scope)} disabled={busy || loading}><RefreshCw size={16} /> Refresh</Button>
        </div>
        <section className="studio-editorial-section"><h2>A reader wrote</h2>
          {review.reports.length ? review.reports.map(report => <button key={report.id} type="button" className="studio-report-card" onClick={() => { setSelectedReportId(report.id); setStatus(""); window.scrollTo({ top: 0, behavior: "instant" }); }}>
            <span className={`review-badge review-badge--${report.status === "open" ? "pending_review" : report.status === "actioned" ? "rejected" : "published"}`}><Flag size={13} /> {report.kind === "copyright" ? "Copyright" : "Other"} · {report.status}</span>
            <h2>{report.title}</h2><p>“{report.reason}”</p><small>{report.reporterHandle ? `@${report.reporterHandle}` : "Guest report"} · {shortTimeAgo(report.createdAt)}</small><b>Review report <ArrowUpRight size={18} /></b>
          </button>) : <p className="studio-meta">{!loaded ? "Reports have not loaded." : scope === "open" ? "Nothing reported." : "No reports at all."}</p>}
          {loaded && <RightsPagination label="reports" page={review.reportsOffset / pageSize} total={review.reportsTotal} disabled={busy || loading} onPage={setReportsPage} />}
        </section>
        <section className="studio-editorial-section"><h2>Rights not yet confirmed</h2>
          <div className="studio-link-rows">{review.unattestedBoks.map(bok => <button key={bok.reelId} type="button" onClick={() => { setSelectedBokId(bok.reelId); setStatus(""); window.scrollTo({ top: 0, behavior: "instant" }); }}><span><strong>{bok.title}</strong><small>{bok.bokStatus} · {bok.note || "No rights source recorded"}</small></span><ArrowUpRight /></button>)}</div>
          {!review.unattestedBoks.length && <p className="studio-meta">{loaded ? "Every bok on the platform has confirmed rights." : "Rights records have not loaded."}</p>}
          {loaded && <RightsPagination label="unattested boks" page={review.unattestedOffset / pageSize} total={review.unattested} disabled={busy || loading} onPage={setUnattestedPage} />}
        </section>
      </>}
      {selectedReport && <>
        <span className={`review-badge review-badge--${selectedReport.status === "open" ? "pending_review" : selectedReport.status === "actioned" ? "rejected" : "published"}`}>{selectedReport.status} {selectedReport.kind === "copyright" ? "copyright" : "reader"} report</span>
        <h2 className="studio-book-title">{selectedReport.title}</h2>
        <div className="studio-link-rows"><button type="button" onClick={() => openBok(selectedReport.reelId)}><span><strong>Open the bok</strong><small>{selectedReport.authorHandle ? `@${selectedReport.authorHandle}` : selectedReport.authorName} · currently {selectedReport.bokStatus}</small></span><ArrowUpRight /></button></div>
        <div className="studio-report-evidence"><p className="studio-eyebrow">Reader’s report</p><p className="studio-report-quote">“{selectedReport.reason}”</p><small>{selectedReport.reporterHandle ? `@${selectedReport.reporterHandle}` : "Guest report"} · {shortTimeAgo(selectedReport.createdAt)}</small></div>
        <div className="studio-hint"><strong>Author attestation · {selectedReport.rightsConfirmed ? "confirmed" : "not confirmed"}</strong><p>{selectedReport.rightsNote || "No note about where the rights come from."}</p></div>
        {selectedReport.status === "open" ? <>
          <label className="studio-field">Reason shown to the author<Textarea rows={4} value={notes[selectedReport.id] ?? ""} onChange={(event) => setNotes(current => ({ ...current, [selectedReport.id]: event.target.value }))} /></label>
          <div className="studio-inline studio-decision-footer"><Button variant="outline" onClick={() => void resolve(selectedReport.id, "dismissed")} disabled={busy}><Check /> Dismiss report</Button><Button onClick={() => void resolve(selectedReport.id, "actioned")} disabled={busy}><X /> Take bok down</Button></div>
        </> : <p className="studio-meta">Resolved {shortTimeAgo(selectedReport.reviewedAt ?? selectedReport.createdAt)}{selectedReport.reviewNote ? `: ${selectedReport.reviewNote}` : ""}</p>}
      </>}
      {selectedBok && <>
        <h2 className="studio-book-title">{selectedBok.title}</h2><p className="studio-meta">{selectedBok.authorHandle ? `@${selectedBok.authorHandle} · ` : ""}{selectedBok.bokStatus}</p>
        <div className="studio-hint"><strong>Rights not confirmed</strong><p>{selectedBok.note || "No rights source has been recorded for this bok."}</p></div>
        <label className="studio-field">Where the rights come from<Input value={rightsNotes[selectedBok.reelId] ?? ""} placeholder="Original work, permission, or public-domain source" onChange={(event) => setRightsNotes(current => ({ ...current, [selectedBok.reelId]: event.target.value }))} /></label>
        <p className="studio-meta">Record the evidence before clearing the rights. This does not change publication status.</p>
        <div className="studio-inline"><Button variant="outline" onClick={() => openBok(selectedBok.reelId)}>Open complete bok</Button><Button onClick={() => void attest(selectedBok.reelId, true)} disabled={busy}><ShieldCheck /> Record as cleared</Button></div>
      </>}
      {status && <p className="text-sm leading-6" role="status" aria-live="polite">{status}</p>}
    </section>
  );
}

function RightsPagination({ label, page, total, disabled, onPage }: {
  label: string; page: number; total: number; disabled: boolean; onPage: (page: number) => void;
}) {
  return (
    <div className="studio-pagination">
      <p>{total ? Math.min(page * pageSize + 1, total) : 0}–{Math.min((page + 1) * pageSize, total)} of {total} {label}</p>
      <div><Button variant="outline" disabled={disabled || page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" disabled={disabled || (page + 1) * pageSize >= total} onClick={() => onPage(page + 1)}>Next</Button></div>
    </div>
  );
}
