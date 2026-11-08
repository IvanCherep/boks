import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientIp, countryInDatabase, lookupCountry } from "@/lib/boks/geoip";

describe("the address a country is looked up for", () => {
  it("is the one Caddy saw: the last X-Forwarded-For entry", () => {
    expect(clientIp("93.87.1.10")).toBe("93.87.1.10");
    expect(clientIp("1.2.3.4, 93.87.1.10")).toBe("93.87.1.10");
    expect(clientIp("2a02:2a40::1")).toBe("2a02:2a40::1");
  });

  it("is nothing when the header is missing or not an address", () => {
    expect(clientIp(null)).toBeNull();
    expect(clientIp("")).toBeNull();
    expect(clientIp("unknown")).toBeNull();
    expect(clientIp("<script>")).toBeNull();
  });
});

describe("a country from the database", () => {
  it("keeps a real code and refuses anything else", () => {
    const reader = (code?: string) => ({ get: () => (code ? { country: { iso_code: code } } : null) });
    expect(countryInDatabase(reader("RS"), "93.87.1.10")).toBe("RS");
    expect(countryInDatabase(reader(), "10.0.0.1")).toBeNull();
    expect(countryInDatabase(reader("XX"), "1.1.1.1")).toBeNull();
    expect(countryInDatabase({ get: () => { throw new Error("bad address"); } }, "x")).toBeNull();
  });

  it("is nothing, not an error, without a database file", async () => {
    expect(await lookupCountry("93.87.1.10", undefined)).toBeNull();
    expect(await lookupCountry("93.87.1.10", "/nonexistent/country.mmdb")).toBeNull();
    expect(await lookupCountry(null, "/nonexistent/country.mmdb")).toBeNull();
  });

  // Runs against the real file when one is given: BOKS_GEOIP_TEST_DB=<path to dbip-country-lite.mmdb>.
  const realDb = process.env.BOKS_GEOIP_TEST_DB;
  it.skipIf(!realDb || !existsSync(realDb))("finds known networks in the real database", async () => {
    expect(await lookupCountry("8.8.8.8", realDb)).toBe("US");
    expect(await lookupCountry("77.88.8.8", realDb)).toBe("RU");
    expect(await lookupCountry("127.0.0.1", realDb)).toBeNull();
  });
});
