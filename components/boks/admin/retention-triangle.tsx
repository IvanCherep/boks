"use client";

import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";

const words = defineMessages(
  {
    noCohorts: "No reader cohorts yet.",
    arrived: "Arrived",
    readers: "Readers",
    week0: "Week 0",
    still: (readers: number, size: number, offset: number) =>
      `${readers} of ${size} readers still reading ${offset} week${offset === 1 ? "" : "s"} later`,
  },
  {
    ru: {
      noCohorts: "Когорт читателей пока нет.",
      arrived: "Пришли",
      readers: "Читатели",
      week0: "Неделя 0",
      still: (readers: number, size: number, offset: number) =>
        `${readers} из ${size} читателей всё ещё читают через ${offset} ${plural("ru", offset, { one: "неделю", few: "недели", many: "недель", other: "недели" })}`,
    },
  }
);

export type RetentionCohort = {
  week: string;
  size: number;
  retained: Array<{ offset: number; readers: number }>;
};

/**
 * The retention triangle: of the readers who arrived in a given week, how many
 * were still reading N weeks later.
 *
 * Cohort size is shown beside every row on purpose. A retention percentage off
 * four readers is one person changing their mind, and a reader of this table
 * needs to see that without being told.
 */
export function RetentionTriangle({ cohorts, maxOffset = 6 }: { cohorts: RetentionCohort[]; maxOffset?: number }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  if (!cohorts.length) {
    return <p className="text-sm text-[var(--muted-foreground)]">{t.noCohorts}</p>;
  }

  const offsets = Array.from({ length: maxOffset + 1 }, (_, index) => index);

  return (
    <div className="retention">
      <div className="retention__row retention__head">
        <span>{t.arrived}</span>
        <span>{t.readers}</span>
        {offsets.map((offset) => (
          <span key={offset}>{offset === 0 ? t.week0 : `+${offset}`}</span>
        ))}
      </div>
      {cohorts.map((cohort) => {
        const byOffset = new Map(cohort.retained.map((entry) => [entry.offset, entry.readers]));
        return (
          <div key={cohort.week} className="retention__row">
            <span>{formatWeek(cohort.week, language)}</span>
            <span className="retention__size">{cohort.size}</span>
            {offsets.map((offset) => {
              const readers = byOffset.get(offset);
              if (readers === undefined) return <span key={offset} className="retention__cell retention__cell--empty">·</span>;
              const share = cohort.size ? Math.round((readers / cohort.size) * 100) : 0;
              return (
                <span
                  key={offset}
                  className="retention__cell"
                  style={{ background: shade(share) }}
                  title={t.still(readers, cohort.size, offset)}
                >
                  {share}%
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** One hue, light to dark: this is a magnitude, not a category. */
function shade(share: number) {
  if (share <= 0) return "transparent";
  const strength = Math.min(1, share / 100);
  return `color-mix(in srgb, var(--primary) ${Math.round(12 + strength * 62)}%, var(--card))`;
}

function formatWeek(week: string, language: UiLanguage) {
  const date = new Date(`${week}T00:00:00Z`);
  return date.toLocaleDateString(language, { month: "short", day: "numeric" });
}
