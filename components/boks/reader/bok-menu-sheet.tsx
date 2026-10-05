"use client";

import { useState } from "react";
import { Flag, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Story } from "@/components/boks/client-types";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { atHandle } from "@/components/boks/reader/handles";

export type BokReportKind = "copyright" | "other";
export type BokReportOutcome = "received" | "already";

/**
 * The bok's own menu: copy its link, or report it to an admin.
 *
 * Mounted only while open, so every opening starts with an empty report -
 * the form state lives here and goes when the sheet does.
 */
export function BokMenuSheet({
  story,
  onClose,
  onCopyLink,
  onReport,
}: {
  story: Story;
  onClose: () => void;
  onCopyLink: () => void;
  /** Resolves to what the server made of the report, or null when it was not sent. */
  onReport: (kind: BokReportKind, reason: string) => Promise<BokReportOutcome | null>;
}) {
  const [reportKind, setReportKind] = useState<BokReportKind>("copyright");
  const [reportReason, setReportReason] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState<BokReportOutcome | null>(null);
  const reasonLength = reportReason.trim().length;

  async function sendReport() {
    setReportSending(true);
    try {
      const outcome = await onReport(reportKind, reportReason);
      if (outcome) {
        setReportDone(outcome);
        setReportReason("");
      }
    } finally {
      setReportSending(false);
    }
  }

  return (
    <ReaderSheet label="This bok" onClose={onClose}>
      <ReaderSheetHeader label="This bok" onClose={onClose} title="This bok" />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <p className="truncate text-sm font-medium">{story.title}</p>
        <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
          {story.authorName ? `${story.authorName} · ${atHandle(story.authorHandle)}` : atHandle(story.authorHandle)}
        </p>

        <Button className="mt-4 w-full justify-start" variant="outline" onClick={onCopyLink}>
          <LinkIcon className="size-4" /> Copy link to this bok
        </Button>

        {reportDone ? (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
            <p className="text-sm font-semibold">
              {reportDone === "received" ? "Report sent" : "You have already reported this bok"}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              {reportDone === "received"
                ? "A boks admin reads every report. If the piece has to come down, its author is told why."
                : "It is already with an admin. There is nothing more to do."}
            </p>
            <Button className="mt-3 w-full" variant="ghost" onClick={onClose}>
              Back to reading
            </Button>
          </div>
        ) : (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Report a problem</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Only boks admins see this. Tell us what is wrong and, if it is your work, how we
              can tell.
            </p>

            <div className="mt-3 flex gap-2">
              {(
                [
                  ["copyright", "Copyright"],
                  ["other", "Something else"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`report-kind${reportKind === value ? " report-kind--on" : ""}`}
                  aria-pressed={reportKind === value}
                  onClick={() => setReportKind(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <Textarea
              className="mt-3 min-h-[96px]"
              value={reportReason}
              placeholder={
                reportKind === "copyright"
                  ? "This is my translation, first published in 1998. I never gave permission."
                  : "What is wrong with this bok?"
              }
              onChange={(event) => setReportReason(event.target.value)}
            />

            <Button className="mt-3 w-full" onClick={sendReport} disabled={reportSending || reasonLength < 10}>
              <Flag className="size-4" /> {reportSending ? "Sending…" : "Send report"}
            </Button>
            {reasonLength > 0 && reasonLength < 10 && (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                A sentence or two, so an admin can act on it.
              </p>
            )}
          </div>
        )}
      </div>
    </ReaderSheet>
  );
}
