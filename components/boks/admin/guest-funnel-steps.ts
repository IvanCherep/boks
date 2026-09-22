import type { GuestFunnel } from "@/components/boks/client-types";

/**
 * The guest funnel as steps, with the one number a founder acts on: where the
 * most people are lost.
 *
 * Kept apart from the component because the arithmetic has rules worth
 * testing - a step after an empty one has no rate, and "came back another day"
 * is not a step at all (a guest can come back without ever reading).
 */

export type FunnelStep = {
  key: keyof GuestFunnel["funnel"];
  label: string;
  count: number;
  /** Share of the step before it, 0..1; null for the first step or after an empty one. */
  ofPrevious: number | null;
  /** Share of all guest devices, 0..1; null when there are none. */
  ofAll: number | null;
};

const order: { key: FunnelStep["key"]; label: string }[] = [
  { key: "guests", label: "Guest devices" },
  { key: "startedReading", label: "Started reading" },
  { key: "finishedOne", label: "Finished a bok" },
  { key: "finishedThree", label: "Finished three" },
  { key: "sawSignup", label: "Saw the sign-up" },
  { key: "requestedLink", label: "Asked for a sign-in link" },
  { key: "createdAccount", label: "Created an account" },
];

export function funnelSteps(funnel: GuestFunnel["funnel"]): FunnelStep[] {
  const total = funnel.guests;
  return order.map((step, index) => {
    const count = funnel[step.key] ?? 0;
    const previous = index === 0 ? null : funnel[order[index - 1].key] ?? 0;
    return {
      ...step,
      count,
      ofPrevious: previous ? count / previous : null,
      ofAll: total ? count / total : null,
    };
  });
}

/**
 * The step that keeps the smallest share of the one before it.
 *
 * Only among steps with at least a handful of people behind them: two of three
 * is not a finding. That floor matters most at exactly the scale this console
 * is used at.
 */
export function biggestDrop(steps: FunnelStep[], minimumBefore = 5): { from: FunnelStep; to: FunnelStep } | null {
  let worst: { from: FunnelStep; to: FunnelStep } | null = null;
  for (let index = 1; index < steps.length; index += 1) {
    const from = steps[index - 1];
    const to = steps[index];
    if (from.count < minimumBefore || to.ofPrevious === null) continue;
    if (!worst || to.ofPrevious < (worst.to.ofPrevious ?? 1)) worst = { from, to };
  }
  return worst;
}

export function percent(share: number | null) {
  if (share === null) return "—";
  const value = share * 100;
  return `${value < 10 && value > 0 ? value.toFixed(1) : Math.round(value)}%`;
}
