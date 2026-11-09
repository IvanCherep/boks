import { describe, expect, it } from "vitest";
import { authorFromPath, authorPath, bokPath, isBokPath } from "@/lib/boks/reader-address";

describe("the address while reading", () => {
  it("names an author as /@handle and reads it back", () => {
    expect(authorPath("@prokhorov")).toBe("/@prokhorov");
    expect(authorFromPath("/@prokhorov")).toBe("prokhorov");
    expect(authorFromPath("/%40prokhorov")).toBeNull();
    expect(authorFromPath("/@pro/khorov")).toBeNull();
    expect(authorFromPath("/series")).toBeNull();
  });

  it("names a bok by its slug", () => {
    expect(bokPath("kosa-prokhorov")).toBe("/b/kosa-prokhorov");
    expect(isBokPath("/b/kosa-prokhorov")).toBe(true);
    expect(isBokPath("/b/kosa/image")).toBe(false);
    expect(isBokPath("/")).toBe(false);
  });
});
