import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { backdropAt, textPresets, wordReachedAt, type PoemManifest } from "@/lib/boks/poetry/manifest";
import { poemManifestFor, sandboxPoems } from "@/components/boks/poetry/poems";

/*
 * The standard every poem is held to, whichever poem it is.
 *
 * `manifest.test.ts` holds the logic against the first poem in detail; this
 * holds every folder under `public/poetry/` to the rules a new poem could
 * quietly break - a missing file, a scene too short to look at, a zone under
 * the controls, a line the voice never reaches. A new poem is checked by
 * existing, with nothing to add here.
 */
const slugs = readdirSync("public/poetry", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const publicFile = (url: string) => `public${url}`;

/**
 * Seconds in a constant-bitrate MP3, from its size and its first frame's
 * bitrate. Every recording and theme here is CBR (ElevenLabs' `mp3_44100_128`,
 * or ffmpeg at `-b:a 128k`), so this is exact to a frame without a decoder.
 */
function mp3Seconds(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    offset = 10 + (((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f));
  }
  while (offset < bytes.length - 4 && !(bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0)) offset += 1;
  const mpeg1 = ((bytes[offset + 1] >> 3) & 3) === 3;
  const index = bytes[offset + 2] >> 4;
  const kbps = (mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[index];
  return ((bytes.length - offset) * 8) / (kbps * 1000);
}

describe.each(slugs)("the poem in public/poetry/%s", (slug) => {
  const manifest = JSON.parse(
    readFileSync(`public/poetry/${slug}/manifest.json`, "utf8")
  ) as PoemManifest;

  it("has every file it names", () => {
    expect(existsSync(publicFile(manifest.audio)), manifest.audio).toBe(true);
    // The theme is part of the reading, not optional.
    expect(manifest.theme, "theme").toBeDefined();
    expect(existsSync(publicFile(manifest.theme!.src)), manifest.theme!.src).toBe(true);
    for (const scene of manifest.scenes) {
      expect(existsSync(publicFile(scene.image)), scene.image).toBe(true);
      expect(scene.image, scene.id).toMatch(/\.webp$/);
    }
  });

  it("was timed by its own recording", () => {
    expect(manifest.timingMode).toBe("forced-alignment");
  });

  it("covers the recording with no gap and no overlap", () => {
    for (let index = 1; index < manifest.lines.length; index += 1) {
      expect(manifest.lines[index].startMs).toBe(manifest.lines[index - 1].endMs);
    }
    expect(manifest.lines.at(-1)!.endMs).toBe(manifest.durationMs);
  });

  it("keeps every word inside the line that owns it", () => {
    for (const line of manifest.lines) {
      for (const token of line.tokens) {
        expect(token.atMs, token.text).toBeGreaterThanOrEqual(line.startMs);
        expect(token.atMs, token.text).toBeLessThan(line.endMs);
      }
    }
  });

  it("reaches the last word of every line before the line ends", () => {
    const lead = manifest.playback.tokenLeadMs ?? 0;
    for (const line of manifest.lines) {
      expect(wordReachedAt(line, line.endMs - 1 + lead)).toBe(line.tokens.length - 1);
    }
  });

  it("names only presets the renderer can draw", () => {
    for (const scene of manifest.scenes) {
      expect(textPresets, scene.id).toContain(scene.textPreset);
    }
  });

  it("keeps every zone inside the frame and clear of the controls", () => {
    for (const scene of manifest.scenes) {
      for (const zone of scene.safeZones) {
        expect(zone.x, scene.id).toBeGreaterThanOrEqual(0);
        expect(zone.y, scene.id).toBeGreaterThanOrEqual(0);
        expect(zone.x + zone.width, scene.id).toBeLessThanOrEqual(1);
        expect(zone.y + zone.height, scene.id).toBeLessThanOrEqual(0.88);
      }
    }
  });

  it("gives every picture time to be looked at, and more of it still than dissolving", () => {
    for (let index = 0; index < manifest.scenes.length; index += 1) {
      const scene = manifest.scenes[index];
      const until = manifest.scenes[index + 1]?.startMs ?? manifest.durationMs;
      expect(until - scene.startMs, scene.id).toBeGreaterThan(3500);
      if (index > 0) expect(scene.transitionMs, scene.id).toBeLessThan((until - scene.startMs) / 2);
    }
  });

  it("never jumps: the picture is continuous across the whole poem", () => {
    let previous = backdropAt(manifest, 0);
    for (let ms = 16; ms <= manifest.durationMs; ms += 16) {
      const now = backdropAt(manifest, ms);
      if (previous.from !== now.from) expect(previous.to, `at ${ms}`).toBe(now.from);
      previous = now;
    }
  });

  it("has a theme that lasts as long as the voice", () => {
    // A music take can come back shorter than it was asked for - one returned
    // 249 s of a requested 380 after a rate-limit retry, and the last two
    // minutes of the poem played without it, and a seek past its end stopped it.
    const voice = mp3Seconds(publicFile(manifest.audio));
    expect(voice, "narration").toBeGreaterThanOrEqual(manifest.durationMs / 1000 - 0.5);
    expect(mp3Seconds(publicFile(manifest.theme!.src)), "theme").toBeGreaterThanOrEqual(voice - 1);
  });

  it("keeps its theme audibly under the voice", () => {
    // Measured per poem, 13 dB under the voice since 2026-10-11 (10 before;
    // the music read too loud across the series), or further for a piece
    // that asks for an almost silent bed. Outside this range it has either
    // vanished or begun to compete.
    expect(manifest.theme!.gain).toBeGreaterThan(0.03);
    expect(manifest.theme!.gain).toBeLessThan(0.4);
  });
});

describe("the poem registry", () => {
  it("points every boks and the sandbox at a poem that exists", () => {
    const urls = [
      ...sandboxPoems,
      poemManifestFor("202c3d9c-5a8e-4c91-8278-ab0fc4e602cf"),
      poemManifestFor("3056ee24-d8c0-4963-923f-967213a3ec34"),
    ];
    for (const url of urls) {
      expect(url).not.toBeNull();
      expect(existsSync(publicFile(url!)), url!).toBe(true);
    }
  });

  it("offers every poem on disk in the sandbox", () => {
    for (const slug of slugs) {
      expect(sandboxPoems).toContain(`/poetry/${slug}/manifest.json`);
    }
  });
});
