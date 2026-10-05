import { describe, expect, it } from "vitest";
import { describeBokSubmissionQuota, normalizeBokSubmissionQuota } from "@/lib/boks/author/submission-quota";
import { dailyBokSubmissionLimit } from "@/lib/boks/contracts";

const now = new Date("2026-09-12T21:30:00.000Z");

describe("describeBokSubmissionQuota", () => {
  it("allows three boks a day", () => {
    expect(dailyBokSubmissionLimit).toBe(3);
    expect(describeBokSubmissionQuota(0, now).remaining).toBe(3);
    expect(describeBokSubmissionQuota(2, now).remaining).toBe(1);
  });

  it("marks the quota exhausted at the limit", () => {
    const quota = describeBokSubmissionQuota(3, now);
    expect(quota.exhausted).toBe(true);
    expect(quota.remaining).toBe(0);
    expect(quota.message).toContain("Daily limit reached");
  });

  it("never reports negative remaining when the count is already over", () => {
    expect(describeBokSubmissionQuota(9, now).remaining).toBe(0);
  });

  it("resets at the start of the next day", () => {
    expect(describeBokSubmissionQuota(1, now).resetsAt).toBe("2026-09-13T00:00:00.000Z");
  });
});

describe("normalizeBokSubmissionQuota", () => {
  it("repairs a partial payload from the database", () => {
    const quota = normalizeBokSubmissionQuota({ usedToday: 1 }, now);
    expect(quota.limit).toBe(3);
    expect(quota.remaining).toBe(2);
  });

  it("survives a missing payload", () => {
    const quota = normalizeBokSubmissionQuota(null, now);
    expect(quota.usedToday).toBe(0);
    expect(quota.exhausted).toBe(false);
  });

  it("takes the limit and the verdict from the database, not the constant", () => {
    const quota = normalizeBokSubmissionQuota({ limit: 5, usedToday: 3, remaining: 2, exhausted: false }, now);
    expect(quota.limit).toBe(5);
    expect(quota.remaining).toBe(2);
    expect(quota.exhausted).toBe(false);
    expect(quota.message).toBe("2 submissions left today.");

    const closed = normalizeBokSubmissionQuota({ limit: 5, usedToday: 1, remaining: 0, exhausted: true }, now);
    expect(closed.exhausted).toBe(true);
    expect(closed.message).toContain("5 boks a day");
  });
});
