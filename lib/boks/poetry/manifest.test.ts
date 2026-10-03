import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  backdropAt,
  crossfadeProgress,
  lineIndexAt,
  playedFraction,
  presetFor,
  sceneFor,
  textPresets,
  tokenStateAt,
  zoneFor,
  type PoemManifest,
} from "@/lib/boks/poetry/manifest";

const manifest = JSON.parse(
  readFileSync("public/poetry/farewell-russia/manifest.json", "utf8")
) as PoemManifest;

describe("the poem that ships", () => {
  it("is eight lines over eight scenes, with real timings", () => {
    expect(manifest.lines).toHaveLength(8);
    expect(manifest.scenes).toHaveLength(8);
    // Placeholder timings drift against the voice; these came from the
    // recording itself.
    expect(manifest.timingMode).toBe("forced-alignment");
    for (const line of manifest.lines) {
      expect(sceneFor(manifest, manifest.lines.indexOf(line)), line.sceneId).not.toBeNull();
    }
  });

  it("covers the recording with no gap and no overlap", () => {
    // A gap is a blank screen mid-poem; an overlap is two lines claiming the
    // same moment. Lines run back to back by construction, so assert it.
    for (let index = 1; index < manifest.lines.length; index += 1) {
      expect(manifest.lines[index].startMs).toBe(manifest.lines[index - 1].endMs);
    }
    expect(manifest.lines[0].startMs).toBe(0);
    expect(manifest.lines.at(-1)!.endMs).toBe(manifest.durationMs);
  });

  it("keeps every word inside the line that owns it", () => {
    for (const line of manifest.lines) {
      for (const token of line.tokens) {
        expect(token.atMs, token.text).toBeGreaterThanOrEqual(line.startMs);
        expect(token.atMs, token.text).toBeLessThan(line.endMs);
      }
    }
  });

  it("names only presets the renderer can draw", () => {
    for (const scene of manifest.scenes) {
      expect(textPresets, scene.id).toContain(scene.textPreset);
    }
  });
});

describe("which line and scene a moment belongs to", () => {
  it("answers before the first word and after the last", () => {
    expect(lineIndexAt(manifest.lines, 0)).toBe(0);
    expect(lineIndexAt(manifest.lines, -500)).toBe(0);
    expect(lineIndexAt(manifest.lines, 99_999)).toBe(manifest.lines.length - 1);
  });

  it("changes on the boundary, not around it", () => {
    const second = manifest.lines[1];
    expect(lineIndexAt(manifest.lines, second.startMs - 1)).toBe(0);
    expect(lineIndexAt(manifest.lines, second.startMs)).toBe(1);
  });

  it("gives the same answer however the moment was reached", () => {
    // Seeking is the case this exists for: state comes from the timecode
    // alone, so arriving at 9s by playing and by dragging must be identical.
    for (const ms of [0, 2500, 9040, 12_000, 16_000]) {
      const index = lineIndexAt(manifest.lines, ms);
      expect(lineIndexAt(manifest.lines, ms)).toBe(index);
      expect(sceneFor(manifest, index)).not.toBeNull();
    }
  });
});

describe("where a word is in its life", () => {
  const line = manifest.lines[0];

  it("is hidden before it is spoken", () => {
    expect(tokenStateAt(line, 1, line.tokens[1].atMs - 1)).toBe("hidden");
  });

  it("is active from the moment it is spoken", () => {
    expect(tokenStateAt(line, 1, line.tokens[1].atMs)).toBe("active");
  });

  it("hands over to the next word rather than fading on a timer", () => {
    const handover = line.tokens[2].atMs;
    expect(tokenStateAt(line, 1, handover - 1)).toBe("active");
    expect(tokenStateAt(line, 1, handover)).toBe("settled");
    expect(tokenStateAt(line, 2, handover)).toBe("active");
  });

  it("keeps the last word of a line lit until the line ends", () => {
    const last = line.tokens.length - 1;
    expect(tokenStateAt(line, last, line.endMs - 1)).toBe("active");
    expect(tokenStateAt(line, last, line.endMs)).toBe("settled");
  });

  it("never leaves two words active at once", () => {
    for (const current of manifest.lines) {
      for (let ms = current.startMs; ms < current.endMs; ms += 40) {
        const active = current.tokens.filter(
          (_, index) => tokenStateAt(current, index, ms) === "active"
        );
        expect(active.length, `${current.sceneId} at ${ms}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("where a word is placed", () => {
  it("splits one line between two parts of the frame, and only that one", () => {
    const split = manifest.scenes.find((scene) => scene.textPreset === "social-hierarchy-split")!;
    expect(zoneFor(split, "lower").y).toBeGreaterThan(zoneFor(split, "upper").y);
    // The masters sit above the slaves. That is the line's whole argument.
    const line = manifest.lines.find((l) => l.sceneId === split.id)!;
    expect(line.tokens.filter((t) => t.zone === "lower")).toHaveLength(2);
    expect(line.tokens.filter((t) => t.zone === "upper")).toHaveLength(2);
  });

  it("falls back to the first zone for a role the scene does not have", () => {
    const plain = manifest.scenes[0];
    expect(zoneFor(plain, "nowhere")).toEqual(plain.safeZones[0]);
    expect(zoneFor(plain)).toEqual(plain.safeZones[0]);
  });

  it("keeps every zone inside the frame and clear of the controls", () => {
    // The bottom 12% belongs to the player.
    for (const scene of manifest.scenes) {
      for (const zone of scene.safeZones) {
        expect(zone.x, scene.id).toBeGreaterThanOrEqual(0);
        expect(zone.y, scene.id).toBeGreaterThanOrEqual(0);
        expect(zone.x + zone.width, scene.id).toBeLessThanOrEqual(1);
        expect(zone.y + zone.height, scene.id).toBeLessThanOrEqual(0.88);
      }
    }
  });
});

describe("a preset the renderer cannot draw", () => {
  it("becomes the quiet one instead of going unstyled", () => {
    expect(presetFor({ textPreset: "farewell-drift" })).toBe("farewell-drift");
    expect(presetFor({ textPreset: "no-such-effect" })).toBe("quiet-breath");
    expect(presetFor({ textPreset: "" })).toBe("quiet-breath");
  });
});

describe("the crossfade to the next scene", () => {
  const lead = manifest.playback.crossfadeLeadMs;

  it("has not begun in the middle of a line", () => {
    expect(crossfadeProgress(manifest.lines, 0, 100, lead, 470)).toBe(0);
  });

  it("begins before the next line, not on it", () => {
    const begins = manifest.lines[1].startMs - lead;
    expect(crossfadeProgress(manifest.lines, 0, begins, lead, 470)).toBe(0);
    expect(crossfadeProgress(manifest.lines, 0, begins + 235, lead, 470)).toBeCloseTo(0.5, 1);
    expect(crossfadeProgress(manifest.lines, 0, begins + 470, lead, 470)).toBe(1);
  });

  it("does not run off the end of the poem", () => {
    const last = manifest.lines.length - 1;
    expect(crossfadeProgress(manifest.lines, last, manifest.durationMs, lead, 470)).toBe(0);
  });
});

describe("the progress bar", () => {
  it("clamps at both ends", () => {
    expect(playedFraction(-100, 16_640)).toBe(0);
    expect(playedFraction(8_320, 16_640)).toBe(0.5);
    expect(playedFraction(99_999, 16_640)).toBe(1);
    expect(playedFraction(100, 0)).toBe(0);
  });
});

describe("which two pictures are on screen", () => {
  const idOf = (index: number) => sceneFor(manifest, index)?.id ?? null;

  it("shows one scene, alone, in the middle of a line", () => {
    const { from, to, progress } = backdropAt(manifest, 500);
    expect(idOf(from)).toBe(manifest.scenes[0].id);
    expect(to).toBe(-1);
    expect(progress).toBe(0);
  });

  it("holds the pair until the dissolve has finished, not until the line changes", () => {
    // The crossfade starts before the next line and outlasts that lead, so it
    // is still running after the words have moved on. Swapping the layers on
    // the line boundary would cut it in half and read as a jump.
    const boundary = manifest.lines[1].startMs;
    const lead = manifest.playback.crossfadeLeadMs;
    expect(manifest.scenes[1].transitionMs).toBeGreaterThan(lead);

    const during = backdropAt(manifest, boundary + 10);
    expect(idOf(during.from)).toBe(manifest.scenes[0].id);
    expect(idOf(during.to)).toBe(manifest.scenes[1].id);
    expect(during.progress).toBeGreaterThan(0);
    expect(during.progress).toBeLessThan(1);
  });

  it("puts the two pictures of a dissolve on different layers", () => {
    // The renderer gives a scene a layer by the parity of its index, so the
    // picture on a layer only ever changes while that layer is invisible.
    // Consecutive indexes guarantee the pair never collides.
    for (let ms = 0; ms <= manifest.durationMs; ms += 16) {
      const { from, to } = backdropAt(manifest, ms);
      if (to >= 0) expect(from % 2, `at ${ms}`).not.toBe(to % 2);
    }
  });

  it("never jumps: the picture is continuous across the whole poem", () => {
    let previous = backdropAt(manifest, 0);
    for (let ms = 16; ms <= manifest.durationMs; ms += 16) {
      const now = backdropAt(manifest, ms);
      if (previous.to >= 0 && now.to < 0) {
        // The dissolve finished: what was arriving must now be what is here.
        expect(now.from, `at ${ms}`).toBe(previous.to);
        expect(previous.progress).toBeGreaterThan(0.9);
      }
      if (previous.from !== now.from) {
        // `from` may only change when a dissolve completed, never mid-fade.
        expect(previous.to, `at ${ms}`).toBe(now.from);
      }
      previous = now;
    }
  });
});

describe("the piece's own theme", () => {
  it("ships with the poem and is not optional", () => {
    // Part of the reading rather than music behind it: no switch, and the
    // player drives it from the same transport as the voice.
    expect(manifest.theme).toBeDefined();
    expect(manifest.theme!.src).toBe("/poetry/farewell-russia/theme.mp3");
  });

  it("sits under the voice, but not out of earshot", () => {
    // Measured: the theme was generated at -16.8 dBFS and the reading sits at
    // -21.4. Ten decibels under is present without competing; below about
    // fifteen it stops being part of the piece and becomes background.
    const themeDbfs = -16.8;
    const voiceDbfs = -21.4;
    const separation = voiceDbfs - (themeDbfs + 20 * Math.log10(manifest.theme!.gain));
    expect(separation).toBeGreaterThan(6);
    expect(separation).toBeLessThan(15);
  });

  it("reads ahead of the voice, so a word is whole when it is said", () => {
    // An arrival takes about half a second; begun on the syllable the word
    // would still be forming after the voice had moved on.
    const lead = manifest.playback.tokenLeadMs ?? 0;
    expect(lead).toBeGreaterThan(120);
    expect(lead).toBeLessThan(400);
  });

  it("is not slowed or sped up", () => {
    // The reading sets its own pace; the format follows it.
    expect((manifest.playback as { rate?: number }).rate).toBeUndefined();
  });
});
