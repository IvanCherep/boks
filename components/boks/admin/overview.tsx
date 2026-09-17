"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoksOverview } from "@/components/boks/client-types";
import { loadBoksOverview } from "@/components/boks/supabase-browser-data";
import { MetricBars, type MetricBarRow } from "@/components/boks/admin/metric-bars";
import { MetricNote } from "@/components/boks/admin/metric-note";

/**
 * The weekly page.
 *
 * Only numbers that change a decision. No composite scores, no rate whose
 * denominator is a guess, and no algorithm comparison - that lives in
 * Experiments, and at a small catalog it has nothing to say.
 */
export function AdminOverview() {
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
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
          Everything here is measured from attributed reader events. Reading time counts only the
          seconds a boks was actually on screen.
        </p>
        <div className="flex gap-2">
          <select className="field-control w-[150px]" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <Button variant="outline" onClick={() => refresh(days)} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {status && <p className="panel p-4 text-sm text-[var(--muted-foreground)]">{status}</p>}

      {overview && (
        <>
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
              <BigNumber label="Minutes per finished boks" value={String(minutesPerBok)} note="" />
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
                  spent at least half the time the word count implies at 238 words a minute.
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
