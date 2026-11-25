import { describe, expect, it } from "vitest";
import { musicCreditLine, musicCreditNames } from "./music-credit";

describe("music credit", () => {
  it("drops the author's own label, keeps the names as written", () => {
    expect(musicCreditNames("авторы музыки: Л. Булдыгин, В. Рвачев")).toBe("Л. Булдыгин, В. Рвачев");
    expect(musicCreditNames("автор музыки: Л.Булдыгин при содействии В.Рвачева и Н.Станиславчик")).toBe("Л.Булдыгин при содействии В.Рвачева и Н.Станиславчик");
    expect(musicCreditNames("Музыка — Н. Станиславчик")).toBe("Н. Станиславчик");
    expect(musicCreditNames("  Л. Булдыгин  ")).toBe("Л. Булдыгин");
  });

  it("prints one label, nothing for an empty credit", () => {
    const ru = (_en: string, ru: string) => ru;
    expect(musicCreditLine("авторы музыки: Л. Булдыгин, В. Рвачев", ru)).toBe("Музыка: Л. Булдыгин, В. Рвачев");
    expect(musicCreditLine("музыка:", ru)).toBe("");
  });
});
