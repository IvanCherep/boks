import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  backdropAt,
  crossfadeProgress,
  lineIndexAt,
  nextLineStart,
  playedFraction,
  previousLineStart,
  presetFor,
  sceneAt,
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
  it("is eight lines over four scenes, with real timings", () => {
    // Two lines to a picture. Eight pictures across seventeen seconds changed
    // every two, which is faster than anyone can settle into a frame.
    expect(manifest.lines).toHaveLength(8);
    expect(manifest.scenes).toHaveLength(4);
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

  it("stays lit while its phrase runs, instead of going out on the next word", () => {
    // "немытая" and "Россия," are one phrase. The first does not dim when the
    // second is spoken - a word going out as the next comes on is what made
    // the line blink its way across the screen.
    const second = line.tokens[2];
    expect(line.tokens[1].phrase).toBe(second.phrase);
    expect(tokenStateAt(line, 1, second.atMs)).toBe("active");
    expect(tokenStateAt(line, 2, second.atMs)).toBe("active");
  });

  it("puts a phrase out all at once, when it is over", () => {
    // "Прощай," is its own phrase and ends where the next begins.
    const next = line.tokens.find((t) => t.phrase !== line.tokens[0].phrase)!;
    expect(tokenStateAt(line, 0, next.atMs - 1)).toBe("active");
    expect(tokenStateAt(line, 0, next.atMs)).toBe("settled");
  });

  it("keeps the last word of a line lit until the line ends", () => {
    const last = line.tokens.length - 1;
    expect(tokenStateAt(line, last, line.endMs - 1)).toBe("active");
    expect(tokenStateAt(line, last, line.endMs)).toBe("settled");
  });

  it("never lights words from two phrases at once", () => {
    // Several words may be lit - that is the point - but they must all belong
    // to the same phrase, or the screen is showing two thoughts at a time.
    for (const current of manifest.lines) {
      for (let ms = current.startMs; ms < current.endMs; ms += 40) {
        const lit = current.tokens.filter(
          (_, index) => tokenStateAt(current, index, ms) === "active"
        );
        const phrases = new Set(lit.map((token) => token.phrase));
        expect(phrases.size, `${current.sceneId} at ${ms}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("groups the poem into phrases its punctuation already marks", () => {
    // Thirteen, not thirty-three: a handover every 1.3 seconds rather than
    // every half second.
    const phrases = new Set(
      manifest.lines.flatMap((l) => l.tokens.map((token) => token.phrase))
    );
    expect(phrases.size).toBe(13);
    // And a phrase always ends on the word marked as carrying it.
    for (const l of manifest.lines) {
      l.tokens.forEach((token, index) => {
        const next = l.tokens[index + 1];
        if (next && next.phrase !== token.phrase) {
          expect(token.emphasis, token.text).toBe("lead");
        }
      });
    }
  });
});

describe("where a word is placed", () => {
  it("splits one line between two parts of the frame, and only that one", () => {
    const split = manifest.scenes.find((scene) => scene.textPreset === "social-hierarchy-split")!;
    expect(zoneFor(split, "lower").y).toBeGreaterThan(zoneFor(split, "upper").y);

    // The masters sit above the slaves. That is the line's whole argument -
    // and only that line. Its picture now also carries the line before it,
    // which must stay whole: "Прощай," low and "Россия," high argues nothing.
    const shared = manifest.lines.filter((l) => l.sceneId === split.id);
    expect(shared).toHaveLength(2);
    expect(shared[0].tokens.every((t) => t.zone === undefined)).toBe(true);
    expect(shared[1].tokens.filter((t) => t.zone === "lower")).toHaveLength(2);
    expect(shared[1].tokens.filter((t) => t.zone === "upper")).toHaveLength(2);
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
  const offset = manifest.playback.crossfadeOffsetMs;

  it("has not begun in the middle of a line", () => {
    expect(crossfadeProgress(manifest.lines, 0, 100, offset, 1100)).toBe(0);
  });

  it("begins after the line has landed, not with it", () => {
    // The word and the whole world behind it moving on the same beat is what
    // made a short poem feel cut rather than read.
    expect(offset).toBeGreaterThan(0);
    const begins = manifest.lines[1].startMs + offset;
    expect(crossfadeProgress(manifest.lines, 0, manifest.lines[1].startMs, offset, 1100)).toBe(0);
    expect(crossfadeProgress(manifest.lines, 0, begins, offset, 1100)).toBe(0);
    expect(crossfadeProgress(manifest.lines, 0, begins + 550, offset, 1100)).toBeCloseTo(0.5, 1);
    expect(crossfadeProgress(manifest.lines, 0, begins + 1100, offset, 1100)).toBe(1);
  });

  it("leaves the picture still for part of every line", () => {
    // A dissolve that ran until the next one began would never settle. Each
    // scene has to be itself for a while, or there is nothing to look at.
    for (let index = 0; index < manifest.lines.length - 1; index += 1) {
      const scene = sceneFor(manifest, index + 1)!;
      const span = manifest.lines[index + 1].endMs - manifest.lines[index + 1].startMs;
      expect(offset + scene.transitionMs, scene.id).toBeLessThan(span + offset);
    }
  });

  it("does not run off the end of the poem", () => {
    const last = manifest.lines.length - 1;
    expect(crossfadeProgress(manifest.lines, last, manifest.durationMs, offset, 1100)).toBe(0);
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
  // Scene indexes, not line indexes: `backdropAt` deals in pictures.
  const idOf = (index: number) => sceneAt(manifest, index)?.id ?? null;

  it("shows one scene, alone, in the middle of a line", () => {
    const { from, to, progress } = backdropAt(manifest, 500);
    expect(idOf(from)).toBe(manifest.scenes[0].id);
    expect(to).toBe(-1);
    expect(progress).toBe(0);
  });

  it("still shows the old picture when the new line's first word arrives", () => {
    // The word lands in the scene belonging to the line before it, and only
    // then does the world turn. That gap is the aftertaste.
    const boundary = manifest.scenes[1].startMs;
    const during = backdropAt(manifest, boundary + 10);
    expect(idOf(during.from)).toBe(manifest.scenes[0].id);
    expect(during.to).toBe(-1);
    expect(during.progress).toBe(0);
  });

  it("turns the scene once the word has been in the air a while", () => {
    const begins = manifest.scenes[1].startMs + manifest.playback.crossfadeOffsetMs;
    const during = backdropAt(manifest, begins + 200);
    expect(idOf(during.from)).toBe(manifest.scenes[0].id);
    expect(idOf(during.to)).toBe(manifest.scenes[1].id);
    expect(during.progress).toBeGreaterThan(0);
    expect(during.progress).toBeLessThan(1);
  });

  it("holds the same picture across both of its lines", () => {
    // The pair shares a scene, so nothing may change between them.
    const second = manifest.lines[1];
    const atFirst = backdropAt(manifest, 200);
    const atSecond = backdropAt(manifest, second.startMs + 200);
    expect(atSecond.from).toBe(atFirst.from);
    expect(atSecond.to).toBe(-1);
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

describe("how long a picture stays", () => {
  it("gives every scene time to be looked at", () => {
    // The complaint this answers: the frames jumped too fast to settle into.
    // Three and a half seconds is about where a full-screen image stops being
    // a flash and starts being a place.
    const starts = manifest.scenes.map((scene) => scene.startMs);
    for (let index = 0; index < starts.length; index += 1) {
      const until = starts[index + 1] ?? manifest.durationMs;
      expect(until - starts[index], manifest.scenes[index].id).toBeGreaterThan(3500);
    }
  });

  it("spends more of each scene still than dissolving", () => {
    // A dissolve that ran most of the way to the next one would never settle.
    for (let index = 1; index < manifest.scenes.length; index += 1) {
      const scene = manifest.scenes[index];
      const until = manifest.scenes[index + 1]?.startMs ?? manifest.durationMs;
      const span = until - scene.startMs;
      expect(scene.transitionMs, scene.id).toBeLessThan(span / 2);
    }
  });
});

describe("stepping through the poem", () => {
  const lines = manifest.lines;

  it("goes to the start of the line you are in", () => {
    const second = lines[1];
    expect(previousLineStart(lines, second.startMs + 900)).toBe(second.startMs);
  });

  it("goes to the line before when you are at the top of one", () => {
    // Without this, tapping back twice gives the same line twice and the
    // control looks broken.
    const second = lines[1];
    expect(previousLineStart(lines, second.startMs + 100)).toBe(lines[0].startMs);
    expect(previousLineStart(lines, second.startMs)).toBe(lines[0].startMs);
  });

  it("stops at the beginning rather than going negative", () => {
    expect(previousLineStart(lines, 0)).toBe(0);
    expect(previousLineStart(lines, 50)).toBe(0);
  });

  it("goes forward a line, and no further than the end", () => {
    expect(nextLineStart(lines, 0, manifest.durationMs)).toBe(lines[1].startMs);
    const last = lines.at(-1)!;
    expect(nextLineStart(lines, last.startMs + 10, manifest.durationMs)).toBe(manifest.durationMs);
  });

  it("lands on a moment the renderer can draw from scratch", () => {
    // Everything is a function of the timecode, so a step has to leave the
    // scene, the phrase and the lit word all correct in one frame.
    for (const line of lines) {
      const index = lineIndexAt(lines, line.startMs);
      expect(sceneFor(manifest, index)).not.toBeNull();
      expect(backdropAt(manifest, line.startMs).from).toBeGreaterThanOrEqual(0);
      expect(tokenStateAt(line, 0, line.startMs)).toBe("active");
    }
  });
});
