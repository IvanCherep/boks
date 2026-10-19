"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminBokStatus, AdminPersonDetail } from "@/components/boks/client-types";
import { loadAdminPerson } from "@/components/boks/supabase-browser-data";
import { readableBoksError } from "@/lib/boks/errors";
import { useAdminInspector } from "@/components/boks/admin/inspector-context";
import { BokStatusBadge, Fact, Metric, formatAdminDate } from "@/components/boks/admin/bok-inspector";
import { PersonActions } from "@/components/boks/admin/person-actions";
import { lastThirtyDays } from "@/components/boks/admin/inspector-format";

type ListKey = "wrote" | "liked" | "commented" | "read";

/**
 * One account for an admin: who they are, how they read, what they wrote,
 * liked and said. Every boks in it opens the boks view.
 */
export function PersonInspector({ userId, currentUserId, onChanged }: { userId: string; currentUserId: string | null; onChanged: () => void }) {
  const { openBok } = useAdminInspector();
  const [person, setPerson] = useState<AdminPersonDetail | null>(null);
  const [error, setError] = useState("");
  const [list, setList] = useState<ListKey>("wrote");

  const refresh = useCallback(async () => {
    try {
      setPerson(await loadAdminPerson(userId));
      setError("");
    } catch (caught) {
      setError(readableBoksError(caught, "Could not open this account."));
    }
  }, [userId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  const days = useMemo(() => (person ? lastThirtyDays(person.activity) : []), [person]);

  if (error && !person) return <p className="p-6 text-sm text-[var(--destructive)]">{error}</p>;
  if (!person) return <p className="p-6 text-sm text-[var(--muted-foreground)]">Loading…</p>;

  const m = person.metrics;
  const peak = Math.max(1, ...days.map((entry) => entry.minutes));
  const perSession = m.sessions ? Math.round((m.minutes / m.sessions) * 10) / 10 : 0;
  // The tabs carry the true totals; the lists under them are the newest
  // few hundred, and say so when they are cut short.
  const lists: { key: ListKey; label: string; count: number; shown: number }[] = [
    { key: "wrote", label: "Wrote", count: m.authored.total, shown: person.authoredBoks.length },
    { key: "liked", label: "Liked", count: m.likesGiven, shown: person.likedBoks.length },
    { key: "commented", label: "Commented", count: m.commentsWritten, shown: person.comments.length },
    { key: "read", label: "Read", count: m.boksOpened, shown: person.readBoks.length },
  ];
  const activeList = lists.find((entry) => entry.key === list)!;

  function exportPerson() {
    if (!person) return;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...person }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `boks-person-${person.handle || person.userId}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="inspector-body">
      <header className="studio-inspector-heading">
        <p className="studio-eyebrow">Account / inspector</p>
        <h2>@{person.handle || "reader"}</h2>
      </header>
      <div className="studio-person-head">
        <div className="studio-person-avatar" aria-hidden="true">{(person.handle || "r").slice(0, 1)}</div>
        <div><span className={`studio-role ${person.bannedAt ? "is-suspended" : person.role === "admin" ? "is-admin" : ""}`}>{person.bannedAt ? "Suspended" : person.role === "admin" ? "Admin" : "Active reader"}</span>
          <p>{person.email || "Guest session"}</p><small>Joined {new Date(person.joinedAt).toLocaleDateString()} · {person.algorithmId || "Unassigned"}</small>
        </div>
      </div>
      {person.bannedAt && <p className="studio-hint">Suspended {formatAdminDate(person.bannedAt)}{person.bannedBy ? ` by @${person.bannedBy}` : ""}{person.banReason ? ` — ${person.banReason}` : ""}</p>}
      {error && <p role="alert" className="studio-meta">{error}</p>}
      <section className="inspector-metrics" aria-label="Reading">
        <Metric label="foreground minutes" value={m.minutes} detail={`${m.minutesLast7Days} in the last 7 days`} />
        <Metric label="sessions" value={m.sessions} detail={`${perSession} min per session`} />
        <Metric label="boks read" value={m.boksFinished} detail={`of ${m.boksOpened} opened`} />
        <Metric label="boks written" value={m.authored.total} detail={`${m.authored.published} published · ${m.authored.pending} in review`} />
      </section>

      <section className="grid gap-2" aria-label="Reading in the last 30 days">
        <h3 className="inspector-heading">
          Last 30 days <span>{m.minutesLast30Days} min</span>
        </h3>
        <div className="inspector-activity" role="img" aria-label={`Reading minutes per day, peak ${peak}`}>
          {days.map((entry) => (
            <span
              key={entry.day}
              style={{ height: `${Math.max(entry.minutes ? 8 : 2, (entry.minutes / peak) * 100)}%` }}
              data-empty={entry.minutes === 0 ? "true" : undefined}
              title={`${entry.day}: ${entry.minutes} min, ${entry.boks} boks`}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3" aria-label="Boks">
        <div className="admin-segmented admin-segmented--wide" role="group" aria-label="Which boks">
          {lists.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={list === entry.key} aria-label={`${entry.label}: ${entry.count}`} onClick={() => setList(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
        {activeList.shown < activeList.count && (
          <p className="text-xs text-[var(--muted-foreground)]">
            Showing the latest {activeList.shown} of {activeList.count}.
          </p>
        )}

        {list === "wrote" && (
          <BokList
            empty="Has not written any boks."
            rows={person.authoredBoks.map((bok) => ({
              id: bok.id,
              title: bok.title,
              status: bok.status,
              detail: `${formatAdminDate(bok.createdAt)} · ${bok.readers} readers · ♥ ${bok.likes} · ${bok.comments} comments`,
            }))}
            onOpen={openBok}
          />
        )}
        {list === "liked" && (
          <BokList
            empty="Has not liked anything."
            rows={person.likedBoks.map((bok) => ({
              id: bok.id,
              title: bok.title,
              status: bok.status,
              detail: `${bok.authorName} · liked ${formatAdminDate(bok.at)}`,
            }))}
            onOpen={openBok}
          />
        )}
        {list === "commented" && (
          <BokList
            empty="Has not commented."
            rows={person.comments.map((comment) => ({
              key: String(comment.id),
              id: comment.reelId,
              title: comment.title,
              status: comment.status,
              detail: `${comment.isReply ? "reply · " : ""}${formatAdminDate(comment.at)}`,
              quote: comment.body,
            }))}
            onOpen={openBok}
          />
        )}
        {list === "read" && (
          <BokList
            empty="Has not read anything yet."
            rows={person.readBoks.map((bok) => ({
              id: bok.id,
              title: bok.title,
              status: bok.status,
              detail: `${bok.authorName} · ${Math.round(bok.activeSeconds / 6) / 10} min · ${bok.finished ? "finished" : "not finished"} · ${formatAdminDate(bok.at)}`,
            }))}
            onOpen={openBok}
          />
        )}
      </section>
      {!person.isAnonymous && <PersonActions row={person} currentUserId={currentUserId} onChanged={async () => { onChanged(); await refresh(); }} />}
      <Button variant="ghost" className="studio-export" onClick={exportPerson}><Download /> Export account JSON</Button>
      <details className="studio-details"><summary>Account & measurement details <span>＋</span></summary><div className="studio-details-body">
        <section className="inspector-metrics"><Metric label="active days" value={m.activeDays} /><Metric label="skips" value={m.skips} /><Metric label="likes given" value={m.likesGiven} /><Metric label="comments" value={m.commentsWritten} /><Metric label="following" value={m.following} /><Metric label="followers" value={m.followers} /></section>
        <dl className="inspector-facts"><Fact label="Last sign-in">{formatAdminDate(person.lastSignInAt)}</Fact><Fact label="First read">{formatAdminDate(m.firstReadAt)}</Fact><Fact label="Last read">{formatAdminDate(m.lastReadAt)}</Fact><Fact label="Terms accepted">{formatAdminDate(person.termsAcceptedAt)}</Fact><Fact label="Languages">{person.readingLanguages.join(", ") || "None"}</Fact></dl>
        {m.authored.total > 0 && <section className="inspector-metrics"><Metric label="readers reached" value={m.readersReached} /><Metric label="likes received" value={m.likesReceived} /><Metric label="comments received" value={m.commentsReceived} /><Metric label="archived boks" value={m.authored.archived} /></section>}
      </div></details>
    </div>
  );
}

function BokList({
  rows,
  empty,
  onOpen,
}: {
  rows: { key?: string; id: string; title: string; status: AdminBokStatus; detail: string; quote?: string }[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  if (!rows.length) return <p className="text-sm text-[var(--muted-foreground)]">{empty}</p>;
  return (
    <ul className="inspector-list">
      {rows.map((row) => (
        <li key={row.key ?? row.id}>
          <button type="button" className="inspector-row-button" onClick={() => onOpen(row.id)}>
            <span className="inspector-list__meta">
              <strong>{row.title}</strong>
              {row.status !== "published" && <BokStatusBadge status={row.status} />}
            </span>
            <small>{row.detail}</small>
            {row.quote && <p>{row.quote}</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}
