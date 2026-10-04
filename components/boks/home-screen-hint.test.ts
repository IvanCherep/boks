import { describe, expect, it } from "vitest";
import {
  canAddToHomeScreen,
  homeScreenHintKey,
  markHomeScreenHintShown,
  shouldOfferHomeScreen,
  type DeviceFacts,
} from "./home-screen-hint";

const iPhoneSafari =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const iPadSafari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const androidChrome =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

function device(userAgent: string, overrides: Partial<DeviceFacts> = {}): DeviceFacts {
  return { userAgent, maxTouchPoints: 5, standalone: false, ...overrides };
}

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("home screen hint", () => {
  it("is for an iPhone or iPad in a browser tab", () => {
    expect(canAddToHomeScreen(device(iPhoneSafari))).toBe(true);
    expect(canAddToHomeScreen(device(iPadSafari))).toBe(true);
  });

  it("is not for a Mac, which reports the same as an iPad but has no touch", () => {
    expect(canAddToHomeScreen(device(iPadSafari, { maxTouchPoints: 0 }))).toBe(false);
  });

  it("is not for Android, which gets fullscreen instead", () => {
    expect(canAddToHomeScreen(device(androidChrome))).toBe(false);
  });

  it("is not said to a reader who already came from the home screen", () => {
    expect(canAddToHomeScreen(device(iPhoneSafari, { standalone: true }))).toBe(false);
  });

  it("is not said inside another app's web view", () => {
    expect(canAddToHomeScreen(device(`${iPhoneSafari} Instagram 350.0`))).toBe(false);
    expect(canAddToHomeScreen(device(`${iPhoneSafari} [FBAN/FBIOS;FBAV/480.0]`))).toBe(false);
  });

  it("is said once", () => {
    const storage = memory();
    expect(shouldOfferHomeScreen(device(iPhoneSafari), storage)).toBe(true);
    markHomeScreenHintShown(storage);
    expect(storage.getItem(homeScreenHintKey)).toBe("shown");
    expect(shouldOfferHomeScreen(device(iPhoneSafari), storage)).toBe(false);
  });

  it("stays quiet when storage cannot remember it was said", () => {
    const refusing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(shouldOfferHomeScreen(device(iPhoneSafari), refusing)).toBe(false);
    expect(shouldOfferHomeScreen(device(iPhoneSafari), null)).toBe(false);
  });
});
