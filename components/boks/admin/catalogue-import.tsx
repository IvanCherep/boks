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

/**
 * The database caps a call at 100 rows. Batching under that keeps each request
 * short enough to survive a proxy and gives the operator moving progress
 * instead of one long wait with nothing on screen.
 */
const batchSize = 25;

function estimateMinutes(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return Math.max(1, Math.min(15, Math.ceil(words / 238)));
}

export function CatalogueImport({ onOpenContent }: { onOpenContent: (published: boolean) => void }) {
  const [view, setView] = useState<"catalogue" | "preview" | "errors" | "importing" | "done" | "cleanup">("catalogue");
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
      setStatus(readableBoksError(error, "Could not load the publisher accounts."));
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
      setStatus("Nothing to read. Drop .md, .txt or .jsonl files.");
      return;
    }

    const parsed = parseCatalogueFiles(files);
    setRows(parsed.rows);
    setProblems(parsed.problems);
    setView(parsed.rows.length ? "preview" : "errors");
    window.scrollTo({ top: 0 });
    setStatus(
      `Read ${files.length} file${files.length === 1 ? "" : "s"}: ${parsed.rows.length} ready` +
        (parsed.problems.length ? `, ${parsed.problems.length} to fix` : "")
    );
  }

  async function runImport(retryUnresolved = false) {
    if (!publisher) { setStatus("Choose the account these boks publish under."); return; }
    if (!rows.length) return;
    if (!rightsConfirmed) { setStatus("Confirm the rights for this batch before importing it."); return; }
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
      setStatus(`${imported} imported into @${publisher}` + (skipped ? `, ${skipped} already there` : "") +
        (rejected ? `, ${rejected} refused` : "") + (publishNow ? "." : ". They are waiting in the review queue."));
      await refresh();
    } catch (error) {
      setStatus(readableBoksError(error, "The import stopped. Completed batches are kept. Retry unresolved boks; stable IDs prevent duplicates if the last batch was saved."));
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
      setStatus(`@${handle} can now receive imports.`);
      await refresh();
      setPublisher(handle);
      setResults([]);
      setProgress(null);
      setPurgeMatched(null);
    } catch (error) {
      setStatus(readableBoksError(error, "Could not mark that account as a publisher."));
    } finally {
      setBusy(false);
    }
  }

  async function purge(confirm: boolean) {
    const prefix = purgePrefix.trim();
    if (!publisher || !prefix) {
      setStatus("Name the account and the import-key prefix to remove.");
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
          ? `Removed ${report.deleted} boks from @${publisher}, and everything readers did with them.`
          : `${report.matched} boks in @${publisher} start with "${prefix}". Removing them also removes their reads, likes and comments.`
      );
      if (confirm) {
        setPurgeMatched(null);
        setPurgePrefix("");
        await refresh();
      }
    } catch (error) {
      setStatus(readableBoksError(error, "Could not remove that batch."));
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
          ? `Removed ${report.deleted} demo boks, and everything readers did with them. ${report.authored} authored boks were left alone.`
          : `${report.seeds} demo boks on the platform, and ${report.authored} from authors. Removing the demo set also removes its reads, likes and comments.`
      );
      if (confirm) setSeedCount(null);
      await refresh();
    } catch (error) {
      setStatus(readableBoksError(error, "Could not clear the demo catalogue."));
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
  const heading = { catalogue: "Catalogue", preview: "Import preview", errors: "Files to fix", importing: "Importing boks", done: unresolved ? "Import needs attention" : "Import complete", cleanup: "Remove test content" }[view];
  return (
    <section className="studio-catalogue" data-studio-detail={view !== "catalogue" ? "true" : undefined}>
      {view !== "catalogue" && <header className="studio-subview-heading"><button type="button" className="studio-text-link" disabled={busy} onClick={() => go(view === "errors" && rows.length ? "preview" : "catalogue")}>← {view === "errors" && rows.length ? "Import preview" : "Catalogue"}</button><p className="studio-eyebrow">Editorial / catalogue{view === "done" ? " / complete" : ""}</p>{view !== "done" && <h1>{heading}</h1>}</header>}
      <input ref={filePicker} type="file" multiple accept=".md,.markdown,.txt,.jsonl" className="hidden" onChange={(event) => void readFiles(event.target.files)} />
      <input ref={folderPicker} type="file" {...{ webkitdirectory: "true", directory: "true" }} multiple className="hidden" onChange={(event) => void readFiles(event.target.files)} />

      {view === "catalogue" && <>
        <section className="studio-editorial-section"><h2>What to acquire next</h2><div className="studio-supply"><div><span>Language</span><span>Boks</span><span>Readers</span></div>{languages.map((row) => <div key={row.language} className={row.readers > 0 && row.published === 0 ? "is-gap" : undefined}><span>{row.language === "en" ? "English" : row.language === "ru" ? "Russian" : row.language === "und" ? "Undetermined" : row.language}</span><strong>{row.published}</strong><strong>{row.readers}</strong></div>)}</div><p className="studio-meta">Published supply · readers who accept each language</p></section>
        <label className="studio-field">Publisher account<select value={publisher} disabled={busy || !publishers.length} onChange={(event) => { setPublisher(event.target.value); setPurgeMatched(null); setPurgeAcknowledged(false); }}><option value="" disabled>Choose an account</option>{publishers.map((entry) => <option key={entry.handle} value={entry.handle}>@{entry.handle} · {entry.published} published</option>)}</select></label>
        {!publishers.length && <p className="studio-hint">No publisher accounts yet. Create an account through normal sign-in, then add its handle here.</p>}
        <details className="studio-details"><summary>Add a publisher account <span>＋</span></summary><div className="studio-details-body"><label className="studio-field">Existing account handle<Input value={newPublisher} onChange={(event) => setNewPublisher(event.target.value)} placeholder="boks" /></label><Button variant="outline" disabled={busy || !newPublisher.trim()} onClick={addPublisher}>Mark as publisher</Button></div></details>
        <button type="button" className="studio-dropzone" onClick={() => filePicker.current?.click()} disabled={busy}><Upload aria-hidden="true" /><h2>Import boks</h2><p>Choose files<br />.md · .txt · .jsonl</p></button>
        <div className="studio-inline"><Button variant="ghost" onClick={() => folderPicker.current?.click()} disabled={busy}><FolderOpen /> Choose a folder</Button><Button variant="ghost" onClick={() => void refresh()} disabled={busy}><RefreshCw /> Refresh</Button></div>
        {rows.length > 0 && <button type="button" className="studio-author-link" onClick={() => go(progress ? "done" : "preview")}>Return to {progress ? "import receipt" : "import preview"}<span>↗</span></button>}
        <details className="studio-details"><summary>File format & stable IDs <span>＋</span></summary><div className="studio-details-body"><p className="studio-meta">One bok per Markdown or text file with front matter, or a JSONL export. Stable IDs make repeat imports safe.</p><pre className="studio-import-format">{`---
title: The Lamplighter's Last Round
author: Abel Mensah
id: lamp-001
rights: Original work, used with permission
---
The story text goes here.`}</pre></div></details>
        <button type="button" className="studio-author-link" onClick={() => go("cleanup")}>Review a test-batch cleanup <span>↗</span></button>
      </>}
      {view === "preview" && <>
        <div className="studio-metric-pair"><MetricTile label="ready to import" value={rows.length} /><MetricTile label="bylines" value={totals.bylines} /></div>
        <div className="studio-link-rows">{rows.slice(0,200).map((row) => <button key={row.importKey} type="button" onClick={() => setPreview(preview === row.importKey ? null : row.importKey)}><span><strong>{row.title}</strong><small>{row.importKey} · {row.authorName || "No byline"} · {estimateMinutes(row.text)} min</small></span><span>↗</span></button>)}</div>
        <p className="studio-meta">Showing {Math.min(rows.length,200)} of {rows.length} · stable file IDs prevent duplicates.</p>
        {previewRow && <article className="studio-import-preview-text"><h2>{previewRow.title}</h2><p className="studio-meta">{previewRow.authorName} · {previewRow.importKey}</p><div>{previewRow.text}</div><Button variant="ghost" onClick={() => setPreview(null)}>Close text preview</Button></article>}
        <label className="studio-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span><strong>These boks may be published here.</strong><small>This attestation is recorded for each bok.</small></span></label>
        <label className="studio-field">Rights source<Input value={rightsNote} onChange={(event) => setRightsNote(event.target.value)} placeholder="Source or permission for this batch" /><small>A file’s own rights source takes precedence.</small></label>
        <label className="studio-check"><input type="checkbox" checked={publishNow} onChange={(event) => setPublishNow(event.target.checked)} /><span>Publish immediately. Otherwise send to review.</span></label>
        {problems.length > 0 && <button type="button" className="studio-author-link" onClick={() => go("errors")}><span>{problems.length} files to fix</span><AlertTriangle /></button>}
        <footer className="studio-flow-footer"><Button onClick={() => void runImport()} disabled={busy || !publisher || !rightsConfirmed}>Import {rows.length} into @{publisher || "…"}</Button></footer>
      </>}
      {view === "errors" && <>
        <div className="studio-metric-pair"><MetricTile label="ready to import" value={rows.length} /><MetricTile label="need attention" value={problems.length} /></div>
        <p className="studio-meta">Ready boks are kept. Fix these files and choose the corrected batch again.</p>
        {problems.slice(0,100).map((problem) => <article className="studio-file-error" key={`${problem.source}-${problem.problem}`}><strong>{problem.source}</strong><p>{problem.problem}</p></article>)}
        <div className="studio-inline"><Button variant="outline" onClick={() => filePicker.current?.click()}>Choose corrected files</Button>{rows.length > 0 && <Button onClick={() => go("preview")}>Review {rows.length} ready boks</Button>}</div>
      </>}
      {view === "importing" && <>
        <div className="studio-import-progress" role="status"><strong>{progress?.done || 0}<span> / {rows.length}</span></strong><p>boks processed</p><progress value={progress?.done || 0} max={rows.length} /></div>
        <div className="studio-import-lines">{results.slice(-5).map((result) => <p key={result.index}><span>{result.status === "rejected" ? "!" : "✓"}</span>{rows[result.index]?.title || result.importKey}</p>)}</div>
        <p className="studio-hint">Keep this page open. Stable IDs prevent duplicate boks when you retry a batch.</p>
      </>}
      {view === "done" && <>
        <div className={`studio-import-success ${unresolved ? "has-errors" : ""}`} aria-hidden="true">{unresolved ? <AlertTriangle /> : <Check />}</div>
        <h1 className="studio-import-done-title">{heading}</h1>
        <div className="studio-metric-pair"><MetricTile label={publishNow ? "imported & published" : "imported for review"} value={imported} /><MetricTile label="already existed" value={skipped} /></div>
        <p className="studio-hint">Saved under @{publisher}. Each bok keeps its own byline and rights source.</p>
        {unresolved > 0 && <><p className="studio-notice">{unresolved} boks need attention. Completed batches are kept.</p>{rejected.slice(0,40).map((row) => <article className="studio-file-error" key={row.index}><strong>{row.importKey}</strong><p>{row.reason}</p></article>)}<Button onClick={() => void runImport(true)} disabled={busy || !publisher || !rightsConfirmed}>Retry unresolved boks</Button></>}
        <Button variant="outline" onClick={downloadReceipt}><Download /> Download import receipt</Button>
        <footer className="studio-flow-footer"><Button onClick={() => onOpenContent(publishNow)}>{publishNow ? "Open published content" : "Open review queue"}</Button></footer>
      </>}
      {view === "cleanup" && <>
        <label className="studio-field">Publisher account<select value={publisher} disabled={busy} onChange={(event) => { setPublisher(event.target.value); setPurgeMatched(null); setPurgeAcknowledged(false); }}>{publishers.map((entry) => <option key={entry.handle} value={entry.handle}>@{entry.handle}</option>)}</select></label>
        <label className="studio-field">Import ID prefix<Input value={purgePrefix} placeholder="fixture-" onChange={(event) => { setPurgePrefix(event.target.value); setPurgeMatched(null); setPurgeAcknowledged(false); }} /></label>
        <Button variant="outline" onClick={() => void purge(false)} disabled={busy || !publisher || !purgePrefix.trim()}>Preview matching count</Button>
        {purgeMatched !== null && <div className="studio-paper-slip"><span className="studio-eyebrow">Preview only · nothing removed</span><h2>{purgeMatched} matching boks</h2><p className="studio-meta">All belong to @{publisher} and begin with {purgePrefix}. This preview reports the server count.</p></div>}
        <p className="studio-hint">Deleting this batch also removes its reactions, comments and reading metrics. This cannot be undone.</p>
        {purgeMatched !== null && purgeMatched > 0 && <><label className="studio-check"><input type="checkbox" checked={purgeAcknowledged} onChange={(event) => setPurgeAcknowledged(event.target.checked)} /><span>I reviewed the publisher, prefix and {purgeMatched} matching boks.</span></label><Button variant="destructive" disabled={busy || !purgeAcknowledged || purgeReviewed !== `${publisher}:${purgePrefix.trim()}`} onClick={() => void purge(true)}><Trash2 /> Remove these {purgeMatched}</Button></>}
        <details className="studio-details"><summary>Seeded demo catalogue <span>＋</span></summary><div className="studio-details-body"><p className="studio-meta">Only boks marked as seeds can be removed here. Author submissions are kept.</p><Button variant="outline" disabled={busy} onClick={() => void clearDemoCatalogue(false)}>Count demo boks</Button>{seedCount && <><p>{seedCount.seeds} seed boks · {seedCount.authored} authored boks kept</p>{seedCount.seeds > 0 && <><label className="studio-check"><input type="checkbox" checked={seedAcknowledged} onChange={(event) => setSeedAcknowledged(event.target.checked)} /><span>I understand the seed boks and their history will be permanently erased.</span></label><Button variant="destructive" disabled={busy || !seedAcknowledged} onClick={() => void clearDemoCatalogue(true)}>Remove {seedCount.seeds} seed boks</Button></>}</>}</div></details>
      </>}
      {status && <p className="studio-notice" role="status" aria-live="polite">{status}</p>}
    </section>
  );
}
