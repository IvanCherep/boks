"use client";

import { MetricNote } from "@/components/boks/admin/metric-note";
import type { SlatePositionRow } from "@/components/boks/client-types";

/**
 * Reading by slate position.
 *
 * Two arms can produce the same completion rate for opposite reasons: one
 * retrieves better pieces and puts them anywhere, the other retrieves the same
 * pieces and orders them so the reader meets the right one first. Those are
 * different claims about a recommender and a pooled rate cannot tell them
 * apart. This table can.
 *
 * It is also the only screen that looks at the feed as a *sequence* rather
 * than as a set, which is what the ranking actually produces.
 */

function ratio(numerator: number, denominator: number) {
  if (!denominator) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function minutesLabel(seconds: number) {
  if (!seconds) return "—";
  if (seconds < 90) return `${seconds}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function PositionEffects({ rows }: { rows: SlatePositionRow[] }) {
  const algorithms = [...new Set(rows.map((row) => row.algorithmId))].sort();

  return (
    <section className="panel p-5">
      <h3 className="text-lg font-semibold tracking-normal">Where in the feed does reading happen?</h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
        The feed is a sequence, not a set. If an arm wins, this says whether it
        won by finding better pieces or by putting them earlier - and whether
        readers are reaching the back of the slate at all.
      </p>

      <MetricNote
        label="Slate position"
        is={
          <>
            Reading grouped by the position a piece held in the slate it was served from, for each
            arm.
          </>
        }
        how={
          <>
            Every event carries the rank of the piece within its serve. Positions are bucketed -
            the first three separately, then 4–5, 6–10 and beyond - because a reader rarely goes
            past ten and a row per rank would be mostly noise. Reading time is taken per
            (session, piece) with a maximum before it is summed, the same rule the reader outcomes
            use.
          </>
        }
        not={
          <>
            Not a per-reader comparison, and not a verdict. These are pooled counts: a reader who
            reads twice as much counts twice, so they describe the arm rather than testing it.
            Every verdict on this page is computed per reader.
          </>
        }
      />

      {!rows.length ? (
        <p className="mt-4 text-sm text-[var(--muted-foreground)]">
          No ranked events in this window yet. This fills in as soon as readers are served a slate.
        </p>
      ) : (
        <div className="mt-4 grid gap-5">
          {algorithms.map((algorithmId) => (
            <div key={algorithmId}>
              <h4 className="text-sm font-semibold">{algorithmId}</h4>
              <div className="mt-2 overflow-x-auto">
                <table className="stat-table">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th>Readers</th>
                      <th>Served</th>
                      <th>Started</th>
                      <th>Finished of started</th>
                      <th>Reactions</th>
                      <th>Reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .filter((row) => row.algorithmId === algorithmId)
                      .map((row) => (
                        <tr key={`${algorithmId}-${row.position}`}>
                          <td>{row.position}</td>
                          <td>{row.readers}</td>
                          <td>{row.impressions}</td>
                          <td>{ratio(row.starts, row.impressions)}</td>
                          <td>{ratio(row.completes, row.starts)}</td>
                          <td>{row.reactions}</td>
                          <td>{minutesLabel(row.activeSeconds)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
