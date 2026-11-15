"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Bookmark, Globe, Send } from "lucide-react";
import "@/app/daily.css";
import { useMessages } from "@/components/boks/ui-language";
import { maxPassageLength, tidyPassage } from "@/lib/boks/daily/passage";
import { defineMessages } from "@/lib/i18n/messages";
import { dailyMessages } from "./messages";

export type PassageSelection = {
  text: string;
  /** Where the selection is on screen, for the menu to sit beside it. */
  rect: { top: number; bottom: number; left: number; right: number };
};

const limits = defineMessages(
  { tooLong: `Choose a line or two: up to ${maxPassageLength} characters.` },
  { ru: { tooLong: `Выделите строку или две: до ${maxPassageLength} знаков.` } },
);

/**
 * The words a reader has selected inside `container`, while they stay
 * selected there. Anything outside it - the title, a comment, another app's
 * text - is not a line of the bok and is ignored.
 */
export function usePassageSelection(container: RefObject<HTMLElement | null>, enabled: boolean, resetKey: string | undefined) {
  const [selection, setSelection] = useState<PassageSelection | null>(null);
  const frame = useRef(0);

  const measure = useCallback(() => {
    const root = container.current;
    const current = typeof window === "undefined" ? null : window.getSelection();
    if (!enabled || !root || !current || current.isCollapsed || current.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = current.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const text = tidyPassage(current.toString());
    if (!/[\p{L}\p{N}]/u.test(text)) {
      setSelection(null);
      return;
    }
    const box = range.getBoundingClientRect();
    setSelection({ text, rect: { top: box.top, bottom: box.bottom, left: box.left, right: box.right } });
  }, [container, enabled]);

  useEffect(() => {
    if (!enabled) {
      const timer = window.setTimeout(() => setSelection(null), 0);
      return () => window.clearTimeout(timer);
    }
    // Settle first: a selection being dragged changes on every pointer move.
    let timer = 0;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 140);
    };
    const follow = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    document.addEventListener("selectionchange", later);
    window.addEventListener("resize", follow);
    // The text scrolls inside its own viewport; the menu follows the words.
    const scroller = container.current?.closest(".story-scroll");
    scroller?.addEventListener("scroll", follow, { passive: true });
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame.current);
      document.removeEventListener("selectionchange", later);
      window.removeEventListener("resize", follow);
      scroller?.removeEventListener("scroll", follow);
    };
  }, [container, enabled, measure, resetKey]);

  // A new bok: nothing of the last one is selected.
  useEffect(() => {
    const timer = window.setTimeout(() => setSelection(null), 0);
    return () => window.clearTimeout(timer);
  }, [resetKey]);

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  return { selection, clear };
}

const menuHeight = 162;
const menuWidth = 248;

/**
 * Two actions beside the selected words. Below the selection, so a phone's
 * own copy menu above it stays usable; above it when there is no room.
 */
export function SelectionMenu({ selection, onShareWorld, onSend, onSave }: {
  selection: PassageSelection;
  onShareWorld: (text: string) => void;
  onSend: (text: string) => void;
  onSave: (text: string) => void;
}) {
  const words = useMessages(dailyMessages);
  const limit = useMessages(limits);
  const [viewport, setViewport] = useState({ width: 390, height: 800 });
  useEffect(() => {
    const read = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  const gap = 30;
  const reserveBottom = 96;
  const below = selection.rect.bottom + gap + menuHeight < viewport.height - reserveBottom;
  const top = below ? selection.rect.bottom + gap : Math.max(76, selection.rect.top - gap - menuHeight);
  const centre = (selection.rect.left + selection.rect.right) / 2;
  const left = Math.min(Math.max(12, centre - menuWidth / 2), viewport.width - menuWidth - 12);
  const tooLong = selection.text.length > maxPassageLength;
  // Keep the words selected while a button is pressed, and keep the press
  // from reaching the reader underneath (which would turn the page).
  const hold = {
    onPointerDown: (event: React.PointerEvent) => { event.preventDefault(); event.stopPropagation(); },
    onPointerUp: (event: React.PointerEvent) => event.stopPropagation(),
    onTouchStart: (event: React.TouchEvent) => event.stopPropagation(),
    onTouchEnd: (event: React.TouchEvent) => event.stopPropagation(),
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
  };
  return <div className={`daily-selection-menu${below ? "" : " is-above"}`} role="toolbar" aria-label={words.lineActions}
    style={{ top, left, width: menuWidth }} {...hold}>
    {tooLong ? <p className="daily-selection-menu__note">{limit.tooLong}</p> : <>
      <button type="button" onClick={() => onShareWorld(selection.text)}><Globe aria-hidden="true" />{words.shareWorld}</button>
      <button type="button" onClick={() => onSend(selection.text)}><Send aria-hidden="true" />{words.sendLine}</button>
      <button type="button" onClick={() => onSave(selection.text)}><Bookmark aria-hidden="true" />{words.saveLine}</button>
    </>}
  </div>;
}
