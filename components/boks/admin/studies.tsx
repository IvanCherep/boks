"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Story } from "@/components/boks/client-types";
import {
  deleteStudyFragmentBatch,
  importStudyFragments,
  listStudies,
  listStudyFragments,
  loadStudyBoks,
  loadStudyResponses,
  setStudyEnabled,
  setStudyMaterials,
  type StudyAdminRow,
} from "@/components/boks/supabase-browser-data";
import { StudyFormGallery } from "@/components/boks/admin/study-form-gallery";
import { materialBokIds, materialTemplates, parseStudyMaterials, seriesBokIds, type StudyMaterials } from "@/lib/boks/studies/materials";
import { isSeriesBok } from "@/components/boks/studies/study-series";
import { poemManifestFor } from "@/components/boks/poetry/poems";
import { studyConditions, studyDescriptions, studyPath, type StudyKey } from "@/lib/boks/studies/protocol";
import { studyResponsesCsv, summariseStudy, type StudySummary } from "@/lib/boks/studies/results";

/**
 * Studies: the controlled tests behind the thesis hypotheses
 * (`docs/studies.md`).
 *
 * Each study has one switch. Off - the default - its participant page says
 * no study is running and the database refuses every answer; the link can be
 * printed and handed out before it starts. A study can be switched on only
 * with materials its protocol can use. Switching off stops new participants
 * and answers and keeps what was collected.
 *
 * Results are computed here from the raw answers (`lib/boks/studies/results.ts`)
 * with the team's own runs left out unless asked for; the export is the raw
 * answers for any other analysis.
 */
export function AdminStudies() {
  const [view, setView] = useState<"studies" | "forms">("studies");
  const [studies, setStudies] = useState<StudyAdminRow[] | null>(null);
  const [status, setStatus] = useState("Loading…");

  const refresh = useCallback(async () => {
    try {
      setStudies(await listStudies());
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the studies.");
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="admin-segmented" aria-label="View">
          <button type="button" aria-pressed={view === "studies"} onClick={() => setView("studies")}>Studies</button>
          <button type="button" aria-pressed={view === "forms"} onClick={() => setView("forms")}>Participant forms</button>
        </div>
        {view === "studies" && (
          <Button variant="outline" onClick={() => void refresh()}><RefreshCw className="size-4" /> Refresh</Button>
        )}
      </div>
      {view === "forms" ? (
        <StudyFormGallery />
      ) : (
        <>
          <p className="max-w-3xl text-sm text-[var(--muted-foreground)]">
            Every study starts switched off. Until it is on, its link shows “this study is not running” and nothing can
            be written. Choose its texts, look at it with Preview (nothing is saved), then switch it on.
          </p>
          {status && <p className="text-sm text-[var(--muted-foreground)]" role="status">{status}</p>}
          {studies?.map((study) => <StudyPanel key={study.key} study={study} onChange={refresh} />)}
        </>
      )}
    </section>
  );
}

function StudyPanel({ study, onChange }: { study: StudyAdminRow; onChange: () => Promise<void> }) {
  const description = studyDescriptions[study.key];
  const parsed = parseStudyMaterials(study.key, study.materials);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = typeof window === "undefined" ? studyPath(study.key) : `${window.location.origin}${studyPath(study.key)}`;

  async function toggle(enabled: boolean) {
    if (enabled && !parsed.ok) {
      setNote("Choose the study's texts first: " + parsed.problems.join(" "));
      return;
    }
    setBusy(true);
    setNote("");
    try {
      await setStudyEnabled(study.key, enabled);
      await onChange();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not switch the study.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNote(url);
    }
  }

  return (
    <article className="panel grid gap-4 p-4" aria-labelledby={`study-${study.key}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <p className="studio-eyebrow">{description.label} · {description.owner === "team" ? "team hypothesis" : description.owner}</p>
          <h2 id={`study-${study.key}`} className="text-xl font-semibold tracking-normal">{description.title}</h2>
          <p className="mt-1 text-sm">{description.comparison}</p>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description.outcome}</p>
        </div>
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={study.enabled} disabled={busy} onCheckedChange={(checked) => void toggle(checked)} aria-label={`${description.label} running`} />
          {study.enabled ? "Running" : "Off"}
        </label>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <code className="rounded bg-[var(--muted)] px-2 py-1">{studyPath(study.key)}</code>
        <Button variant="outline" size="sm" onClick={() => void copy()}><Copy className="size-4" /> {copied ? "Copied" : "Copy link"}</Button>
        {studyConditions[study.key].map((condition) => (
          <Button key={condition} variant="outline" size="sm" asChild>
            <a href={`${studyPath(study.key)}?preview=1&condition=${condition}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" /> Preview{studyConditions[study.key].length > 1 ? `: ${condition}` : ""}
            </a>
          </Button>
        ))}
      </div>

      <p className="text-sm text-[var(--muted-foreground)]">
        {study.participants} participant{study.participants === 1 ? "" : "s"}, {study.completed} finished
        {Object.keys(study.byCondition).length > 0 && ` · ${Object.entries(study.byCondition).map(([condition, count]) => `${condition}: ${count}`).join(", ")}`}
        {` · ${study.responses} answers`}
        {study.lastResponseAt && ` · last ${new Date(study.lastResponseAt).toLocaleString()}`}
      </p>

      {note && <p className="text-sm text-[var(--muted-foreground)]" role="status">{note}</p>}

      <details>
        <summary className="cursor-pointer text-sm font-medium">Texts and settings {parsed.ok ? "" : "· not ready"}</summary>
        <MaterialsEditor study={study} onSaved={onChange} />
      </details>

      {study.key === "b3" && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Fragments · {study.fragments ?? 0} imported</summary>
          <FragmentImport onChange={onChange} />
        </details>
      )}

      <details>
        <summary className="cursor-pointer text-sm font-medium">Results</summary>
        <StudyResults studyKey={study.key} />
      </details>
    </article>
  );
}

const materialHelp: Record<StudyKey, string> = {
  rg1: "familiarization: a Series piece shown first in both formats. targets: Series pieces; each participant gets one, in their assigned format.",
  rg2: "minutes: each session's length; everyone has a feed session and a catalogue session, in the assigned order. poolSize: texts per session - twice as many are drawn from the participant's own feed and split by alternating ranks, so the two sessions never share a text.",
  a1: "pairs: at least 4 of { whole, fragment } of similar length (±10%), theme and difficulty. choices: new texts for the free choice, at least two of each kind ({ bokId, kind }).",
  a2: "setA and setB: comparable lists of the same size, in the order the feed shows them. minutes: each session's length.",
  a3: "targets: the test pool, at least perParticipant + profileSize boks with semantic vectors, by many authors; none is served while the profile forms. profileSize: rated boks that fix the profile (5). perParticipant: new texts rated after it (10). feedPoolSize: how much of the participant's own feed the profile is formed from.",
  b1: "pieces: immersive poems with gesture scenes. perParticipant: how many each participant reads; their roles follow the recorded traces.",
  b2: "pieces: { series, author, sameAuthor: [other plain texts by them], others: [plain texts by other authors] }. distractorAuthors: names added to the screening question.",
  b3: "batch: the imported fragment batch to rate; empty rates every fragment.",
};

function MaterialsEditor({ study, onSaved }: { study: StudyAdminRow; onSaved: () => Promise<void> }) {
  const initial = Object.keys(study.materials).length ? study.materials : materialTemplates[study.key];
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [problems, setProblems] = useState<string[]>([]);
  const [titles, setTitles] = useState<{ id: string; story: Story | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  function parse() {
    try {
      return { raw: JSON.parse(text) as unknown, error: "" };
    } catch (error) {
      return { raw: null, error: error instanceof Error ? error.message : "Not JSON." };
    }
  }

  async function check() {
    const { raw, error } = parse();
    if (error) {
      setProblems([error]);
      return null;
    }
    const parsed = parseStudyMaterials(study.key, raw);
    const ids = materialBokIds(study.key, raw);
    const stories = await loadStudyBoks(ids);
    const byId = new Map(stories.map((story) => [story.id, story]));
    const resolved = ids.map((id) => ({ id, story: byId.get(id) ?? null }));
    setTitles(resolved);
    const unpublished = resolved.filter((entry) => !entry.story).map((entry) => `${entry.id} is not a published bok.`);
    // b1 replays gestures, which only the immersive poems have.
    const notSeries = seriesBokIds(study.key, raw)
      .filter((id) => (study.key === "b1" ? !poemManifestFor(id) : !isSeriesBok(id)))
      .map((id) => `${id} is not ${study.key === "b1" ? "an immersive poem" : "a Series piece"}.`);
    // a1: a pair is comparable only at a similar length - within 10% in words.
    const uneven = study.key === "a1" && parsed.ok
      ? (parsed.materials as StudyMaterials["a1"]).pairs.flatMap((pair, index) => {
          const whole = byId.get(pair.whole)?.wordCount ?? 0;
          const fragment = byId.get(pair.fragment)?.wordCount ?? 0;
          if (!whole || !fragment) return [];
          return Math.abs(whole - fragment) / Math.max(whole, fragment) > 0.1
            ? [`pairs[${index}]: ${whole} against ${fragment} words differ by more than 10%.`]
            : [];
        })
      : [];
    const all = [...parsed.problems, ...unpublished, ...notSeries, ...uneven];
    setProblems(all);
    return all.length ? null : (raw as Record<string, unknown>);
  }

  async function save() {
    setBusy(true);
    setNote("");
    try {
      const materials = await check();
      if (!materials) return;
      await setStudyMaterials(study.key, materials);
      setNote("Saved.");
      await onSaved();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3">
      <p className="text-sm text-[var(--muted-foreground)]">{materialHelp[study.key]} Bok ids are the ones in a bok&apos;s link (/b/&lt;id&gt;).</p>
      <Textarea className="min-h-56 font-mono text-xs" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} aria-label="Materials as JSON" />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void check()}>Check</Button>
        <Button disabled={busy || study.enabled} onClick={() => void save()}>Save</Button>
        {study.enabled && <span className="self-center text-sm text-[var(--muted-foreground)]">Switch the study off to change its texts: running participants would get a different plan.</span>}
      </div>
      {note && <p className="text-sm" role="status">{note}</p>}
      {problems.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-[var(--destructive)]">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      )}
      {titles && titles.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {titles.map((entry) => (
            <li key={entry.id}>
              <code className="text-xs">{entry.id.slice(0, 8)}</code>{" "}
              {entry.story ? `${entry.story.title} — ${entry.story.authorName}, ${entry.story.wordCount} words` : "not published"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FragmentImport({ onChange }: { onChange: () => Promise<void> }) {
  const [batch, setBatch] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<Record<string, { algorithm: number; window: number }> | null>(null);

  const loadBatches = useCallback(async () => {
    const rows = await listStudyFragments();
    const counts: Record<string, { algorithm: number; window: number }> = {};
    for (const row of rows) {
      counts[row.batch] ??= { algorithm: 0, window: 0 };
      counts[row.batch][row.method] += 1;
    }
    setBatches(counts);
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => void loadBatches().catch(() => undefined), 0);
    return () => window.clearTimeout(handle);
  }, [loadBatches]);

  async function submit() {
    setBusy(true);
    setNote("");
    try {
      const rows = JSON.parse(text) as unknown;
      if (!Array.isArray(rows)) throw new Error("Paste a JSON array of fragments.");
      const count = await importStudyFragments(batch, rows as Record<string, unknown>[]);
      setNote(`${count} fragments imported into “${batch}”.`);
      setText("");
      await loadBatches();
      await onChange();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not import.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(name: string) {
    try {
      const removed = await deleteStudyFragmentBatch(name);
      setNote(`${removed} unrated fragments removed from “${name}”. Rated ones stay: their answers are data.`);
      await loadBatches();
      await onChange();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not remove.");
    }
  }

  return (
    <div className="mt-3 grid gap-3">
      <p className="text-sm text-[var(--muted-foreground)]">
        A JSON array from the fragment prototype: {"{ method: \"algorithm\" | \"window\", sourceTitle, sourceAuthor, language, body, rank }"}.
        The text is stored verbatim. Raters never see the method; same-length windows from the same books are the comparison.
      </p>
      <Input placeholder="Batch name, e.g. pilot-1" value={batch} onChange={(event) => setBatch(event.target.value)} aria-label="Batch" />
      <Textarea className="min-h-40 font-mono text-xs" value={text} spellCheck={false} onChange={(event) => setText(event.target.value)} aria-label="Fragments as JSON" />
      <div><Button disabled={busy || !batch.trim() || !text.trim()} onClick={() => void submit()}>Import</Button></div>
      {note && <p className="text-sm" role="status">{note}</p>}
      {batches && Object.keys(batches).length > 0 && (
        <ul className="grid gap-1 text-sm">
          {Object.entries(batches).map(([name, counts]) => (
            <li key={name} className="flex flex-wrap items-center gap-2">
              <code>{name}</code> {counts.algorithm} algorithm, {counts.window} window
              <Button variant="outline" size="sm" onClick={() => void remove(name)}>Remove unrated</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatValue(value: number, unit: "points" | "share" | "score") {
  if (unit === "score") return value.toFixed(3);
  return unit === "share" ? `${Math.round(value * 1000) / 10}%` : (Math.round(value * 100) / 100).toFixed(2);
}

function formatEffect(value: number, unit: "points" | "share" | "score") {
  const sign = value > 0 ? "+" : "";
  if (unit === "score") return `${sign}${value.toFixed(3)}`;
  return unit === "share" ? `${sign}${Math.round(value * 1000) / 10} pp` : `${sign}${(Math.round(value * 100) / 100).toFixed(2)}`;
}

function StudyResults({ studyKey }: { studyKey: StudyKey }) {
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [includeTeam, setIncludeTeam] = useState(false);
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<Awaited<ReturnType<typeof loadStudyResponses>>>([]);

  async function load(team = includeTeam) {
    setStatus("Loading…");
    try {
      const responses = await loadStudyResponses(studyKey);
      const fragments = studyKey === "b3" ? await listStudyFragments() : undefined;
      setRows(responses);
      setSummary(summariseStudy(studyKey, responses, { includeTeam: team, fragments }));
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the results.");
    }
  }

  function download(kind: "csv" | "json") {
    const body = kind === "csv" ? studyResponsesCsv(rows) : JSON.stringify(rows, null, 2);
    const blob = new Blob([body], { type: kind === "csv" ? "text/csv" : "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `boks-study-${studyKey}-${new Date().toISOString().slice(0, 10)}.${kind}`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="mt-3 grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void load()}><RefreshCw className="size-4" /> {summary ? "Reload" : "Compute"}</Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeTeam} onChange={(event) => { setIncludeTeam(event.target.checked); if (summary) void load(event.target.checked); }} />
          Include the team&apos;s own runs
        </label>
        {rows.length > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={() => download("csv")}><Download className="size-4" /> CSV</Button>
            <Button variant="outline" size="sm" onClick={() => download("json")}><Download className="size-4" /> JSON</Button>
          </>
        )}
      </div>
      {status && <p className="text-sm text-[var(--muted-foreground)]">{status}</p>}
      {summary && (
        <>
          <p className="text-sm">
            {summary.participants} participants, {summary.completed} finished
            {Object.keys(summary.byCondition).length > 0 && ` · ${Object.entries(summary.byCondition).map(([condition, count]) => `${condition}: ${count}`).join(", ")}`}
          </p>
          {summary.comparisons.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-[var(--muted-foreground)]">
                    <th className="py-1 font-medium">Measure</th>
                    <th className="py-1 text-right font-medium">Control</th>
                    <th className="py-1 text-right font-medium">Variant</th>
                    <th className="py-1 text-right font-medium">Effect</th>
                    <th className="py-1 text-right font-medium">95% interval</th>
                    <th className="py-1 text-right font-medium">n</th>
                    <th className="py-1 text-right font-medium">Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.comparisons.map((comparison) => {
                    const result = comparison.result;
                    const insufficient = result.status === "insufficient_data";
                    return (
                      <tr key={comparison.label} className="border-t border-[var(--border)]">
                        <td className="py-2">{comparison.label}</td>
                        <td className="py-2 text-right">{comparison.controlLabel}: {formatValue(result.controlValue, comparison.unit)}</td>
                        <td className="py-2 text-right">{comparison.variantLabel}: {formatValue(result.variantValue, comparison.unit)}</td>
                        <td className="py-2 text-right">{insufficient ? "—" : formatEffect(result.effect, comparison.unit)}</td>
                        <td className="py-2 text-right">{insufficient ? `needs ${result.minimumReaders} an arm` : `${formatEffect(result.ci[0], comparison.unit)} … ${formatEffect(result.ci[1], comparison.unit)}`}</td>
                        <td className="py-2 text-right">{result.design === "paired" ? result.readers : `${result.controlReaders} / ${result.variantReaders}`}</td>
                        <td className="py-2 text-right">
                          {formatEffect(comparison.threshold, comparison.unit)}
                          {comparison.meetsThreshold === null ? "" : comparison.meetsThreshold ? " · met" : " · not met"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {summary.facts.map((fact) => <p key={fact.label} className="text-sm"><span className="text-[var(--muted-foreground)]">{fact.label}:</span> {fact.value}</p>)}
          {summary.fragments && summary.fragments.verdicts.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="text-left text-[var(--muted-foreground)]"><th className="py-1 font-medium">Fragment</th><th className="py-1 font-medium">Method</th><th className="py-1 text-right font-medium">Ratings</th><th className="py-1 text-right font-medium">Yes to both</th><th className="py-1 text-right font-medium">Accepted</th></tr></thead>
                <tbody>
                  {summary.fragments.verdicts.map((verdict) => (
                    <tr key={verdict.fragment.id} className="border-t border-[var(--border)]">
                      <td className="py-1">{verdict.fragment.sourceTitle}{verdict.fragment.rank !== null ? ` #${verdict.fragment.rank}` : ""}</td>
                      <td className="py-1">{verdict.fragment.method}</td>
                      <td className="py-1 text-right">{verdict.ratings}</td>
                      <td className="py-1 text-right">{verdict.bothYes}</td>
                      <td className="py-1 text-right">{verdict.accepted ? "yes" : verdict.ratings >= 3 ? "no" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
