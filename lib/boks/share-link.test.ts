import { describe, expect, it } from "vitest";
import { authorShareLabel, authorShareLabelPrefix, authorShareUrl } from "./share-link";

describe("an author's link as people see and send it", () => {
  it("is on go.tryboks.com on the site, so messengers abroad can preview it", () => {
    expect(authorShareUrl("malyo_subbotina", "https://tryboks.com")).toBe("https://go.tryboks.com/@malyo_subbotina");
    expect(authorShareLabel("malyo_subbotina", "https://tryboks.com")).toBe("go.tryboks.com/@malyo_subbotina");
    expect(authorShareLabel("@malyo_subbotina", "https://www.tryboks.com")).toBe("go.tryboks.com/@malyo_subbotina");
    expect(authorShareLabelPrefix("https://tryboks.com")).toBe("go.tryboks.com/@");
  });

  it("stays on the page's own origin anywhere else", () => {
    expect(authorShareLabel("poet", "http://localhost:5173")).toBe("localhost:5173/@poet");
    expect(authorShareLabelPrefix("http://localhost:5173")).toBe("localhost:5173/@");
  });
});
