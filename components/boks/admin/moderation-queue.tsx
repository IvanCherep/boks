"use client";

import { useState } from "react";
import { Check, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AdminModerationItem } from "@/components/boks/client-types";

export function ModerationQueue({
  items,
  busy,
  onReview,
}: {
  items: AdminModerationItem[];
  busy: boolean;
  onReview: (item: AdminModerationItem, decision: "approve" | "reject", reason: string) => Promise<void>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");

  async function review(item: AdminModerationItem, decision: "approve" | "reject") {
    const reason = reasons[item.id]?.trim() ?? "";
    if (decision === "reject" && !reason) {
      setStatus("Add a clear reason before refusing a bok. The author sees it.");
      return;
    }

    setStatus("");
    await onReview(item, decision, reason);
    setReasons((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-[var(--border)] p-4">
        <h2 className="text-xl font-semibold tracking-normal">Review queue</h2>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          New boks stay private until an admin approves them. Refused boks return to the author with your reason.
        </p>
        {status && <p className="mt-2 text-sm text-[var(--destructive)]">{status}</p>}
      </div>
      <div className="moderation-list">
        {items.length ? (
          items.map((item) => (
            <article key={item.id} className="moderation-item">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`review-badge review-badge--${item.status}`}>
                      {item.status === "rejected" ? <XCircle className="size-4" /> : <RefreshCw className="size-4" />}
                      {item.status === "rejected" ? "Refused" : "Waiting"}
                    </span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {item.submittedAt ? new Date(item.submittedAt).toLocaleString() : "not submitted"}
                    </span>
                  </div>
                  <h3 className="mt-3 break-words text-lg font-semibold tracking-normal">{item.title}</h3>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {item.authorName}
                    {item.authorHandle ? ` · @${item.authorHandle.replace(/^@+/, "")}` : ""} · {item.authorEmail || "unknown email"} ·{" "}
                    {item.minutes} min · {item.genre} · {item.mood}
                  </p>
                  {item.hook && <p className="mt-3 text-sm leading-6 text-[var(--soft-foreground)]">{item.hook}</p>}
                  <div className="moderation-copy mt-3 max-h-[220px] overflow-y-auto rounded-lg bg-[var(--reader)] p-3 text-sm leading-7">
                    {item.body.split("\n").map((paragraph) => (
                      <p key={paragraph} className="mb-3 last:mb-0">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                  {item.reviewNote && (
                    <p className="mt-3 rounded-lg bg-[var(--muted)] p-3 text-sm leading-6 text-[var(--muted-foreground)]">
                      Previous reason: {item.reviewNote}
                    </p>
                  )}
                </div>
                <div className="grid content-start gap-3">
                  <Textarea
                    aria-label={`Refusal reason for ${item.title}`}
                    placeholder="Reason if refused"
                    value={reasons[item.id] ?? ""}
                    onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => review(item, "reject")}>
                      <XCircle className="size-4" /> Refuse
                    </Button>
                    <Button disabled={busy} onClick={() => review(item, "approve")}>
                      <Check className="size-4" /> Approve
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))
        ) : (
          <div className="p-4 text-sm text-[var(--muted-foreground)]">No boks are waiting for review.</div>
        )}
      </div>
    </section>
  );
}
