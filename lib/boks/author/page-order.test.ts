import { describe, expect, it } from "vitest";
import { moveBy, moveTo, orderChanged } from "./page-order";
import { inviteLink, inviteTokenFromHash } from "./invite-link";

describe("page order", () => {
  const keys = ["b:1", "w:2", "b:3"];

  it("moves one place up and down", () => {
    expect(moveBy(keys, 1, -1)).toEqual(["w:2", "b:1", "b:3"]);
    expect(moveBy(keys, 1, 1)).toEqual(["b:1", "b:3", "w:2"]);
  });

  it("stops at the edges instead of wrapping", () => {
    expect(moveBy(keys, 0, -1)).toEqual(keys);
    expect(moveBy(keys, 2, 1)).toEqual(keys);
  });

  it("drops a dragged item where it was released", () => {
    expect(moveTo(keys, 0, 2)).toEqual(["w:2", "b:3", "b:1"]);
    expect(moveTo(keys, 2, 0)).toEqual(["b:3", "b:1", "w:2"]);
    expect(moveTo(keys, 5, 0)).toEqual(keys);
  });

  it("knows when nothing moved", () => {
    expect(orderChanged(keys, [...keys])).toBe(false);
    expect(orderChanged(keys, moveBy(keys, 0, 1))).toBe(true);
  });
});

describe("invite link", () => {
  const token = "a".repeat(64);

  it("keeps the token in the fragment, out of every request", () => {
    const link = inviteLink("https://tryboks.com/", token);
    expect(link).toBe(`https://tryboks.com/author#invite=${token}`);
    expect(new URL(link).search).toBe("");
  });

  it("reads only a well-formed token", () => {
    expect(inviteTokenFromHash(`#invite=${token}`)).toBe(token);
    expect(inviteTokenFromHash(`#profile-edit&invite=${token}`)).toBe(token);
    expect(inviteTokenFromHash("#invite=../../x")).toBeNull();
    expect(inviteTokenFromHash("#write")).toBeNull();
  });
});
