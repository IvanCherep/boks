import { describe, expect, it } from "vitest";
import { openingBokAttribute, sharedBokRedirectScript, sharedBokTarget } from "@/lib/boks/shared-bok-redirect";

const id = "99ee280f-faf5-4026-99fc-9cbec9d79a2a";

/** Runs the inline script against a fake page and reports where it went. */
function runScript(scriptId: string, page: { search?: string; referrer?: string; hostname?: string } = {}) {
  const attributes = new Map<string, string>();
  let replacedWith: string | null = null;
  const fakeWindow = {
    location: {
      hostname: page.hostname ?? "tryboks.com",
      search: page.search ?? "",
      replace: (url: string) => {
        replacedWith = url;
      },
    },
  };
  const fakeDocument = {
    referrer: page.referrer ?? "",
    documentElement: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
  };
  new Function("window", "document", sharedBokRedirectScript(scriptId))(fakeWindow, fakeDocument);
  return { replacedWith: replacedWith as string | null, hidden: attributes.has(openingBokAttribute) };
}

describe("the shared-link redirect", () => {
  const cases = [
    { search: "", referrer: "", hostname: "tryboks.com" },
    { search: "?link=msu-philology", referrer: "https://t.me/", hostname: "tryboks.com" },
    { search: "?utm_source=tg&utm_campaign=launch&other=x", referrer: "https://tryboks.com/", hostname: "tryboks.com" },
    { search: "?recording=1", referrer: "not a url", hostname: "tryboks.com" },
  ];

  it("goes where the React fallback would go, before the bundle loads", () => {
    for (const page of cases) {
      expect(runScript(id, page).replacedWith).toBe(sharedBokTarget({ id, ...page }));
    }
  });

  it("carries the tracked link and the source across the redirect", () => {
    expect(sharedBokTarget({ id, search: "?link=msu", referrer: "https://vk.com/feed", hostname: "tryboks.com" })).toBe(
      `/?bok=${id}&from=share&ref=vk.com&link=msu`
    );
  });

  it("hides the text page while it leaves, so a person never sees it", () => {
    expect(runScript(id).hidden).toBe(true);
  });

  it("sends a link with no id to the feed", () => {
    expect(runScript("").replacedWith).toBe("/");
    expect(sharedBokTarget({ id: "", search: "", referrer: "", hostname: "tryboks.com" })).toBe("/");
  });

  it("cannot be broken out of by a hostile id", () => {
    // `sharedBokIdFrom` returns the raw segment when it holds no UUID.
    const hostile = '</script><script>alert(1)</script>"';
    const script = sharedBokRedirectScript(hostile);
    expect(script).not.toContain("</script>");
    expect(runScript(hostile).replacedWith).toBe(
      sharedBokTarget({ id: hostile, search: "", referrer: "", hostname: "tryboks.com" })
    );
  });
});
