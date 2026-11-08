"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  loadBackgroundJobRuns,
  loadEmbeddingCoverage,
  type BackgroundJobReport,
} from "@/components/boks/supabase-browser-data";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

/**
 * Background jobs, as an admin needs to see them: is it running, what did it
 * do, and if it broke, why.
 *
 * One job so far, the embedder (`deploy/embedder`): every 15 minutes it gives
 * newly published boks their vector. Every run writes a row, also the ones
 * with nothing to do, so "last checked 4 min ago" is a fact, not a hope.
 */

/** Cron runs every 15 minutes; three missed runs is a stopped schedule. */
const intervalMinutes = 15;
const staleMinutes = 45;

const words = defineMessages({
  title: "Background jobs",
  embedder: "Embeddings for new boks",
  embedderHint: "Every 15 minutes the server gives each newly published bok its vector (multilingual-e5-small), so recommendations can match it by meaning.",
  ok: (ago: string, next: string) => `Working. Last check ${ago}; next ${next}.`,
  failed: (ago: string) => `The last run failed ${ago}.`,
  stale: (ago: string) => `No run for ${ago}: the schedule has stopped.`,
  never: "No runs yet.",
  running: "Running now.",
  coverage: (embedded: number, total: number, missing: number) => `${embedded} of ${total} published boks have a vector · ${missing} waiting`,
  week: (count: number) => `${count} embedded in the last 7 days`,
  failures: (count: number) => `${count} failed in the last 24 hours`,
  when: "When",
  result: "Result",
  done: "Embedded",
  left: "Waiting",
  took: "Took",
  resultOk: "ok",
  resultFailed: "failed",
  resultRunning: "running",
  nothing: "nothing new",
  refresh: "Refresh",
  loadFailed: "Could not load the job log.",
  ago: (minutes: number) => (minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`),
  inMinutes: (minutes: number) => (minutes < 1 ? "any moment" : `in about ${minutes} min`),
  forMinutes: (minutes: number) => (minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`),
}, { ru: {
  title: "Фоновые задачи",
  embedder: "Эмбеддинги для новых боков",
  embedderHint: "Каждые 15 минут сервер считает вектор (multilingual-e5-small) для каждого нового опубликованного бока, чтобы рекомендации подбирали его по смыслу.",
  ok: (ago: string, next: string) => `Работает. Последняя проверка ${ago}, следующая ${next}.`,
  failed: (ago: string) => `Последний запуск ${ago} закончился ошибкой.`,
  stale: (ago: string) => `Запусков нет уже ${ago}: расписание остановилось.`,
  never: "Запусков ещё не было.",
  running: "Идёт прямо сейчас.",
  coverage: (embedded: number, total: number, missing: number) => `${embedded} из ${total} опубликованных боков с вектором · ${missing} в очереди`,
  week: (count: number) => `За 7 дней посчитано: ${count}`,
  failures: (count: number) => `${count} ${plural("ru", count, { one: "ошибка", few: "ошибки", many: "ошибок", other: "ошибки" })} за сутки`,
  when: "Когда",
  result: "Итог",
  done: "Посчитано",
  left: "В очереди",
  took: "Заняло",
  resultOk: "успешно",
  resultFailed: "ошибка",
  resultRunning: "идёт",
  nothing: "новых нет",
  refresh: "Обновить",
  loadFailed: "Не удалось загрузить журнал задач.",
  ago: (minutes: number) => (minutes < 1 ? "только что" : minutes < 60 ? `${minutes} мин назад` : `${Math.round(minutes / 60)} ч назад`),
  inMinutes: (minutes: number) => (minutes < 1 ? "вот-вот" : `примерно через ${minutes} мин`),
  forMinutes: (minutes: number) => (minutes < 120 ? `${minutes} мин` : `${Math.round(minutes / 60)} ч`),
} });

type Coverage = Awaited<ReturnType<typeof loadEmbeddingCoverage>>;

const minutesSince = (at: string, now: number) => Math.max(0, Math.round((now - Date.parse(at)) / 60_000));

export function BackgroundJobs({ refreshKey }: { refreshKey?: unknown }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [report, setReport] = useState<BackgroundJobReport | null>(null);
  const [coverage, setCoverage] = useState<Coverage>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [runs, cover] = await Promise.all([loadBackgroundJobRuns("embedder", 12), loadEmbeddingCoverage().catch(() => null)]);
      setReport(runs);
      setCoverage(cover);
      setError("");
    } catch {
      setError("load");
    } finally {
      setNow(Date.now());
      setBusy(false);
    }
  }, []);

  // Deferred a tick: the load sets state, which an effect body must not do directly.
  useEffect(() => {
    const handle = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(handle);
  }, [refresh, refreshKey]);

  const runs = report?.runs ?? [];
  const last = runs[0];
  const lastAgo = last ? minutesSince(last.started_at, now) : null;
  let state: { tone: "ok" | "bad" | "idle"; text: string };
  if (!last) state = { tone: "idle", text: t.never };
  else if (last.status === "running" && lastAgo! < staleMinutes) state = { tone: "ok", text: t.running };
  else if (lastAgo! >= staleMinutes) state = { tone: "bad", text: t.stale(t.forMinutes(lastAgo!)) };
  else if (last.status === "failed") state = { tone: "bad", text: t.failed(t.ago(lastAgo!)) };
  else state = { tone: "ok", text: t.ok(t.ago(lastAgo!), t.inMinutes(Math.max(0, intervalMinutes - lastAgo!))) };

  const time = (at: string) =>
    new Date(at).toLocaleString(language === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <section className="studio-jobs" aria-label={t.title}>
      <header className="studio-jobs__head">
        <p className="studio-eyebrow">{t.title}</p>
        <Button variant="ghost" onClick={() => void refresh()} disabled={busy}><RefreshCw className="size-4" /> {t.refresh}</Button>
      </header>
      <h3 className="studio-jobs__title">{t.embedder}</h3>
      <p className={`studio-jobs__state studio-jobs__state--${state.tone}`} role="status">{state.text}</p>
      {last?.status === "failed" && last.error && <pre className="studio-jobs__error">{last.error}</pre>}
      {error && <p className="studio-meta">{t.loadFailed}</p>}
      <p className="studio-meta">
        {coverage && t.coverage(coverage.publishedEmbedded, coverage.publishedTotal, coverage.publishedMissing)}
        {report && <>{coverage && " · "}{t.week(report.processedLastWeek)}</>}
        {report && report.failedLastDay > 0 && <> · <span className="studio-jobs__bad">{t.failures(report.failedLastDay)}</span></>}
      </p>
      <p className="studio-meta">{t.embedderHint}</p>
      {runs.length > 0 && (
        <div className="studio-jobs__table" role="table">
          <div className="studio-jobs__row studio-jobs__row--head" role="row">
            <span role="columnheader">{t.when}</span><span role="columnheader">{t.result}</span>
            <span role="columnheader">{t.done}</span><span role="columnheader">{t.left}</span><span role="columnheader">{t.took}</span>
          </div>
          {runs.map((run) => (
            <div className="studio-jobs__row" role="row" key={run.id} title={run.details?.titles?.join(", ") || run.error || undefined}>
              <span role="cell">{time(run.started_at)}</span>
              <span role="cell" className={run.status === "failed" ? "studio-jobs__bad" : undefined}>
                {run.status === "ok" ? t.resultOk : run.status === "failed" ? t.resultFailed : t.resultRunning}
              </span>
              <span role="cell">{run.status === "ok" && run.processed === 0 ? t.nothing : run.processed}</span>
              <span role="cell">{run.remaining ?? "–"}</span>
              <span role="cell">{run.duration_ms == null ? "–" : `${(run.duration_ms / 1000).toFixed(1)} ${language === "ru" ? "с" : "s"}`}</span>
              {run.processed > 0 && run.details?.titles?.length ? (
                <span role="cell" className="studio-jobs__titles">{run.details.titles.join(" · ")}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
