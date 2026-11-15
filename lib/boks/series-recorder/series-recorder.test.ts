import { describe, expect, it } from "vitest";
import { characterAlignment, matchTake, shiftAlignment } from "@/lib/boks/series-recorder/alignment";
import { draftGaps, estimatedReadingMs, lineWords, poemLines, takeExtension } from "@/lib/boks/series-recorder/rules";
import { linesPerPicture, planSceneMap } from "@/lib/boks/series-recorder/scene-plan";

describe("poemLines", () => {
  it("keeps the author's lines and counts stanzas by blank lines", () => {
    const poem = poemLines("  Мороз и солнце; день чудесный!\r\nЕщё ты дремлешь\n\n\nПора, красавица\n");
    expect(poem.lines).toEqual(["Мороз и солнце; день чудесный!", "Ещё ты дремлешь", "Пора, красавица"]);
    expect(poem.stanzas).toEqual([2, 1]);
  });

  it("does not count a dash as a word", () => {
    expect(lineWords("века — и снова")).toEqual(["века", "и", "снова"]);
  });

  it("estimates a first pace from words and lines", () => {
    expect(estimatedReadingMs(["раз два три четыре", "пять шесть"])).toBe(Math.round((6 / 2.1) * 1000 + 700));
  });
});

describe("takeExtension", () => {
  it("names what Chrome and Safari record, and refuses the rest", () => {
    expect(takeExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(takeExtension("audio/mp4")).toBe("mp4");
    expect(takeExtension("text/html")).toBeNull();
  });
});

describe("draftGaps", () => {
  const base = { title: "Связь", text: "строка", takes: [{ file: "take-1.webm", durationMs: 1000, bytes: 1, createdAt: "" }], images: [{ file: "image-1.jpg", width: 1, height: 1, source: "upload" as const }], chosenTake: "take-1.webm" };
  it("is empty when a draft can be built", () => expect(draftGaps(base)).toEqual([]));
  it("names what is missing, in order", () => {
    expect(draftGaps({ ...base, title: " ", images: [], chosenTake: "take-9.webm" })).toEqual(["title", "take", "images"]);
  });
});

describe("linesPerPicture", () => {
  it("keeps stanzas whole and shares lines as evenly as that allows", () => {
    expect(linesPerPicture([4, 4, 4, 4], 2)).toEqual([8, 8]);
    expect(linesPerPicture([2, 3, 5, 6, 6, 6], 3)).toEqual([10, 6, 12]);
  });

  it("splits the longest stanza when there are more pictures than stanzas", () => {
    // Equal costs may land either way round; the shares are what matter.
    expect([...linesPerPicture([8], 3)].sort()).toEqual([2, 3, 3]);
    expect([...linesPerPicture([3, 1], 3)].sort()).toEqual([1, 1, 2]);
    expect(linesPerPicture([3, 1], 3).at(-1)).toBe(1);
  });

  it("never gives a picture no lines", () => {
    expect(linesPerPicture([1, 1], 5)).toEqual([1, 1]);
    expect(linesPerPicture([], 3)).toEqual([]);
  });

  it("always covers every line", () => {
    for (const stanzas of [[5, 2, 7, 1], [12], [1, 1, 1, 1, 1, 1, 1]]) {
      for (let pictures = 1; pictures <= 5; pictures += 1) {
        const sizes = linesPerPicture(stanzas, pictures);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(stanzas.reduce((a, b) => a + b, 0));
        expect(sizes.every((n) => n > 0)).toBe(true);
      }
    }
  });
});

describe("planSceneMap", () => {
  it("gives each picture its run of lines, in the author's order", () => {
    const map = planSceneMap({ title: "T", author: "A", language: "ru", lines: ["a", "b", "c", "d"], stanzas: [2, 2], images: ["scene-01.webp", "scene-02.webp"] });
    expect(map.scenes.map((scene) => [scene.image, scene.lines, scene.line])).toEqual([
      ["scene-01.webp", 2, "a / b"],
      ["scene-02.webp", 2, "c / d"],
    ]);
  });
});

describe("alignment", () => {
  const text = "Ветер за окном\nв ночи";
  // Forced alignment glues «в» to the end of the line before it.
  const aligned = {
    characters: [...text].map((ch, i) => ({ text: ch, start: i < 14 ? 1 + i * 0.05 : i < 16 ? 1.65 : 2.6 + (i - 17) * 0.05, end: i < 14 ? 1.05 + i * 0.05 : i < 16 ? 2.5 : 2.65 + (i - 17) * 0.05 })),
    words: [],
  };
  const heard = [
    { text: "Ветер", start: 1, end: 1.25 },
    { text: "за", start: 1.25, end: 1.35 },
    { text: "окном", start: 1.35, end: 1.7 },
    { text: "в", start: 2.4, end: 2.5 },
    { text: "ночи", start: 2.6, end: 2.85 },
  ];

  it("takes speech to text's start for a short word glued to the phrase before", () => {
    const timed = characterAlignment(text, aligned, heard);
    expect(timed.characters.join("")).toBe(text);
    expect(timed.character_start_times_seconds[15]).toBe(2.4);
  });

  it("shifts every time when the head of the take is trimmed, never below zero", () => {
    const shifted = shiftAlignment(characterAlignment(text, aligned, heard), 1.2);
    expect(shifted.character_start_times_seconds[0]).toBe(0);
    expect(shifted.character_start_times_seconds[15]).toBe(1.2);
  });

  it("measures how much of the text the take reads, and what it missed", () => {
    const match = matchTake("Мороз и солнце день чудесный", [
      { text: "Мороз", start: 0, end: 0 },
      { text: "и", start: 0, end: 0 },
      { text: "[вдох]", start: 0, end: 0, type: "audio_event" },
      { text: "солнце,", start: 0, end: 0 },
      { text: "чудесный", start: 0, end: 0 },
      { text: "друг", start: 0, end: 0 },
    ]);
    expect(match.match).toBeCloseTo(0.8);
    expect(match.missed).toEqual(["день"]);
    expect(match.extra).toEqual(["друг"]);
  });
});

describe("art", () => {
  it("keeps a prompt within the image model's 500 characters, the look always whole", async () => {
    const { artPrompt, artStyle, promptLimit } = await import("@/lib/boks/series-recorder/art");
    const long = artPrompt("Очень длинная сцена ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(promptLimit);
    expect(long.endsWith(artStyle)).toBe(true);
    expect(artPrompt("Туман над озером.")).toBe(`Туман над озером. ${artStyle}`);
  });

  it("reads one scene a number from the reply, null where there is none", async () => {
    const { readScenes } = await import("@/lib/boks/series-recorder/art");
    const scenes = readScenes("Вот сцены:\n**1.** Пустая комната с книгой.\n3) «Озеро на рассвете»", 3);
    expect(scenes).toEqual(["Пустая комната с книгой.", null, "Озеро на рассвете"]);
  });

  it("asks without the title or the whole poem, which tripped the content filter", async () => {
    const { scenesRequest } = await import("@/lib/boks/series-recorder/art");
    const request = scenesRequest([["Люблю грозу в начале мая"], ["Когда весенний, первый гром"]]);
    expect(request).toContain("1. Люблю грозу в начале мая");
    expect(request).toContain("ровно 2 строками");
  });
});
