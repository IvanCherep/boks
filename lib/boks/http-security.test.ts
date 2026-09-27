import { describe, expect, it } from "vitest";
import { readBoundedJsonObject } from "@/lib/boks/http-security";

describe("readBoundedJsonObject", () => {
  it("parses a bounded object", async () => {
    const request = new Request("https://tryboks.com/api/feed", {
      method: "POST",
      body: JSON.stringify({ limit: 20 }),
    });
    await expect(readBoundedJsonObject(request, 100)).resolves.toEqual({ limit: 20 });
  });

  it("rejects an oversized declared body before reading it", async () => {
    const request = new Request("https://tryboks.com/api/feed", {
      method: "POST",
      headers: { "Content-Length": "101" },
      body: "{}",
    });
    await expect(readBoundedJsonObject(request, 100)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("rejects an oversized chunked body", async () => {
    const request = new Request("https://tryboks.com/api/feed", {
      method: "POST",
      body: JSON.stringify({ payload: "x".repeat(100) }),
    });
    await expect(readBoundedJsonObject(request, 32)).rejects.toMatchObject({
      status: 413,
    });
  });

  it("rejects arrays and malformed JSON", async () => {
    await expect(
      readBoundedJsonObject(
        new Request("https://tryboks.com/api/feed", { method: "POST", body: "[]" })
      )
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      readBoundedJsonObject(
        new Request("https://tryboks.com/api/feed", { method: "POST", body: "{" })
      )
    ).rejects.toMatchObject({ status: 400 });
  });
});
