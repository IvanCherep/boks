"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReaderPreferences } from "@/components/boks/reader-preferences";

/**
 * The panel the reader pulls up over a bok: responses, an author, the bok's
 * own menu. All three want the same geometry - full width above the bottom
 * edge on a phone, a card beside the action rail on a desktop - and the same
 * two ways out, a grip for the thumb and a close button for everything else.
 *
 * It exists because that geometry was a 200-character class string copied into
 * every sheet, and a fourth copy would have drifted from the other three.
 */
export function ReaderSheet({
  label,
  onClose,
  children,
  expandable = false,
  expanded = false,
  onExpandedChange,
  className = "",
  inactive = false,
}: {
  /** Names the dialog for a screen reader, and both close controls. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  /** The sheet stays mounted underneath a dialog that currently owns input. */
  inactive?: boolean;
}) {
  const { t } = useReaderPreferences();
  const dragStartY = useRef<number | null>(null);
  const dragged = useRef(false);
  const closeRef = useRef(onClose);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  /**
   * Escape closes the sheet wherever focus is. The sheet opens from a tap on
   * the rail, which leaves focus on the page, so a handler on the sheet alone
   * never heard the key. A key pressed inside the sheet is handled there and
   * stops, so this does not fire twice; the account panel, when it is open on
   * top, takes Escape first in the capture phase and closes only itself.
   */
  useEffect(() => {
    if (inactive) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      closeRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inactive]);

  function startGripDrag(event: PointerEvent<HTMLButtonElement>) {
    dragStartY.current = event.clientY;
    dragged.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishGripDrag(event: PointerEvent<HTMLButtonElement>) {
    if (dragStartY.current == null) return;
    const distance = event.clientY - dragStartY.current;
    dragStartY.current = null;
    dragged.current = Math.abs(distance) > 16;
    if (!expandable) { if (distance > 72) onClose(); return; }
    if (Math.abs(distance) < 32) return;
    if (distance < 0) onExpandedChange?.(true);
    else if (expanded) onExpandedChange?.(false);
    else if (distance > 72) onClose();
  }

  return (
    <div
      ref={panel}
      tabIndex={-1}
      className={`reader-sheet${expanded ? " reader-sheet--expanded" : ""} ${className} absolute inset-x-2 bottom-2 z-30 flex flex-col rounded-[24px] border border-[var(--border)] bg-[var(--card)] shadow-[0_18px_70px_rgb(var(--shadow-rgb)/18%)] sm:inset-x-auto sm:bottom-6 sm:right-24 sm:w-[380px]`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      inert={inactive}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Tab") {
          const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
          const first = nodes[0]; const last = nodes[nodes.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
        }
        if (event.key === "Escape") onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="sheet-grip"
        onPointerDown={startGripDrag}
        onPointerUp={finishGripDrag}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          if (expandable) onExpandedChange?.(!expanded);
          else onClose();
        }}
        aria-label={expandable ? `${expanded ? t("Collapse", "Свернуть") : t("Expand", "Развернуть")} ${label.toLowerCase()}` : `${t("Close", "Закрыть")} ${label.toLowerCase()}`}
      />
      {children}
    </div>
  );
}

/** The sheet's title row, with the close button every sheet carries. */
export function ReaderSheetHeader({
  title,
  onClose,
  label,
  expanded,
  onExpandedChange,
}: {
  title: ReactNode;
  onClose: () => void;
  label: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { t } = useReaderPreferences();
  return (
    <div className="reader-sheet-header px-4 pt-1 sm:pt-4">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <div className="reader-sheet-header__actions">
        {onExpandedChange && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onExpandedChange(!expanded)}
            aria-label={expanded ? `${t("Collapse", "Свернуть")} ${label.toLowerCase()}` : t(`Open ${label.toLowerCase()} full screen`, `Открыть ${label.toLowerCase()} на весь экран`)}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={`${t("Close", "Закрыть")} ${label.toLowerCase()}`}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
