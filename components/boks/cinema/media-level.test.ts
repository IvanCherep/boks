import { afterEach, describe, expect, it, vi } from "vitest";
import { createMediaLevel } from "./media-level";

afterEach(() => vi.unstubAllGlobals());

describe("format sound mixer", () => {
  it("keeps native playback until a Sound gesture, then routes one source through one gain", () => {
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
    const createSource = vi.fn(() => source);
    const resume = vi.fn(() => Promise.resolve());
    const close = vi.fn(() => Promise.resolve());
    vi.stubGlobal("window", { AudioContext: class {
      destination = {};
      state = "suspended";
      createMediaElementSource = createSource;
      createGain = () => gain;
      resume = resume;
      close = close;
    } });
    const element = { volume: 1 } as HTMLAudioElement;
    const mixer = createMediaLevel(element);
    mixer.set(0.7);
    expect(createSource).not.toHaveBeenCalled();
    expect(element.volume).toBe(0.7);
    mixer.set(0.4, true);
    mixer.set(0.2, true);
    expect(createSource).toHaveBeenCalledTimes(1);
    expect(source.connect).toHaveBeenCalledTimes(1);
    expect(gain.gain.value).toBe(0.2);
    expect(element.volume).toBe(1);
    mixer.dispose();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("pauses and reports a denied mixer so the player can show retry", async () => {
    vi.stubGlobal("window", { AudioContext: class {
      destination = {};
      state = "suspended";
      createMediaElementSource = () => ({ connect() {}, disconnect() {} });
      createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
      resume = () => Promise.reject(new Error("NotAllowedError"));
      close = () => Promise.resolve();
    } });
    const failed = vi.fn();
    const element = new EventTarget() as HTMLAudioElement;
    element.volume = 1;
    element.pause = vi.fn();
    element.addEventListener("boks-mixer-error", failed);
    const mixer = createMediaLevel(element);
    mixer.set(0.2, true);
    await Promise.resolve();
    expect(element.pause).toHaveBeenCalledOnce();
    expect(failed).toHaveBeenCalledOnce();
    mixer.dispose();
  });
});
