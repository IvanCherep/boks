import { describe, expect, it } from "vitest";
import { chosenAfterAdding, chosenAfterRemoving, currentVoice, promptStanzas, voiceFingerprint, voiceText, type VoiceTake } from "@/lib/boks/author/voice/rules";

const take = (file: string, fingerprint: string): VoiceTake => ({ file, fingerprint, durationMs: 60000, bytes: 1000, source: "teleprompter", name: null, createdAt: "2026-11-22T10:00:00Z" });

describe("the fingerprint of the text a take reads", () => {
  it("is the database's own (boks_voice_fingerprint gives the same for this text)", async () => {
    // Checked against `select public.boks_voice_fingerprint(...)` on the local stack, 2026-11-22.
    expect(await voiceFingerprint("  Люблю грозу\tв начале мая,\r\n\nкогда весенний «первый» гром…  ")).toBe("884611af341be373");
  });

  it("keeps a take current when only spaces and line breaks change, and not when a word does", async () => {
    const text = "Первая строка.\nВторая строка.";
    expect(voiceText("  Первая  строка.\n\n\tВторая строка. ")).toBe(voiceText(text));
    expect(await voiceFingerprint("Первая строка.\n\nВторая   строка.")).toBe(await voiceFingerprint(text));
    expect(await voiceFingerprint("Первая строка.\nДругая строка.")).not.toBe(await voiceFingerprint(text));
  });
});

describe("which take goes to the editors", () => {
  it("is the chosen one, only while it reads the text as it is", () => {
    const takes = { takes: [take("take-1.webm", "aaaaaaaaaaaaaaaa"), take("take-2.wav", "bbbbbbbbbbbbbbbb")], chosen: "take-1.webm" };
    expect(currentVoice(takes, "aaaaaaaaaaaaaaaa")?.file).toBe("take-1.webm");
    expect(currentVoice(takes, "bbbbbbbbbbbbbbbb")).toBeNull(); // the chosen take is of an older text
    expect(currentVoice({ takes: [], chosen: null }, "aaaaaaaaaaaaaaaa")).toBeNull();
    expect(currentVoice(null, "aaaaaaaaaaaaaaaa")).toBeNull();
  });

  it("is the newest when none is chosen or the chosen one reads another text", () => {
    const first = take("take-1.webm", "aaaaaaaaaaaaaaaa");
    expect(chosenAfterAdding({ takes: [], chosen: null }, first)).toBe("take-1.webm");
    expect(chosenAfterAdding({ takes: [first], chosen: "take-1.webm" }, take("take-2.webm", "aaaaaaaaaaaaaaaa"))).toBe("take-1.webm");
    expect(chosenAfterAdding({ takes: [first], chosen: "take-1.webm" }, take("take-2.webm", "bbbbbbbbbbbbbbbb"))).toBe("take-2.webm");
  });

  it("after a delete: the chosen one stays, else the newest of the current text, else the newest", () => {
    const takes = [take("take-1.webm", "aaaaaaaaaaaaaaaa"), take("take-2.webm", "bbbbbbbbbbbbbbbb"), take("take-3.webm", "aaaaaaaaaaaaaaaa")];
    expect(chosenAfterRemoving(takes, "take-1.webm", "take-3.webm")).toBe("take-1.webm");
    expect(chosenAfterRemoving(takes, "take-3.webm", "take-3.webm", "bbbbbbbbbbbbbbbb")).toBe("take-2.webm");
    expect(chosenAfterRemoving(takes, "take-3.webm", "take-3.webm")).toBe("take-2.webm");
    expect(chosenAfterRemoving([takes[0]], "take-1.webm", "take-1.webm")).toBeNull();
  });
});

describe("the text on the teleprompter", () => {
  it("keeps a poem's lines and stanzas as typed", () => {
    expect(promptStanzas("Люблю грозу в начале мая,\nКогда весенний, первый гром,\n\nКак бы резвяся и играя,\nГрохочет в небе голубом.")).toEqual([
      ["Люблю грозу в начале мая,", "Когда весенний, первый гром,"],
      ["Как бы резвяся и играя,", "Грохочет в небе голубом."],
    ]);
  });

  it("cuts prose into lines of about 64 characters, at sentences, then commas, then words", () => {
    const paragraph = "Утро было серым. Мы вышли из дома рано, когда улицы ещё спали, и пошли к реке, где туман лежал на воде, как вата, и не хотел подниматься. Потом пошёл дождь.";
    const [lines] = promptStanzas(`${paragraph}\n\nВторой абзац.`).slice(0, 1);
    expect(lines.every((line) => line.length <= 64)).toBe(true);
    expect(lines.join(" ")).toBe(paragraph);
    expect(lines[0]).toMatch(/^Утро было серым\. /);
    expect(lines.length).toBeGreaterThan(2);
    expect(promptStanzas(`${paragraph}\n\nВторой абзац.`)[1]).toEqual(["Второй абзац."]);
  });

  it("cuts one endless word run between words, and leaves no empty lines", () => {
    const run = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(" ");
    const lines = promptStanzas(`\n\n${run}\n\n\n`).flat();
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.every((line) => line.length > 0 && line.length <= 64)).toBe(true);
    expect(lines.join(" ")).toBe(run);
  });
});
