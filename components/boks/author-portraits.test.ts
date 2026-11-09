import { describe, expect, it } from "vitest";
import { authorPortraitFor, authorPortraits } from "@/components/boks/author-portraits";

describe("author portraits", () => {
  it("are found by handle, with or without @, in any case", () => {
    expect(authorPortraitFor("prokhorov")?.family).toBe("Прохоров");
    expect(authorPortraitFor("@Prokhorov")?.given).toBe("Алексей");
    expect(authorPortraitFor("boks")).toBeNull();
  });

  it("keep the author's photos in link-only storage, never in this public repository", () => {
    for (const portrait of authorPortraits) {
      for (const path of [portrait.photo, portrait.thumb, portrait.share].filter(Boolean)) {
        expect(path).toMatch(/^\/l\/[A-Za-z0-9_-]{22,}\/f\/[a-z0-9-]+\.(webp|jpg)$/);
      }
      if (portrait.share) expect(portrait.share).toMatch(/-share\.jpg$/);
    }
  });
});

describe("author aliases", () => {
  it("open the author's page under another name, with their own preview", async () => {
    const { authorAliasFor } = await import("@/components/boks/author-portraits");
    const found = authorAliasFor("veroslov")!;
    expect(found.portrait.handle).toBe("prokhorov");
    expect(found.alias.image).toMatch(/^\/l\/[A-Za-z0-9_-]{22,}\/f\/[a-z0-9-]+-share\.jpg$/);
    expect(found.alias.description.length).toBeLessThanOrEqual(200);
    expect(`${found.alias.title} ${found.alias.description}`).not.toMatch(/—/);
    expect(authorAliasFor("prokhorov")).toBeNull();
  });
});
