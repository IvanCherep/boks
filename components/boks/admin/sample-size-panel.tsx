"use client";

import { MetricNote } from "@/components/boks/admin/metric-note";
import type { LabCohort } from "@/lib/boks/recommendations/metrics";
import type { SampleSizeCurve } from "@/lib/recsys/statistics/sample-size";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

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

const words = defineMessages(
  {
    seconds: "s",
    minutes: "m",
    status: {
      positive: "resolved, variant ahead",
      negative: "resolved, variant behind",
      inconclusive: "not resolved",
      insufficient_data: "below the minimum",
    } as Record<string, string>,
    title: "How much data do we need?",
    empty: "Nothing to size yet. This fills in once the split has a control arm and one variant with readers in both.",
    label: "Sample size and detectable effect",
    is: (metric: string) => <>The size of difference this experiment can currently see on <strong>{metric}</strong>, and the size it would need to see a smaller one.</>,
    how: (spread: number) =>
      `Readers are the unit. The spread of the metric across readers is ${spread} (standard deviation over mean), and power is simulated at that spread for each sample size. The observed rows re-run the same estimator - difference in means with a percentile bootstrap interval - on the first k readers of each arm, in arrival order.`,
    not: "Not a forecast of the result. A curve that wanders and then settles is the normal shape of a small experiment, and the last observed row is today, not a trend. A “not resolved” row means the data cannot tell, which is different from the arms being equal.",
    columns: ["Readers per arm", "Effect", "Interval", "± precision", "Smallest visible", "Verdict"],
    today: "today",
    planned: "planned",
    notMeasured: "not measured yet",
    target: "target",
    chance: "chance of seeing it",
    refused: (minimum: number) =>
      `A comparison is refused below ${minimum} readers per arm rather than shown with a wide interval, because a number on a screen gets quoted and an interval does not.`,
    needs: (effect: string, readers: number) => ` Resolving a ${effect} difference needs about ${readers} readers per arm.`,
    newReaders: "Does it differ for new readers?",
    newReadersLead: "The same comparison, computed separately for readers in their first week and for everyone older. A pooled estimate hides the case where an arm helps one group and hurts the other: two real effects of opposite sign average to nothing and the arm looks inert.",
    cohortLabel: "Cohort split",
    cohortIs: "Whether the arms differ for newcomers and for readers who have stayed.",
    cohortHow: "Each reader's tenure is the days between their first ever read and the day of the row being counted, so “first week” is a property of when they read, not of when the window opens. Rows are split on that and the reader-level comparison is re-run on each side.",
    cohortNot: "Not a subgroup finding. Splitting halves the readers in each arm, so both sides are underpowered long before the pooled comparison is. Read it as a reason to look, and to keep the split in mind when the sample is big enough to decide.",
    cohortColumns: ["Group", "Readers", "Control", "Variant", "Effect", "Verdict"],
    noReaders: "no readers",
  },
  {
    ru: {
      seconds: " с",
      minutes: " мин",
      status: {
        positive: "решено, вариант впереди",
        negative: "решено, вариант позади",
        inconclusive: "не решено",
        insufficient_data: "ниже минимума",
      },
      title: "Сколько данных нужно?",
      empty: "Пока нечего оценивать. Таблица заполнится, когда в сплите будут контрольный вариант и один вариант с читателями в обоих.",
      label: "Размер выборки и минимальный обнаруживаемый эффект",
      is: (metric: string) => <>Какую разницу этот эксперимент сейчас способен увидеть по метрике <strong>{metric}</strong> и какая выборка нужна, чтобы увидеть меньшую.</>,
      how: (spread: number) =>
        `Единица измерения: читатель. Разброс метрики между читателями ${spread} (стандартное отклонение к среднему), и мощность моделируется при этом разбросе для каждого размера выборки. Наблюдаемые строки заново прогоняют ту же оценку (разность средних с перцентильным бутстреп-интервалом) на первых k читателях каждого варианта в порядке прихода.`,
      not: "Это не прогноз результата. Кривая, которая блуждает, а потом успокаивается, обычна для маленького эксперимента, а последняя наблюдаемая строка это сегодняшний день, а не тренд. Строка «не решено» значит, что данные не могут сказать, а это не то же самое, что равенство вариантов.",
      columns: ["Читателей на вариант", "Эффект", "Интервал", "± точность", "Мин. обнаруживаемый эффект", "Вердикт"],
      today: "сегодня",
      planned: "план",
      notMeasured: "ещё не измерено",
      target: "цель",
      chance: "шанс это увидеть",
      refused: (minimum: number) =>
        `Ниже ${minimum} читателей на вариант сравнение не показывается совсем, даже с широким интервалом: число на экране цитируют, а интервал нет.`,
      needs: (effect: string, readers: number) => ` Чтобы различить разницу в ${effect}, нужно около ${readers} читателей на вариант.`,
      newReaders: "Отличается ли это для новых читателей?",
      newReadersLead: "То же сравнение, посчитанное отдельно для читателей на первой неделе и для всех остальных. Общая оценка скрывает случай, когда вариант помогает одной группе и вредит другой: два настоящих эффекта противоположного знака в среднем дают ноль, и вариант выглядит бесполезным.",
      cohortLabel: "Разбивка по когортам",
      cohortIs: "Различаются ли варианты для новичков и для тех, кто остался.",
      cohortHow: "Стаж читателя: дни между его самым первым прочтением и днём считаемой строки, так что «первая неделя» зависит от того, когда он читал, а не от начала окна. Строки делятся по этому признаку, и сравнение по читателям прогоняется для каждой стороны.",
      cohortNot: "Это не вывод о подгруппе. Разбивка делит читателей каждого варианта пополам, так что обеим сторонам не хватает мощности задолго до общего сравнения. Считайте это поводом присмотреться и держать разбивку в уме, когда выборка станет достаточной для решения.",
      cohortColumns: ["Группа", "Читатели", "Контроль", "Вариант", "Эффект", "Вердикт"],
      noReaders: "нет читателей",
    },
  }
);

function secondsLabel(value: number | null, t: (typeof words)["en"]) {
  if (value === null) return "—";
  const rounded = Math.round(value);
  if (Math.abs(rounded) < 90) return `${rounded}${t.seconds}`;
  return `${(rounded / 60).toFixed(1)}${t.minutes}`;
}

export function SampleSizePanel({
  curve,
  cohorts,
  minimumReadersPerArm,
}: {
  curve: SampleSizeCurve | null;
  cohorts: LabCohort[];
  minimumReadersPerArm: number;
}) {
  const t = useMessages(words);
  const statusLabel = t.status;
  if (!curve) {
    return (
      <section className="panel p-5">
        <h3 className="text-lg font-semibold tracking-normal">{t.title}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          {t.empty}
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="panel p-5">
        <h3 className="text-lg font-semibold tracking-normal">{t.title}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6">{curve.readout}</p>
        <MetricNote
          label={t.label}
          is={t.is(curve.metric)}
          how={t.how(curve.coefficientOfVariation)}
          not={t.not}
        />

        <div className="mt-4 overflow-x-auto">
          <table className="stat-table">
            <thead>
              <tr>
                {t.columns.map((column) => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {curve.observed.map((step) => (
                <tr key={`observed-${step.readersPerArm}`}>
                  <td>
                    {step.readersPerArm}
                    {step.readersPerArm === curve.readersPerArmNow && (
                      <span className="admin-pill">{t.today}</span>
                    )}
                  </td>
                  <td>{secondsLabel(step.effect, t)}</td>
                  <td>
                    {step.ci ? `${secondsLabel(step.ci[0], t)} … ${secondsLabel(step.ci[1], t)}` : "—"}
                  </td>
                  <td>{secondsLabel(step.precision, t)}</td>
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
                    <span className="admin-pill">{t.planned}</span>
                  </td>
                  <td colSpan={3} className="text-[var(--muted-foreground)]">
                    {t.notMeasured}
                  </td>
                  <td>{percentLabel(curve.targetEffect)} {t.target}</td>
                  <td className="text-[var(--muted-foreground)]">
                    {percentLabel(step.power)} {t.chance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
          {t.refused(minimumReadersPerArm)}
          {curve.readersNeededForTargetEffect
            ? t.needs(percentLabel(curve.targetEffect), curve.readersNeededForTargetEffect)
            : ""}
        </p>
      </div>

      {cohorts.length > 0 && (
        <div className="panel p-5">
          <h3 className="text-lg font-semibold tracking-normal">{t.newReaders}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
            {t.newReadersLead}
          </p>
          <MetricNote label={t.cohortLabel} is={t.cohortIs} how={t.cohortHow} not={t.cohortNot} />

          <div className="mt-4 overflow-x-auto">
            <table className="stat-table">
              <thead>
                <tr>
                  {t.cohortColumns.map((column) => <th key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((cohort) => (
                  <tr key={cohort.id}>
                    <td>{cohort.label}</td>
                    <td>{cohort.readers}</td>
                    <td>{cohort.comparison ? secondsLabel(cohort.comparison.controlValue, t) : "—"}</td>
                    <td>{cohort.comparison ? secondsLabel(cohort.comparison.variantValue, t) : "—"}</td>
                    <td>
                      {cohort.comparison && cohort.comparison.status !== "insufficient_data"
                        ? secondsLabel(cohort.comparison.effect, t)
                        : "—"}
                    </td>
                    <td className="text-[var(--muted-foreground)]">
                      {cohort.comparison
                        ? (statusLabel[cohort.comparison.status] ?? cohort.comparison.status)
                        : t.noReaders}
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
