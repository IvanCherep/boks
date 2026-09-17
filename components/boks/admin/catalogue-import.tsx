"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FolderOpen, RefreshCw, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricTile } from "@/components/boks/shared-ui";
import { MetricNote } from "@/components/boks/admin/metric-note";
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

export function CatalogueImport() {
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
    setStatus(
      `Read ${files.length} file${files.length === 1 ? "" : "s"}: ${parsed.rows.length} ready` +
        (parsed.problems.length ? `, ${parsed.problems.length} to fix` : "")
    );
  }

  async function runImport() {
    if (!publisher) {
      setStatus("Choose the account these boks publish under.");
      return;
    }
    if (!rows.length) return;
    if (!rightsConfirmed) {
      setStatus("Confirm the rights for this batch before importing it.");
      return;
    }

    setBusy(true);
    setStatus("");
    setResults([]);
    setProgress({ done: 0, total: rows.length });

    const collected: BoksImportRowResult[] = [];
    try {
      for (let start = 0; start < rows.length; start += batchSize) {
        const batch = rows.slice(start, start + batchSize);
        const report = await importBoksBatch({
          publisherHandle: publisher,
          rows: batch,
          publish: publishNow,
          rightsConfirmed,
          rightsNote,
        });
        // The database numbers rows within its own batch; shift them so the
        // operator can find a rejected row in the list they dropped in.
        collected.push(...report.results.map((row) => ({ ...row, index: row.index + start })));
        setResults([...collected]);
        setProgress({ done: Math.min(start + batch.length, rows.length), total: rows.length });
      }

      const imported = collected.filter((row) => row.status === "imported").length;
      const skipped = collected.filter((row) => row.status === "skipped").length;
      const rejected = collected.filter((row) => row.status === "rejected").length;
      setStatus(
        `${imported} imported into @${publisher}` +
          (skipped ? `, ${skipped} already there` : "") +
          (rejected ? `, ${rejected} refused` : "") +
          (publishNow ? "." : ". They are waiting in the review queue.")
      );
      await refresh();
    } catch (error) {
      setStatus(readableBoksError(error, "The import stopped. Nothing after the last batch was written."));
    } finally {
      setBusy(false);
    }
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

    setBusy(true);
    try {
      const report = await deleteBoksImport({ publisherHandle: publisher, prefix, confirm });
      setPurgeMatched(report.matched);
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

  return (
    <section className="grid gap-4">
      <div className="panel p-5">
        <h2 className="text-xl font-semibold tracking-normal">What to acquire next</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          boks only recommends what a reader can read, so a language with readers and no boks is an
          empty app for those readers. Neither column means much alone.
        </p>
        <MetricNote
          label="Language supply and demand"
          is={<>Published boks per language, beside the readers who accept that language.</>}
          how={
            <>
              A boks&apos; language is derived from its text, not asked of the author: Cyrillic
              against Latin settles Russian from English, then English function words separate
              English from other Latin-script languages. Anything it cannot place is
              <code> und</code>, and a reader who narrowed their languages is <em>not</em> offered
              it - unknown is not a yes. So the <code>und</code> row is a work queue: those boks
              reach only readers who left their languages alone, until an admin labels them.
              A reader&apos;s languages start from their browser and are theirs to change.{" "}
              <strong>Only</strong> counts readers who accept nothing else - if that language has no
              boks, those readers see an empty feed.
            </>
          }
          not={
            <>
              Not a measure of interest. It counts readers who said they can read a language, not
              readers who want more of it - that question needs boks in that language first.
            </>
          }
        />
        <div className="mt-4 overflow-x-auto">
          <table className="stat-table">
            <thead>
              <tr>
                <th>Language</th>
                <th>Published</th>
                <th>Readers</th>
                <th>Only this one</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {languages.map((row) => (
                <tr key={row.language}>
                  <td>{row.language === "und" ? "undetermined" : row.language}</td>
                  <td>{row.published}</td>
                  <td>{row.readers}</td>
                  <td>{row.readersOnly}</td>
                  <td className="text-[var(--muted-foreground)]">
                    {row.readersOnly > 0 && row.published === 0
                      ? `${row.readersOnly} reader${row.readersOnly === 1 ? "" : "s"} with an empty feed`
                      : row.language === "und" && row.published > 0
                        ? "hidden from every reader who set a language - label these"
                        : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="text-xl font-semibold tracking-normal">Publish into an account</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          A boks is attributed to an account, and carries its own byline on top. So one account can
          publish a whole catalogue with a different writer credited on every piece. Readers follow
          the account; each piece still says who wrote it.
        </p>

        {publishers.length ? (
          <div className="mt-4 grid gap-2">
            {publishers.map((entry) => (
              <label
                key={entry.handle}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 ${
                  publisher === entry.handle
                    ? "border-[var(--foreground)] bg-[var(--muted)]"
                    : "border-[var(--border)]"
                }`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="boks-publisher"
                    checked={publisher === entry.handle}
                    onChange={() => setPublisher(entry.handle)}
                  />
                  <span className="font-semibold">@{entry.handle}</span>
                </span>
                <span className="text-sm text-[var(--muted-foreground)]">
                  {entry.published} published · {entry.imported} imported · {entry.followers} following
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4 text-sm leading-6">
            No publisher accounts yet. Create the account the ordinary way — sign up with its email
            and set its nickname — then name it here. Nothing can be imported into an account that
            has not been marked, so a mistyped handle cannot pour a catalogue into a reader&apos;s
            account.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Mark an account as a publisher
            <Input
              value={newPublisher}
              placeholder="boks"
              onChange={(event) => setNewPublisher(event.target.value)}
            />
          </label>
          <Button variant="outline" onClick={addPublisher} disabled={busy || !newPublisher.trim()}>
            <Check className="size-4" /> Mark
          </Button>
          <Button variant="outline" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      <div className="panel p-5">
        <h2 className="text-xl font-semibold tracking-normal">Load a catalogue</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          One file per bok — <code>.md</code> or <code>.txt</code> with a front-matter block — or a
          single <code>.jsonl</code> export. Every piece keeps a stable id, so running the same load
          twice imports nothing the second time instead of doubling the catalogue.
        </p>

        <pre className="mt-3 overflow-x-auto rounded-xl bg-[var(--muted)] p-3 text-xs leading-5">{`---
title: The Lamplighter's Last Round
author: Abel Mensah        # optional: the byline for this piece
hook: One night the city switched to electric.
id: lamp-001               # optional: defaults to the file name
date: 1998-04-02           # optional: keeps the catalogue's own date
---
The story text goes here.`}</pre>

        <div className="mt-4 flex flex-wrap gap-2">
          <input
            ref={filePicker}
            type="file"
            multiple
            accept=".md,.markdown,.txt,.jsonl"
            className="hidden"
            onChange={(event) => void readFiles(event.target.files)}
          />
          <input
            ref={folderPicker}
            type="file"
            /* @ts-expect-error - a directory picker is not in the React DOM types */
            webkitdirectory="true"
            directory="true"
            multiple
            className="hidden"
            onChange={(event) => void readFiles(event.target.files)}
          />
          <Button variant="outline" onClick={() => filePicker.current?.click()} disabled={busy}>
            <Upload className="size-4" /> Choose files
          </Button>
          <Button variant="outline" onClick={() => folderPicker.current?.click()} disabled={busy}>
            <FolderOpen className="size-4" /> Choose a folder
          </Button>
        </div>

        {rows.length > 0 && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricTile label="Ready to import" value={rows.length} />
              <MetricTile label="Named writers" value={totals.bylines} />
              <MetricTile label="Reading minutes" value={totals.minutes} />
              <MetricTile label="To fix" value={problems.length} />
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
              <label className="flex cursor-pointer items-start gap-3 text-sm font-medium leading-6">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={rightsConfirmed}
                  onChange={(event) => setRightsConfirmed(event.target.checked)}
                />
                <span>
                  These {rows.length} boks may be published here.
                  <span className="mt-1 block font-normal text-[var(--muted-foreground)]">
                    Asked once for the batch, because a public-domain load is hundreds of files with
                    the same answer. It is recorded against every piece, under your account.
                  </span>
                </span>
              </label>

              <label className="mt-3 grid gap-1 text-sm font-medium">
                Where the rights come from
                <span className="text-sm font-normal text-[var(--muted-foreground)]">
                  Admins only. Applies to the whole batch; a file with its own <code>rights:</code>{" "}
                  line keeps that instead.
                </span>
                <Input
                  value={rightsNote}
                  placeholder="Project Gutenberg, public domain in the US"
                  onChange={(event) => setRightsNote(event.target.value)}
                />
              </label>
            </div>

            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={publishNow}
                onChange={(event) => setPublishNow(event.target.checked)}
              />
              Publish straight away. Unchecked, they land in the review queue instead.
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={runImport} disabled={busy || !publisher || !rightsConfirmed}>
                <Upload className="size-4" />
                {busy ? "Importing…" : `Import ${rows.length} boks into @${publisher || "…"}`}
              </Button>
              {progress && (
                <span className="text-sm text-[var(--muted-foreground)]">
                  {progress.done} of {progress.total}
                </span>
              )}
            </div>

            <div className="mt-4 max-h-[280px] overflow-y-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--muted)] text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                  <tr>
                    <th className="p-2">Id</th>
                    <th className="p-2">Title</th>
                    <th className="p-2">Byline</th>
                    <th className="p-2">Min</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((row) => (
                    <tr key={row.importKey} className="border-t border-[var(--border)]">
                      <td className="p-2 font-mono text-xs">{row.importKey}</td>
                      <td className="p-2">{row.title}</td>
                      <td className="p-2 text-[var(--muted-foreground)]">{row.authorName || "—"}</td>
                      <td className="p-2">{estimateMinutes(row.text)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && (
                <p className="p-2 text-xs text-[var(--muted-foreground)]">
                  and {rows.length - 200} more, all of which will be imported
                </p>
              )}
            </div>
          </>
        )}

        {problems.length > 0 && (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4" /> {problems.length} file
              {problems.length === 1 ? "" : "s"} to fix — the rest will still import
            </p>
            <ul className="mt-2 grid gap-1 text-sm text-[var(--muted-foreground)]">
              {problems.slice(0, 40).map((problem) => (
                <li key={`${problem.source}-${problem.problem}`}>
                  <span className="font-mono text-xs">{problem.source}</span> — {problem.problem}
                </li>
              ))}
            </ul>
          </div>
        )}

        {rejected.length > 0 && (
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-3">
            <p className="text-sm font-semibold">{rejected.length} refused by the database</p>
            <ul className="mt-2 grid gap-1 text-sm text-[var(--muted-foreground)]">
              {rejected.slice(0, 40).map((row) => (
                <li key={`${row.index}-${row.importKey}`}>
                  <span className="font-mono text-xs">{row.importKey}</span> — {row.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {status && <p className="mt-4 text-sm leading-6" role="status" aria-live="polite">{status}</p>}
      </div>

      <div className="panel p-5">
        <h2 className="text-xl font-semibold tracking-normal">Remove a test batch</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          Matches on the start of the import id, so a load given ids like{" "}
          <code>fixture-0001</code> comes out again with the prefix <code>fixture-</code>. Removing a
          boks also removes the reads, likes and comments attached to it, and cannot be undone — this
          is for test data, not for taking a published piece down.
        </p>

        <div className="mt-4 rounded-xl border border-[var(--border)] p-3">
          <p className="text-sm font-semibold">The seeded demo catalogue</p>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
            The boks that came with the platform, written to have something to rank. Marked as
            seeds, so this can only ever remove those — work an author published is out of its
            reach.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void clearDemoCatalogue(false)} disabled={busy}>
              Count the demo boks
            </Button>
            {seedCount !== null && seedCount.seeds > 0 && (
              <Button variant="outline" onClick={() => void clearDemoCatalogue(true)} disabled={busy}>
                <Trash2 className="size-4" /> Remove all {seedCount.seeds} for good
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Import-key prefix
            <Input
              value={purgePrefix}
              placeholder="fixture-"
              onChange={(event) => {
                setPurgePrefix(event.target.value);
                setPurgeMatched(null);
              }}
            />
          </label>
          <Button variant="outline" onClick={() => void purge(false)} disabled={busy || !purgePrefix.trim()}>
            Count them
          </Button>
          {purgeMatched !== null && purgeMatched > 0 && (
            <Button variant="outline" onClick={() => void purge(true)} disabled={busy}>
              <Trash2 className="size-4" /> Remove {purgeMatched} for good
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
