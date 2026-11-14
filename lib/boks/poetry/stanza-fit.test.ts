import { describe, expect, it } from "vitest";
import type { PoemManifest, PoemScene } from "@/lib/boks/poetry/manifest";
import { controlsBand, fitFrames, layoutStanzas, stanzaFitProblems, wordSize } from "@/lib/boks/poetry/stanza-fit";

/** A one-picture poem whose lines are `lines`, its zone starting at `y`. */
function poem(lines: string[], y: number, lead = true): PoemManifest {
  const scene: PoemScene = {
    id: "s1", line: lines.join(" / "), image: "/x.webp", startMs: 0, lines: lines.length,
    focalPoint: { x: 0.5, y: 0.5 }, safeZones: [{ x: 0.08, y, width: 0.84, height: 0.18 }],
    textPreset: "quiet-breath", transitionMs: 1000,
  };
  return {
    id: "t", title: "Проба", author: "boks", language: "ru", timingMode: "forced-alignment", audio: "/a.mp3",
    durationMs: 10_000, palette: { text: "#fff", active: "#fff", shadow: "#000" },
    playback: { crossfadeOffsetMs: 0, defaultCrossfadeMs: 1000, backgroundScaleFrom: 1, backgroundScaleTo: 1 },
    scenes: [scene],
    lines: lines.map((text, index) => ({
      sceneId: "s1", startMs: index * 1000, endMs: index * 1000 + 900,
      tokens: text.split(" ").map((word, i, all) => ({ text: word, atMs: index * 1000 + i * 100, endMs: index * 1000 + i * 100 + 90, ...(lead && i === all.length - 1 ? { emphasis: "lead" as const } : {}) })),
    })),
  };
}

const iPhone15 = { name: "iPhone 15", width: 390, height: 844 };
// «Нишевые интересы», picture 4, as published on 2026-11-14: the browser drew it 233 px tall.
const nishevye = [
  "Мне ближе, чем новое и оригинальное,",
  "С непропорциональными хлястиками.",
  "Всё потасканное по самым злачным местам.",
  "Мой аромат выбран по нотам и в нём",
  "Мускат сочетается с архаичным",
];

describe("a stanza laid out as the player lays it out", () => {
  it("is sized from the column's width, within the format's limits", () => {
    expect(wordSize(390)).toBeCloseTo(25.74, 2);
    expect(wordSize(300)).toBe(24.8);
    expect(wordSize(1000)).toBe(40);
    expect(wordSize(390, 0.9)).toBeCloseTo(23.17, 2);
  });

  it("measures within a few pixels of the browser, never under", () => {
    const [fit] = layoutStanzas(poem(nishevye, 0.7), iPhone15);
    // Two rows: lines 1, 3, 5 share the first, 2 and 4 the second.
    const height = (fit.bottom - fit.top) * iPhone15.height;
    expect(height).toBeGreaterThanOrEqual(150);
    expect(height).toBeLessThan(260);
  });

  it("calls out a stanza set so low it runs under the player, and says how high to start it", () => {
    const problems = stanzaFitProblems(poem(nishevye, 0.7));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(/picture 1 \(s1\).*past 81% where the player begins.*Start the zone higher \(y at most \d+%\)/);
  });

  it("passes the same stanza started higher", () => {
    expect(stanzaFitProblems(poem(nishevye, 0.45))).toEqual([]);
  });

  it("breaks a word too long for the column at its hyphen, as the browser does, rather than shrinking the stanza", () => {
    const hyphen = layoutStanzas(poem(["Тянет карикатурно-продолговатая"], 0.1), iPhone15)[0];
    expect(hyphen.narrowed).toBe(false);
    const solid = layoutStanzas(poem(["Тянет карикатурнопродолговатаяфигураснизким"], 0.1), iPhone15)[0];
    expect(solid.narrowed).toBe(true);
  });

  it("checks the shortest frame a reader gets, Safari with its toolbars", () => {
    expect(fitFrames.some((frame) => frame.height < 700)).toBe(true);
    expect(controlsBand).toBeGreaterThan(0.12);
  });
});
