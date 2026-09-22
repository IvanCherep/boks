import { describe, expect, it } from "vitest";
import { biggestDrop, funnelSteps, percent } from "@/components/boks/admin/guest-funnel-steps";

const funnel = {
  guests: 100,
  startedReading: 80,
  finishedOne: 60,
  finishedThree: 30,
  cameBack: 12,
  sawSignup: 25,
  requestedLink: 5,
  createdAccount: 3,
};

describe("the guest funnel as steps", () => {
  it("keeps the order a guest moves through, and leaves returning out of it", () => {
    const steps = funnelSteps(funnel);
    expect(steps.map((step) => step.key)).toEqual([
      "guests",
      "startedReading",
      "finishedOne",
      "finishedThree",
      "sawSignup",
      "requestedLink",
      "createdAccount",
    ]);
  });

  it("gives each step its share of the one before and of everyone", () => {
    const steps = funnelSteps(funnel);
    expect(steps[0].ofPrevious).toBeNull();
    expect(steps[1].ofPrevious).toBeCloseTo(0.8);
    expect(steps[5].ofPrevious).toBeCloseTo(0.2);
    expect(steps[6].ofAll).toBeCloseTo(0.03);
  });

  it("names the step that loses the most", () => {
    const drop = biggestDrop(funnelSteps(funnel));
    expect(drop?.from.key).toBe("sawSignup");
    expect(drop?.to.key).toBe("requestedLink");
  });

  it("does not call two out of three a finding", () => {
    const tiny = { ...funnel, guests: 3, startedReading: 3, finishedOne: 2, finishedThree: 1, sawSignup: 1, requestedLink: 0, createdAccount: 0 };
    expect(biggestDrop(funnelSteps(tiny))).toBeNull();
  });

  it("has no rate after an empty step, rather than a division by zero", () => {
    const empty = { ...funnel, sawSignup: 0, requestedLink: 0, createdAccount: 0 };
    const steps = funnelSteps(empty);
    expect(steps[5].ofPrevious).toBeNull();
    expect(steps[6].ofPrevious).toBeNull();
  });

  it("reads small shares to a decimal and large ones as whole numbers", () => {
    expect(percent(0.03)).toBe("3.0%");
    expect(percent(0.8)).toBe("80%");
    expect(percent(null)).toBe("—");
    expect(percent(0)).toBe("0%");
  });
});
