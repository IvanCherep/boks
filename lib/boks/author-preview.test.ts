import { describe, expect, it } from "vitest";
import { authorPreviewDescription, loadAuthorForShare, sharedAuthorFromAnswer } from "@/lib/boks/author-preview";

const prokhorov = {
  authorHandle: "prokhorov",
  totalBoks: 6,
  writers: [{ name: "Алексей Прохоров", boks: 6 }],
  boks: [{ title: "коса" }, { title: "у горы Мегиддо" }, { title: "азбука веры" }],
};

describe("an author link's preview", () => {
  it("names a one-writer account by the writer, and lists a few titles", () => {
    const author = sharedAuthorFromAnswer("prokhorov", prokhorov)!;
    expect(author.name).toBe("Алексей Прохоров");
    expect(authorPreviewDescription(author)).toBe("6 боков на boks: «коса», «у горы Мегиддо», «азбука веры» и другие.");
  });

  it("names a publisher of many writers by its handle", () => {
    const author = sharedAuthorFromAnswer("boks", { authorHandle: "boks", totalBoks: 229, writers: [{ name: "Блок" }, { name: "Emily Dickinson" }], boks: [{ title: "Hope" }] })!;
    expect(author.name).toBe("@boks");
    expect(authorPreviewDescription(author)).toBe("229 boks on boks: «Hope» and more.");
  });

  it("counts in Russian", () => {
    const one = sharedAuthorFromAnswer("a", { totalBoks: 1, writers: [{ name: "Анна" }], boks: [{ title: "Вечер" }] })!;
    const two = sharedAuthorFromAnswer("a", { totalBoks: 22, writers: [{ name: "Анна" }], boks: [{ title: "Вечер" }] })!;
    expect(authorPreviewDescription(one)).toBe("1 бок на boks: «Вечер».");
    expect(authorPreviewDescription(two)).toBe("22 бока на boks: «Вечер» и другие.");
  });

  it("is nothing for an author with nothing published, a bad handle, or a failed call", async () => {
    expect(sharedAuthorFromAnswer("x", { totalBoks: 0, boks: [] })).toBeNull();
    expect(await loadAuthorForShare("../etc", { url: "https://example.test", key: "k" })).toBeNull();
    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect(await loadAuthorForShare("prokhorov", { url: "https://example.test", key: "k", fetchImpl: failing })).toBeNull();
    const ok = (async () => new Response(JSON.stringify(prokhorov))) as unknown as typeof fetch;
    expect((await loadAuthorForShare("@Prokhorov", { url: "https://example.test", key: "k", fetchImpl: ok }))?.handle).toBe("prokhorov");
  });
});

describe("the line under an author link's title", () => {
  it("says what boks is, in the author's language", async () => {
    const { authorSharePitch } = await import("@/lib/boks/author-preview");
    const { sharePitch } = await import("@/lib/boks/share-preview");
    expect(authorSharePitch(sharedAuthorFromAnswer("prokhorov", prokhorov)!)).toBe(sharePitch.ru);
    expect(authorSharePitch(sharedAuthorFromAnswer("x", { totalBoks: 1, writers: [{ name: "Emily Dickinson" }], boks: [{ title: "Hope" }] })!)).toBe(sharePitch.en);
  });
});
