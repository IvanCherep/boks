"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

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
}: {
  /** Names the dialog for a screen reader, and both close controls. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
}) {
  const dragStartY = useRef<number | null>(null);
  const dragged = useRef(false);

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
    if (!expandable || Math.abs(distance) < 32) return;
    if (distance < 0) onExpandedChange?.(true);
    else if (expanded) onExpandedChange?.(false);
    else if (distance > 72) onClose();
  }

  return (
    <div
      className={`reader-sheet${expanded ? " reader-sheet--expanded" : ""} ${className} absolute inset-x-2 bottom-2 z-30 flex flex-col rounded-[24px] border border-[var(--border)] bg-[var(--card)] shadow-[0_18px_70px_rgb(40_29_18/18%)] sm:inset-x-auto sm:bottom-6 sm:right-24 sm:w-[380px]`}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={(event) => {
        event.stopPropagation();
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
        aria-label={expandable ? `${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()}` : `Close ${label.toLowerCase()}`}
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
  return (
    <div className="reader-sheet-header px-4 pt-1 sm:pt-4">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <div className="reader-sheet-header__actions">
        {onExpandedChange && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onExpandedChange(!expanded)}
            aria-label={expanded ? `Collapse ${label.toLowerCase()}` : `Open ${label.toLowerCase()} full screen`}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label={`Close ${label.toLowerCase()}`}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
