import type { GuestFunnel } from "@/components/boks/client-types";
import { currentUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

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

type StepKey = Exclude<FunnelStep["key"], "cameBack">;

const order: StepKey[] = ["guests", "startedReading", "finishedOne", "finishedThree", "sawSignup", "requestedLink", "createdAccount"];

const stepLabels = defineMessages<Record<StepKey, string>>(
  {
    guests: "Guest devices",
    startedReading: "Started reading",
    finishedOne: "Finished a bok",
    finishedThree: "Finished three",
    sawSignup: "Saw the sign-up",
    requestedLink: "Asked for a sign-in link",
    createdAccount: "Created an account",
  },
  {
    ru: {
      guests: "Устройства гостей",
      startedReading: "Начали читать",
      finishedOne: "Дочитали бок",
      finishedThree: "Дочитали три",
      sawSignup: "Увидели регистрацию",
      requestedLink: "Запросили ссылку для входа",
      createdAccount: "Создали аккаунт",
    },
  }
);

export function funnelSteps(funnel: GuestFunnel["funnel"], language: UiLanguage = currentUiLanguage()): FunnelStep[] {
  const total = funnel.guests;
  return order.map((key, index) => {
    const count = funnel[key] ?? 0;
    const previous = index === 0 ? null : funnel[order[index - 1]] ?? 0;
    return {
      key,
      label: stepLabels[language][key],
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
