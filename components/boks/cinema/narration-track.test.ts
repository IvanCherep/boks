import { describe, expect, it } from "vitest";
import {
  lineAtTime,
  lineStartTimes,
  narrationTrackFor,
  type NarrationAlignment,
} from "@/components/boks/cinema/narration-track";
import { planScenes } from "@/components/boks/cinema/scene-plan";

/** An alignment as ElevenLabs returns one: a time for every character, spaces included. */
function alignmentFor(text: string, secondsPerCharacter = 0.1): NarrationAlignment {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, index) => index * secondsPerCharacter),
    character_end_times_seconds: characters.map((_, index) => (index + 1) * secondsPerCharacter),
  };
}

describe("lining a recording up with the lines on screen", () => {
  // The text handed to the voice keeps its paragraph breaks; the lines on the
  // card have their own. Matching them is the one thing that has to be right,
  // because a highlight in the wrong place is worse than no recording.
  const text = "Первое предложение здесь.\n\nВторое предложение тоже здесь.";

  it("finds when each line starts, ignoring how the whitespace differs", () => {
    const plan = planScenes({ id: "x", text });
    const starts = lineStartTimes(plan.lines, alignmentFor(text));
    expect(starts).not.toBeNull();
    expect(starts).toHaveLength(plan.lines.length);
    expect(starts?.[0]).toBe(0);
    // Each line starts later than the one before it.
    for (let index = 1; index < (starts?.length ?? 0); index += 1) {
      expect(starts![index]).toBeGreaterThan(starts![index - 1]);
    }
  });

  it("refuses rather than guesses when the words and the recording disagree", () => {
    const plan = planScenes({ id: "x", text });
    // A recording of something else entirely.
    expect(lineStartTimes(plan.lines, alignmentFor("Совершенно другой текст."))).toBeNull();
  });

  it("finds the line the recording is inside", () => {
    const starts = [0, 4, 9];
    expect(lineAtTime(starts, 0)).toBe(0);
    expect(lineAtTime(starts, 3.9)).toBe(0);
    expect(lineAtTime(starts, 4)).toBe(1);
    expect(lineAtTime(starts, 8.5)).toBe(1);
    expect(lineAtTime(starts, 99)).toBe(2);
    // Before the first line, which a seek backwards can produce.
    expect(lineAtTime(starts, -1)).toBe(0);
  });

  it("has a recording for the Tolstoy piece and none for anything else", () => {
    expect(narrationTrackFor("ee470590-a93c-467e-aaeb-87ae00c0745e")?.audio).toBe(
      "/cinema/lion/narration.mp3"
    );
    expect(narrationTrackFor("no-such-boks")).toBeNull();
  });
});
