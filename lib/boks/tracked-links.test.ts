import { describe, expect, it } from "vitest";
import { bokIdFromInput, linkCodeFrom, trackedLinkUrl } from "@/lib/boks/tracked-links";

const id = "a1e3baf7-44da-4867-a817-088f1cdfbd26";

describe("tracked links", () => {
  it("finds the bok in whatever an admin pastes", () => {
    expect(bokIdFromInput(id)).toBe(id);
    expect(bokIdFromInput(`https://tryboks.com/b/${id}`)).toBe(id);
    expect(bokIdFromInput(`https://tryboks.com/?bok=${id.toUpperCase()}&from=share`)).toBe(id);
    // The messenger-damaged form `share-preview.ts` repairs.
    expect(bokIdFromInput(`https://tryboks.com/b/${id}Read "Конкурс" on boks`)).toBe(id);
    expect(bokIdFromInput("Лев и собачка")).toBeNull();
  });

  it("accepts the codes the database accepts, and nothing else", () => {
    expect(linkCodeFrom(" MSU-Philology ")).toBe("msu-philology");
    expect(linkCodeFrom("a")).toBe("a");
    expect(linkCodeFrom("-msu")).toBeNull();
    expect(linkCodeFrom("msu-")).toBeNull();
    expect(linkCodeFrom("мгу")).toBeNull();
    expect(linkCodeFrom("a".repeat(41))).toBeNull();
    expect(linkCodeFrom(null)).toBeNull();
  });

  it("builds the link to send: a bok's share link with the code, or the feed with it", () => {
    expect(trackedLinkUrl("https://tryboks.com/", { code: "msu", bokId: id })).toBe(
      `https://go.tryboks.com/b/${id}?link=msu`
    );
    expect(trackedLinkUrl("https://tryboks.com", { code: "msu", bokId: null })).toBe("https://go.tryboks.com/?link=msu");
    expect(trackedLinkUrl("http://localhost:3000", { code: "msu", bokId: null })).toBe("http://localhost:3000/?link=msu");
  });
});
