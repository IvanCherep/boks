import { describe, expect, it, vi } from "vitest";
import { shareToStory } from "./kit-share";

const file = new File([new Uint8Array([0xff, 0xd8])], "boks-card.jpg", { type: "image/jpeg" });
const link = "https://tryboks.com/b/glinyanye-lyudi";

describe("share to a story", () => {
  it("copies the link and hands the picture to the share sheet in one tap", async () => {
    const order: string[] = [];
    const writeText = vi.fn(async () => { order.push("copy"); });
    const share = vi.fn(async () => { order.push("share"); });
    expect(await shareToStory(file, link, { share, clipboard: { writeText } })).toEqual({ outcome: "shared", copied: true });
    expect(writeText).toHaveBeenCalledWith(link);
    expect(share).toHaveBeenCalledWith({ files: [file] });
    expect(order).toEqual(["copy", "share"]);
  });

  it("starts the share sheet without waiting for the copy", async () => {
    let release = () => {};
    const writeText = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const share = vi.fn(async () => {});
    const result = shareToStory(file, link, { share, clipboard: { writeText } });
    await Promise.resolve();
    expect(share).toHaveBeenCalled();
    release();
    expect((await result).copied).toBe(true);
  });

  it("tells a closed sheet from a failure", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    expect((await shareToStory(file, link, { share: async () => { throw abort; } })).outcome).toBe("cancelled");
    expect((await shareToStory(file, link, { share: async () => { throw new Error("NotAllowedError"); } })).outcome).toBe("failed");
  });

  it("still shares when the clipboard refuses", async () => {
    const result = await shareToStory(file, link, { share: async () => {}, clipboard: { writeText: async () => { throw new Error("denied"); } } });
    expect(result).toEqual({ outcome: "shared", copied: false });
  });
});
