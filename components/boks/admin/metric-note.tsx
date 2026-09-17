"use client";

import type React from "react";
import { Info } from "lucide-react";

/**
 * What a number on this console means, folded away until asked for.
 *
 * Three fields, always in the same order, because they answer the three
 * questions that get asked about every metric in a review:
 *
 *   * **is** - what it measures, in a sentence a non-specialist can repeat.
 *   * **how** - where the number comes from. Which events, which denominator,
 *     which window. Someone has to be able to check it.
 *   * **not** - what it must not be read as. This is the field that earns its
 *     keep: a console's failure mode is not a wrong number, it is a right
 *     number read as something it isn't. "Impressions" counted views and was
 *     read as reach; a rate over three readers was read as a result.
 *
 * Collapsed by default: an operator who checks this screen weekly does not
 * want to read it again, and a visitor being shown the console does. `<details>`
 * gives both, keyboard and screen reader included, with no state to manage.
 */
export function MetricNote({
  is,
  how,
  not,
  label,
}: {
  is: React.ReactNode;
  how: React.ReactNode;
  /** Omit only when there is genuinely no common misreading. */
  not?: React.ReactNode;
  /** Names the metric in the summary, for a screen reader out of context. */
  label: string;
}) {
  return (
    <details className="metric-note">
      <summary className="metric-note-summary">
        <Info className="size-3.5" aria-hidden="true" />
        <span>How this is measured</span>
        <span className="sr-only"> — {label}</span>
      </summary>
      <div className="metric-note-body">
        <p>
          <strong>What it is.</strong> {is}
        </p>
        <p>
          <strong>How it is computed.</strong> {how}
        </p>
        {not && (
          <p>
            <strong>What it is not.</strong> {not}
          </p>
        )}
      </div>
    </details>
  );
}
