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
  const [weeks, setWeeks] = useState(8);
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

  return <div className="studio-growth">
    {status && <p className="studio-notice" role="status">{status}</p>}
    {growth && <>
      <section className="studio-metric-pair"><Tile label="readers, all time" value={totals?.readers ?? 0} note="" /><Tile label="accounts, all time" value={totals?.accounts ?? 0} note="" /><Tile label="minutes read" value={totals?.minutes ?? 0} note="" /><Tile label="boks read" value={totals?.boksFinished ?? 0} note="" /></section>
      <section className="studio-editorial-section"><h2>Are readers arriving?</h2><TimeSeriesBars points={points("newReaders")} caption={`New readers per week · last ${weeks} weeks`} /><div className="studio-filter-line"><select aria-label="Growth period" className="field-control" value={weeks} onChange={(event) => setWeeks(Number(event.target.value))}><option value={8}>Last 8 weeks</option><option value={12}>Last 12 weeks</option><option value={26}>Last 26 weeks</option></select><Button variant="ghost" onClick={() => refresh(weeks)} disabled={busy}><RefreshCw /> Refresh</Button></div></section>
      <section className="studio-editorial-section"><h2>Do they come back?</h2>{growth.cohorts.length ? <table className="studio-retention"><thead><tr><th>Arrival week</th><th>Readers</th>{[1,2,3].map(offset=><th key={offset}>W{offset}</th>)}</tr></thead><tbody>{growth.cohorts.map(cohort=><tr key={cohort.week}><td>{shortWeek(cohort.week)}</td><td>{cohort.size}</td>{[1,2,3].map(offset=><td key={offset}>{cohort.retained.find(entry=>entry.offset===offset)?.readers ?? "—"}</td>)}</tr>)}</tbody></table> : <p className="studio-meta">No reader cohorts yet.</p>}<p className="studio-meta">Returning readers, with the arrival cohort beside them. Weeks that have not elapsed stay blank.</p>{growth.daySeven && <div className="studio-metric-pair"><Tile label="Returned on day 7" value={growth.daySeven.returned} note={growth.daySeven.eligible ? `${Math.round((growth.daySeven.returned / growth.daySeven.eligible) * 100)}% of ${growth.daySeven.eligible} who first read 7–90 days ago` : "nobody first read 7–90 days ago yet"} /></div>}</section>
      <details className="studio-details"><summary>Reading, activation & supply <span>＋</span></summary><div className="studio-details-body">
        <div className="studio-metric-pair"><Tile label="Readers today" value={stickiness?.daily ?? 0} note={`${stickiness?.weekly ?? 0} this week`} /><Tile label="Readers this month" value={stickiness?.monthly ?? 0} note={`${stickinessRatio}% of them read today`} /><Tile label="Published boks" value={totals?.publishedBoks ?? 0} note="The catalogue readers draw from" /></div>
        <TimeSeriesBars points={points("signups")} caption="Accounts created per week" /><TimeSeriesBars points={points("minutes")} caption="Minutes read per week" unit="m" /><TimeSeriesBars points={points("activeReaders")} caption="Active readers per week" /><TimeSeriesBars points={points("sessions")} caption="Reading sessions per week" /><TimeSeriesBars points={points("boksFinished")} caption="Boks read per week" />
        <h3>First 30 days</h3><div className="studio-metric-pair"><Tile label="Arrived" value={activation?.newReaders ?? 0} note="last 30 days" /><Tile label="Read at least one" value={activation?.finishedOne ?? 0} note={share(activation?.finishedOne,activation?.newReaders)} /><Tile label="Read three or more" value={activation?.finishedThree ?? 0} note={share(activation?.finishedThree,activation?.newReaders)} /><Tile label="Created an account" value={activation?.signedUp ?? 0} note={share(activation?.signedUp,activation?.newReaders)} /></div>
        <TimeSeriesBars points={points("boksPublished")} caption="Boks published per week" /><h3>Full cohort rates</h3><RetentionTriangle cohorts={growth.cohorts} /><p className="studio-meta">Each rate uses its arrival cohort as the denominator. All reading time comes from foreground activity.</p>
      </div></details>
    </>}
  </div>;
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
