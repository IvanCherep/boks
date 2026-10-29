"use client";

import { useState } from "react";
import { ChevronRight, Clapperboard, Flag, Link as LinkIcon, Music, Trash2, UserRound, X } from "lucide-react";
import { ReaderBackIcon, ReaderShareIcon as Share2 } from "./reader-icons";
import { readableBoksError } from "@/lib/boks/errors";
import { Button } from "@/components/ui/button";
import type { Story } from "@/components/boks/client-types";
import { ReaderSheet } from "@/components/boks/reader-sheet";
import { atHandle } from "@/components/boks/reader/handles";

import { bokCoverPalette } from "./bok-cover-palette";
import { bokArtworkFocus, getBokArtwork } from "./bok-artwork";
import { useReaderPreferences } from "../reader-preferences";

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
  onShare, onSettings, onAuthor,
  onOpenFormat, formatLabel, onToggleMusic, musicOn, onHide,
}: {
  story: Story;
  onClose: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onSettings: () => void;
  onAuthor: () => void;
  onOpenFormat?: () => void;
  formatLabel?: string | null;
  onToggleMusic?: () => void;
  musicOn?: boolean;
  onHide?: () => void;
  /** Resolves to what the server made of the report, or null when it was not sent. */
  onReport: (kind: BokReportKind, reason: string) => Promise<BokReportOutcome | null>;
}) {
  const { t } = useReaderPreferences();
  const [reportOpen, setReportOpen] = useState(false);
  const artwork = getBokArtwork(story);
  const palette = bokCoverPalette(story.id);
  const [reportKind, setReportKind] = useState<BokReportKind>("copyright");
  const [reportReason, setReportReason] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportEmail, setReportEmail] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportDone, setReportDone] = useState<BokReportOutcome | null>(null);
  const reasonLength = reportReason.trim().length;

  async function sendReport() {
    setReportSending(true);
    setReportError("");
    try {
      const reason = reportEmail.trim() ? `${reportReason.trim()}\n\nContact email: ${reportEmail.trim()}` : reportReason.trim();
      const outcome = await onReport(reportKind, reason);
      if (outcome) {
        setReportDone(outcome);
        setReportReason("");
      }
    } catch (error) {
      const message = readableBoksError(error, t("Could not send that report. Try again.", "Не удалось отправить сообщение. Попробуйте ещё раз."));
      setReportError(/failed to fetch|networkerror|load failed/i.test(message) ? t("Check your connection, then try again.", "Проверьте соединение и попробуйте ещё раз.") : message);
    } finally {
      setReportSending(false);
    }
  }

  if (reportOpen || reportDone) {
    const heading = reportDone ? t("Report received", "Сообщение получено") : t("Report a concern", "Сообщить о проблеме");
    const back = reportDone ? onClose : () => setReportOpen(false);
    return <ReaderSheet label={heading} onClose={back} className="report-v44 social-page">
      <header className="social-page-header"><button className="social-icon" type="button" onClick={back} aria-label={t("Back", "Назад")}><ReaderBackIcon /></button><span>{heading}</span><span /></header>
      {reportDone ? <div className="report-sent-page">
        <div className="report-endmark" aria-hidden="true">b.</div>
        <h1 className="social-display">{heading}</h1>
        <p>{reportDone === "received" ? t("We’ll review this bok and the details you shared.", "Мы рассмотрим этот бок и ваше сообщение.") : t("Your report is already with an admin. We’ll review this bok and the details you shared.", "Ваше сообщение уже у администратора. Мы рассмотрим этот бок и его подробности.")}</p>
        <Button onClick={onClose}>{t("Back to reading", "Вернуться к чтению")}</Button>
      </div> : <form className="report-form" onSubmit={(event) => { event.preventDefault(); void sendReport(); }}>
        <span className="social-eyebrow" translate="no">{story.title}</span>
        <h1 className="social-display">{t("Report this bok", "Сообщить об этом боке")}</h1>
        <label>{t("What is it about?", "В чём проблема?")}<select value={reportKind} onChange={(event) => setReportKind(event.target.value as BokReportKind)} disabled={reportSending}>
          <option value="copyright">{t("Copyright or permission", "Авторские права или разрешение")}</option>
          <option value="other">{t("Something else", "Другая проблема")}</option>
        </select></label>
        <label>{t("Tell us more", "Расскажите подробнее")}<textarea value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder={t("What should we look into?", "На что нам обратить внимание?")} maxLength={1700} required minLength={10} disabled={reportSending} /></label>
        <label>{t("Your email (optional)", "Ваш email (необязательно)")}<input type="email" autoComplete="email" value={reportEmail} onChange={(event) => setReportEmail(event.target.value)} maxLength={254} disabled={reportSending} /></label>
        <p className="social-note">{t("Only the moderation team can read this report.", "Это сообщение увидят только модераторы.")}</p>
        {reportError && <p className="report-error" role="alert">{reportError}</p>}
        <Button type="submit" disabled={reportSending || reasonLength < 10}>{reportSending ? t("Sending…", "Отправляем…") : reportError ? t("Try again", "Попробовать ещё раз") : t("Send report", "Отправить сообщение")}</Button>
      </form>}
    </ReaderSheet>;
  }

  return (
    <ReaderSheet label={t("This bok", "Этот бок")} onClose={onClose} className="bok-menu-v44">
      <header className="bok-menu-heading">
        {artwork ? <img src={artwork} alt="" style={{ objectPosition: bokArtworkFocus(story.id) }} /> : <span className="bok-menu-heading__type" aria-hidden="true" style={{ backgroundColor: palette.paper, color: palette.ink }}>{story.title.charAt(0)}</span>}
        <span className="bok-menu-heading-copy"><span className="bok-menu-kicker">{t("Reading now", "Сейчас читаете")}</span><strong translate="no">{story.title}</strong><small translate="no">{story.authorName || atHandle(story.authorHandle)}</small></span>
        <button className="bok-menu-close" type="button" onClick={onClose} aria-label={t("Close menu", "Закрыть меню")}><X /></button>
      </header>

      <div className="bok-menu-body">
        <div className="bok-menu-tiles">
          <button type="button" onClick={onShare}><Share2 size={29} /><span>{t("Share", "Поделиться")}<ChevronRight /></span></button>
          <button type="button" onClick={onSettings}><i>Aa</i><span>{t("Text settings", "Настройки текста")}<ChevronRight /></span></button>
        </div>
        <div className="bok-menu-links">
        {story.authorHandle && <button className="bok-menu-link" type="button" onClick={onAuthor}><UserRound /><span>{story.authorName || atHandle(story.authorHandle)}</span><ChevronRight /></button>}
        <button className="bok-menu-link" type="button" onClick={onCopyLink}><LinkIcon /><span>{t("Copy link to this bok", "Ссылка на этот бок")}</span><ChevronRight /></button>
        {onOpenFormat && formatLabel && <button className="bok-menu-link" type="button" onClick={onOpenFormat}><Clapperboard /><span>{formatLabel}</span><ChevronRight /></button>}
        {onToggleMusic && <button className="bok-menu-link" type="button" onClick={onToggleMusic} aria-pressed={musicOn}><Music /><span>{musicOn ? t("Turn music off", "Выключить музыку") : t("Read with music", "Читать под музыку")}</span><ChevronRight /></button>}
        {onHide && <button className="bok-menu-link bok-menu-link--quiet" type="button" onClick={onHide}><Trash2 /><span>{t("Hide this bok (admin)", "Скрыть бок (администратор)")}</span><ChevronRight /></button>}

        <button className="bok-menu-link bok-menu-link--quiet" type="button" onClick={() => setReportOpen(true)}><Flag /><span>{t("Report a concern", "Сообщить о проблеме")}</span><ChevronRight /></button>
        </div>
      </div>
    </ReaderSheet>
  );
}
