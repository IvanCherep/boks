"use client";

import { useEffect, useRef } from "react";

/**
 * Asks again every `everyMs` while `enabled`, and at once when the tab is
 * shown again: the page's conversation, live on both sides (2026-11-20).
 *
 * A message used to appear only after a reload, in the author's cabinet and in
 * Studio alike. There is no realtime service on our server, and a note between
 * an author and the team does not need one: fifteen seconds reads as live.
 *
 * Nothing is asked while the tab is hidden, and never two at once. A failed
 * ask is skipped, not reported: the next one tries again.
 */
export function useLivePoll(poll: () => Promise<unknown>, everyMs: number, enabled: boolean) {
  const latest = useRef(poll);
  useEffect(() => {
    latest.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let timer = 0;
    const ask = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await latest.current();
      } catch {
        // The next tick tries again.
      } finally {
        running = false;
      }
    };
    const tick = async () => {
      await ask();
      if (!stopped) timer = window.setTimeout(tick, everyMs);
    };
    timer = window.setTimeout(tick, everyMs);
    const shown = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", shown);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [enabled, everyMs]);
}
