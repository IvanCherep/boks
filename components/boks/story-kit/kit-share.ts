/**
 * "Share to a story" (`docs/story-kit.md`): one tap copies the work's link,
 * for the story's link sticker, and opens the phone's share sheet with the
 * picture, from which the author picks Instagram, VK or Telegram. A website
 * cannot open a network's story editor itself: that is for their own apps and
 * mini apps only.
 */

export type ShareOutcome = "shared" | "cancelled" | "failed";

type Device = {
  share: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/**
 * Both start inside the same tap: the copy first, without waiting for it,
 * because a share sheet must open while the tap still counts as one.
 */
export async function shareToStory(file: File, link: string, device: Device): Promise<{ outcome: ShareOutcome; copied: boolean }> {
  let copying: Promise<boolean>;
  try {
    copying = device.clipboard ? device.clipboard.writeText(link).then(() => true, () => false) : Promise.resolve(false);
  } catch {
    copying = Promise.resolve(false);
  }
  let outcome: ShareOutcome;
  try {
    await device.share({ files: [file] });
    outcome = "shared";
  } catch (error) {
    outcome = error instanceof Error && error.name === "AbortError" ? "cancelled" : "failed";
  }
  return { outcome, copied: await copying };
}
