"use client";

import { useState } from "react";
import { Flag, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Story } from "@/components/boks/client-types";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { atHandle } from "@/components/boks/reader/handles";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages(
  {
    thisBok: "This bok",
    copyLink: "Copy link to this bok",
    sent: "Report sent",
    already: "You have already reported this bok",
    sentBody: "A boks admin reads every report. If the piece has to come down, its author is told why.",
    alreadyBody: "It is already with an admin. There is nothing more to do.",
    back: "Back to reading",
    report: "Report a problem",
    reportBody: "Only boks admins see this. Tell us what is wrong and, if it is your work, how we can tell.",
    copyright: "Copyright",
    other: "Something else",
    copyrightPlaceholder: "This is my translation, first published in 1998. I never gave permission.",
    otherPlaceholder: "What is wrong with this bok?",
    sending: "Sending…",
    send: "Send report",
    tooShort: "A sentence or two, so an admin can act on it.",
  },
  {
    ru: {
      thisBok: "Этот текст",
      copyLink: "Скопировать ссылку на текст",
      sent: "Жалоба отправлена",
      already: "Вы уже пожаловались на этот текст",
      sentBody:
        "Администратор boks читает каждую жалобу. Если текст придётся снять, автору объяснят почему.",
      alreadyBody: "Жалоба уже у администратора. Больше ничего делать не нужно.",
      back: "Вернуться к чтению",
      report: "Сообщить о проблеме",
      reportBody:
        "Это увидят только администраторы boks. Расскажите, что не так, и, если это ваша работа, как мы можем это проверить.",
      copyright: "Авторские права",
      other: "Другое",
      copyrightPlaceholder: "Это мой перевод, впервые опубликован в 1998 году. Я не давал разрешения.",
      otherPlaceholder: "Что не так с этим текстом?",
      sending: "Отправляем…",
      send: "Отправить жалобу",
      tooShort: "Пару предложений, чтобы администратор мог разобраться.",
    },
  }
);

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
  const t = useMessages(messages);

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
    <ReaderSheet label={t.thisBok} onClose={onClose}>
      <ReaderSheetHeader label={t.thisBok} onClose={onClose} title={t.thisBok} />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <p className="truncate text-sm font-medium">{story.title}</p>
        <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
          {story.authorName ? `${story.authorName} · ${atHandle(story.authorHandle)}` : atHandle(story.authorHandle)}
        </p>

        <Button className="mt-4 w-full justify-start" variant="outline" onClick={onCopyLink}>
          <LinkIcon className="size-4" /> {t.copyLink}
        </Button>

        {reportDone ? (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
            <p className="text-sm font-semibold">
              {reportDone === "received" ? t.sent : t.already}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              {reportDone === "received" ? t.sentBody : t.alreadyBody}
            </p>
            <Button className="mt-3 w-full" variant="ghost" onClick={onClose}>
              {t.back}
            </Button>
          </div>
        ) : (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">{t.report}</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              {t.reportBody}
            </p>

            <div className="mt-3 flex gap-2">
              {(
                [
                  ["copyright", t.copyright],
                  ["other", t.other],
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
                  ? t.copyrightPlaceholder
                  : t.otherPlaceholder
              }
              onChange={(event) => setReportReason(event.target.value)}
            />

            <Button className="mt-3 w-full" onClick={sendReport} disabled={reportSending || reasonLength < 10}>
              <Flag className="size-4" /> {reportSending ? t.sending : t.send}
            </Button>
            {reasonLength > 0 && reasonLength < 10 && (
              <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                {t.tooShort}
              </p>
            )}
          </div>
        )}
      </div>
    </ReaderSheet>
  );
}
