import { describe, expect, it } from "vitest";
import {
  assignExperimentArm,
  defaultExperimentConfig,
  inferUserSegment,
  normalizeExperimentConfig,
} from "@/lib/boks/recommendations/experiments";

describe("normalizeExperimentConfig", () => {
  it("drops arms that name an algorithm this build does not have", () => {
    const config = normalizeExperimentConfig({
      key: "custom",
      controlAlgorithmId: "balanced",
      arms: [
        { algorithmId: "balanced", weight: 50 },
        { algorithmId: "not_a_real_algorithm", weight: 50 },
      ],
      minimumImpressionsPerArm: 25,
    });

    expect(config.arms.map((arm) => arm.algorithmId)).toEqual(["balanced"]);
    expect(config.minimumImpressionsPerArm).toBe(25);
  });

  it("falls back to the default split when nothing is live", () => {
    const config = normalizeExperimentConfig({ arms: [{ algorithmId: "balanced", weight: 0 }] });
    expect(config.arms).toEqual(defaultExperimentConfig.arms);
  });

  it("repairs an unknown control", () => {
    const config = normalizeExperimentConfig({ controlAlgorithmId: "ghost" });
    expect(config.controlAlgorithmId).toBe("for_you");
  });

  it("de-duplicates repeated arms", () => {
    const config = normalizeExperimentConfig({
      arms: [
        { algorithmId: "balanced", weight: 10 },
        { algorithmId: "balanced", weight: 90 },
      ],
    });
    expect(config.arms).toEqual([{ algorithmId: "balanced", weight: 10 }]);
  });
});

describe("defaultExperimentConfig", () => {
  it("runs two arms, because a few dozen readers cannot fill four", () => {
    expect(defaultExperimentConfig.arms).toHaveLength(2);
    expect(defaultExperimentConfig.arms.every((arm) => arm.weight > 0)).toBe(true);
  });

  it("includes the control among the live arms", () => {
    expect(defaultExperimentConfig.arms.map((arm) => arm.algorithmId)).toContain(
      defaultExperimentConfig.controlAlgorithmId
    );
  });
});

describe("assignExperimentArm", () => {
  it("keeps a visitor in the same arm across calls", () => {
    const first = assignExperimentArm("visitor-42");
    const second = assignExperimentArm("visitor-42");
    expect(first.algorithmId).toBe(second.algorithmId);
    expect(first.userSegment).toBe(second.userSegment);
  });

  it("spreads visitors across every live arm", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 400; index += 1) {
      seen.add(assignExperimentArm(`visitor-${index}`).algorithmId);
    }
    expect([...seen].sort()).toEqual(defaultExperimentConfig.arms.map((arm) => arm.algorithmId).sort());
  });

  it("respects a zero-weight arm", () => {
    const config = normalizeExperimentConfig({
      arms: [
        { algorithmId: "balanced", weight: 100 },
        { algorithmId: "discovery", weight: 0 },
      ],
    });

    for (let index = 0; index < 100; index += 1) {
      expect(assignExperimentArm(`visitor-${index}`, config).algorithmId).toBe("balanced");
    }
  });

  it("honours an explicit admin request and marks it as requested", () => {
    const experiment = assignExperimentArm("visitor-1", defaultExperimentConfig, "random_control");
    expect(experiment.algorithmId).toBe("random_control");
    expect(experiment.source).toBe("requested");
  });

  it("ignores an unknown requested algorithm", () => {
    const experiment = assignExperimentArm("visitor-1", defaultExperimentConfig, "ghost");
    expect(experiment.source).toBe("assigned");
  });
});

describe("inferUserSegment", () => {
  it("produces every segment across a population", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) seen.add(inferUserSegment(`visitor-${index}`));
    expect(seen.size).toBe(4);
  });
});
