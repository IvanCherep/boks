import { describe, expect, it } from "vitest";
import {
  candidatesFromReelRows,
  mapSupabaseReelToStory,
  type SupabaseReelRow,
} from "@/lib/boks/supabase-reels";

const reel: SupabaseReelRow = {
  id: "00000001-0000-4000-8000-000000000001",
  title: "Незнакомка",
  author_name: "Александр Блок",
  author_handle: "boks",
  author_user_id: "11111111-1111-4111-8111-111111111111",
  text: "По вечерам над ресторанами",
  genre: "poetry",
  mood: "calm",
  minutes: 2,
  word_count: 220,
  created_at: "2026-09-20T10:00:00Z",
  language: "ru",
};

describe("candidatesFromReelRows", () => {
  it("keeps who wrote a piece on the degraded path", () => {
    // Without the byline every piece of a publisher's catalogue is a different
    // author to the ranker, and author spacing does nothing.
    const [candidate] = candidatesFromReelRows([reel]).candidates;
    expect(candidate.authorName).toBe("Александр Блок");
    expect(candidate.authorUserId).toBe(reel.author_user_id);
  });
});

describe("mapSupabaseReelToStory", () => {
  it("carries the language when the row has one", () => {
    expect(mapSupabaseReelToStory(reel).language).toBe("ru");
    expect(mapSupabaseReelToStory({ ...reel, language: undefined })).not.toHaveProperty("language");
  });
});
