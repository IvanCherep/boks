"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FlaskConical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  RecommendationDataQuality,
  RecommendationLabPayload,
  SlatePositionRow,
} from "@/components/boks/client-types";
import { secondsLabel } from "@/components/boks/client-format";
import { ExperimentEditor } from "@/components/boks/admin/experiment-editor";
import { MetricBars, type MetricBarRow } from "@/components/boks/admin/metric-bars";
import { SampleSizePanel } from "@/components/boks/admin/sample-size-panel";
import { MetricNote } from "@/components/boks/admin/metric-note";
import { PositionEffects } from "@/components/boks/admin/position-effects";
import { readerOutcomesToCsv, readerOutcomesReadme } from "@/lib/recsys/aggregate";
import { MetricTile } from "@/components/boks/shared-ui";
import {
  loadRecommendationCandidates,
  loadRecommendationLab,
  loadSlatePositionEffects,
  saveActiveExperimentConfig,
} from "@/components/boks/supabase-browser-data";
import {
  defaultExperimentConfig,
  describeRecommendationStrategies,
  emptyRecommendationLab,
  findComparison,
  measureStrategyDivergence,
  type ArmSummary,
  type DivergenceReport,
  type RecommendationExperimentConfig,
  type RecommendationLabReport,
} from "@/lib/boks/recommendations";
import {
  readerMetric,
  type AlgorithmComparison,
  type ReaderMetricId,
} from "@/lib/recsys/aggregate";

const labMetricOptions: { id: ReaderMetricId; help: string }[] = [
  {
    id: "active_seconds",
    help: "Foreground reading seconds per reader over the window. The north star, and the only metric a ranker can move without moving a rate somewhere else.",
  },
  {
    id: "boks_opened",
    help: "Distinct boks each reader opened. Answers whether ranking earns a second read, which is the whole product thesis.",
  },
  {
    id: "completion_rate",
    help: "Completions over starts, per reader. Readers with fewer than five starts are excluded: a rate over two starts is noise wearing a percentage sign.",
  },
  {
    id: "skip_rate",
    help: "Skips over starts, per reader. Lower is better.",
  },
];

const emptyLab: RecommendationLabPayload = {
  experiment: defaultExperimentConfig,
  report: emptyRecommendationLab,
  outcomes: [],
  assignments: [],
  topStories: [],
  dataQuality: null,
  available: true,
  notice: "",
};

/**
 * Side-by-side comparison of the algorithms that have served traffic.
 *
 * Two rules govern everything on this screen. The analysis unit is the reader,
 * stated on the page rather than implied. And no number is shown without what
 * it was computed from — sample size, interval, and what this sample could have
 * detected if it were real.
 */
export function RecommendationLab() {
  const [experimentNotice, setExperimentNotice] = useState("");
  const [lab, setLab] = useState<RecommendationLabPayload>(emptyLab);
  const [metric, setMetric] = useState<ReaderMetricId>("active_seconds");
  const [days, setDays] = useState(30);
  const [status, setStatus] = useState("Loading recommendation results...");
  const [busy, setBusy] = useState(false);
  const [positions, setPositions] = useState<SlatePositionRow[]>([]);
  const [divergence, setDivergence] = useState<DivergenceReport | null>(null);

  const refresh = useCallback(async (nextDays: number) => {
    setBusy(true);
    try {
      const payload = await loadRecommendationLab(nextDays);
      // Loaded beside the lab rather than inside it: it is an aggregate over
      // events, not part of the reader-level comparison, and keeping them
      // separate stops one becoming a denominator for the other.
      setPositions(await loadSlatePositionEffects(nextDays, payload.experiment.key));
      setLab(payload);

      // Before reading any comparison, check the algorithms are even producing
      // different feeds on the catalog as it stands today.
      try {
        const candidates = await loadRecommendationCandidates(400);
        const liveArms = payload.experiment.arms.filter((arm) => arm.weight > 0).map((arm) => arm.algorithmId);
        setDivergence(
          measureStrategyDivergence({
            candidates,
            algorithmIds: liveArms.length > 1 ? liveArms : undefined,
          })
        );
      } catch {
        setDivergence(null);
      }

      setStatus(
        payload.available
          ? payload.report.arms.length
            ? ""
            : "No attributed reads yet. Ask testers to read from the feed, then refresh."
          : payload.notice
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load recommendation results.");
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

  const report = lab.report;
  const definition = readerMetric(metric);
  const selectedHelp = labMetricOptions.find((option) => option.id === metric)?.help ?? "";
  const variantArms = report.arms.filter((arm) => !arm.isControl);

  const barRows: MetricBarRow[] = report.arms.map((arm) => ({
    id: arm.algorithmId,
    label: arm.algorithmName,
    sublabel: `${arm.readers} reader${arm.readers === 1 ? "" : "s"}${arm.isControl ? " · control" : ""}`,
    value: armValue(arm, metric),
    unit: definition.unit === "rate" ? "%" : definition.unit === "seconds" ? "s" : "",
    note: arm.readiness.ready ? undefined : `needs ${arm.readiness.required - arm.readiness.readers} more readers`,
    muted: !arm.readiness.ready,
  }));

  function exportLab() {
    const payload = {
      exportedAt: new Date().toISOString(),
      windowDays: days,
      experiment: lab.experiment,
      strategies: describeRecommendationStrategies(),
      report: lab.report,
      dataQuality: lab.dataQuality,
      assignments: lab.assignments,
      topStories: lab.topStories,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `boks-recommendation-lab-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * The rows the comparison was computed from, so it can be recomputed
   * elsewhere. Two files: the table, and a note saying what the table is and
   * which mistake not to make with it.
   */
  function exportOutcomes() {
    const readers = new Set(lab.outcomes.map((row) => row.userId)).size;
    const stamp = new Date().toISOString().slice(0, 10);

    const files: Array<[string, string, string]> = [
      [`boks-reader-outcomes-${stamp}.csv`, readerOutcomesToCsv(lab.outcomes), "text/csv"],
      [
        `boks-reader-outcomes-${stamp}.txt`,
        readerOutcomesReadme({
          windowDays: days,
          experimentKey: lab.experiment.key,
          controlAlgorithmId: lab.report.controlAlgorithmId,
          rows: lab.outcomes.length,
          readers,
        }),
        "text/plain",
      ],
    ];

    for (const [name, body, type] of files) {
      const url = URL.createObjectURL(new Blob([body], { type }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    }
  }

  async function saveExperiment(config: RecommendationExperimentConfig) {
    await saveActiveExperimentConfig(config);
    setExperimentNotice("Saved. New readers are assigned with the updated split.");
    await refresh(days);
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] p-4">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-normal">
            <FlaskConical className="size-5 text-[var(--primary)]" /> Recommendation lab
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--muted-foreground)]">
            Experiment <strong>{lab.experiment.key}</strong> · control{" "}
            <strong>{report.controlAlgorithmId}</strong> · one reader is one sample, and an arm is
            compared once it holds {report.minimumReadersPerArm} of them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className="field-control w-[150px]" value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button variant="outline" onClick={() => refresh(days)} disabled={busy}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={exportLab}>
            <Download className="size-4" /> Export comparison
          </Button>
          <Button variant="outline" onClick={exportOutcomes} disabled={!lab.outcomes.length}>
            <Download className="size-4" /> Export reader rows
          </Button>
        </div>
      </div>

      {status && (
        <p className={`px-4 pt-4 text-sm ${lab.available ? "text-[var(--muted-foreground)]" : "text-[var(--destructive)]"}`}>
          {status}
        </p>
      )}

      <div className="grid gap-5 p-4">
        {divergence && (
          <div className={`divergence divergence--${divergence.verdict}`}>
            <p className="text-sm font-semibold">
              {divergence.verdict === "indistinguishable"
                ? "These algorithms are not distinguishable yet"
                : divergence.verdict === "weak"
                  ? "These algorithms only partly differ"
                  : "These algorithms produce genuinely different feeds"}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{divergence.summary}</p>
            {divergence.verdict !== "usable" && (
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                Everything below is still measured honestly - it just cannot separate arms that are
                serving the same boks. Catalog size is the constraint, not sample size.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricTile label="Readers measured" value={report.totals.readers} />
          <MetricTile label="Sessions" value={report.totals.sessions} />
          <MetricTile label="Active reading" value={secondsLabel(report.totals.activeSeconds)} />
          <MetricTile
            label="Events with a feed"
            value={`${percent(report.totals.attributedEvents, report.totals.events)}%`}
          />
          <MetricTile label="Readers in both arms" value={report.totals.crossedReaders} />
        </div>

        <MetricNote
          label="What this experiment measures and on whom"
          is={
            <>
              A comparison between the ranking algorithms serving the feed, computed on readers -
              one reader is one observation, whatever they did.
            </>
          }
          how={
            <>
              Every reader is assigned to one arm and stays in it. Their events are totalled over
              the window into one value per metric, and the two arms&apos; reader-level values are
              compared with a Hodges–Lehmann shift, a percentile bootstrap interval and a
              permutation test. &ldquo;Events with a feed&rdquo; is the share of events carrying the
              id of the slate that produced them, which is what makes a serve reconstructible.
            </>
          }
          not={
            <>
              Not a comparison over impressions. Events inside one reader are correlated, so a test
              over events reports significance that is not there - this console used to do exactly
              that and called three readers a strong signal. Readers who appear in both arms are
              removed rather than folded in, and counted above so the removal is visible.
            </>
          }
        />

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="grid gap-1 text-sm font-medium">
              Compare on
              <select
                className="field-control w-[240px]"
                value={metric}
                onChange={(event) => setMetric(event.target.value as ReaderMetricId)}
              >
                {labMetricOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {readerMetric(option.id).label}
                  </option>
                ))}
              </select>
            </label>
            <p className="max-w-md text-sm text-[var(--muted-foreground)]">{selectedHelp}</p>
          </div>

          <MetricBars
            rows={barRows}
            lowerIsBetter={definition.lowerIsBetter}
            caption={`Median ${definition.label.toLowerCase()} per reader, last ${days} days. Dimmed arms hold too few readers to compare.`}
          />
        </div>

        {variantArms.map((arm) => (
          <ComparisonReadout
            key={arm.algorithmId}
            comparison={findComparison(report, arm.algorithmId, metric)}
            report={report}
            arm={arm}
          />
        ))}

        <div className="experiment-table">
          <div className="experiment-row experiment-head">
            <span>Algorithm</span>
            <span>Readers</span>
            <span>Sessions</span>
            <span>Median read</span>
            <span>Median boks</span>
            <span>Completion</span>
            <span>Skip</span>
            <span>Reaction</span>
          </div>
          {report.arms.length ? (
            report.arms.map((arm) => (
              <div className="experiment-row" key={arm.algorithmId}>
                <span>
                  <strong>{arm.algorithmName}</strong>
                  <small>
                    {arm.algorithmId}
                    {arm.isControl ? " · control" : ""}
                  </small>
                </span>
                <span>{arm.readers}</span>
                <span>{arm.sessions}</span>
                <span>{secondsLabel(arm.medianActiveSeconds)}</span>
                <span>{arm.medianBoksOpened}</span>
                <span>{arm.completionRate}%</span>
                <span>{arm.skipRate}%</span>
                <span>{arm.reactionRate}%</span>
              </div>
            ))
          ) : (
            <div className="p-4 text-sm text-[var(--muted-foreground)]">
              No algorithm-attributed reads in this window.
            </div>
          )}
        </div>
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
          The four rates in this table are pooled over each arm&apos;s events, so a reader who reads
          twice as much counts twice. They describe the arm; they are never the basis of a verdict.
          Every verdict above is computed per reader.
        </p>

        <SampleSizePanel
          curve={report.sampleSize}
          cohorts={report.cohorts}
          minimumReadersPerArm={report.minimumReadersPerArm}
        />

        <PositionEffects rows={positions} />

        <DataQualityPanel quality={lab.dataQuality} />

        <div className="grid gap-3 border-t border-[var(--border)] pt-4">
          <div>
            <h3 className="text-lg font-semibold tracking-normal">Traffic split</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Readers never choose an algorithm. This decides how they are assigned, and the assignment stays stable for
              each reader so one tester never bounces between variants.
            </p>
          </div>
          <ExperimentEditor
            key={`${lab.experiment.key}:${lab.experiment.updatedAt ?? "initial"}`}
            config={lab.experiment}
            disabled={!lab.available || busy}
            onSave={saveExperiment}
            notice={experimentNotice}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * One arm against the control, on one metric.
 *
 * Deliberately wordy and deliberately colourless. An interval that spans zero
 * is reported as inconclusive and never as "no difference", and a sample too
 * small to see the effect says so in the same breath as the estimate.
 */
function ComparisonReadout({
  comparison,
  report,
  arm,
}: {
  comparison: AlgorithmComparison | undefined;
  report: RecommendationLabReport;
  arm: ArmSummary;
}) {
  if (!comparison) return null;

  const shortfall = report.minimumReadersPerArm - Math.min(comparison.controlReaders, comparison.variantReaders);

  return (
    <div className="grid gap-2 rounded-[var(--radius)] border border-[var(--border)] p-4">
      <p className="text-sm font-semibold">
        {arm.algorithmName} vs {report.controlAlgorithmId} · {comparison.metric}
      </p>

      {comparison.status === "insufficient_data" ? (
        <p className="text-sm leading-6 text-[var(--muted-foreground)]">
          {comparison.controlReaders} readers on control and {comparison.variantReaders} on this arm.
          Below {report.minimumReadersPerArm} per arm nothing is estimated — {shortfall} more
          reader{shortfall === 1 ? "" : "s"} in the smaller arm before this line says anything.
        </p>
      ) : (
        <>
          <p className="text-sm leading-6">
            <strong>
              {comparison.effect > 0 ? "+" : ""}
              {comparison.effect}
            </strong>{" "}
            {comparison.estimator.startsWith("hodges") ? "shift" : "difference"}, 95% interval{" "}
            <strong>
              [{comparison.ci[0]}, {comparison.ci[1]}]
            </strong>
            {typeof comparison.pValue === "number" ? ` · permutation p = ${comparison.pValue}` : ""}
          </p>
          <p className="text-sm leading-6 text-[var(--muted-foreground)]">
            {comparison.status === "inconclusive"
              ? "The interval spans zero. That is not evidence the arms are the same — it is an absence of evidence either way."
              : comparison.status === "positive"
                ? "The interval excludes zero in the better direction."
                : "The interval excludes zero in the worse direction."}{" "}
            {comparison.controlReaders} vs {comparison.variantReaders} readers
            {comparison.crossedReaders
              ? `, after excluding ${comparison.crossedReaders} who appeared in both arms`
              : ""}
            .
          </p>
          {comparison.power && <PowerLine comparison={comparison} />}
          {comparison.perReaderValues && (
            <p className="text-sm leading-6 text-[var(--muted-foreground)]">
              Control: {comparison.perReaderValues.control.map((value) => Math.round(value)).join(", ")}
              <br />
              Variant: {comparison.perReaderValues.variant.map((value) => Math.round(value)).join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** What this sample could have detected, phrased as a refusal where it must be. */
function PowerLine({ comparison }: { comparison: AlgorithmComparison }) {
  const power = comparison.power;
  if (!power) return null;

  return (
    <p className="text-sm leading-6 text-[var(--muted-foreground)]">
      {power.readersPerArm} readers per arm, spread {power.coefficientOfVariation}.{" "}
      {power.minimumDetectableEffect === null ? (
        <>
          Nothing this sample could show would be reliable — not even a tripling. You are not
          currently running an experiment.
        </>
      ) : (
        <>
          Nothing below{" "}
          <strong>+{Math.round(power.minimumDetectableEffect * 100)}%</strong> is visible at this
          size. A {Math.round(power.targetEffect * 100)}% difference would be detected{" "}
          {Math.round(power.powerForTargetEffect * 100)}% of the time
          {power.readersNeededForTargetEffect
            ? `, and would need about ${power.readersNeededForTargetEffect} readers per arm to be reliable`
            : ""}
          .
        </>
      )}
    </p>
  );
}

/**
 * The conditions that decide whether anything above can be believed.
 *
 * Every counter here was previously invisible, and invisible is how broken
 * numbers get trusted.
 */
function DataQualityPanel({ quality }: { quality: RecommendationDataQuality | null }) {
  if (!quality) return null;

  const checks: { label: string; value: number; help: string }[] = [
    { label: "Events with no served feed", value: quality.eventsWithoutFeed, help: "Cannot be reconstructed." },
    { label: "Events on no algorithm", value: quality.eventsUnattributed, help: "Not in any arm." },
    { label: "Degraded feeds", value: quality.degradedFeeds, help: "Ranked without behaviour, or outside the Worker." },
    { label: "Empty feeds", value: quality.emptyFeeds, help: "A serve with nothing in it." },
    { label: "Algorithm mismatch", value: quality.algorithmMismatch, help: "Event and feed disagree on the arm." },
    { label: "Reel not in its feed", value: quality.rankNotInFeed, help: "A read of something never served." },
    { label: "Events before their feed", value: quality.eventsBeforeFeed, help: "Clock or attribution fault." },
    { label: "Duplicate outcomes", value: quality.duplicateOutcomes, help: "Two verdicts for one read." },
    { label: "Clamped reading time", value: quality.clampedReadingTime, help: "Hit the 24-hour ceiling." },
    { label: "Outcomes with no time", value: quality.outcomesWithoutTime, help: "A read that took zero seconds." },
    { label: "Readers with no assignment", value: quality.eventsWithoutAssignment, help: "Events with no stored arm." },
  ];

  return (
    <div className="grid gap-3 border-t border-[var(--border)] pt-4">
      <div>
        <h3 className="text-lg font-semibold tracking-normal">Data quality</h3>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {quality.events} reader events and {quality.feeds} served feeds in the last{" "}
          {quality.windowDays} days. Anything above zero below is a reason to distrust a comparison,
          not a number to optimise.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {checks.map((check) => (
          <div key={check.label} className="rounded-[var(--radius)] border border-[var(--border)] p-3">
            <p className="text-sm font-medium">
              {check.label}: <strong>{check.value}</strong>
            </p>
            <p className="text-sm text-[var(--muted-foreground)]">{check.help}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        Feeds by backend:{" "}
        {Object.entries(quality.feedsByBackend)
          .map(([backend, count]) => `${backend} ${count}`)
          .join(" · ") || "none"}
        . Labelling versions:{" "}
        {Object.entries(quality.labelingVersions)
          .map(([version, count]) => `${version} ${count}`)
          .join(" · ") || "none"}
        .
      </p>
    </div>
  );
}

function armValue(arm: ArmSummary, metric: ReaderMetricId) {
  if (metric === "active_seconds") return arm.medianActiveSeconds;
  if (metric === "boks_opened") return arm.medianBoksOpened;
  if (metric === "completion_rate") return arm.completionRate;
  if (metric === "skip_rate") return arm.skipRate;
  return 0;
}

function percent(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 1000) / 10;
}
