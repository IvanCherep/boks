import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gestureHintIn, gestureHintTranslations } from "@/components/boks/poetry/gesture-hints";

const root = join(process.cwd(), "public/poetry");

function shippedHints() {
  const hints = new Set<string>();
  for (const slug of readdirSync(root)) {
    let manifest: string;
    try {
      manifest = readFileSync(join(root, slug, "manifest.json"), "utf8");
    } catch {
      continue;
    }
    for (const match of manifest.matchAll(/"hint":\s*"([^"]+)"/g)) hints.add(match[1]);
  }
  return [...hints];
}

describe("gesture hints in the interface's language", () => {
  it("has every shipped hint in every other language", () => {
    const hints = shippedHints();
    expect(hints.length).toBeGreaterThan(0);
    for (const [language, table] of Object.entries(gestureHintTranslations)) {
      for (const hint of hints) expect(table[hint], `${language}: ${hint}`).toBeTruthy();
    }
  });

  it("keeps English as written", () => {
    expect(gestureHintIn("Hold the screen", "en")).toBe("Hold the screen");
    expect(gestureHintIn("Hold the screen", "ru")).toBe("Удерживайте экран");
  });
});
