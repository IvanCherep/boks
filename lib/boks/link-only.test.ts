import { describe, expect, it } from "vitest";
import {
  isLinkOnlyFile,
  isLinkOnlyToken,
  linkOnlyContentType,
  linkOnlyFilePath,
  linkOnlyStorageUrl,
} from "@/lib/boks/link-only";

const token = "AbCdEfGhIjKlMnOpQrSt_-";

describe("link-only pieces", () => {
  it("accepts only a long random token", () => {
    expect(isLinkOnlyToken(token)).toBe(true);
    expect(isLinkOnlyToken("short")).toBe(false);
    expect(isLinkOnlyToken("kacheli")).toBe(false);
    expect(isLinkOnlyToken(`${token}/..`)).toBe(false);
    expect(isLinkOnlyToken(`${token}.`)).toBe(false);
  });

  it("serves only flat files of the three kinds a poem has", () => {
    for (const file of ["manifest.json", "narration.mp3", "theme.mp3", "cover.webp", "01-kacheli-i-rozhdenie.webp"]) {
      expect(isLinkOnlyFile(file)).toBe(true);
    }
    for (const file of ["../manifest.json", "scenes/01.webp", ".env", "index.html", "a.mp3.js", "Manifest.JSON", ""]) {
      expect(isLinkOnlyFile(file)).toBe(false);
    }
  });

  it("builds the storage address only for a valid token and file", () => {
    expect(linkOnlyStorageUrl("https://project.supabase.co/", token, "manifest.json")).toBe(
      `https://project.supabase.co/storage/v1/object/public/link-only/${token}/manifest.json`
    );
    expect(linkOnlyStorageUrl("https://project.supabase.co", token, "../x.json")).toBeNull();
    expect(linkOnlyStorageUrl("https://project.supabase.co", "nope", "manifest.json")).toBeNull();
  });

  it("names the right content type and same-origin path", () => {
    expect(linkOnlyContentType("narration.mp3")).toBe("audio/mpeg");
    expect(linkOnlyContentType("cover.webp")).toBe("image/webp");
    expect(linkOnlyContentType("manifest.json")).toMatch(/^application\/json/);
    expect(linkOnlyFilePath(token, "cover.webp")).toBe(`/l/${token}/f/cover.webp`);
  });
});
