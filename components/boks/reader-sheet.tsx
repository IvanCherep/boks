"use client";

import type React from "react";
import { X } from "lucide-react";
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
}: {
  /** Names the dialog for a screen reader, and both close controls. */
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="reader-sheet absolute inset-x-2 bottom-2 z-30 flex flex-col rounded-[24px] border border-[var(--border)] bg-[var(--card)] shadow-[0_18px_70px_rgb(40_29_18/18%)] sm:inset-x-auto sm:bottom-6 sm:right-24 sm:w-[380px]"
      role="dialog"
      aria-label={label}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
    >
      {/* A bottom sheet on a phone: the grip says it can be pulled away. It is
          a real button so a keyboard and a screen reader get the same escape
          the thumb has. */}
      <button type="button" className="sheet-grip" onClick={onClose} aria-label={`Close ${label.toLowerCase()}`} />
      {children}
    </div>
  );
}

/** The sheet's title row, with the close button every sheet carries. */
export function ReaderSheetHeader({
  title,
  onClose,
  label,
}: {
  title: React.ReactNode;
  onClose: () => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-1 sm:pt-4">
      <h2 className="text-lg font-semibold tracking-normal">{title}</h2>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label={`Close ${label.toLowerCase()}`}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
