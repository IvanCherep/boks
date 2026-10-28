"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Download, FolderOpen, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { originalImportIndices, pendingImportRows } from "@/components/boks/admin/import-progress";
import { MetricTile } from "@/components/boks/shared-ui";
import { readableBoksError } from "@/lib/boks/errors";
import {
  parseCatalogueFiles,
  type CatalogueProblem,
  type CatalogueRow,
} from "@/lib/boks/import/parse-catalogue";
import type { BoksImportRowResult, BoksPublisher, LanguageDemandRow } from "@/components/boks/client-types";
import {
  deleteBoksImport,
  deleteSeedBoks,
  importBoksBatch,
  loadBoksLanguageDemand,
  loadBoksPublishers,
  setBoksPublisher,
} from "@/components/boks/supabase-browser-data";
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import type { UiLanguage } from "@/lib/i18n/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

/**
 * The database caps a call at 100 rows. Batching under that keeps each request
 * short enough to survive a proxy and gives the operator moving progress
 * instead of one long wait with nothing on screen.
 */
const batchSize = 25;

type CatalogueView = "catalogue" | "preview" | "errors" | "importing" | "done" | "cleanup";

const boksRu = (n: number) => `${n} ${plural("ru", n, { one: "бок", few: "бока", many: "боков", other: "бока" })}`;

const words = defineMessages({
  publishersLoadFailed: "Could not load the publisher accounts.",
  nothingToRead: "Nothing to read. Drop .md, .txt or .jsonl files.",
  readSummary: (files: number, ready: number, problems: number) =>
    `Read ${files} file${files === 1 ? "" : "s"}: ${ready} ready` + (problems ? `, ${problems} to fix` : ""),
  choosePublisher: "Choose the account these boks publish under.",
  confirmRights: "Confirm the rights for this batch before importing it.",
  importSummary: (imported: number, publisher: string, skipped: number, rejected: number, published: boolean) =>
    `${imported} imported into @${publisher}` + (skipped ? `, ${skipped} already there` : "") +
    (rejected ? `, ${rejected} refused` : "") + (published ? "." : ". They are waiting in the review queue."),
  importStopped: "The import stopped. Completed batches are kept. Retry unresolved boks; stable IDs prevent duplicates if the last batch was saved.",
  publisherAdded: (handle: string) => `@${handle} can now receive imports.`,
  publisherFailed: "Could not mark that account as a publisher.",
  purgeNeedsPrefix: "Name the account and the import-key prefix to remove.",
  purgeDone: (deleted: number, publisher: string) => `Removed ${deleted} boks from @${publisher}, and everything readers did with them.`,
  purgePreview: (matched: number, publisher: string, prefix: string) =>
    `${matched} boks in @${publisher} start with "${prefix}". Removing them also removes their reads, likes and comments.`,
  purgeFailed: "Could not remove that batch.",
  seedsDone: (deleted: number, authored: number) =>
    `Removed ${deleted} demo boks, and everything readers did with them. ${authored} authored boks were left alone.`,
  seedsPreview: (seeds: number, authored: number) =>
    `${seeds} demo boks on the platform, and ${authored} from authors. Removing the demo set also removes its reads, likes and comments.`,
  seedsFailed: "Could not clear the demo catalogue.",
  headings: {
    catalogue: "Catalogue", preview: "Import preview", errors: "Files to fix", importing: "Importing boks",
    done: "Import complete", cleanup: "Remove test content",
  } as Record<CatalogueView, string>,
  needsAttention: "Import needs attention",
  eyebrow: "Editorial / catalogue",
  eyebrowComplete: " / complete",
  whatNext: "What to acquire next",
  language: "Language",
  boks: "Boks",
  readers: "Readers",
  languageName: (code: string) => code === "en" ? "English" : code === "ru" ? "Russian" : code === "und" ? "Undetermined" : code,
  supplyNote: "Published supply · readers who accept each language",
  publisherAccount: "Publisher account",
  chooseAccount: "Choose an account",
  publishedCount: (n: number) => `${n} published`,
  noPublishers: "No publisher accounts yet. Create an account through normal sign-in, then add its handle here.",
  addPublisher: "Add a publisher account",
  existingHandle: "Existing account handle",
  markPublisher: "Mark as publisher",
  importBoks: "Import boks",
  chooseFiles: "Choose files",
  chooseFolder: "Choose a folder",
  refresh: "Refresh",
  returnTo: (receipt: boolean) => `Return to ${receipt ? "import receipt" : "import preview"}`,
  fileFormat: "File format & stable IDs",
  fileFormatHint: "One bok per Markdown or text file with front matter, or a JSONL export. Stable IDs make repeat imports safe.",
  reviewCleanup: "Review a test-batch cleanup",
  readyToImport: "ready to import",
  bylines: "bylines",
  noByline: "No byline",
  minutes: (n: number) => `${n} min`,
  showing: (shown: number, total: number) => `Showing ${shown} of ${total} · stable file IDs prevent duplicates.`,
  closePreview: "Close text preview",
  mayPublish: "These boks may be published here.",
  attestationRecorded: "This attestation is recorded for each bok.",
  rightsSource: "Rights source",
  rightsSourcePlaceholder: "Source or permission for this batch",
  fileRightsFirst: "A file’s own rights source takes precedence.",
  publishNow: "Publish immediately. Otherwise send to review.",
  filesToFix: (n: number) => `${n} files to fix`,
  importInto: (n: number, publisher: string) => `Import ${n} into @${publisher}`,
  needAttention: "need attention",
  readyKept: "Ready boks are kept. Fix these files and choose the corrected batch again.",
  chooseCorrected: "Choose corrected files",
  reviewReady: (n: number) => `Review ${n} ready boks`,
  processed: "boks processed",
  keepOpen: "Keep this page open. Stable IDs prevent duplicate boks when you retry a batch.",
  importedPublished: "imported & published",
  importedForReview: "imported for review",
  alreadyExisted: "already existed",
  savedUnder: (publisher: string) => `Saved under @${publisher}. Each bok keeps its own byline and rights source.`,
  unresolved: (n: number) => `${n} boks need attention. Completed batches are kept.`,
  retryUnresolved: "Retry unresolved boks",
  downloadReceipt: "Download import receipt",
  openPublished: "Open published content",
  openReview: "Open review queue",
  importPrefix: "Import ID prefix",
  previewCount: "Preview matching count",
  previewOnly: "Preview only · nothing removed",
  matching: (n: number) => `${n} matching boks`,
  matchingNote: (publisher: string, prefix: string) => `All belong to @${publisher} and begin with ${prefix}. This preview reports the server count.`,
  purgeWarning: "Deleting this batch also removes its reactions, comments and reading metrics. This cannot be undone.",
  purgeAck: (n: number) => `I reviewed the publisher, prefix and ${n} matching boks.`,
  removeThese: (n: number) => `Remove these ${n}`,
  seeded: "Seeded demo catalogue",
  seededHint: "Only boks marked as seeds can be removed here. Author submissions are kept.",
  countDemo: "Count demo boks",
  seedCounts: (seeds: number, authored: number) => `${seeds} seed boks · ${authored} authored boks kept`,
  seedAck: "I understand the seed boks and their history will be permanently erased.",
  removeSeeds: (n: number) => `Remove ${n} seed boks`,
}, { ru: {
  publishersLoadFailed: "Не удалось загрузить аккаунты издателей.",
  nothingToRead: "Нечего читать. Выберите файлы .md, .txt или .jsonl.",
  readSummary: (files: number, ready: number, problems: number) =>
    `Прочитано ${files} ${plural("ru", files, { one: "файл", few: "файла", many: "файлов", other: "файла" })}: готово ${ready}` + (problems ? `, исправить ${problems}` : ""),
  choosePublisher: "Выберите аккаунт, от имени которого публикуются эти боки.",
  confirmRights: "Подтвердите права на эту партию, прежде чем импортировать её.",
  importSummary: (imported: number, publisher: string, skipped: number, rejected: number, published: boolean) =>
    `В @${publisher} импортировано: ${imported}` + (skipped ? `, уже были: ${skipped}` : "") +
    (rejected ? `, отклонено: ${rejected}` : "") + (published ? "." : ". Они ждут в очереди проверки."),
  importStopped: "Импорт остановился. Завершённые партии сохранены. Повторите для оставшихся боков: стабильные ID не дадут дублей, если последняя партия успела сохраниться.",
  publisherAdded: (handle: string) => `@${handle} теперь может принимать импорт.`,
  publisherFailed: "Не удалось сделать этот аккаунт издателем.",
  purgeNeedsPrefix: "Укажите аккаунт и префикс ключа импорта для удаления.",
  purgeDone: (deleted: number, publisher: string) => `Удалено ${boksRu(deleted)} из @${publisher} вместе со всем, что с ними делали читатели.`,
  purgePreview: (matched: number, publisher: string, prefix: string) =>
    `В @${publisher} ${boksRu(matched)} с префиксом «${prefix}». Удаление сотрёт и их чтения, лайки и комментарии.`,
  purgeFailed: "Не удалось удалить эту партию.",
  seedsDone: (deleted: number, authored: number) =>
    `Удалено демо-боков: ${deleted}, вместе со всем, что с ними делали читатели. Авторские боки (${authored}) не тронуты.`,
  seedsPreview: (seeds: number, authored: number) =>
    `На платформе демо-боков: ${seeds}, авторских: ${authored}. Удаление демо-набора сотрёт и его чтения, лайки и комментарии.`,
  seedsFailed: "Не удалось очистить демо-каталог.",
  headings: {
    catalogue: "Каталог", preview: "Предпросмотр импорта", errors: "Файлы с ошибками", importing: "Импорт боков",
    done: "Импорт завершён", cleanup: "Удаление тестового контента",
  },
  needsAttention: "Импорт требует внимания",
  eyebrow: "Редакция / каталог",
  eyebrowComplete: " / готово",
  whatNext: "Что добавить дальше",
  language: "Язык",
  boks: "Боки",
  readers: "Читатели",
  languageName: (code: string) => code === "en" ? "Английский" : code === "ru" ? "Русский" : code === "und" ? "Не определён" : code,
  supplyNote: "Опубликовано · читатели, принимающие каждый язык",
  publisherAccount: "Аккаунт издателя",
  chooseAccount: "Выберите аккаунт",
  publishedCount: (n: number) => `опубликовано: ${n}`,
  noPublishers: "Аккаунтов издателей пока нет. Создайте аккаунт через обычный вход, затем добавьте его @имя здесь.",
  addPublisher: "Добавить аккаунт издателя",
  existingHandle: "@имя существующего аккаунта",
  markPublisher: "Сделать издателем",
  importBoks: "Импорт боков",
  chooseFiles: "Выберите файлы",
  chooseFolder: "Выбрать папку",
  refresh: "Обновить",
  returnTo: (receipt: boolean) => receipt ? "Вернуться к отчёту об импорте" : "Вернуться к предпросмотру",
  fileFormat: "Формат файлов и стабильные ID",
  fileFormatHint: "Один бок на Markdown- или текстовый файл с front matter, либо экспорт JSONL. Стабильные ID делают повторный импорт безопасным.",
  reviewCleanup: "Удаление тестовой партии",
  readyToImport: "готово к импорту",
  bylines: "подписи",
  noByline: "Без подписи",
  minutes: (n: number) => `${n} мин`,
  showing: (shown: number, total: number) => `Показано ${shown} из ${total} · стабильные ID файлов не дают дублей.`,
  closePreview: "Закрыть текст",
  mayPublish: "Эти боки можно публиковать здесь.",
  attestationRecorded: "Это подтверждение записывается для каждого бока.",
  rightsSource: "Источник прав",
  rightsSourcePlaceholder: "Источник или разрешение для этой партии",
  fileRightsFirst: "Источник прав, указанный в самом файле, важнее.",
  publishNow: "Опубликовать сразу. Иначе отправить на проверку.",
  filesToFix: (n: number) => `Исправить ${plural("ru", n, { one: "файл", few: "файла", many: "файлов", other: "файла" })}: ${n}`,
  importInto: (n: number, publisher: string) => `Импортировать ${n} в @${publisher}`,
  needAttention: "требуют внимания",
  readyKept: "Готовые боки сохранены. Исправьте эти файлы и выберите исправленную партию снова.",
  chooseCorrected: "Выбрать исправленные файлы",
  reviewReady: (n: number) => `Проверить готовые: ${n}`,
  processed: "боков обработано",
  keepOpen: "Не закрывайте страницу. Стабильные ID не дадут дублей при повторе партии.",
  importedPublished: "импортировано и опубликовано",
  importedForReview: "импортировано на проверку",
  alreadyExisted: "уже были",
  savedUnder: (publisher: string) => `Сохранено в @${publisher}. У каждого бока своя подпись и свой источник прав.`,
  unresolved: (n: number) => `Требуют внимания: ${boksRu(n)}. Завершённые партии сохранены.`,
  retryUnresolved: "Повторить для оставшихся боков",
  downloadReceipt: "Скачать отчёт об импорте",
  openPublished: "Открыть опубликованный контент",
  openReview: "Открыть очередь проверки",
  importPrefix: "Префикс ID импорта",
  previewCount: "Посчитать совпадения",
  previewOnly: "Только предпросмотр · ничего не удалено",
  matching: (n: number) => `Совпадений: ${boksRu(n)}`,
  matchingNote: (publisher: string, prefix: string) => `Все принадлежат @${publisher} и начинаются с ${prefix}. Число посчитано на сервере.`,
  purgeWarning: "Удаление партии сотрёт и её реакции, комментарии и метрики чтения. Это нельзя отменить.",
  purgeAck: (n: number) => `Я проверил издателя, префикс и ${boksRu(n)} в совпадениях.`,
  removeThese: (n: number) => `Удалить ${boksRu(n)}`,
  seeded: "Демо-каталог",
  seededHint: "Здесь можно удалить только боки, помеченные как демо. Авторские присылки сохраняются.",
  countDemo: "Посчитать демо-боки",
  seedCounts: (seeds: number, authored: number) => `Демо-боков: ${seeds} · авторских сохранится: ${authored}`,
  seedAck: "Я понимаю, что демо-боки и их история будут стёрты навсегда.",
  removeSeeds: (n: number) => `Удалить демо-боки: ${n}`,
} });

/**
 * The import RPC's fixed rejection reasons, in Russian. They come from the
 * database in English; anything else (a raw database error) is shown as sent.
 */
const russianImportReasons: Record<string, string> = {
  "An import key is required, so the load can be repeated safely.": "Нужен ключ импорта, чтобы загрузку можно было безопасно повторить.",
  "Title is required.": "Нужно название.",
  "Story text is required.": "Нужен текст.",
  "Already imported.": "Уже импортирован.",
};

function importReason(reason: string | undefined, language: UiLanguage) {
  if (!reason || language === "en") return reason;
  const tooLong = reason.match(/^A bok must fit inside 15 minutes\. This one is (\d+) characters; the limit is (\d+)\.$/);
  if (tooLong) return `Бок должен укладываться в 15 минут. В этом ${tooLong[1]} знаков при пределе ${tooLong[2]}.`;
  return russianImportReasons[reason] ?? reason;
}

function estimateMinutes(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return Math.max(1, Math.min(15, Math.ceil(words / 238)));
}

export function CatalogueImport({ onOpenContent }: { onOpenContent: (published: boolean) => void }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [view, setView] = useState<CatalogueView>("catalogue");
  const [preview, setPreview] = useState<string | null>(null);
  const [publishers, setPublishers] = useState<BoksPublisher[]>([]);
  const [publisher, setPublisher] = useState("");
  const [newPublisher, setNewPublisher] = useState("");
  const [rows, setRows] = useState<CatalogueRow[]>([]);
  const [problems, setProblems] = useState<CatalogueProblem[]>([]);
  const [results, setResults] = useState<BoksImportRowResult[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishNow, setPublishNow] = useState(true);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [rightsNote, setRightsNote] = useState("");
  const [purgePrefix, setPurgePrefix] = useState("");
  const [purgeMatched, setPurgeMatched] = useState<number | null>(null);
  const [purgeAcknowledged, setPurgeAcknowledged] = useState(false);
  const [seedAcknowledged, setSeedAcknowledged] = useState(false);
  const [purgeReviewed, setPurgeReviewed] = useState("");
  const [seedCount, setSeedCount] = useState<{ seeds: number; authored: number } | null>(null);
  const [languages, setLanguages] = useState<LanguageDemandRow[]>([]);
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loadBoksPublishers();
      setPublishers(next);
      setLanguages(await loadBoksLanguageDemand());
      setPublisher((current) => current || next[0]?.handle || "");
    } catch (error) {
      setStatus(readableBoksError(error, words[currentUiLanguage()].publishersLoadFailed));
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  const totals = useMemo(() => {
    const characters = rows.reduce((sum, row) => sum + row.text.length, 0);
    const minutes = rows.reduce((sum, row) => sum + estimateMinutes(row.text), 0);
    const bylines = new Set(rows.map((row) => row.authorName).filter(Boolean));
    return { characters, minutes, bylines: bylines.size };
  }, [rows]);

  async function readFiles(fileList: FileList | null) {
    if (!fileList?.length) return;

    setStatus("");
    setResults([]);
    setProgress(null);
    const files = await Promise.all(
      Array.from(fileList)
        .filter((file) => /\.(md|markdown|txt|jsonl)$/i.test(file.name))
        .map(async (file) => ({
          name: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          content: await file.text(),
        }))
    );

    if (!files.length) {
      setStatus(t.nothingToRead);
      return;
    }

    const parsed = parseCatalogueFiles(files, language);
    setRows(parsed.rows);
    setProblems(parsed.problems);
    setView(parsed.rows.length ? "preview" : "errors");
    window.scrollTo({ top: 0 });
    setStatus(t.readSummary(files.length, parsed.rows.length, parsed.problems.length));
  }

  async function runImport(retryUnresolved = false) {
    if (!publisher) { setStatus(t.choosePublisher); return; }
    if (!rows.length) return;
    if (!rightsConfirmed) { setStatus(t.confirmRights); return; }
    const { settled, pending: pendingRows } = pendingImportRows(rows, retryUnresolved ? results : []);
    if (!pendingRows.length) return;
    const collected = [...settled];
    setBusy(true);
    setStatus("");
    setResults(collected);
    setProgress({ done: settled.length, total: rows.length });
    setView("importing");
    window.scrollTo({ top: 0 });
    try {
      for (let start = 0; start < pendingRows.length; start += batchSize) {
        const batch = pendingRows.slice(start, start + batchSize);
        const report = await importBoksBatch({ publisherHandle: publisher, rows: batch.map(({ row }) => row), publish: publishNow, rightsConfirmed, rightsNote });
        collected.push(...originalImportIndices(report.results, batch));
        setResults([...collected]);
        setProgress({ done: collected.length, total: rows.length });
      }
      const imported = collected.filter((row) => row.status === "imported").length;
      const skipped = collected.filter((row) => row.status === "skipped").length;
      const rejected = collected.filter((row) => row.status === "rejected").length;
      setStatus(t.importSummary(imported, publisher, skipped, rejected, publishNow));
      await refresh();
    } catch (error) {
      setStatus(readableBoksError(error, t.importStopped));
    } finally { setBusy(false); setView("done"); }
  }

  function downloadReceipt() {
    const recordedKeys = new Set(results.map((row) => row.importKey));
    const receipt = { exportedAt: new Date().toISOString(), publisher, results,
      unresolved: rows.filter((row) => !recordedKeys.has(row.importKey)).map((row) => row.importKey) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "boks-import-receipt.json"; link.click(); URL.revokeObjectURL(url);
  }

  async function addPublisher() {
    const handle = newPublisher.trim().replace(/^@+/, "");
    if (!handle) return;

    setBusy(true);
    try {
      await setBoksPublisher(handle, true);
      setNewPublisher("");
      setStatus(t.publisherAdded(handle));
      await refresh();
      setPublisher(handle);
      setResults([]);
      setProgress(null);
      setPurgeMatched(null);
    } catch (error) {
      setStatus(readableBoksError(error, t.publisherFailed));
    } finally {
      setBusy(false);
    }
  }

  async function purge(confirm: boolean) {
    const prefix = purgePrefix.trim();
    if (!publisher || !prefix) {
      setStatus(t.purgeNeedsPrefix);
      return;
    }

    if (confirm && (!purgeAcknowledged || purgeReviewed !== `${publisher}:${prefix}`)) return;
    setBusy(true);
    try {
      const report = await deleteBoksImport({ publisherHandle: publisher, prefix, confirm });
      setPurgeMatched(report.matched);
      setPurgeReviewed(`${publisher}:${prefix}`);
      setPurgeAcknowledged(false);
      setStatus(
        confirm
          ? t.purgeDone(report.deleted, publisher)
          : t.purgePreview(report.matched, publisher, prefix)
      );
      if (confirm) {
        setPurgeMatched(null);
        setPurgePrefix("");
        await refresh();
      }
    } catch (error) {
      setStatus(readableBoksError(error, t.purgeFailed));
    } finally {
      setBusy(false);
    }
  }

  async function clearDemoCatalogue(confirm: boolean) {
    if (confirm && !seedAcknowledged) return;
    setSeedAcknowledged(false);
    setBusy(true);
    try {
      const report = await deleteSeedBoks(confirm);
      setSeedCount({ seeds: report.seeds, authored: report.authored });
      setStatus(
        confirm
          ? t.seedsDone(report.deleted, report.authored)
          : t.seedsPreview(report.seeds, report.authored)
      );
      if (confirm) setSeedCount(null);
      await refresh();
    } catch (error) {
      setStatus(readableBoksError(error, t.seedsFailed));
    } finally {
      setBusy(false);
    }
  }

  const rejected = results.filter((row) => row.status === "rejected");

  const imported = results.filter((row) => row.status === "imported").length;
  const skipped = results.filter((row) => row.status === "skipped").length;
  const unresolved = Math.max(0, rows.length - results.length) + rejected.length;
  const previewRow = rows.find((row) => row.importKey === preview);
  function go(next: typeof view) { setView(next); setPreview(null); window.scrollTo({ top: 0 }); }
  const heading = view === "done" && unresolved ? t.needsAttention : t.headings[view];
  return (
    <section className="studio-catalogue" data-studio-detail={view !== "catalogue" ? "true" : undefined}>
      {view !== "catalogue" && <header className="studio-subview-heading"><button type="button" className="studio-text-link" disabled={busy} onClick={() => go(view === "errors" && rows.length ? "preview" : "catalogue")}>← {view === "errors" && rows.length ? t.headings.preview : t.headings.catalogue}</button><p className="studio-eyebrow">{t.eyebrow}{view === "done" ? t.eyebrowComplete : ""}</p>{view !== "done" && <h1>{heading}</h1>}</header>}
      <input ref={filePicker} type="file" multiple accept=".md,.markdown,.txt,.jsonl" className="hidden" onChange={(event) => void readFiles(event.target.files)} />
      <input ref={folderPicker} type="file" {...{ webkitdirectory: "true", directory: "true" }} multiple className="hidden" onChange={(event) => void readFiles(event.target.files)} />

      {view === "catalogue" && <>
        <section className="studio-editorial-section"><h2>{t.whatNext}</h2><div className="studio-supply"><div><span>{t.language}</span><span>{t.boks}</span><span>{t.readers}</span></div>{languages.map((row) => <div key={row.language} className={row.readers > 0 && row.published === 0 ? "is-gap" : undefined}><span>{t.languageName(row.language)}</span><strong>{row.published}</strong><strong>{row.readers}</strong></div>)}</div><p className="studio-meta">{t.supplyNote}</p></section>
        <label className="studio-field">{t.publisherAccount}<select value={publisher} disabled={busy || !publishers.length} onChange={(event) => { setPublisher(event.target.value); setPurgeMatched(null); setPurgeAcknowledged(false); }}><option value="" disabled>{t.chooseAccount}</option>{publishers.map((entry) => <option key={entry.handle} value={entry.handle}>@{entry.handle} · {t.publishedCount(entry.published)}</option>)}</select></label>
        {!publishers.length && <p className="studio-hint">{t.noPublishers}</p>}
        <details className="studio-details"><summary>{t.addPublisher} <span>＋</span></summary><div className="studio-details-body"><label className="studio-field">{t.existingHandle}<Input value={newPublisher} onChange={(event) => setNewPublisher(event.target.value)} placeholder="boks" /></label><Button variant="outline" disabled={busy || !newPublisher.trim()} onClick={addPublisher}>{t.markPublisher}</Button></div></details>
        <button type="button" className="studio-dropzone" onClick={() => filePicker.current?.click()} disabled={busy}><Upload aria-hidden="true" /><h2>{t.importBoks}</h2><p>{t.chooseFiles}<br />.md · .txt · .jsonl</p></button>
        <div className="studio-inline"><Button variant="ghost" onClick={() => folderPicker.current?.click()} disabled={busy}><FolderOpen /> {t.chooseFolder}</Button><Button variant="ghost" onClick={() => void refresh()} disabled={busy}><RefreshCw /> {t.refresh}</Button></div>
        {rows.length > 0 && <button type="button" className="studio-author-link" onClick={() => go(progress ? "done" : "preview")}>{t.returnTo(Boolean(progress))}<span>↗</span></button>}
        <details className="studio-details"><summary>{t.fileFormat} <span>＋</span></summary><div className="studio-details-body"><p className="studio-meta">{t.fileFormatHint}</p><pre className="studio-import-format">{`---
title: The Lamplighter's Last Round
author: Abel Mensah
id: lamp-001
rights: Original work, used with permission
---
The story text goes here.`}</pre></div></details>
        <button type="button" className="studio-author-link" onClick={() => go("cleanup")}>{t.reviewCleanup} <span>↗</span></button>
      </>}
      {view === "preview" && <>
        <div className="studio-metric-pair"><MetricTile label={t.readyToImport} value={rows.length} /><MetricTile label={t.bylines} value={totals.bylines} /></div>
        <div className="studio-link-rows">{rows.slice(0,200).map((row) => <button key={row.importKey} type="button" onClick={() => setPreview(preview === row.importKey ? null : row.importKey)}><span><strong>{row.title}</strong><small>{row.importKey} · {row.authorName || t.noByline} · {t.minutes(estimateMinutes(row.text))}</small></span><span>↗</span></button>)}</div>
        <p className="studio-meta">{t.showing(Math.min(rows.length,200), rows.length)}</p>
        {previewRow && <article className="studio-import-preview-text"><h2>{previewRow.title}</h2><p className="studio-meta">{previewRow.authorName} · {previewRow.importKey}</p><div>{previewRow.text}</div><Button variant="ghost" onClick={() => setPreview(null)}>{t.closePreview}</Button></article>}
        <label className="studio-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span><strong>{t.mayPublish}</strong><small>{t.attestationRecorded}</small></span></label>
        <label className="studio-field">{t.rightsSource}<Input value={rightsNote} onChange={(event) => setRightsNote(event.target.value)} placeholder={t.rightsSourcePlaceholder} /><small>{t.fileRightsFirst}</small></label>
        <label className="studio-check"><input type="checkbox" checked={publishNow} onChange={(event) => setPublishNow(event.target.checked)} /><span>{t.publishNow}</span></label>
        {problems.length > 0 && <button type="button" className="studio-author-link" onClick={() => go("errors")}><span>{t.filesToFix(problems.length)}</span><AlertTriangle /></button>}
        <footer className="studio-flow-footer"><Button onClick={() => void runImport()} disabled={busy || !publisher || !rightsConfirmed}>{t.importInto(rows.length, publisher || "…")}</Button></footer>
      </>}
      {view === "errors" && <>
        <div className="studio-metric-pair"><MetricTile label={t.readyToImport} value={rows.length} /><MetricTile label={t.needAttention} value={problems.length} /></div>
        <p className="studio-meta">{t.readyKept}</p>
        {problems.slice(0,100).map((problem) => <article className="studio-file-error" key={`${problem.source}-${problem.problem}`}><strong>{problem.source}</strong><p>{problem.problem}</p></article>)}
        <div className="studio-inline"><Button variant="outline" onClick={() => filePicker.current?.click()}>{t.chooseCorrected}</Button>{rows.length > 0 && <Button onClick={() => go("preview")}>{t.reviewReady(rows.length)}</Button>}</div>
      </>}
      {view === "importing" && <>
        <div className="studio-import-progress" role="status"><strong>{progress?.done || 0}<span> / {rows.length}</span></strong><p>{t.processed}</p><progress value={progress?.done || 0} max={rows.length} /></div>
        <div className="studio-import-lines">{results.slice(-5).map((result) => <p key={result.index}><span>{result.status === "rejected" ? "!" : "✓"}</span>{rows[result.index]?.title || result.importKey}</p>)}</div>
        <p className="studio-hint">{t.keepOpen}</p>
      </>}
      {view === "done" && <>
        <div className={`studio-import-success ${unresolved ? "has-errors" : ""}`} aria-hidden="true">{unresolved ? <AlertTriangle /> : <Check />}</div>
        <h1 className="studio-import-done-title">{heading}</h1>
        <div className="studio-metric-pair"><MetricTile label={publishNow ? t.importedPublished : t.importedForReview} value={imported} /><MetricTile label={t.alreadyExisted} value={skipped} /></div>
        <p className="studio-hint">{t.savedUnder(publisher)}</p>
        {unresolved > 0 && <><p className="studio-notice">{t.unresolved(unresolved)}</p>{rejected.slice(0,40).map((row) => <article className="studio-file-error" key={row.index}><strong>{row.importKey}</strong><p>{importReason(row.reason, language)}</p></article>)}<Button onClick={() => void runImport(true)} disabled={busy || !publisher || !rightsConfirmed}>{t.retryUnresolved}</Button></>}
        <Button variant="outline" onClick={downloadReceipt}><Download /> {t.downloadReceipt}</Button>
        <footer className="studio-flow-footer"><Button onClick={() => onOpenContent(publishNow)}>{publishNow ? t.openPublished : t.openReview}</Button></footer>
      </>}
      {view === "cleanup" && <>
        <label className="studio-field">{t.publisherAccount}<select value={publisher} disabled={busy} onChange={(event) => { setPublisher(event.target.value); setPurgeMatched(null); setPurgeAcknowledged(false); }}>{publishers.map((entry) => <option key={entry.handle} value={entry.handle}>@{entry.handle}</option>)}</select></label>
        <label className="studio-field">{t.importPrefix}<Input value={purgePrefix} placeholder="fixture-" onChange={(event) => { setPurgePrefix(event.target.value); setPurgeMatched(null); setPurgeAcknowledged(false); }} /></label>
        <Button variant="outline" onClick={() => void purge(false)} disabled={busy || !publisher || !purgePrefix.trim()}>{t.previewCount}</Button>
        {purgeMatched !== null && <div className="studio-paper-slip"><span className="studio-eyebrow">{t.previewOnly}</span><h2>{t.matching(purgeMatched)}</h2><p className="studio-meta">{t.matchingNote(publisher, purgePrefix)}</p></div>}
        <p className="studio-hint">{t.purgeWarning}</p>
        {purgeMatched !== null && purgeMatched > 0 && <><label className="studio-check"><input type="checkbox" checked={purgeAcknowledged} onChange={(event) => setPurgeAcknowledged(event.target.checked)} /><span>{t.purgeAck(purgeMatched)}</span></label><Button variant="destructive" disabled={busy || !purgeAcknowledged || purgeReviewed !== `${publisher}:${purgePrefix.trim()}`} onClick={() => void purge(true)}><Trash2 /> {t.removeThese(purgeMatched)}</Button></>}
        <details className="studio-details"><summary>{t.seeded} <span>＋</span></summary><div className="studio-details-body"><p className="studio-meta">{t.seededHint}</p><Button variant="outline" disabled={busy} onClick={() => void clearDemoCatalogue(false)}>{t.countDemo}</Button>{seedCount && <><p>{t.seedCounts(seedCount.seeds, seedCount.authored)}</p>{seedCount.seeds > 0 && <><label className="studio-check"><input type="checkbox" checked={seedAcknowledged} onChange={(event) => setSeedAcknowledged(event.target.checked)} /><span>{t.seedAck}</span></label><Button variant="destructive" disabled={busy || !seedAcknowledged} onClick={() => void clearDemoCatalogue(true)}>{t.removeSeeds(seedCount.seeds)}</Button></>}</>}</div></details>
      </>}
      {status && <p className="studio-notice" role="status" aria-live="polite">{status}</p>}
    </section>
  );
}
