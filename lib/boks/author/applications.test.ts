import { describe, expect, it } from "vitest";
import { applicationWait, contactHref, countApplications, matchesApplicationSearch, orderApplications, type ApplicationLike } from "./applications";

const now = new Date("2026-11-25T12:00:00+03:00");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const row = (id: number, over: Partial<ApplicationLike> = {}): ApplicationLike => ({
  id, name: `Автор ${id}`, contact: "@author", links: "https://t.me/author", stage: "new",
  stageAt: ago(0), createdAt: ago(0), handle: null, email: null, focus: null, ...over,
});

describe("applications CRM", () => {
  it("puts our moves first, the longest waiting on top, then the author's, then closed", () => {
    const rows = [
      row(1, { stage: "written", stageAt: ago(8) }),
      row(2, { stage: "declined", stageAt: ago(1) }),
      row(3, { stage: "new", createdAt: ago(1) }),
      row(4, { stage: "replied", stageAt: ago(4) }),
      row(5, { stage: "silent", stageAt: ago(0) }),
      row(6, { stage: "written", stageAt: ago(2) }),
    ];
    expect(orderApplications(rows).map((r) => r.id)).toEqual([4, 3, 1, 6, 5, 2]);
  });

  it("counts each filter", () => {
    const counts = countApplications([row(1), row(2, { stage: "written" }), row(3, { stage: "agreed" }), row(4, { stage: "silent" })]);
    expect(counts).toEqual({ open: 3, ours: 2, waiting: 1, closed: 1, all: 4 });
  });

  it("says how long a stage has waited and when it is too long", () => {
    expect(applicationWait(row(1, { stage: "new", createdAt: ago(3), stageAt: ago(0) }), now)).toEqual({ mover: "team", days: 3, stuck: true });
    expect(applicationWait(row(1, { stage: "written", stageAt: ago(4) }), now)).toEqual({ mover: "author", days: 4, stuck: false });
    expect(applicationWait(row(1, { stage: "written", stageAt: ago(5) }), now).stuck).toBe(true);
    expect(applicationWait(row(1, { stage: "declined", stageAt: ago(40) }), now)).toMatchObject({ mover: "none", stuck: false });
  });

  it("finds by name, contact, @handle or the team's line", () => {
    const r = row(1, { name: "Вера Полозкова", handle: "vera", focus: "уточнить права" });
    expect(matchesApplicationSearch(r, "полоз")).toBe(true);
    expect(matchesApplicationSearch(r, "@vera")).toBe(true);
    expect(matchesApplicationSearch(r, "права")).toBe(true);
    expect(matchesApplicationSearch(r, "блок")).toBe(false);
  });

  it("turns a contact into a link when it can tell what it is", () => {
    expect(contactHref("vera@mail.ru")).toBe("mailto:vera@mail.ru");
    expect(contactHref("@vera_p")).toBe("https://t.me/vera_p");
    expect(contactHref("t.me/vera_p")).toBe("https://t.me/vera_p");
    expect(contactHref("vk.com/vera")).toBe("https://vk.com/vera");
    expect(contactHref("+7 (912) 345-67-89")).toBe("tel:+79123456789");
    expect(contactHref("пишите в личку")).toBeNull();
  });
});
