"use client";

import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  describeRecommendationStrategies,
  normalizeExperimentConfig,
  type RecommendationExperimentConfig,
} from "@/lib/boks/recommendations";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const words = defineMessages({
  needTraffic: "Give at least one algorithm a share of traffic.",
  controlNeedsTraffic: "The control needs a share of traffic - every arm is compared against it.",
  saved: "Saved. New readers are assigned with the updated split.",
  saveFailed: "Could not save the experiment.",
  proposedShares: "Proposed traffic shares",
  control: "control",
  trafficWeight: "Traffic weight",
  shareOfReaders: (share: number) => `${share}% of readers`,
  parked: "parked",
  controlAlgorithm: "Control algorithm",
  readersPerArm: "Readers needed per arm",
  saveSplit: "Save split",
  addingBefore: "Adding an algorithm is a code change: create one file in",
  addingMiddle: "and list it in that folder's",
  addingAfter: ". It then appears here automatically and can be given traffic.",
}, { ru: {
  needTraffic: "Дайте хотя бы одному алгоритму долю трафика.",
  controlNeedsTraffic: "Контрольному варианту нужна доля трафика: с ним сравниваются все остальные.",
  saved: "Сохранено. Новые читатели распределяются по обновлённой схеме.",
  saveFailed: "Не удалось сохранить эксперимент.",
  proposedShares: "Предлагаемые доли трафика",
  control: "контроль",
  trafficWeight: "Вес трафика",
  shareOfReaders: (share: number) => `${share}% читателей`,
  parked: "на паузе",
  controlAlgorithm: "Контрольный алгоритм",
  readersPerArm: "Нужно читателей на вариант",
  saveSplit: "Сохранить распределение",
  addingBefore: "Новый алгоритм добавляется в коде: создайте один файл в",
  addingMiddle: "и добавьте его в",
  addingAfter: " этой папки. После этого он сам появится здесь, и ему можно будет дать трафик.",
} });

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
  const t = useMessages(words);
  const language = useUiLanguage();
  const strategies = useMemo(() => describeRecommendationStrategies(language), [language]);

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
      setStatus(t.needTraffic);
      return;
    }
    // A parked control has no readers, and every comparison is against it:
    // the lab would silently show nothing at all.
    if (!next.arms.some((arm) => arm.algorithmId === next.controlAlgorithmId && arm.weight > 0)) {
      setStatus(t.controlNeedsTraffic);
      return;
    }

    setSaving(true);
    setStatus("");
    try {
      await onSave(next);
      setStatus(t.saved);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="studio-traffic-bar" aria-label={t.proposedShares}>{strategies.filter(strategy => (weights[strategy.id] ?? 0) > 0).map(strategy => <span key={strategy.id} style={{ flex: weights[strategy.id] }}><strong>{strategy.name}</strong> {Math.round((weights[strategy.id] ?? 0) / totalWeight * 100)}%</span>)}</div>
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
                  {strategy.id === control && <span className="strategy-tag strategy-tag--control">{t.control}</span>}
                </div>
                <details className="studio-row-details"><summary>{strategy.id}</summary><p className="studio-meta">{strategy.description}</p></details>
              </div>
              <div className="grid content-start gap-2">
                <label className="grid gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                  {t.trafficWeight}
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
                <p className="text-xs text-[var(--muted-foreground)]">{weight > 0 ? t.shareOfReaders(share) : t.parked}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-medium">
          {t.controlAlgorithm}
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
          {t.readersPerArm}
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
          <Save className="size-4" /> {t.saveSplit}
        </Button>
      </div>

      {status && <p className="text-sm text-[var(--muted-foreground)]">{status}</p>}

      <p className="text-xs leading-5 text-[var(--muted-foreground)]">
        {t.addingBefore}
        {" "}
        <code>lib/boks/recommendations/strategies/</code> {t.addingMiddle}{" "}
        <code>index.ts</code>{t.addingAfter}
      </p>
    </div>
  );
}
