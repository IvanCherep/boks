import { describe, expect, it } from "vitest";
import type { Comment } from "@/components/boks/client-types";
import { buildCommentThreads } from "@/components/boks/comment-threads";

function comment(id: number, parentCommentId: number | null, createdAt: string): Comment {
  return {
    id,
    storyId: "story",
    visitorName: `reader_${id}`,
    visitorHandle: `reader_${id}`,
    body: `Comment ${id}`,
    createdAt,
    parentCommentId,
    likesCount: 0,
    likedByMe: false,
  };
}

describe("buildCommentThreads", () => {
  it("shows newest roots first and replies from oldest to newest", () => {
    const threads = buildCommentThreads([
      comment(2, 1, "2026-09-19T10:02:00Z"),
      comment(3, null, "2026-09-19T11:00:00Z"),
      comment(1, null, "2026-09-19T10:00:00Z"),
      comment(4, 1, "2026-09-19T10:01:00Z"),
    ]);

    expect(threads.map((thread) => thread.root.id)).toEqual([3, 1]);
    expect(threads[1].replies.map((reply) => reply.id)).toEqual([4, 2]);
  });

  it("keeps an orphan visible as its own conversation", () => {
    const threads = buildCommentThreads([comment(9, 404, "2026-09-19T10:00:00Z")]);
    expect(threads).toHaveLength(1);
    expect(threads[0].root.id).toBe(9);
  });
});

