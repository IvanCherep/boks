"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoksOverview } from "@/components/boks/client-types";
import { loadBoksOverview } from "@/components/boks/supabase-browser-data";
import { MetricBars, type MetricBarRow } from "@/components/boks/admin/metric-bars";
import type { AdminTab } from "@/components/boks/admin-dashboard";
import { MetricNote } from "@/components/boks/admin/metric-note";

/**
 * The weekly page.
 *
 * Only numbers that change a decision. No composite scores, no rate whose
 * denominator is a guess, and no algorithm comparison - that lives in
 * Experiments, and at a small catalog it has nothing to say.
 */
export function AdminOverview({ onNavigate }: { onNavigate: (tab: AdminTab) => void }) {
  const [overview, setOverview] = useState<BoksOverview | null>(null);
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState("Loading...");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (nextDays: number) => {
    setBusy(true);
    try {
      const payload = await loadBoksOverview(nextDays);
      setOverview(payload);
      setStatus(
        payload
          ? ""
          : "This Supabase project does not have the overview function yet. Apply supabase/migrations/20260912190000_boks_overview_metrics.sql."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load the overview.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(days).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [days, refresh]);

  const readers = overview?.readers;
  const reading = overview?.reading;
  const supply = overview?.supply;
  const catalog = overview?.catalog;
  const quality = overview?.dataQuality;

  const minutes = Math.round((reading?.activeSeconds ?? 0) / 60);
  const minutesPerReader = readers?.active ? Math.round(minutes / readers.active) : 0;
  const minutesPerSession = reading?.sessions ? Math.round(minutes / reading.sessions) : 0;
  const sessionsPerReader = readers?.active ? round1((reading?.sessions ?? 0) / readers.active) : 0;
  const minutesPerBok = reading?.boksCompleted ? round1(minutes / reading.boksCompleted) : 0;
  const returningRate = readers?.previousActive
    ? Math.round((readers.returning / readers.previousActive) * 100)
    : 0;
  const outcomeRate = quality?.reads ? Math.round((quality.readsWithOutcome / quality.reads) * 100) : 0;

  const distribution: MetricBarRow[] = (overview?.readsPerReader ?? []).map((row) => ({
    id: row.bucket,
    label: `${row.bucket} boks`,
    value: row.readers,
    unit: "",
  }));

  return (
    <div className="studio-overview">
      {status && <p className="panel p-4 text-sm text-[var(--muted-foreground)]">{status}</p>}

      {overview && (
        <>
          <section className="studio-pulse" aria-label={`Reading in the last ${days} days`}>
            <span className="studio-eyebrow">Last {days} days</span>
            <strong>{minutesPerReader} <i>min</i></strong>
            <p>of foreground reading per reader</p>
            <div><span>{readers?.active ?? 0} active readers</span><span>{readers?.returning ?? 0} of {readers?.previousActive ?? 0} returned</span></div>
          </section>
          <div className="studio-overview-shortcuts">
            <select aria-label="Overview period" className="field-control" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option>
            </select>
            <Button variant="outline" onClick={() => onNavigate("guests")}>Guests</Button>
            <Button variant="outline" onClick={() => onNavigate("growth")}>Growth</Button>
          </div>
          <section className="studio-overview-links" aria-label="Studio work">
            <h2>Needs review</h2>
            <button type="button" onClick={() => onNavigate("moderation")}><span><strong>Review queue</strong><small>{supply?.pending ?? 0} boks waiting · median review {supply?.medianReviewHours ?? 0} h</small></span><ArrowRight /></button>
            <button type="button" onClick={() => onNavigate("rights")}><span><strong>Rights & reports</strong><small>Reader reports and rights to confirm</small></span><ArrowRight /></button>
            <h2>Sections</h2>
            <button type="button" onClick={() => onNavigate("content")}><span><strong>Editorial</strong><small>Content, catalogue and publication</small></span><ArrowRight /></button>
            <button type="button" onClick={() => onNavigate("people")}><span><strong>People</strong><small>Accounts and reader feedback</small></span><ArrowRight /></button>
            <button type="button" onClick={() => onNavigate("experiments")}><span><strong>Research lab</strong><small>Experiments and reading formats</small></span><ArrowRight /></button>
          </section>
          <details className="studio-details">
            <summary>Reading & measurement details <span aria-hidden="true">+</span></summary>
            <div className="studio-details-body">
            <Button variant="outline" onClick={() => refresh(days)} disabled={busy}><RefreshCw className="size-4" /> Refresh measurements</Button>
          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Do readers come back?</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              The number that decides whether this survives. Everything else is diagnosis.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <BigNumber label={`Returning from the previous ${days} days`} value={`${returningRate}%`} note={`${readers?.returning ?? 0} of ${readers?.previousActive ?? 0}`} />
              <BigNumber label="Active readers" value={String(readers?.active ?? 0)} note={`${readers?.new ?? 0} new`} />
              <BigNumber label="Sessions per reader" value={String(sessionsPerReader)} note={`${reading?.sessions ?? 0} sessions`} />
              <BigNumber label="Minutes per reader" value={String(minutesPerReader)} note={`${minutes} minutes read in total`} />
            </div>
            <MetricNote
              label="Returning readers"
              is={<>The share of last period&apos;s readers who read again in this one.</>}
              how={
                <>
                  A reader counts as active in a period if they produced at least one reading event
                  in it. Returning is the intersection of the two periods, over the size of the
                  earlier one. Both periods are the length selected above.
                </>
              }
              not={
                <>
                  Not retention of everyone who ever signed up, and not comparable across window
                  lengths - a 30-day window returns a higher share than a 7-day one by
                  construction, because it gives people longer to come back.
                </>
              }
            />
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Reading time, decomposed</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Minutes alone would reward long boks and slow readers, so they are never shown alone.
              A rise here should come with more sessions or more boks finished, not just longer ones.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <BigNumber label="Minutes per session" value={String(minutesPerSession)} note="" />
              <BigNumber label="Boks finished" value={String(reading?.boksCompleted ?? 0)} note={`${reading?.boksStarted ?? 0} started`} />
              <BigNumber label="Active minutes per boks finished" value={String(minutesPerBok)} note="all reading, finished or not" />
              <BigNumber label="Finished after starting" value={`${reading?.boksStarted ? Math.round(((reading.boksCompleted ?? 0) / reading.boksStarted) * 100) : 0}%`} note="" />
            </div>
            <MetricNote
              label="Reading time"
              is={<>How much actual reading happened, split so no single number can be gamed.</>}
              how={
                <>
                  Only seconds a boks was on screen and in the foreground are counted: the clock
                  stops on a locked phone or a hidden tab, each gap is capped at 120 seconds, and
                  the total per boks is rolled up with a maximum rather than a sum so a repeated
                  heartbeat cannot inflate it. Finished means the reader reached 85% of the text and
                  spent at least 40% of the time the word count implies at 238 words a minute, or
                  stayed 70% of that time without reaching the end; a piece that fits on one screen
                  is finished on 40% of the time alone. &ldquo;Active minutes per boks
                  finished&rdquo; divides all reading time - skipped and unfinished reads included -
                  by the boks finished: it is what one finish costs in attention, not how long a
                  finished boks takes.
                </>
              }
              not={
                <>
                  Not time-on-site and not a rate to maximise. Minutes rise if boks get longer or
                  readers get slower, which is why they are never shown without sessions and boks
                  finished beside them.
                </>
              }
            />
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Do they read more than one?</h3>
            <p className="mt-1 mb-4 text-sm text-[var(--muted-foreground)]">
              Readers grouped by how many boks they opened. An average would hide a split between
              one-and-done and regulars, and that split is the product question.
            </p>
            {distribution.length ? (
              <MetricBars
                rows={distribution}
                highlightBest={false}
                caption={`Readers by boks opened, last ${days} days.`}
              />
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No reads in this window yet.</p>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="panel p-5">
              <h3 className="text-lg font-semibold tracking-normal">Is there enough to read?</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                A feed starves before it mis-ranks. When readers have seen most of the catalog there
                is nothing left to recommend them, whichever algorithm is running.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <BigNumber label="Published boks" value={String(catalog?.published ?? 0)} note={`${catalog?.publishedRecently ?? 0} added in 30 days`} />
                <BigNumber label="Readers past half the catalog" value={String(catalog?.readersPastHalf ?? 0)} note={`median reader has seen ${catalog?.medianSeenShare ?? 0}%`} />
                <BigNumber label="Submitted" value={String(supply?.submitted ?? 0)} note={`${supply?.approved ?? 0} approved, ${supply?.refused ?? 0} refused`} />
                <BigNumber label="Waiting for review" value={String(supply?.pending ?? 0)} note={`median review ${supply?.medianReviewHours ?? 0}h`} />
              </div>
              <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                {supply?.activeAuthors ?? 0} author{(supply?.activeAuthors ?? 0) === 1 ? "" : "s"} submitted in the last 30 days.
              </p>
              <MetricNote
                label="Catalogue headroom"
                is={<>Whether there is still material left for the feed to recommend.</>}
                how={
                  <>
                    A reader has &ldquo;seen&rdquo; a boks once it was served to them, counted from
                    impression events. The median share is over readers active in the window, and
                    the headroom count is readers past half the published catalogue.
                  </>
                }
                not={
                  <>
                    Not a measure of how good the catalogue is. A reader can exhaust it while
                    enjoying none of it - that question lives in Content and in the experiment.
                  </>
                }
              />
            </section>

            <section className="panel p-5">
              <h3 className="text-lg font-semibold tracking-normal">Can these numbers be trusted?</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Measured rather than assumed. This console was confidently wrong for weeks because
                nothing checked whether its inputs made sense.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <BigNumber label="Reads with a recorded outcome" value={`${outcomeRate}%`} note={`${quality?.readsWithOutcome ?? 0} of ${quality?.reads ?? 0}`} />
                <BigNumber label="Sessions ending with no outcome" value={String(quality?.sessionsWithoutOutcome ?? 0)} note={`of ${quality?.sessions ?? 0} sessions`} />
                <BigNumber label="Events with no algorithm" value={String(quality?.unattributedEvents ?? 0)} note="cannot be compared" />
                <BigNumber label="Outcomes with no reading time" value={String(quality?.outcomesWithoutTime ?? 0)} note="clock never started" />
              </div>
            </section>
          </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function BigNumber({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-tile">
      <p>{label}</p>
      <strong>{value}</strong>
      {note && <small className="mt-1 block text-xs text-[var(--muted-foreground)]">{note}</small>}
    </div>
  );
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
