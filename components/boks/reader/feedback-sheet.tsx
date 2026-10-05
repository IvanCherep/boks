"use client";

import { Button } from "@/components/ui/button";
import { surfaceForMilestone } from "@/components/boks/feedback";
import { FeedbackForm } from "@/components/boks/feedback-form";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";

function milestoneTitle(milestone: number) {
  if (milestone === 3) return "Three boks in - what do you think?";
  if (milestone === 10) return "Ten boks in - how is it going?";
  return "Thirty boks in - you know this place now";
}

/**
 * Asked mid-story, so it asks for one thing and then gets out of the way. Once
 * the note is sent the sheet has nothing left to ask: the heading thanks, and
 * the button that used to say "Not now" - still offering to decline something
 * already done - says Close.
 */
export function FeedbackSheet({
  milestone,
  sent,
  boksRead,
  visitorId,
  onSent,
  onClose,
}: {
  milestone: number;
  sent: boolean;
  boksRead: number;
  visitorId: string;
  onSent: () => void;
  onClose: () => void;
}) {
  return (
    <ReaderSheet label="Tell us what you think" onClose={onClose}>
      <ReaderSheetHeader
        label="Tell us what you think"
        onClose={onClose}
        title={sent ? "Thank you" : milestoneTitle(milestone)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <FeedbackForm
          surface={surfaceForMilestone(milestone)}
          boksRead={boksRead}
          visitorId={visitorId}
          onSent={onSent}
          autoFocus
        />
        <Button className="mt-4 w-full" variant="ghost" onClick={onClose}>
          {sent ? "Close" : "Not now"}
        </Button>
      </div>
    </ReaderSheet>
  );
}
