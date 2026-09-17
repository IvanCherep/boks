"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoksGrowth } from "@/components/boks/client-types";
import { loadBoksGrowth } from "@/components/boks/supabase-browser-data";
import { TimeSeriesBars } from "@/components/boks/admin/metric-bars";
import { RetentionTriangle } from "@/components/boks/admin/retention-triangle";

/**
 * The trajectory. What someone from outside asks first: are readers arriving,
 * do they come back, and is the catalog keeping up with them.
 *
 * Everything plotted weekly here is a count or a total. Those are honest at any
 * sample size. Rates are shown only where their denominator is printed beside
 * them, because a percentage off a dozen readers moves several points when one
 * person changes their mind.
 */
export function AdminGrowth() {
  const [growth, setGrowth] = useState<BoksGrowth | null>(null);
  const [weeks, setWeeks] = useState(12);
  const [status, setStatus] = useState("Loading...");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (nextWeeks: number) => {
    setBusy(true);
    try {
      const payload = await loadBoksGrowth(nextWeeks);
      setGrowth(payload);
      setStatus(
        payload
          ? ""
          : "This Supabase project does not have the growth function yet. Apply supabase/migrations/20260912200000_boks_growth_and_cohorts.sql."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load growth.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(weeks).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [weeks, refresh]);

  const weekly = growth?.weekly ?? [];
  const points = (key: "newReaders" | "activeReaders" | "signups" | "minutes" | "sessions" | "boksFinished" | "boksPublished") =>
    weekly.map((row) => ({ label: shortWeek(row.week), value: row[key] }));

  const activation = growth?.activation;
  const stickiness = growth?.stickiness;
  const totals = growth?.totals;
  const stickinessRatio = stickiness?.monthly ? Math.round((stickiness.daily / stickiness.monthly) * 100) : 0;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm leading-6 text-[var(--muted-foreground)]">
          Weekly counts from attributed reader events. Only totals are plotted over time - a rate
          drawn weekly off a handful of readers would show trends that are not there.
        </p>
        <div className="flex gap-2">
          <select className="field-control w-[150px]" value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}>
            <option value={8}>Last 8 weeks</option>
            <option value={12}>Last 12 weeks</option>
            <option value={26}>Last 26 weeks</option>
          </select>
          <Button variant="outline" onClick={() => refresh(weeks)} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
      </div>

      {status && <p className="panel p-4 text-sm text-[var(--muted-foreground)]">{status}</p>}

      {growth && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Tile label="Readers all time" value={totals?.readers ?? 0} note={`${totals?.accounts ?? 0} with accounts`} />
            <Tile label="Minutes read all time" value={totals?.minutes ?? 0} note={`${totals?.boksFinished ?? 0} boks finished`} />
            <Tile label="Readers today" value={stickiness?.daily ?? 0} note={`${stickiness?.weekly ?? 0} this week`} />
            <Tile label="Readers this month" value={stickiness?.monthly ?? 0} note={`${stickinessRatio}% of them read today`} />
            <Tile label="Published boks" value={totals?.publishedBoks ?? 0} note="the catalog readers draw from" />
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Are readers arriving?</h3>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <TimeSeriesBars points={points("newReaders")} caption="New readers per week" />
              <TimeSeriesBars points={points("signups")} caption="Accounts created per week" />
            </div>
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Are they reading?</h3>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <TimeSeriesBars points={points("minutes")} caption="Minutes read per week" unit="m" />
              <TimeSeriesBars points={points("activeReaders")} caption="Active readers per week" />
              <TimeSeriesBars points={points("sessions")} caption="Reading sessions per week" />
              <TimeSeriesBars points={points("boksFinished")} caption="Boks finished per week" />
            </div>
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Do they come back?</h3>
            <p className="mt-1 mb-4 text-sm leading-6 text-[var(--muted-foreground)]">
              Each row is the readers who arrived in that week, and how many were still reading in
              the weeks after. Cohort size is printed beside every row: a percentage off four
              readers is one person changing their mind, and that should be visible.
            </p>
            <RetentionTriangle cohorts={growth.cohorts} />
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Does a new reader get anywhere?</h3>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
              Of the {activation?.newReaders ?? 0} readers who arrived in the last 30 days. A reader
              who never finishes a boks has not experienced the product at all.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Arrived" value={activation?.newReaders ?? 0} note="last 30 days" />
              <Tile
                label="Finished at least one"
                value={activation?.finishedOne ?? 0}
                note={share(activation?.finishedOne, activation?.newReaders)}
              />
              <Tile
                label="Finished three or more"
                value={activation?.finishedThree ?? 0}
                note={share(activation?.finishedThree, activation?.newReaders)}
              />
              <Tile
                label="Created an account"
                value={activation?.signedUp ?? 0}
                note={share(activation?.signedUp, activation?.newReaders)}
              />
            </div>
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">Is supply keeping up?</h3>
            <p className="mt-1 mb-4 text-sm leading-6 text-[var(--muted-foreground)]">
              A reading feed starves before it mis-ranks. If boks published per week sits below what
              readers consume, the catalog runs out however good the algorithm is.
            </p>
            <TimeSeriesBars points={points("boksPublished")} caption="Boks published per week" />
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="metric-tile">
      <p>{label}</p>
      <strong>{value}</strong>
      {note && <small className="mt-1 block text-xs text-[var(--muted-foreground)]">{note}</small>}
    </div>
  );
}

function share(part: number | undefined, whole: number | undefined) {
  if (!whole || part === undefined) return "";
  return `${Math.round((part / whole) * 100)}% of arrivals`;
}

function shortWeek(week: string) {
  const date = new Date(`${week}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
