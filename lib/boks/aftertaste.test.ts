import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  aftertasteTags,
  isAftertasteTag,
  isReaderEventType,
  readerEventTypes,
} from "@/lib/boks/contracts";

describe("the aftertaste vocabulary", () => {
  it("is four words, none of them a verdict", () => {
    expect(aftertasteTags).toEqual(["smiled", "moved", "surprised", "pondering"]);
    expect(new Set(aftertasteTags).size).toBe(4);
  });

  it("recognises its own words and nothing else", () => {
    for (const tag of aftertasteTags) expect(isAftertasteTag(tag)).toBe(true);
    expect(isAftertasteTag("loved")).toBe(false);
    expect(isAftertasteTag("")).toBe(false);
    expect(isAftertasteTag(undefined)).toBe(false);
    expect(isAftertasteTag(3)).toBe(false);
  });

  it("is carried by an event type the queue will accept", () => {
    expect(readerEventTypes).toContain("aftertaste");
    expect(isReaderEventType("aftertaste")).toBe(true);
  });

  it("is allowed by the database too", () => {
    // The client knowing an event type the table's CHECK constraint rejects is
    // a whole evening of reader answers landing in a rejected batch, and the
    // reader would never see a thing go wrong. So the two lists are compared
    // rather than trusted to have been updated together.
    const sql = readFileSync("supabase/migrations/20261001090000_boks_aftertaste.sql", "utf8");
    const allowed = sql
      .slice(sql.indexOf("check (event_type in ("))
      .match(/'([a-z]+)'/g)
      ?.map((quoted) => quoted.replaceAll("'", ""));
    expect(allowed).toBeDefined();
    for (const type of readerEventTypes) expect(allowed, type).toContain(type);
  });
});
