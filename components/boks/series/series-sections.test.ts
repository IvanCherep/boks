import { describe, expect, it } from "vitest";
import { seriesSectionFromPath, seriesSectionPages } from "@/components/boks/series/series-sections";
import { seriesCollections } from "@/components/boks/series/series-catalogue";

describe("a series section's own address", () => {
  it("opens by its slug and its earlier address", () => {
    expect(seriesSectionFromPath("veroslov")?.collection).toBe("prokhorov");
    expect(seriesSectionFromPath("prokhorov")?.slug).toBe("veroslov");
    expect(seriesSectionFromPath("Veroslov")?.slug).toBe("veroslov");
  });

  it("still opens when a messenger glues the message onto the link", () => {
    expect(seriesSectionFromPath(encodeURIComponent("veroslovСлушайте"))?.slug).toBe("veroslov");
    expect(seriesSectionFromPath("veroslov.")?.slug).toBe("veroslov");
  });

  it("is nothing for another word", () => {
    for (const segment of ["", "nobody", "veroslovs", "veroslov-2", "halloween"]) expect(seriesSectionFromPath(segment), segment).toBeNull();
  });

  it("names a real section, and previews from link-only storage as a wide JPEG", () => {
    for (const page of seriesSectionPages) {
      expect(seriesCollections.map((collection) => collection.id)).toContain(page.collection);
      expect(page.share.image).toMatch(/^\/l\/[A-Za-z0-9_-]{22,}\/f\/[a-z0-9-]+-share\.jpg$/);
      expect(page.share.description.length).toBeLessThanOrEqual(200);
      expect(`${page.share.title} ${page.share.description}`).not.toMatch(/—/);
    }
  });
});
