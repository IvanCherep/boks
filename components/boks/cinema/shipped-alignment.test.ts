import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lineStartTimes, type NarrationAlignment } from "@/components/boks/cinema/narration-track";
import { planScenes } from "@/components/boks/cinema/scene-plan";
import { storyMomentsFor } from "@/components/boks/cinema/story-moments";

const lion = "ee470590-a93c-467e-aaeb-87ae00c0745e";

/**
 * The recording that ships, against the text that ships.
 *
 * `lineStartTimes` returns null rather than a wrong answer when the two stop
 * matching, and the reader then falls back to the browser voice - which works,
 * sounds like a robot, and reports nothing. That is the failure this catches:
 * re-record with one character different and the highlight quietly dies.
 */
describe("the shipped recording lines up with the shipped text", () => {
  const alignment = JSON.parse(
    readFileSync("public/cinema/lion/alignment.json", "utf8")
  ) as NarrationAlignment;
  // The alignment holds the text it was read from, character for character.
  const text = alignment.characters.join("");
  const plan = planScenes({ id: lion, text });
  const duration = alignment.character_end_times_seconds.at(-1) ?? 0;

  it("gives every line on screen a time in the recording", () => {
    const starts = lineStartTimes(plan.lines, alignment);
    expect(starts).not.toBeNull();
    expect(starts).toHaveLength(plan.lines.length);
    for (let index = 1; index < starts!.length; index += 1) {
      expect(starts![index]).toBeGreaterThanOrEqual(starts![index - 1]);
    }
  });

  it("keeps every moment inside the recording, and where the rules allow", () => {
    // Re-recording with a different voice changes the length, and a moment
    // left on the old timestamp lands on the wrong sentence - or past the end,
    // where it never opens at all.
    for (const moment of storyMomentsFor(lion)) {
      expect(moment.atSeconds, moment.id).toBeGreaterThan(duration * 0.2);
      expect(moment.atSeconds, moment.id).toBeLessThan(duration * 0.8);
    }
  });
});
