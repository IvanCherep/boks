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
import type { AdminBokStatus, BoksRightsReview } from "@/components/boks/client-types";
import {
  loadBoksRightsReview,
  reviewBokReport,
  setBokRights,
} from "@/components/boks/supabase-browser-data";
import { bokStatusLabels } from "@/components/boks/admin/bok-inspector";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

/**
 * Copyright, from an admin's side: the complaints readers filed, and the boks
 * nobody has vouched for.
 *
 * They are one panel rather than two because they are the same question asked
 * from opposite ends - "may this be here?" - and an admin acting on a report
 * needs to see what the author claimed about the rights in the same glance.
 */
const pageSize = 25;

type ReportStatus = "open" | "actioned" | "dismissed";

const words = defineMessages({
  loadFailed: "Could not load the rights review. Your notes are kept.",
  reasonRequired: "Say why the bok is coming down. The author is shown this.",
  takenDown: (status: string) => `Taken down. The bok is now ${status} and its author sees your reason.`,
  dismissed: "Dismissed. The bok stays up and the author is not told.",
  resolveFailed: "Could not resolve that report.",
  sourceRequired: "Write down where the rights come from before marking it cleared.",
  recordedCleared: "Recorded as cleared.",
  leftUnattested: "Left unattested.",
  recordFailed: "Could not record that.",
  back: "Rights & reports",
  eyebrow: "Editorial / rights",
  copyrightReport: "Copyright report",
  readerReport: "Reader report",
  recordSource: "Record a rights source",
  loading: "Loading rights review…",
  lastPageShown: "The last loaded page is still shown.",
  openReports: "Open reports",
  unattestedBoks: "Unattested boks",
  reportStatus: "Report status",
  open: "Open",
  allReports: "All reports",
  refresh: "Refresh",
  readerWrote: "A reader wrote",
  copyright: "Copyright",
  other: "Other",
  reportStatusLabel: { open: "open", actioned: "actioned", dismissed: "dismissed" } as Record<ReportStatus, string>,
  guestReport: "Guest report",
  reviewReport: "Review report",
  reportsNotLoaded: "Reports have not loaded.",
  nothingReported: "Nothing reported.",
  noReports: "No reports at all.",
  rightsNotConfirmedHeading: "Rights not yet confirmed",
  noSource: "No rights source recorded",
  allConfirmed: "Every bok on the platform has confirmed rights.",
  rightsNotLoaded: "Rights records have not loaded.",
  selectedBadge: (status: string, kind: "copyright" | "other") => `${status} ${kind === "copyright" ? "copyright" : "reader"} report`,
  openBok: "Open the bok",
  currently: (status: string) => `currently ${status}`,
  readersReport: "Reader’s report",
  attestation: (confirmed: boolean) => `Author attestation · ${confirmed ? "confirmed" : "not confirmed"}`,
  noRightsNote: "No note about where the rights come from.",
  reasonShown: "Reason shown to the author",
  dismissReport: "Dismiss report",
  takeDown: "Take bok down",
  resolved: "Resolved",
  rightsNotConfirmed: "Rights not confirmed",
  noSourceForBok: "No rights source has been recorded for this bok.",
  whereRightsFrom: "Where the rights come from",
  sourcePlaceholder: "Original work, permission, or public-domain source",
  recordEvidence: "Record the evidence before clearing the rights. This does not change publication status.",
  openComplete: "Open complete bok",
  recordCleared: "Record as cleared",
  pageReports: "reports",
  pageUnattested: "unattested boks",
  pageRange: (from: number, to: number, total: number, label: string) => `${from}–${to} of ${total} ${label}`,
  previous: "Previous",
  next: "Next",
}, { ru: {
  loadFailed: "Не удалось загрузить проверку прав. Ваши заметки сохранены.",
  reasonRequired: "Объясните, почему бок снимается. Автор это увидит.",
  takenDown: (status: string) => `Снят. Статус бока теперь «${status}», автор видит вашу причину.`,
  dismissed: "Отклонено. Бок остаётся, автору ничего не сообщается.",
  resolveFailed: "Не удалось закрыть жалобу.",
  sourceRequired: "Прежде чем подтвердить права, запишите, откуда они.",
  recordedCleared: "Права записаны как подтверждённые.",
  leftUnattested: "Оставлено без подтверждения.",
  recordFailed: "Не удалось записать.",
  back: "Права и жалобы",
  eyebrow: "Редакция / права",
  copyrightReport: "Жалоба на авторские права",
  readerReport: "Жалоба читателя",
  recordSource: "Записать источник прав",
  loading: "Загружаем проверку прав…",
  lastPageShown: "Показана последняя загруженная страница.",
  openReports: "Открытые жалобы",
  unattestedBoks: "Боки без подтверждённых прав",
  reportStatus: "Статус жалоб",
  open: "Открытые",
  allReports: "Все жалобы",
  refresh: "Обновить",
  readerWrote: "Написали читатели",
  copyright: "Авторские права",
  other: "Другое",
  reportStatusLabel: { open: "открыта", actioned: "бок снят", dismissed: "отклонена" },
  guestReport: "Жалоба гостя",
  reviewReport: "Разобрать жалобу",
  reportsNotLoaded: "Жалобы не загрузились.",
  nothingReported: "Жалоб нет.",
  noReports: "Жалоб не было вовсе.",
  rightsNotConfirmedHeading: "Права ещё не подтверждены",
  noSource: "Источник прав не записан",
  allConfirmed: "У всех боков на платформе права подтверждены.",
  rightsNotLoaded: "Сведения о правах не загрузились.",
  selectedBadge: (status: string, kind: "copyright" | "other") => `${kind === "copyright" ? "Жалоба на авторские права" : "Жалоба читателя"}: ${status}`,
  openBok: "Открыть бок",
  currently: (status: string) => `сейчас: ${status}`,
  readersReport: "Жалоба читателя",
  attestation: (confirmed: boolean) => `Заверение автора · ${confirmed ? "подтверждено" : "не подтверждено"}`,
  noRightsNote: "Нет записи о том, откуда права.",
  reasonShown: "Причина, которую увидит автор",
  dismissReport: "Отклонить жалобу",
  takeDown: "Снять бок",
  resolved: "Закрыта",
  rightsNotConfirmed: "Права не подтверждены",
  noSourceForBok: "Для этого бока источник прав не записан.",
  whereRightsFrom: "Откуда права",
  sourcePlaceholder: "Собственное произведение, разрешение или общественное достояние",
  recordEvidence: "Запишите основание, прежде чем подтвердить права. Статус публикации не изменится.",
  openComplete: "Открыть бок целиком",
  recordCleared: "Подтвердить права",
  pageReports: "жалоб",
  pageUnattested: "боков без подтверждения",
  pageRange: (from: number, to: number, total: number, label: string) => `${from}–${to} из ${total} ${label}`,
  previous: "Назад",
  next: "Далее",
} });

/** A bok status as a person reads it; an unknown value is shown as it came. */
function statusName(statuses: Record<AdminBokStatus, string>, status: string) {
  return statuses[status as AdminBokStatus] ?? status;
}

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
  const t = useMessages(words);
  const statuses = useMessages(bokStatusLabels);
  const language = useUiLanguage();

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
      setLoadError(readableBoksError(error, words[currentUiLanguage()].loadFailed));
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
      setStatus(t.reasonRequired);
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const result = await reviewBokReport({ reportId, decision, note });
      setStatus(
        decision === "actioned"
          ? t.takenDown(statusName(statuses, result.bokStatus).toLowerCase())
          : t.dismissed
      );
      setNotes((current) => {
        const next = { ...current };
        delete next[reportId];
        return next;
      });
      await refresh(scope);
    } catch (error) {
      setStatus(readableBoksError(error, t.resolveFailed));
    } finally {
      setBusy(false);
    }
  }

  async function attest(reelId: string, confirmed: boolean) {
    const note = rightsNotes[reelId]?.trim() ?? "";
    if (confirmed && !note) {
      setStatus(t.sourceRequired);
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      await setBokRights({ reelId, confirmed, note });
      setStatus(confirmed ? t.recordedCleared : t.leftUnattested);
      await refresh(scope);
    } catch (error) {
      setStatus(readableBoksError(error, t.recordFailed));
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
        <button type="button" className="studio-text-link" onClick={back}><ArrowLeft size={17} /> {t.back}</button>
        <div className="studio-subview-heading"><p className="studio-eyebrow">{t.eyebrow}</p><h1>{selectedReport ? selectedReport.kind === "copyright" ? t.copyrightReport : t.readerReport : t.recordSource}</h1></div>
      </>}
      {loading && <p role="status">{t.loading}</p>}
      {loadError && <p role="alert">{loadError} {loaded && t.lastPageShown}</p>}
      {!selectedReport && !selectedBok && <>
        {loaded && <div className="studio-metric-pair"><MetricTile label={t.openReports} value={review.openReports} /><MetricTile label={t.unattestedBoks} value={review.unattested} /></div>}
        <div className="studio-filter-line">
          <div className="admin-segmented" aria-label={t.reportStatus}><button type="button" aria-pressed={scope === "open"} onClick={() => changeScope("open")} disabled={busy}>{t.open}</button><button type="button" aria-pressed={scope === "all"} onClick={() => changeScope("all")} disabled={busy}>{t.allReports}</button></div>
          <Button variant="ghost" onClick={() => void refresh(scope)} disabled={busy || loading}><RefreshCw size={16} /> {t.refresh}</Button>
        </div>
        <section className="studio-editorial-section"><h2>{t.readerWrote}</h2>
          {review.reports.length ? review.reports.map(report => <button key={report.id} type="button" className="studio-report-card" onClick={() => { setSelectedReportId(report.id); setStatus(""); window.scrollTo({ top: 0, behavior: "instant" }); }}>
            <span className={`review-badge review-badge--${report.status === "open" ? "pending_review" : report.status === "actioned" ? "rejected" : "published"}`}><Flag size={13} /> {report.kind === "copyright" ? t.copyright : t.other} · {t.reportStatusLabel[report.status]}</span>
            <h2>{report.title}</h2><p>“{report.reason}”</p><small>{report.reporterHandle ? `@${report.reporterHandle}` : t.guestReport} · {shortTimeAgo(report.createdAt, undefined, language)}</small><b>{t.reviewReport} <ArrowUpRight size={18} /></b>
          </button>) : <p className="studio-meta">{!loaded ? t.reportsNotLoaded : scope === "open" ? t.nothingReported : t.noReports}</p>}
          {loaded && <RightsPagination label={t.pageReports} page={review.reportsOffset / pageSize} total={review.reportsTotal} disabled={busy || loading} onPage={setReportsPage} />}
        </section>
        <section className="studio-editorial-section"><h2>{t.rightsNotConfirmedHeading}</h2>
          <div className="studio-link-rows">{review.unattestedBoks.map(bok => <button key={bok.reelId} type="button" onClick={() => { setSelectedBokId(bok.reelId); setStatus(""); window.scrollTo({ top: 0, behavior: "instant" }); }}><span><strong>{bok.title}</strong><small>{statusName(statuses, bok.bokStatus)} · {bok.note || t.noSource}</small></span><ArrowUpRight /></button>)}</div>
          {!review.unattestedBoks.length && <p className="studio-meta">{loaded ? t.allConfirmed : t.rightsNotLoaded}</p>}
          {loaded && <RightsPagination label={t.pageUnattested} page={review.unattestedOffset / pageSize} total={review.unattested} disabled={busy || loading} onPage={setUnattestedPage} />}
        </section>
      </>}
      {selectedReport && <>
        <span className={`review-badge review-badge--${selectedReport.status === "open" ? "pending_review" : selectedReport.status === "actioned" ? "rejected" : "published"}`}>{t.selectedBadge(t.reportStatusLabel[selectedReport.status], selectedReport.kind)}</span>
        <h2 className="studio-book-title">{selectedReport.title}</h2>
        <div className="studio-link-rows"><button type="button" onClick={() => openBok(selectedReport.reelId)}><span><strong>{t.openBok}</strong><small>{selectedReport.authorHandle ? `@${selectedReport.authorHandle}` : selectedReport.authorName} · {t.currently(statusName(statuses, selectedReport.bokStatus).toLowerCase())}</small></span><ArrowUpRight /></button></div>
        <div className="studio-report-evidence"><p className="studio-eyebrow">{t.readersReport}</p><p className="studio-report-quote">“{selectedReport.reason}”</p><small>{selectedReport.reporterHandle ? `@${selectedReport.reporterHandle}` : t.guestReport} · {shortTimeAgo(selectedReport.createdAt, undefined, language)}</small></div>
        <div className="studio-hint"><strong>{t.attestation(Boolean(selectedReport.rightsConfirmed))}</strong><p>{selectedReport.rightsNote || t.noRightsNote}</p></div>
        {selectedReport.status === "open" ? <>
          <label className="studio-field">{t.reasonShown}<Textarea rows={4} value={notes[selectedReport.id] ?? ""} onChange={(event) => setNotes(current => ({ ...current, [selectedReport.id]: event.target.value }))} /></label>
          <div className="studio-inline studio-decision-footer"><Button variant="outline" onClick={() => void resolve(selectedReport.id, "dismissed")} disabled={busy}><Check /> {t.dismissReport}</Button><Button onClick={() => void resolve(selectedReport.id, "actioned")} disabled={busy}><X /> {t.takeDown}</Button></div>
        </> : <p className="studio-meta">{t.resolved} {shortTimeAgo(selectedReport.reviewedAt ?? selectedReport.createdAt, undefined, language)}{selectedReport.reviewNote ? `: ${selectedReport.reviewNote}` : ""}</p>}
      </>}
      {selectedBok && <>
        <h2 className="studio-book-title">{selectedBok.title}</h2><p className="studio-meta">{selectedBok.authorHandle ? `@${selectedBok.authorHandle} · ` : ""}{statusName(statuses, selectedBok.bokStatus)}</p>
        <div className="studio-hint"><strong>{t.rightsNotConfirmed}</strong><p>{selectedBok.note || t.noSourceForBok}</p></div>
        <label className="studio-field">{t.whereRightsFrom}<Input value={rightsNotes[selectedBok.reelId] ?? ""} placeholder={t.sourcePlaceholder} onChange={(event) => setRightsNotes(current => ({ ...current, [selectedBok.reelId]: event.target.value }))} /></label>
        <p className="studio-meta">{t.recordEvidence}</p>
        <div className="studio-inline"><Button variant="outline" onClick={() => openBok(selectedBok.reelId)}>{t.openComplete}</Button><Button onClick={() => void attest(selectedBok.reelId, true)} disabled={busy}><ShieldCheck /> {t.recordCleared}</Button></div>
      </>}
      {status && <p className="text-sm leading-6" role="status" aria-live="polite">{status}</p>}
    </section>
  );
}

function RightsPagination({ label, page, total, disabled, onPage }: {
  label: string; page: number; total: number; disabled: boolean; onPage: (page: number) => void;
}) {
  const t = useMessages(words);
  return (
    <div className="studio-pagination">
      <p>{t.pageRange(total ? Math.min(page * pageSize + 1, total) : 0, Math.min((page + 1) * pageSize, total), total, label)}</p>
      <div><Button variant="outline" disabled={disabled || page === 0} onClick={() => onPage(page - 1)}>{t.previous}</Button>
        <Button variant="outline" disabled={disabled || (page + 1) * pageSize >= total} onClick={() => onPage(page + 1)}>{t.next}</Button></div>
    </div>
  );
}
