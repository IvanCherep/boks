import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioNarrator } from "./audio-narrator";
import type { NarratorState } from "./narrator";

class TestAudio extends EventTarget {
  static latest: TestAudio;
  src: string;
  preload = "";
  currentTime = 0;
  duration = 90;
  paused = true;
  ended = false;
  volume = 1;
  readyState = 1;
  denied = false;
  constructor(src: string) { super(); this.src = src; TestAudio.latest = this; }
  play() {
    if (this.denied) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  load() {}
}

describe("recorded narration controls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("Audio", TestAudio);
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const narrator = () => createAudioNarrator({ audioUrl: "/voice.mp3", lineStarts: [0, 30, 60], estimatedSeconds: 90 });

  it("keeps the reader's voice level after a story-moment fade and a pause", async () => {
    const player = narrator();
    player.setVolume(0.35);
    player.play();
    await Promise.resolve();
    expect(TestAudio.latest.volume).toBe(0.35);
    player.fadeOutAndPause!(80);
    vi.advanceTimersByTime(100);
    expect(TestAudio.latest.paused).toBe(true);
    player.fadeInAndResume!(80);
    vi.advanceTimersByTime(100);
    expect(TestAudio.latest.volume).toBeCloseTo(0.35);
    player.pause();
    player.resume();
    expect(TestAudio.latest.volume).toBeCloseTo(0.35);
    player.stop();
  });

  it("reports denied playback for retry without advancing or pretending to speak", async () => {
    const player = narrator();
    const states: NarratorState[] = [];
    player.subscribe((state) => states.push(state));
    TestAudio.latest.denied = true;
    player.play();
    await Promise.resolve();
    expect(states.at(-1)).toMatchObject({ error: true, speaking: false, elapsedSeconds: 0, done: false });
    TestAudio.latest.denied = false;
    player.resume();
    await Promise.resolve();
    expect(states.at(-1)).toMatchObject({ error: false, speaking: true });
    player.stop();
  });

  it("holds reading time while buffering and resumes only when playback resumes", async () => {
    const player = narrator();
    let latest: NarratorState | undefined;
    player.subscribe((state) => { latest = state; });
    player.play();
    expect(latest?.speaking).toBe(false);
    await Promise.resolve();
    expect(latest?.speaking).toBe(true);
    TestAudio.latest.dispatchEvent(new Event("waiting"));
    expect(latest?.speaking).toBe(false);
    TestAudio.latest.dispatchEvent(new Event("playing"));
    expect(latest?.speaking).toBe(true);
    player.stop();
  });

  it("does not present an intentional pause during loading as a playback failure", async () => {
    const player = narrator();
    let latest: NarratorState | undefined;
    player.subscribe((state) => { latest = state; });
    vi.spyOn(TestAudio.latest, "play").mockRejectedValueOnce(new DOMException("Interrupted by pause", "AbortError"));
    player.play();
    player.pause();
    await Promise.resolve();
    expect(latest).toMatchObject({ error: false, speaking: false });
    player.stop();
  });

  it("seeks the actual recording and restores its position after changing sources", async () => {
    const player = narrator();
    let latest: NarratorState | undefined;
    player.subscribe((state) => { latest = state; });
    player.play();
    await Promise.resolve();
    player.seek(45);
    player.setSource!("blob:downloaded-recording");
    expect(TestAudio.latest.currentTime).toBe(45);
    expect(latest).toMatchObject({ line: 1, elapsedSeconds: 45 });
    player.stop();
  });

  it("does not start deferred playback after the tab becomes hidden", async () => {
    const visibility = { hidden: false };
    vi.stubGlobal("document", visibility);
    const player = narrator();
    player.play();
    visibility.hidden = true;
    await Promise.resolve();
    expect(TestAudio.latest.paused).toBe(true);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    player.stop();
  });

  it("cannot leave a deferred play running after the format closes", async () => {
    const player = narrator();
    player.play();
    player.stop();
    await Promise.resolve();
    expect(TestAudio.latest.paused).toBe(true);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
