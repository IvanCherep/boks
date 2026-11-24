import { describe, expect, it } from "vitest";
import { toAuthorSearchPage } from "./search-answer";

describe("toAuthorSearchPage", () => {
  it("keeps two writers of one publisher apart and opens an author page as the account", () => {
    const page = toAuthorSearchPage({
      hasMore: true,
      results: [
        { kind: "account", handle: "demidov", byline: null, name: "Евгений Демидов", photoVersion: 1 },
        { kind: "byline", handle: "boks", byline: "Антон Чехов", name: "Антон Чехов", photoVersion: null },
        { kind: "byline", handle: "boks", byline: "Яков Полонский", name: "Яков Полонский", photoVersion: null },
      ],
    });
    expect(page.hasMore).toBe(true);
    expect(page.results.map((row) => row.target)).toEqual([
      { kind: "account", handle: "demidov" },
      { kind: "byline", accountHandle: "boks", byline: "Антон Чехов" },
      { kind: "byline", accountHandle: "boks", byline: "Яков Полонский" },
    ]);
    expect(page.results.map((row) => row.avatarUrl)).toEqual([
      "/a/demidov/photo?v=1",
      null,
      null,
    ]);
  });

  it("drops rows it cannot open and refuses an answer that is not a page", () => {
    const page = toAuthorSearchPage({ results: [{ kind: "byline", handle: "boks", name: "Без подписи" }, { kind: "account", name: "Без адреса" }, { kind: "other", handle: "x", name: "X" }] });
    expect(page).toEqual({ results: [], hasMore: false });
    expect(() => toAuthorSearchPage(null)).toThrow();
  });
});
