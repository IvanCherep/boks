import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "@/lib/boks/canonical-host";

const on = (path: string, host = "read.tryboks.workers.dev") => canonicalRedirect(new URL(`https://${host}${path}`), host);

describe("keeping everyone on tryboks.com", () => {
  it("sends a page on an old host to the same page on tryboks.com", () => {
    expect(on("/")).toBe("https://tryboks.com/");
    expect(on("/author")).toBe("https://tryboks.com/author");
    expect(on("/series", "tryboks.ru")).toBe("https://tryboks.com/series");
    expect(on("/", "www.tryboks.com")).toBe("https://tryboks.com/");
    expect(on("/", "www.tryboks.ru")).toBe("https://tryboks.com/");
  });

  it("keeps the query, so a shared bok still opens and a campaign tag survives", () => {
    expect(on("/b/a1e3baf7-44da-4867-a817-088f1cdfbd26?utm_source=tg", "tryboks.ru")).toBe(
      "https://tryboks.com/b/a1e3baf7-44da-4867-a817-088f1cdfbd26?utm_source=tg"
    );
  });

  it("leaves tabs that were already open on an old host working", () => {
    expect(on("/api/feed")).toBeNull();
    expect(on("/_next/static/chunks/page.js", "tryboks.ru")).toBeNull();
  });

  it("does nothing on tryboks.com or on a developer's machine", () => {
    expect(on("/", "tryboks.com")).toBeNull();
    expect(on("/", "127.0.0.1:8794")).toBeNull();
    expect(on("/", "localhost:3000")).toBeNull();
  });

  it("matches the host however it is written", () => {
    expect(on("/", "READ.TRYBOKS.WORKERS.DEV")).toBe("https://tryboks.com/");
    expect(on("/", "TryBoks.ru:443")).toBe("https://tryboks.com/");
  });
});
