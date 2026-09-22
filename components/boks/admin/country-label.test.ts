import { describe, expect, it } from "vitest";
import { countryFlag, countryLabel, countryName } from "@/components/boks/admin/country-label";

describe("naming a country for the console", () => {
  it("builds the flag from the code", () => {
    expect(countryFlag("RS")).toBe("🇷🇸");
    expect(countryFlag("RU")).toBe("🇷🇺");
  });

  it("names it in English", () => {
    expect(countryName("RS")).toBe("Serbia");
    expect(countryLabel("RU")).toBe("🇷🇺 Russia");
  });

  it("does not invent a flag for devices seen before countries were recorded", () => {
    expect(countryLabel("unknown")).toBe("Unknown");
    expect(countryFlag("unknown")).toBe("");
  });
});
