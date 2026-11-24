import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classicPortraitFiles, searchPortraitFor } from "./search-portraits";

const publicDir = fileURLToPath(new URL("../../../public", import.meta.url));

describe("search portraits", () => {
  it("every registered classic portrait is a file the site serves", () => {
    for (const [byline, file] of classicPortraitFiles) {
      expect(existsSync(`${publicDir}/onboarding/assets/authors/classics-v52/${file}`), `${byline}: ${file}`).toBe(true);
    }
    expect(classicPortraitFiles.size).toBe(42);
  });

  it("gives a classic's face only to that byline under @boks", () => {
    expect(searchPortraitFor({ kind: "byline", handle: "boks", byline: "Антон Чехов", photoVersion: null })).toBe("/onboarding/assets/authors/classics-v52/chekhov.webp");
    expect(searchPortraitFor({ kind: "byline", handle: "someone", byline: "Антон Чехов", photoVersion: null })).toBeNull();
    expect(searchPortraitFor({ kind: "byline", handle: "boks", byline: "Яков Полонский", photoVersion: null })).toBeNull();
  });

  it("gives an author the photo of their own page, by its version", () => {
    expect(searchPortraitFor({ kind: "account", handle: "demidov", byline: null, photoVersion: 3 })).toBe("/a/demidov/photo?v=3");
    expect(searchPortraitFor({ kind: "account", handle: "demidov", byline: null, photoVersion: null })).toBeNull();
  });
});
