import { describe, expect, it } from "vitest";
import { countryFrom } from "@/lib/boks/geo";

describe("reading Cloudflare's country header", () => {
  it("keeps a real country code, upper-cased", () => {
    expect(countryFrom("RS")).toBe("RS");
    expect(countryFrom(" ru ")).toBe("RU");
  });

  it("refuses what is not a country", () => {
    expect(countryFrom("XX")).toBeNull();
    expect(countryFrom("T1")).toBeNull();
    expect(countryFrom("Russia")).toBeNull();
    expect(countryFrom(null)).toBeNull();
    expect(countryFrom("")).toBeNull();
  });
});
