import { describe, expect, it } from "vitest";
import { cleanFacetValues, facetDefinition, facets } from "./rubric";

describe("reading facets", () => {
  it("registers the values the What to read panel offers", () => {
    expect(facetDefinition("mood")?.values).toEqual(["sad", "fun", "think"]);
    expect(facetDefinition("author_group")?.values).toEqual(["classics", "contemporary"]);
    expect(facetDefinition("format")?.values).toEqual(["prose", "poetry"]);
  });

  it("gives every labelled facet a rubric and no derived facet one", () => {
    for (const facet of facets) {
      expect(facet.rubric.length > 0).toBe(facet.subject !== "derived");
    }
  });

  it("keeps a labeller's answer to known values, once each, in order", () => {
    expect(cleanFacetValues("mood", ["think", "angry", "sad", "think"])).toEqual(["think", "sad"]);
    expect(cleanFacetValues("mood", "sad")).toEqual([]);
    expect(cleanFacetValues("mood", [])).toEqual([]);
  });

  it("gives a single-valued facet one value and an unknown facet none", () => {
    expect(cleanFacetValues("author_group", ["classics", "contemporary"])).toEqual(["classics"]);
    expect(cleanFacetValues("genre", ["poem"])).toEqual([]);
  });
});
