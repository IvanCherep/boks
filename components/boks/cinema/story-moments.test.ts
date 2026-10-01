import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  momentDueAt,
  momentsToRearm,
  momentGraceSeconds,
  storyMomentsFor,
} from "@/components/boks/cinema/story-moments";

const lion = "ee470590-a93c-467e-aaeb-87ae00c0745e";
const narrationSeconds = 128.6;

describe("where a story stops to ask something", () => {
  const all = storyMomentsFor(lion);

  it("has two moments for the lion and none for anything else", () => {
    expect(all.map((m) => m.id)).toEqual(["crowd", "heartbeat"]);
    expect(storyMomentsFor("any-other-boks")).toHaveLength(0);
  });

  it("keeps them away from the opening and the close", () => {
    // A pause before the story has earned one is an interruption, and nothing
    // may interrupt the ending.
    for (const moment of all) {
      expect(moment.atSeconds, moment.id).toBeGreaterThan(narrationSeconds * 0.2);
      expect(moment.atSeconds, moment.id).toBeLessThan(narrationSeconds * 0.8);
    }
  });

  it("keeps them well apart", () => {
    // Two in quick succession turn a story into a sequence of tasks.
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i].atSeconds - all[i - 1].atSeconds).toBeGreaterThan(20);
    }
  });

  it("says what will happen and which fingers to move, in both languages", () => {
    // One clever imperative reads well and leaves the reader guessing, and a
    // reader who is guessing has stopped being inside the story.
    for (const moment of all) {
      for (const language of ["ru", "en"] as const) {
        expect(moment.hint[language].length, moment.id).toBeGreaterThan(0);
        expect(moment.how[language].length, moment.id).toBeGreaterThan(0);
        // The instruction is the longer of the two: it names the gesture.
        expect(moment.how[language].length, moment.id).toBeGreaterThanOrEqual(
          moment.hint[language].length
        );
      }
    }
  });

  it("points somewhere inside the frame", () => {
    for (const moment of all) {
      expect(moment.hotspot, moment.id).toBeDefined();
      expect(moment.hotspot!.x).toBeGreaterThan(0);
      expect(moment.hotspot!.x).toBeLessThan(1);
      expect(moment.hotspot!.y).toBeGreaterThan(0);
      expect(moment.hotspot!.y).toBeLessThan(1);
    }
  });

  it("is ordered, so the first one due is the first one found", () => {
    for (let i = 1; i < all.length; i += 1) {
      expect(all[i].atSeconds).toBeGreaterThan(all[i - 1].atSeconds);
    }
  });
});

describe("deciding when a moment opens", () => {
  const all = storyMomentsFor(lion);
  const none = new Set<string>();

  it("stays shut before its mark", () => {
    expect(momentDueAt(all, 0, none)).toBeNull();
    expect(momentDueAt(all, 52.1, none)).toBeNull();
  });

  it("opens on the mark", () => {
    expect(momentDueAt(all, 52.2, none)?.id).toBe("crowd");
    expect(momentDueAt(all, 53.5, none)?.id).toBe("crowd");
  });

  it("never opens the same one twice", () => {
    expect(momentDueAt(all, 53, new Set(["crowd"]))).toBeNull();
  });

  it("does not ambush a reader who sought past it", () => {
    // Dragged from the start to the last minute: the crowd is behind them now.
    expect(momentDueAt(all, 52.2 + momentGraceSeconds + 0.1, none)).toBeNull();
    // ...but a later moment they have not reached still waits for them.
    expect(momentDueAt(all, 81.2, new Set(["crowd"]))?.id).toBe("heartbeat");
  });

  it("gives the earlier one first when both are behind", () => {
    expect(momentDueAt(all, 52.2, none)?.id).toBe("crowd");
  });
});

describe("the files a moment needs", () => {
  const all = storyMomentsFor(lion);

  it("has both frames on disk for every moment", () => {
    // A missing picture is a black rectangle with a hint over it, and nothing
    // in the console to say why.
    for (const moment of all) {
      expect(existsSync(`public${moment.before}`), moment.before).toBe(true);
      expect(existsSync(`public${moment.after}`), moment.after).toBe(true);
    }
  });

  it("has the recording each one plays", () => {
    // A missing sound is silence, which is exactly what this screen looks like
    // when it is working, so nobody would notice until a reader did.
    const sounds: Record<string, string> = {
      crowd: "public/cinema/lion/moments/crowd.mp3",
      heartbeat: "public/cinema/lion/moments/heartbeat.mp3",
    };
    for (const moment of all) {
      expect(sounds[moment.loop], moment.id).toBeDefined();
      expect(existsSync(sounds[moment.loop]), sounds[moment.loop]).toBe(true);
    }
  });
});

describe("going back over a moment", () => {
  const all = storyMomentsFor(lion);

  it("arms the ones the reader has rewound past", () => {
    // Dragged back to the beginning: both are ahead again.
    expect(momentsToRearm(all, 0)).toEqual(["crowd", "heartbeat"]);
    // Back to the middle: only the later one is still to come.
    expect(momentsToRearm(all, 60)).toEqual(["heartbeat"]);
  });

  it("leaves alone the ones still behind the playhead", () => {
    expect(momentsToRearm(all, 128)).toEqual([]);
    // Standing just past one does not re-arm it, or it would fire twice on the
    // ordinary jitter of a playback clock.
    expect(momentsToRearm(all, 52.2)).toEqual(["heartbeat"]);
    expect(momentsToRearm(all, 81.2)).toEqual([]);
  });

  it("re-arms and then re-opens, which is the whole point", () => {
    const done = new Set(["crowd", "heartbeat"]);
    for (const id of momentsToRearm(all, 10)) done.delete(id);
    expect(momentDueAt(all, 52.2, done)?.id).toBe("crowd");
  });
});
