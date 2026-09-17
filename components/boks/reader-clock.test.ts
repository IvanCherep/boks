import { describe, expect, it } from "vitest";
import { createReaderClock } from "@/components/boks/reader-clock";

function fakeClock(startMs = 1_000_000) {
  let current = startMs;
  return {
    now: () => current,
    advance(seconds: number) {
      current += seconds * 1000;
    },
  };
}

describe("createReaderClock", () => {
  it("counts time while the page is visible", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now });

    clock.restart();
    time.advance(30);

    expect(clock.activeSeconds()).toBe(30);
  });

  it("does not count time while the page is hidden", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now });

    clock.restart();
    time.advance(10);
    clock.pause();

    time.advance(600); // reader locked the phone for ten minutes
    clock.resume();
    time.advance(5);

    expect(clock.activeSeconds()).toBe(15);
  });

  it("clamps a single un-observed gap, so a suspended device cannot book hours", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now, maxGapSeconds: 120 });

    clock.restart();
    time.advance(3 * 60 * 60); // laptop slept without firing visibilitychange

    expect(clock.activeSeconds()).toBe(120);
  });

  it("does not clamp genuine continuous reading that is marked regularly", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now, maxGapSeconds: 120 });

    clock.restart();
    for (let tick = 0; tick < 120; tick += 1) {
      time.advance(5);
      clock.mark();
    }

    // Ten minutes of real reading survives, because each mark is well inside
    // the bound. Only an unobserved jump is ever clipped.
    expect(clock.activeSeconds()).toBe(600);
  });

  it("rebases after a restore instead of accruing the gap", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now });

    clock.restart();
    time.advance(20);
    clock.mark();

    time.advance(4000); // page sat in the back/forward cache
    clock.rebase();
    time.advance(10);

    expect(clock.activeSeconds()).toBe(30);
  });

  it("discards the previous boks on restart", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now });

    clock.restart();
    time.advance(45);
    clock.mark();

    clock.restart();
    time.advance(5);

    expect(clock.activeSeconds()).toBe(5);
  });

  it("never reports negative time when the system clock jumps backwards", () => {
    let current = 1_000_000;
    const clock = createReaderClock({ now: () => current });

    clock.restart();
    current -= 5000;

    expect(clock.activeSeconds()).toBe(0);
  });

  it("is idempotent across repeated reads", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now });

    clock.restart();
    time.advance(12);

    expect(clock.activeSeconds()).toBe(12);
    expect(clock.activeSeconds()).toBe(12);
  });

  it("stops and starts cleanly across several visibility cycles", () => {
    const time = fakeClock();
    const clock = createReaderClock({ now: time.now });

    clock.restart();
    for (let cycle = 0; cycle < 4; cycle += 1) {
      time.advance(15);
      clock.pause();
      expect(clock.isRunning()).toBe(false);
      time.advance(300);
      clock.resume();
      expect(clock.isRunning()).toBe(true);
    }

    expect(clock.activeSeconds()).toBe(60);
  });
});
