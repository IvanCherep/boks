"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** A held cover reveals its artwork; moving before the hold remains a swipe. */
export function useCoverInspection(
  ref: RefObject<HTMLDivElement | null>,
  storyId: string | undefined,
  enabled: boolean,
  onStart: () => void,
) {
  const [inspectedStory, setInspectedStory] = useState<string | null>(null);
  const onStartRef = useRef(onStart);
  useLayoutEffect(() => { onStartRef.current = onStart; });

  useEffect(() => {
    const cover = ref.current;
    if (!cover || !storyId || !enabled) return;
    let press: { id: number; x: number; y: number; active: boolean } | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      clearTimeout(timer);
      const previous = press;
      press = null;
      if (previous?.active) {
        setInspectedStory(null);
        if (cover.hasPointerCapture(previous.id)) cover.releasePointerCapture(previous.id);
      }
    };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) { end(); return; }
      if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("button, a, input, textarea, select, [role='button'], [role='dialog'], [contenteditable='true']")) return;
      end();
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, active: false };
      timer = setTimeout(() => {
        if (!press || document.hidden) return;
        press.active = true;
        onStartRef.current();
        setInspectedStory(storyId);
        try { cover.setPointerCapture(press.id); }
        catch { end(); }
      }, 320);
    };
    const move = (event: PointerEvent) => {
      if (press && !press.active && event.pointerId === press.id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) end();
    };
    const up = (event: PointerEvent) => { if (event.pointerId === press?.id) end(); };
    const lost = (event: PointerEvent) => { if (event.target === cover) up(event); };
    const contextMenu = (event: Event) => { if (press) event.preventDefault(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") end(); };
    const visibility = () => { if (document.hidden) end(); };
    cover.addEventListener("pointerdown", down);
    cover.addEventListener("contextmenu", contextMenu);
    cover.addEventListener("lostpointercapture", lost);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", end);
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      end();
      cover.removeEventListener("pointerdown", down);
      cover.removeEventListener("contextmenu", contextMenu);
      cover.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", end);
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [ref, storyId, enabled]);

  return enabled && inspectedStory === storyId;
}
