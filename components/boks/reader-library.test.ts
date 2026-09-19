import { describe, expect, it } from "vitest";
import type { ReaderLibraryItem } from "@/components/boks/client-types";
import { selectReaderLibraryItems } from "@/components/boks/reader-library";

const item = (overrides: Partial<ReaderLibraryItem>): ReaderLibraryItem => ({
  storyId: "story",
  title: "A story",
  authorName: "An Author",
  minutes: 4,
  readAt: null,
  likedAt: null,
  commentedAt: null,
  liked: false,
  commented: false,
  ...overrides,
});

describe("selectReaderLibraryItems", () => {
  const library = [
    item({ storyId: "read", title: "Read only", readAt: "2026-09-17T12:00:00Z" }),
    item({
      storyId: "liked",
      title: "Liked only",
      likedAt: "2026-09-19T12:00:00Z",
      liked: true,
    }),
    item({
      storyId: "commented",
      title: "Commented only",
      authorName: "Mira Vale",
      commentedAt: "2026-09-18T12:00:00Z",
      commented: true,
    }),
    item({
      storyId: "all",
      title: "All actions",
      readAt: "2026-09-19T13:00:00Z",
      likedAt: "2026-09-18T13:00:00Z",
      commentedAt: "2026-09-17T13:00:00Z",
      liked: true,
      commented: true,
    }),
  ];

  it("keeps read, liked, and commented boks in separate activity views", () => {
    expect(selectReaderLibraryItems(library, "read").map((entry) => entry.storyId)).toEqual(["all", "read"]);
    expect(selectReaderLibraryItems(library, "liked").map((entry) => entry.storyId)).toEqual(["liked", "all"]);
    expect(selectReaderLibraryItems(library, "commented").map((entry) => entry.storyId)).toEqual(["commented", "all"]);
  });

  it("searches the active view by title or byline", () => {
    expect(selectReaderLibraryItems(library, "commented", "mira").map((entry) => entry.storyId)).toEqual([
      "commented",
    ]);
    expect(selectReaderLibraryItems(library, "read", "liked only")).toEqual([]);
  });

  it("does not mutate the order returned by the data layer", () => {
    const before = library.map((entry) => entry.storyId);
    selectReaderLibraryItems(library, "liked");
    expect(library.map((entry) => entry.storyId)).toEqual(before);
  });
});
