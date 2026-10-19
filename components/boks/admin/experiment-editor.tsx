"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  describeRecommendationStrategies,
  normalizeExperimentConfig,
  type RecommendationExperimentConfig,
} from "@/lib/boks/recommendations";

const strategies = describeRecommendationStrategies();

/**
 * The traffic split between strategies, editable without a deploy.
 *
 * Every algorithm the build registered is listed here, whether or not it is
 * currently live, so the founder can see the full menu and move traffic between
 * arms. Weights are relative shares; zero parks an arm without losing it.
 *
 * The form owns its values from mount. The caller passes a `key` derived from
 * the saved config so a reload replaces the form instead of syncing into it.
 */
export function ExperimentEditor({
  config,
  disabled,
  onSave,
  notice = "",
}: {
  config: RecommendationExperimentConfig;
  disabled: boolean;
  onSave: (config: RecommendationExperimentConfig) => Promise<void>;
  /**
   * Shown when the editor first renders. A save re-keys the editor so it
   * starts from the saved values, which also wiped the "Saved." it had just
   * set - so the parent carries the message across.
   */
  notice?: string;
}) {
  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(config.arms.map((arm) => [arm.algorithmId, arm.weight]))
  );
  const [control, setControl] = useState(config.controlAlgorithmId);
  const [minimumReaders, setMinimumReaders] = useState(config.minimumReadersPerArm);
  const [status, setStatus] = useState(notice);
  const [saving, setSaving] = useState(false);

  const totalWeight = Object.values(weights).reduce((total, weight) => total + Math.max(0, weight), 0);

  async function save() {
    const next = normalizeExperimentConfig({
      key: config.key,
      controlAlgorithmId: control,
      arms: strategies.map((strategy) => ({
        algorithmId: strategy.id,
        weight: Math.max(0, Math.round(weights[strategy.id] ?? 0)),
      })),
      minimumReadersPerArm: minimumReaders,
    });

    if (!next.arms.some((arm) => arm.weight > 0)) {
      setStatus("Give at least one algorithm a share of traffic.");
      return;
    }
    // A parked control has no readers, and every comparison is against it:
    // the lab would silently show nothing at all.
    if (!next.arms.some((arm) => arm.algorithmId === next.controlAlgorithmId && arm.weight > 0)) {
      setStatus("The control needs a share of traffic - every arm is compared against it.");
      return;
    }

    setSaving(true);
    setStatus("");
    try {
      await onSave(next);
      setStatus("Saved. New readers are assigned with the updated split.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save the experiment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="studio-traffic-bar" aria-label="Proposed traffic shares">{strategies.filter(strategy => (weights[strategy.id] ?? 0) > 0).map(strategy => <span key={strategy.id} style={{ flex: weights[strategy.id] }}><strong>{strategy.name}</strong> {Math.round((weights[strategy.id] ?? 0) / totalWeight * 100)}%</span>)}</div>
      <div className="strategy-list">
        {strategies.map((strategy) => {
          const weight = Math.max(0, weights[strategy.id] ?? 0);
          const share = totalWeight ? Math.round((weight / totalWeight) * 100) : 0;

          return (
            <article key={strategy.id} className={`strategy-card ${weight > 0 ? "is-live" : ""}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">{strategy.name}</strong>
                  <span className="strategy-tag">{strategy.family}</span>
                  {strategy.id === control && <span className="strategy-tag strategy-tag--control">control</span>}
                </div>
                <details className="studio-row-details"><summary>{strategy.id}</summary><p className="studio-meta">{strategy.description}</p></details>
              </div>
              <div className="grid content-start gap-2">
                <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                  Traffic weight
                  <Input
                    type="number"
                    min={0}
                    max={1000}
                    inputMode="numeric"
                    disabled={disabled}
                    value={weight}
                    onChange={(event) =>
                      setWeights((current) => ({ ...current, [strategy.id]: Number(event.target.value) || 0 }))
                    }
                  />
                </label>
                <p className="text-xs text-[var(--muted-foreground)]">{weight > 0 ? `${share}% of readers` : "parked"}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-medium">
          Control algorithm
          <select
            className="field-control"
            value={control}
            disabled={disabled}
            onChange={(event) => setControl(event.target.value)}
          >
            {strategies.map((strategy) => (
              <option key={strategy.id} value={strategy.id}>
                {strategy.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Readers needed per arm
          <Input
            type="number"
            min={2}
            max={100000}
            inputMode="numeric"
            disabled={disabled}
            value={minimumReaders}
            onChange={(event) => setMinimumReaders(Number(event.target.value) || 2)}
          />
        </label>
        <Button onClick={save} disabled={disabled || saving}>
          <Save className="size-4" /> Save split
        </Button>
      </div>

      {status && <p className="text-sm text-[var(--muted-foreground)]">{status}</p>}

      <p className="text-xs leading-5 text-[var(--muted-foreground)]">
        Adding an algorithm is a code change: create one file in
        {" "}
        <code>lib/boks/recommendations/strategies/</code> and list it in that folder&apos;s{" "}
        <code>index.ts</code>. It then appears here automatically and can be given traffic.
      </p>
    </div>
  );
}
