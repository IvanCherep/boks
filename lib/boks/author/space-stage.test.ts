import { describe, expect, it } from "vitest";
import { spaceStage, spaceTimeline, type StageInput } from "./space-stage";

const page = (over: Partial<StageInput> = {}): StageInput => ({
  kind: "author",
  status: "draft",
  owned: false,
  invite: null,
  ready: 0,
  changesRequested: 0,
  ...over,
});

describe("where an author's page stands", () => {
  it("follows the invitation until the author takes the page", () => {
    expect(spaceStage(page())).toBe("not_invited");
    expect(spaceStage(page({ invite: { state: "pending" } }))).toBe("invite_pending");
    expect(spaceStage(page({ invite: { state: "expired" } }))).toBe("invite_expired");
    expect(spaceStage(page({ invite: { state: "revoked" } }))).toBe("invite_revoked");
  });

  it("then follows the author: looking, asking for changes, publishing", () => {
    expect(spaceStage(page({ owned: true }))).toBe("author_reviewing");
    expect(spaceStage(page({ owned: true, changesRequested: 1 }))).toBe("changes_requested");
    expect(spaceStage(page({ owned: true, status: "published", ready: 2 }))).toBe("partly_published");
    expect(spaceStage(page({ owned: true, status: "published" }))).toBe("published");
    // A request for changes outranks a page already open.
    expect(spaceStage(page({ owned: true, status: "published", changesRequested: 1 }))).toBe("changes_requested");
  });

  it("an editorial page is the team's own", () => {
    expect(spaceStage(page({ kind: "editorial" }))).toBe("author_reviewing");
    expect(spaceStage(page({ kind: "editorial", status: "published" }))).toBe("published");
    expect(spaceStage(page({ kind: "editorial", status: "unpublished" }))).toBe("unpublished");
  });
});

describe("a page's history", () => {
  it("puts invitations, messages and publications together, newest first", () => {
    const events = spaceTimeline({
      invites: [{ email: "d@boks.test", createdAt: "2026-11-14T10:00:00Z", acceptedAt: "2026-11-14T11:00:00Z" }],
      messages: [
        { fromAuthor: true, body: "Фото светлее", workTitle: null, createdAt: "2026-11-14T12:00:00Z" },
        { fromAuthor: false, body: "Правки внесены", workTitle: "Связь", createdAt: "2026-11-14T13:00:00Z" },
      ],
      publications: [{ createdAt: "2026-11-14T14:00:00Z", pagePublished: true, actorHandle: "d", items: [{ title: "Связь" }] }],
    });
    expect(events.map((event) => event.kind)).toEqual(["published", "team_wrote", "author_wrote", "accepted", "invited"]);
    expect(events[0]).toMatchObject({ titles: ["Связь"], pagePublished: true });
  });
});
