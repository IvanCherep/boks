import { describe, expect, it } from "vitest";
import { recordingRequested } from "@/components/boks/recording-mode";

describe("recordingRequested", () => {
  it("is on for the spellings an admin would type", () => {
    for (const search of ["?recording=1", "?recording=true", "?recording", "?bok=7&recording=TRUE"]) {
      expect(recordingRequested(search)).toBe(true);
    }
  });

  it("is off without the flag or when it is turned off", () => {
    for (const search of ["", "?bok=7", "?recording=0", "?recording=false"]) {
      expect(recordingRequested(search)).toBe(false);
    }
  });
});
