"use client";

import { Button } from "@/components/ui/button";
import { surfaceForMilestone } from "@/components/boks/feedback";
import { FeedbackForm } from "@/components/boks/feedback-form";
import { ReaderSheet } from "@/components/boks/reader-sheet";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { ReaderBackIcon } from "./reader-icons";
import { plural } from "@/lib/i18n/messages";

/** The real reading milestone uses the same letter and sent views as Settings. */
export function FeedbackSheet({ milestone, sent, boksRead, visitorId, onSent, onClose }: {
  milestone: number;
  sent: boolean;
  boksRead: number;
  visitorId: string;
  onSent: () => void;
  onClose: () => void;
}) {
  const { t } = useReaderPreferences();
  return <ReaderSheet label={t("Feedback", "Обратная связь")} onClose={onClose} className="feedback-v44 social-page">
    <header className="social-page-header"><button className="social-icon" type="button" onClick={onClose} aria-label={t("Back", "Назад")}><ReaderBackIcon /></button><span>{t("Feedback", "Обратная связь")}</span><span /></header>
    {sent ? <>
      <div className="you-sent-art" aria-hidden="true"><span>✓</span><i>↗</i></div>
      <h1 className="social-display">{t("Feedback sent.", "Отзыв отправлен.")}</h1>
      <p className="social-muted">{t("Thank you. Your feedback has been received.", "Спасибо. Ваш отзыв получен.")}</p>
      <Button className="you-wide-button" onClick={onClose}>{t("Back to reading", "Вернуться к чтению")}</Button>
    </> : <>
      <div className="you-postmark" aria-hidden="true">boks<span>FEEDBACK</span></div>
      <h1 className="social-display">{t("Send feedback.", "Обратная связь.")}</h1>
      <p className="social-muted">{t(`You’ve read ${milestone} boks. Tell us about a problem or suggest an improvement.`, `Вы прочитали ${milestone} ${plural("ru", milestone, { one: "бок", few: "бока", many: "боков", other: "бока" })}. Расскажите о проблеме или предложите улучшение.`)}</p>
      <FeedbackForm presentation="letter" surface={surfaceForMilestone(milestone)} boksRead={boksRead} visitorId={visitorId} onSent={onSent} />
      <Button className="you-wide-button" variant="ghost" onClick={onClose}>{t("Not now", "Не сейчас")}</Button>
    </>}
  </ReaderSheet>;
}
