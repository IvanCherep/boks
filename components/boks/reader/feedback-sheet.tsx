"use client";

import { Button } from "@/components/ui/button";
import { surfaceForMilestone } from "@/components/boks/feedback";
import { FeedbackForm } from "@/components/boks/feedback-form";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages(
  {
    label: "Tell us what you think",
    three: "Three boks in - what do you think?",
    ten: "Ten boks in - how is it going?",
    thirty: "Thirty boks in - you know this place now",
    thanks: "Thank you",
    close: "Close",
    notNow: "Not now",
  },
  {
    ru: {
      label: "Расскажите, что думаете",
      three: "Три текста позади - как вам?",
      ten: "Десять текстов позади - как идёт?",
      thirty: "Тридцать текстов позади - вы здесь уже свой",
      thanks: "Спасибо",
      close: "Закрыть",
      notNow: "Не сейчас",
    },
  }
);

function milestoneTitle(milestone: number, t: (typeof messages)["en"]) {
  if (milestone === 3) return t.three;
  if (milestone === 10) return t.ten;
  return t.thirty;
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
  const t = useMessages(messages);
  return (
    <ReaderSheet label={t.label} onClose={onClose}>
      <ReaderSheetHeader
        label={t.label}
        onClose={onClose}
        title={sent ? t.thanks : milestoneTitle(milestone, t)}
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
          {sent ? t.close : t.notNow}
        </Button>
      </div>
    </ReaderSheet>
  );
}
