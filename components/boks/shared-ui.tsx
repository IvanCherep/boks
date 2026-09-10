import type React from "react";
import { TrendingUp } from "lucide-react";
import { storySignal } from "@/components/boks/client-format";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
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
  value: number;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`action-button pointer-events-auto ${active ? "is-active" : ""}`} onClick={onClick} aria-label={label}>
      {children}
      <span>{value}</span>
    </button>
  );
}

export function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-tile">
      <p>{label}</p>
      <strong>{Number.isFinite(value) ? value : 0}</strong>
    </div>
  );
}

export function AdminPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-normal">
        <TrendingUp className="size-4 text-[var(--primary)]" />
        {title}
      </h2>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}

export function Target({ label, value, target }: { label: string; value: number; target: string }) {
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
        <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">Target: {target}</p>
    </div>
  );
}

export function Breakdown({ rows, labelKey }: { rows: Array<Record<string, number | string>>; labelKey: string }) {
  const max = Math.max(1, ...rows.map((row) => storySignal(row)));
  if (!rows.length) return <p className="text-sm text-[var(--muted-foreground)]">No data yet.</p>;

  return rows.slice(0, 6).map((row) => {
    const signal = storySignal(row);
    return (
      <div key={String(row[labelKey])}>
        <div className="flex justify-between gap-3 text-sm">
          <span>{String(row[labelKey])}</span>
          <span className="font-medium">{signal}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.max(4, (signal / max) * 100)}%` }} />
        </div>
      </div>
    );
  });
}
