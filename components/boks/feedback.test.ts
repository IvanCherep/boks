import { describe, expect, it } from "vitest";
import {
  countRead,
  dueMilestone,
  emptyFeedbackState,
  feedbackMilestones,
  markPrompted,
  surfaceForMilestone,
} from "@/components/boks/feedback";

/** Reads `count` boks in a row, answering every prompt the way `answer` says. */
function readThrough(count: number, answer: (milestone: number) => void = () => {}) {
  let state = emptyFeedbackState;
  const offered: number[] = [];
  for (let index = 0; index < count; index += 1) {
    state = countRead(state);
    const milestone = dueMilestone(state);
    if (milestone !== null) {
      offered.push(milestone);
      answer(milestone);
      state = markPrompted(state, milestone);
    }
  }
  return { state, offered };
}

describe("when the feedback box is offered", () => {
  it("asks after the 3rd, 10th and 30th bok, and at no other point", () => {
    const { offered } = readThrough(40);
    expect(offered).toEqual([...feedbackMilestones]);
  });

  it("asks once per milestone, however many boks follow it", () => {
    const { offered } = readThrough(9);
    expect(offered).toEqual([3]);
  });

  it("does not ask again after the reader declines - declining is answering", () => {
    const { state } = readThrough(5);
    expect(dueMilestone(state)).toBeNull();
    expect(dueMilestone(countRead(state))).toBeNull();
  });

  it("asks once about where they are, not three times in a row, when the count arrives already past a milestone", () => {
    // A second device, a cleared browser, one long first sitting: the count can
    // jump. Walking such a reader through three prompts would be absurd.
    const arrived = { reads: 30, prompted: [] };
    const milestone = dueMilestone(arrived);
    expect(milestone).toBe(30);
    expect(dueMilestone(markPrompted(arrived, 30))).toBeNull();
  });

  it("labels each moment for the inbox, so a note can be read in context", () => {
    expect(surfaceForMilestone(3)).toBe("after_3");
    expect(surfaceForMilestone(10)).toBe("after_10");
    expect(surfaceForMilestone(30)).toBe("after_30");
  });

  it("counts only what it is given, and never below zero", () => {
    expect(countRead({ reads: -5, prompted: [] }).reads).toBe(1);
    expect(countRead(emptyFeedbackState).reads).toBe(1);
  });
});
