import { formatCompactCount } from "@/components/boks/client-format";
import type React from "react";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** One line under the label, for a field whose purpose is not obvious. */
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {hint && <span className="text-sm font-normal text-[var(--muted-foreground)]">{hint}</span>}
      {children}
    </label>
  );
}

export function ActionButton({
  label,
  value,
  active,
  tone,
  onClick,
  children,
}: {
  label: string;
  /**
   * A public count, printed to the right of the icon and always - zero
   * included, so a boks nobody has reacted to yet says so instead of looking
   * as though it has no count. Omit it for an action that cannot be counted: a
   * share stops being visible the moment the link leaves the app.
   *
   * Likes used to be left without a number, because a like row is private and
   * a client can count only its own. The total comes from an aggregate now -
   * see `get_bok_reactions` and the feed RPC - which says how many, never who.
   */
  value?: number;
  /** For a toggle such as the like: drawn active and announced as pressed. */
  active?: boolean;
  /** `danger` for a destructive action, such as the admin Hide. */
  tone?: "danger";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const counted = typeof value === "number";
  return (
    <button
      type="button"
      // Each class stays a whole, space-separated literal. Tailwind finds its
      // utilities by scanning source text: glued to an interpolation, as in
      // `pointer-events-auto${...}`, the utility is never generated, the button
      // inherits the rail's pointer-events: none, and a tap on the heart falls
      // through to the reader - which, near the right edge, turns the page.
      className={[
        "action-button pointer-events-auto",
        counted && "action-button--counted",
        active && "is-active",
        tone === "danger" && "action-button--danger",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={(event) => {
        // A mouse click leaves focus on the button, and the reader's Space -
        // page down - then pressed it again: an accidental unlike. Keyboard
        // activation (detail 0) keeps focus, as it should.
        if (event.detail > 0) event.currentTarget.blur();
        onClick();
      }}
      aria-label={counted ? `${label}, ${value}` : label}
      title={counted ? undefined : label}
      aria-pressed={typeof active === "boolean" ? active : undefined}
    >
      {children}
      {counted && (
        <span className={`action-count${value === 0 ? " action-count--zero" : ""}`} aria-hidden="true">
          {formatCompactCount(value)}
        </span>
      )}
    </button>
  );
}

export function MetricTile({ label, value }: { label: string; value: number | string }) {
  const display = typeof value === "number" ? (Number.isFinite(value) ? value : 0) : value;
  return (
    <div className="metric-tile">
      <p>{label}</p>
      <strong>{display}</strong>
    </div>
  );
}
