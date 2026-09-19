"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Flag, RefreshCw, ShieldCheck, X } from "lucide-react";
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
export function RightsReview() {
  const [review, setReview] = useState<BoksRightsReview>({
    openReports: 0,
    unattested: 0,
    reports: [],
    unattestedBoks: [],
  });
  const [scope, setScope] = useState<"open" | "all">("open");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [rightsNotes, setRightsNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // The reader can only open a published boks; a reported or unattested one is
  // often not. The admin boks view opens any of them.
  const { openBok } = useAdminInspector();

  const refresh = useCallback(async (next: "open" | "all") => {
    try {
      setReview(await loadBoksRightsReview(next));
    } catch (error) {
      setStatus(readableBoksError(error, "Could not load the rights review."));
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(scope).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refresh, scope]);

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

  return (
    <section className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Open reports" value={review.openReports} />
        <MetricTile label="Unattested boks" value={review.unattested} />
      </div>

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
          <div>
            <h2 className="text-xl font-semibold tracking-normal">Reports</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              What a reader told us, in their words. Taking a bok down removes it from the feed and
              shows your reason to its author.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={scope === "open" ? "default" : "outline"}
              onClick={() => setScope("open")}
              disabled={busy}
            >
              Open
            </Button>
            <Button
              variant={scope === "all" ? "default" : "outline"}
              onClick={() => setScope("all")}
              disabled={busy}
            >
              All
            </Button>
            <Button variant="outline" onClick={() => void refresh(scope)} disabled={busy}>
              <RefreshCw className="size-4" /> Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-3 p-4">
          {review.reports.length ? (
            review.reports.map((report) => (
              <article key={report.id} className="submission-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">
                      <button type="button" className="inspector-link inspector-link--title" onClick={() => openBok(report.reelId)}>
                        {report.title}
                      </button>
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {[
                        report.authorName,
                        report.authorHandle ? `@${report.authorHandle}` : null,
                        `bok is ${report.bokStatus}`,
                        report.reporterHandle ? `reported by @${report.reporterHandle}` : "reported by a guest",
                        shortTimeAgo(report.createdAt),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className={`review-badge review-badge--${report.status === "open" ? "pending_review" : report.status === "actioned" ? "rejected" : "published"}`}>
                    <Flag className="size-3.5" />
                    {report.kind === "copyright" ? "Copyright" : "Other"} · {report.status}
                  </span>
                </div>

                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-[var(--muted)] p-3 text-sm leading-6">
                  {report.reason}
                </p>

                <div className="mt-3 rounded-lg border border-[var(--border)] p-3 text-sm leading-6">
                  <p className="flex items-center gap-2 font-medium">
                    {report.rightsConfirmed ? (
                      <>
                        <ShieldCheck className="size-4" /> The author confirmed they hold the rights
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="size-4" /> Nobody has confirmed the rights
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-[var(--muted-foreground)]">
                    {report.rightsNote || "They left no note about where the rights come from."}
                  </p>
                </div>

                {report.status === "open" ? (
                  <>
                    <Textarea
                      className="mt-3 min-h-[72px]"
                      value={notes[report.id] ?? ""}
                      placeholder="Why it is coming down. The author reads this."
                      onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => void resolve(report.id, "actioned")} disabled={busy}>
                        <X className="size-4" /> Take the bok down
                      </Button>
                      <Button variant="ghost" onClick={() => void resolve(report.id, "dismissed")} disabled={busy}>
                        <Check className="size-4" /> Dismiss
                      </Button>
                    </div>
                  </>
                ) : (
                  report.reviewNote && (
                    <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                      Resolved {shortTimeAgo(report.reviewedAt ?? report.createdAt)}: {report.reviewNote}
                    </p>
                  )
                )}
              </article>
            ))
          ) : (
            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
              {scope === "open" ? "Nothing reported. " : "No reports at all. "}
              Readers can report any bok from its menu in the reader.
            </p>
          )}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-[var(--border)] p-4">
          <h2 className="text-xl font-semibold tracking-normal">Rights nobody has confirmed</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
            Boks published before boks asked the question, and boks withdrawn after a report. Record
            where the rights come from, or leave them here — this list is the honest state, not a
            queue you have to empty.
          </p>
        </div>

        <div className="grid gap-3 p-4">
          {review.unattestedBoks.length ? (
            review.unattestedBoks.map((bok) => (
              <article key={bok.reelId} className="submission-card">
                <p className="break-words text-sm font-semibold">
                  <button type="button" className="inspector-link inspector-link--title" onClick={() => openBok(bok.reelId)}>
                    {bok.title}
                  </button>
                </p>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {[bok.authorHandle ? `@${bok.authorHandle}` : null, `bok is ${bok.bokStatus}`, shortTimeAgo(bok.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {bok.note && <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{bok.note}</p>}

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="grid flex-1 gap-1 text-sm font-medium">
                    Where the rights come from
                    <Input
                      value={rightsNotes[bok.reelId] ?? ""}
                      placeholder="Project Gutenberg #1342, public domain"
                      onChange={(event) =>
                        setRightsNotes((current) => ({ ...current, [bok.reelId]: event.target.value }))
                      }
                    />
                  </label>
                  <Button variant="outline" onClick={() => void attest(bok.reelId, true)} disabled={busy}>
                    <ShieldCheck className="size-4" /> Record as cleared
                  </Button>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
              Every bok on the platform has a rights record behind it.
            </p>
          )}
        </div>
      </div>

      {status && (
        <p className="text-sm leading-6" role="status" aria-live="polite">
          {status}
        </p>
      )}
    </section>
  );
}
