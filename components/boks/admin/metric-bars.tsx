"use client";

import { numberValue } from "@/components/boks/client-format";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const words = defineMessages(
  {
    noReads: "No attributed reads yet.",
    best: "best",
    nothingYet: "Nothing recorded yet.",
    thisWeek: "this week",
  },
  {
    ru: {
      noReads: "Атрибутированных прочтений пока нет.",
      best: "лучший",
      nothingYet: "Пока ничего не записано.",
      thisWeek: "на этой неделе",
    },
  }
);

export type MetricBarRow = {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  /** Shown after the value, e.g. "%" or "pts". */
  unit?: string;
  note?: string;
  muted?: boolean;
};

/**
 * One measure across a handful of named algorithms: a magnitude comparison, so
 * horizontal bars with direct labels. Identity lives in the row label, so this
 * is a single-series chart and needs one hue and no legend. The same numbers
 * are always available in the table below, which is the accessible view.
 */
export function MetricBars({
  rows,
  caption,
  lowerIsBetter = false,
  highlightBest = true,
}: {
  rows: MetricBarRow[];
  caption: string;
  lowerIsBetter?: boolean;
  /** Off for distributions, where the tallest bar is not a winner. */
  highlightBest?: boolean;
}) {
  const t = useMessages(words);
  if (!rows.length) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t.noReads}</p>;
  }

  const max = Math.max(1, ...rows.map((row) => Math.abs(numberValue(row.value))));
  const best = highlightBest
    ? [...rows].sort((left, right) => (lowerIsBetter ? left.value - right.value : right.value - left.value))[0]
    : null;

  return (
    <figure className="metric-bars">
      <figcaption>{caption}</figcaption>
      {rows.map((row) => {
        const value = numberValue(row.value);
        const width = Math.max(2, (Math.abs(value) / max) * 100);
        return (
          <div key={row.id} className={`metric-bar ${row.muted ? "is-muted" : ""}`}>
            <div className="metric-bar__label">
              <strong>{row.label}</strong>
              {row.sublabel && <small>{row.sublabel}</small>}
            </div>
            <div
              className="metric-bar__track"
              title={`${row.label}: ${value}${row.unit ?? ""}${row.note ? ` (${row.note})` : ""}`}
            >
              <div className="metric-bar__fill" style={{ width: `${width}%` }} />
            </div>
            <div className="metric-bar__value">
              <strong>
                {value}
                {row.unit ?? ""}
              </strong>
              {row.id === best?.id && !row.muted && <small>{t.best}</small>}
              {row.note && <small>{row.note}</small>}
            </div>
          </div>
        );
      })}
    </figure>
  );
}

export type TimePoint = { label: string; value: number };

/**
 * One measure over time. A single series, so identity comes from the axis and
 * no legend is needed.
 *
 * Deliberately only ever used for counts and totals - readers, sessions,
 * minutes, boks. Those are honest at any sample size. A rate plotted weekly off
 * a dozen readers moves several points on one person's behaviour, and a line
 * through those points invites reading a trend that is not there.
 */
export function TimeSeriesBars({
  points,
  caption,
  unit = "",
}: {
  points: TimePoint[];
  caption: string;
  unit?: string;
}) {
  const t = useMessages(words);
  if (!points.length) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t.nothingYet}</p>;
  }

  const max = Math.max(1, ...points.map((point) => point.value));
  const latest = points.at(-1);

  return (
    <figure className="time-series">
      <figcaption>
        {caption}
        {latest && (
          <strong className="time-series__latest">
            {latest.value}
            {unit} {t.thisWeek}
          </strong>
        )}
      </figcaption>
      <div className="time-series__plot">
        {points.map((point) => (
          <div key={point.label} className="time-series__column" title={`${point.label}: ${point.value}${unit}`}>
            <div
              className="time-series__bar"
              style={{ height: `${point.value === 0 ? 2 : Math.max(6, (point.value / max) * 100)}%` }}
            />
            <span className="time-series__value">{point.value}</span>
          </div>
        ))}
      </div>
      <div className="time-series__axis">
        <span>{points[0]?.label}</span>
        <span>{latest?.label}</span>
      </div>
    </figure>
  );
}
