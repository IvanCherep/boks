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
  onClick,
  children,
}: {
  label: string;
  /**
   * A public count, shown under the icon. Omit it for an action that has no
   * count a reader could act on: a like is private to the reader who made it
   * (see the `likes` row-level policy), so a number there would either be the
   * reader's own 0-or-1 or a figure the database does not publish.
   */
  value?: number;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`action-button pointer-events-auto ${active ? "is-active" : ""}`} onClick={onClick} aria-label={label}>
      {children}
      {typeof value === "number" && <span>{value}</span>}
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
