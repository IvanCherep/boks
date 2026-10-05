import { dailyBokSubmissionLimit } from "@/lib/boks/contracts";

/**
 * The daily author limit in one place. The database is the authority - this
 * module mirrors the same rule so the author cabinet can explain the limit
 * before a submission is rejected, and so the rule is testable without a DB.
 */

export type BokSubmissionQuota = {
  limit: number;
  usedToday: number;
  remaining: number;
  exhausted: boolean;
  /** Start of the next UTC day, when the counter resets. */
  resetsAt: string;
  message: string;
};

export function describeBokSubmissionQuota(
  usedToday: number,
  now: Date = new Date(),
  limit: number = dailyBokSubmissionLimit
): BokSubmissionQuota {
  const used = Math.max(0, Math.floor(Number(usedToday) || 0));
  const remaining = Math.max(0, limit - used);
  const resetsAt = nextDayStart(now);

  return {
    limit,
    usedToday: used,
    remaining,
    exhausted: remaining === 0,
    resetsAt: resetsAt.toISOString(),
    message: quotaMessage(remaining, limit),
  };
}

/**
 * The database's answer, with the gaps filled in.
 *
 * Whatever the server states wins: if `boks_daily_submission_limit()` changes,
 * the cabinet must not keep enabling or disabling Submit from the constant it
 * was built with. The local rule only fills fields the payload lacks.
 */
export function normalizeBokSubmissionQuota(raw: unknown, now: Date = new Date()): BokSubmissionQuota {
  const source = (raw ?? {}) as Partial<BokSubmissionQuota>;
  const limit = Math.max(1, Math.round(Number(source.limit) || dailyBokSubmissionLimit));
  const fallback = describeBokSubmissionQuota(Number(source.usedToday) || 0, now, limit);
  const remaining =
    typeof source.remaining === "number" && Number.isFinite(source.remaining)
      ? Math.max(0, Math.floor(source.remaining))
      : fallback.remaining;
  const exhausted = typeof source.exhausted === "boolean" ? source.exhausted : remaining === 0;

  return {
    ...fallback,
    remaining,
    exhausted,
    message: quotaMessage(exhausted ? 0 : remaining, limit),
    resetsAt: typeof source.resetsAt === "string" && source.resetsAt ? source.resetsAt : fallback.resetsAt,
  };
}

function quotaMessage(remaining: number, limit: number) {
  if (remaining === 0) return `Daily limit reached. You can submit ${limit} boks a day; the next slot opens tomorrow.`;
  if (remaining === 1) return "1 submission left today.";
  return `${remaining} submissions left today.`;
}

function nextDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
