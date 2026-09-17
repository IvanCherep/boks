"use client";

import { MetricNote } from "@/components/boks/admin/metric-note";
import type { LabCohort } from "@/lib/boks/recommendations/metrics";
import type { SampleSizeCurve } from "@/lib/recsys/statistics/sample-size";

/**
 * When will this experiment be able to answer anything?
 *
 * The rest of the console reports what happened. This reports what the data
 * can and cannot resolve, which at small sample sizes is the more useful of
 * the two and the one that gets skipped. Two readings:
 *
 *   * the **observed** rows replay the same estimator on the first k readers
 *     of each arm, so the narrowing interval - and any early result that later
 *     flipped - is visible rather than asserted;
 *   * the **projected** rows hold the spread measured so far and ask what a
 *     larger sample would buy. A plan, not a forecast, and labelled so.
 *
 * It is also the screen to show someone who asks how the product knows
 * anything: it states the sample, the precision, and what is out of reach.
 */

function percentLabel(value: number | null) {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

function secondsLabel(value: number | null) {
  if (value === null) return "—";
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 90) return `${rounded}s`;
  return `${(rounded / 60).toFixed(1)}m`;
}

const statusLabel: Record<string, string> = {
  positive: "resolved, variant ahead",
  negative: "resolved, variant behind",
  inconclusive: "not resolved",
  insufficient_data: "below the minimum",
};

export function SampleSizePanel({
  curve,
  cohorts,
  minimumReadersPerArm,
}: {
  curve: SampleSizeCurve | null;
  cohorts: LabCohort[];
  minimumReadersPerArm: number;
}) {
  if (!curve) {
    return (
      <section className="panel p-5">
        <h3 className="text-lg font-semibold tracking-normal">How much data do we need?</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          Nothing to size yet. This fills in once the split has a control arm and one variant with
          readers in both.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="panel p-5">
        <h3 className="text-lg font-semibold tracking-normal">How much data do we need?</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6">{curve.readout}</p>
        <MetricNote
          label="Sample size and detectable effect"
          is={
            <>
              The size of difference this experiment can currently see on{" "}
              <strong>{curve.metric}</strong>, and the size it would need to see a smaller one.
            </>
          }
          how={
            <>
              Readers are the unit. The spread of the metric across readers is{" "}
              {curve.coefficientOfVariation} (standard deviation over mean), and power is simulated
              at that spread for each sample size. The observed rows re-run the same estimator -
              Hodges–Lehmann shift with a percentile bootstrap interval - on the first k readers of
              each arm, in arrival order.
            </>
          }
          not={
            <>
              Not a forecast of the result. A curve that wanders and then settles is the normal
              shape of a small experiment, and the last observed row is today, not a trend. A
              &ldquo;not resolved&rdquo; row means the data cannot tell, which is different from the
              arms being equal.
            </>
          }
        />

        <div className="mt-4 overflow-x-auto">
          <table className="stat-table">
            <thead>
              <tr>
                <th>Readers per arm</th>
                <th>Effect</th>
                <th>Interval</th>
                <th>± precision</th>
                <th>Smallest visible</th>
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {curve.observed.map((step) => (
                <tr key={`observed-${step.readersPerArm}`}>
                  <td>
                    {step.readersPerArm}
                    {step.readersPerArm === curve.readersPerArmNow && (
                      <span className="admin-pill">today</span>
                    )}
                  </td>
                  <td>{secondsLabel(step.effect)}</td>
                  <td>
                    {step.ci ? `${secondsLabel(step.ci[0])} … ${secondsLabel(step.ci[1])}` : "—"}
                  </td>
                  <td>{secondsLabel(step.precision)}</td>
                  <td>{percentLabel(step.minimumDetectableEffect)}</td>
                  <td className="text-[var(--muted-foreground)]">
                    {statusLabel[step.status] ?? step.status}
                  </td>
                </tr>
              ))}
              {curve.projected.map((step) => (
                <tr key={`projected-${step.readersPerArm}`} className="stat-row-planned">
                  <td>
                    {step.readersPerArm}
                    <span className="admin-pill">planned</span>
                  </td>
                  <td colSpan={3} className="text-[var(--muted-foreground)]">
                    not measured yet
                  </td>
                  <td>{percentLabel(curve.targetEffect)} target</td>
                  <td className="text-[var(--muted-foreground)]">
                    {percentLabel(step.power)} chance of seeing it
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          A comparison is refused below {minimumReadersPerArm} readers per arm rather than shown
          with a wide interval, because a number on a screen gets quoted and an interval does not.
          {curve.readersNeededForTargetEffect
            ? ` Resolving a ${percentLabel(curve.targetEffect)} difference needs about ${curve.readersNeededForTargetEffect} readers per arm.`
            : ""}
        </p>
      </div>

      {cohorts.length > 0 && (
        <div className="panel p-5">
          <h3 className="text-lg font-semibold tracking-normal">Does it differ for new readers?</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
            The same comparison, computed separately for readers in their first week and for
            everyone older. A pooled estimate hides the case where an arm helps one group and hurts
            the other: two real effects of opposite sign average to nothing and the arm looks inert.
          </p>
          <MetricNote
            label="Cohort split"
            is={<>Whether the arms differ for newcomers and for readers who have stayed.</>}
            how={
              <>
                Each reader&apos;s tenure is the days between their first ever read and the day of
                the row being counted, so &ldquo;first week&rdquo; is a property of when they read,
                not of when the window opens. Rows are split on that and the reader-level
                comparison is re-run on each side.
              </>
            }
            not={
              <>
                Not a subgroup finding. Splitting halves the readers in each arm, so both sides are
                underpowered long before the pooled comparison is. Read it as a reason to look, and
                to keep the split in mind when the sample is big enough to decide.
              </>
            }
          />

          <div className="mt-4 overflow-x-auto">
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Readers</th>
                  <th>Control</th>
                  <th>Variant</th>
                  <th>Effect</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((cohort) => (
                  <tr key={cohort.id}>
                    <td>{cohort.label}</td>
                    <td>{cohort.readers}</td>
                    <td>{cohort.comparison ? secondsLabel(cohort.comparison.controlValue) : "—"}</td>
                    <td>{cohort.comparison ? secondsLabel(cohort.comparison.variantValue) : "—"}</td>
                    <td>
                      {cohort.comparison && cohort.comparison.status !== "insufficient_data"
                        ? secondsLabel(cohort.comparison.effect)
                        : "—"}
                    </td>
                    <td className="text-[var(--muted-foreground)]">
                      {cohort.comparison
                        ? (statusLabel[cohort.comparison.status] ?? cohort.comparison.status)
                        : "no readers"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
