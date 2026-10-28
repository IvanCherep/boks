/**
 * A browsing session in rg2 and a2: ten minutes in one interface, what was
 * opened and read, and the questions after it.
 *
 * The measured half (`SessionRead`) comes from the study reader's own clock and
 * scroll - foreground time only, the same rule as the feed's. The reported
 * half (`SessionSurvey`) is what the participant says afterwards. A
 * **successful session** needs both: a text the participant had not read
 * before, read to the end by the measurement *and* by their own account,
 * within the session's minutes, and the choice rated 4 or 5 of 5. Every raw
 * value is stored, so a different rule can be applied to the same data later.
 *
 * rg2 is judged by a different number from the same survey: how satisfied the
 * participant is with the whole session of choosing and reading, 1..7, asked
 * after every session in both studies, including a session in which nothing
 * was opened.
 */

export type ReadOutcome = "complete" | "skip";

export type SessionRead = {
  bokId: string;
  /** Seconds into the session when it was opened. */
  openedAt: number;
  /** Foreground seconds with the text on screen. */
  activeSeconds: number;
  /** How far down the text, 0..1. */
  progress: number;
  scrollable: boolean;
  outcome: ReadOutcome;
};

export type SessionMeasurement = {
  interface: "feed" | "catalogue" | "inline" | "cards";
  set?: "a" | "b";
  minutes: number;
  /** Ids in the order the interface offered them. */
  offered: string[];
  reads: SessionRead[];
  /** Catalogue searches typed and filters used, for describing the control arm. */
  searches?: number;
  filters?: number;
  endedBy: "timer" | "participant";
  elapsedSeconds: number;
};

export type SessionSurvey = {
  perBok: Record<string, { readBefore: "yes" | "no"; finished: "yes" | "part" | "no" }>;
  /** «Насколько вы довольны выбором?» 1..5; null when nothing was opened. */
  satisfaction: number | null;
  /** «Насколько вы довольны этим сеансом выбора и чтения?» 1..7, always asked. Absent in answers saved before 28 October 2026. */
  sessionSatisfaction?: number | null;
  /** «Прочитанное меня тронуло» 1..7, the emotional response; null when nothing was opened. */
  moved?: number | null;
};

export const successfulSatisfaction = 4;

/** The bok that made the session successful, or null. */
export function successfulFind(measurement: SessionMeasurement, survey: SessionSurvey): string | null {
  if ((survey.satisfaction ?? 0) < successfulSatisfaction) return null;
  const limit = measurement.minutes * 60;
  const found = measurement.reads.find((read) => {
    const said = survey.perBok[read.bokId];
    return (
      read.openedAt <= limit &&
      read.outcome === "complete" &&
      said?.finished === "yes" &&
      said.readBefore === "no"
    );
  });
  return found?.bokId ?? null;
}
