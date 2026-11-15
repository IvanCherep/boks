"use client";

import { useEffect, useRef } from "react";

/**
 * Escape closes the daily surface on top (a letter, the send sheet, a card),
 * before the reader underneath hears it. The latest `onClose` is used without
 * re-subscribing, so a parent's re-render never touches the listener.
 */
export function useEscape(onClose: () => void, enabled = true) {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      latest.current();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
