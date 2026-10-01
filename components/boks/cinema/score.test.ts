import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { scoreFor, scoreLevels } from "@/components/boks/cinema/score";

const lion = "ee470590-a93c-467e-aaeb-87ae00c0745e";

describe("the music under a boks", () => {
  it("has a bed for the lion and none for anything else", () => {
    expect(scoreFor(lion)).toBe("/cinema/lion/score.mp3");
    expect(scoreFor("any-other-boks")).toBeNull();
  });

  it("has the file it points at", () => {
    expect(existsSync(`public${scoreFor(lion)}`)).toBe(true);
  });

  it("sits far enough under the voice to be a bed and not a duet", () => {
    // The file was generated at -27.0 dBFS and the narration reads -21.5 once
    // its pauses are excluded. Broadcast puts music 15-25 dB under dialogue;
    // these gains have to keep it inside that, or the words start to fight.
    const fileDbfs = -27.0;
    const voiceDbfs = -21.5;
    const separation = (gain: number) => voiceDbfs - (fileDbfs + 20 * Math.log10(gain));
    expect(separation(scoreLevels.under)).toBeGreaterThanOrEqual(15);
    expect(separation(scoreLevels.under)).toBeLessThanOrEqual(25);
  });

  it("comes up only part way when the voice stops", () => {
    // Louder in a moment, because nothing competes with it there - but still
    // under where the voice was, so returning to the reading is not a jolt.
    expect(scoreLevels.open).toBeGreaterThan(scoreLevels.under);
    const voiceDbfs = -21.5;
    const openDbfs = -27.0 + 20 * Math.log10(scoreLevels.open);
    expect(openDbfs).toBeLessThan(voiceDbfs);
  });
});
