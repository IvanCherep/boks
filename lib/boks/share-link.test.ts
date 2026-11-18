import { describe, expect, it } from "vitest";
import { authorShareLabel, authorShareLabelPrefix, authorShareTitle, authorShareUrl, russianShareUrl } from "./share-link";

describe("an author's link as people see and send it", () => {
  it("is on go.tryboks.com on the site, so messengers abroad can preview it", () => {
    expect(authorShareUrl("malyo_subbotina", "https://tryboks.com")).toBe("https://go.tryboks.com/@malyo_subbotina");
    // On screen it is the site's own address; the share buttons pick go. or not.
    expect(authorShareLabel("malyo_subbotina", "https://tryboks.com")).toBe("tryboks.com/@malyo_subbotina");
    expect(authorShareLabel("@malyo_subbotina", "https://www.tryboks.com")).toBe("tryboks.com/@malyo_subbotina");
    expect(authorShareLabelPrefix("https://tryboks.com")).toBe("tryboks.com/@");
  });

  it("stays on the page's own origin anywhere else", () => {
    expect(authorShareLabel("poet", "http://localhost:5173")).toBe("localhost:5173/@poet");
    expect(authorShareLabelPrefix("http://localhost:5173")).toBe("localhost:5173/@");
  });
});

describe("russianShareUrl", () => {
  it("sends Russian networks straight to tryboks.com, path and query kept", () => {
    expect(russianShareUrl("https://go.tryboks.com/@vodennikov")).toBe("https://tryboks.com/@vodennikov");
    expect(russianShareUrl("https://go.tryboks.com/b/snegurochka-vodennikov?line=abc")).toBe("https://tryboks.com/b/snegurochka-vodennikov?line=abc");
  });

  it("leaves other links alone", () => {
    expect(russianShareUrl("http://localhost:5181/@vodennikov")).toBe("http://localhost:5181/@vodennikov");
    expect(russianShareUrl("not a url")).toBe("not a url");
  });
});

describe("an author's preview title", () => {
  it("has no @handle, which VK would turn into a link to its own profile", () => {
    expect(authorShareTitle("Дмитрий Воденников", "vodennikov")).toBe("Дмитрий Воденников · boks");
    expect(authorShareTitle("@reader_x", "reader_x")).toBe("reader_x · boks");
    expect(authorShareTitle("  ", "@prokhorov")).toBe("prokhorov · boks");
  });
});
