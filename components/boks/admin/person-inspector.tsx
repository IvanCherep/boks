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
import { currentUiLanguage, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const ru = (n: number, one: string, few: string, many: string) => plural("ru", n, { one, few, many, other: few });

const words = defineMessages(
  {
    couldNotOpen: "Could not open this account.",
    loading: "Loading…",
    lists: { wrote: "Wrote", liked: "Liked", commented: "Commented", read: "Read" } as Record<ListKey, string>,
    eyebrow: "Account / inspector",
    suspended: "Suspended",
    admin: "Admin",
    activeReader: "Active reader",
    guestSession: "Guest session",
    joined: (date: string) => `Joined ${date}`,
    unassigned: "Unassigned",
    suspendedNote: (date: string, by: string | null, reason: string | null) =>
      `Suspended ${date}${by ? ` by @${by}` : ""}${reason ? ` — ${reason}` : ""}`,
    reading: "Reading",
    foregroundMinutes: "foreground minutes",
    last7: (n: number) => `${n} in the last 7 days`,
    sessions: "sessions",
    perSession: (n: number) => `${n} min per session`,
    boksRead: "boks read",
    ofOpened: (n: number) => `of ${n} opened`,
    boksWritten: "boks written",
    writtenDetail: (published: number, pending: number) => `${published} published · ${pending} in review`,
    last30Label: "Reading in the last 30 days",
    last30: "Last 30 days",
    min: (n: number) => `${n} min`,
    perDay: (peak: number) => `Reading minutes per day, peak ${peak}`,
    dayTitle: (day: string, minutes: number, boks: number) => `${day}: ${minutes} min, ${boks} boks`,
    boks: "Boks",
    whichBoks: "Which boks",
    showing: (shown: number, count: number) => `Showing the latest ${shown} of ${count}.`,
    noneWritten: "Has not written any boks.",
    wroteDetail: (date: string, readers: number, likes: number, comments: number) => `${date} · ${readers} readers · ♥ ${likes} · ${comments} comments`,
    noneLiked: "Has not liked anything.",
    likedDetail: (author: string | undefined, date: string) => `${author} · liked ${date}`,
    noneCommented: "Has not commented.",
    reply: "reply · ",
    noneRead: "Has not read anything yet.",
    finished: "finished",
    notFinished: "not finished",
    export: "Export account JSON",
    details: "Account & measurement details",
    activeDays: "active days",
    skips: "skips",
    likesGiven: "likes given",
    comments: "comments",
    following: "following",
    followers: "followers",
    lastSignIn: "Last sign-in",
    firstRead: "First read",
    lastRead: "Last read",
    terms: "Terms accepted",
    languages: "Languages",
    none: "None",
    readersReached: "readers reached",
    likesReceived: "likes received",
    commentsReceived: "comments received",
    archivedBoks: "archived boks",
  },
  {
    ru: {
      couldNotOpen: "Не удалось открыть этот аккаунт.",
      loading: "Загрузка…",
      lists: { wrote: "Написал", liked: "Лайкнул", commented: "Комментировал", read: "Читал" },
      eyebrow: "Аккаунт / инспектор",
      suspended: "Заблокирован",
      admin: "Админ",
      activeReader: "Активный читатель",
      guestSession: "Гостевая сессия",
      joined: (date: string) => `С нами с ${date}`,
      unassigned: "Не назначен",
      suspendedNote: (date: string, by: string | null, reason: string | null) =>
        `Заблокирован ${date}${by ? `, @${by}` : ""}${reason ? `: ${reason}` : ""}`,
      reading: "Чтение",
      foregroundMinutes: "минут на экране",
      last7: (n: number) => `${n} за последние 7 дней`,
      sessions: "сессии",
      perSession: (n: number) => `${n} мин за сессию`,
      boksRead: "боков прочитано",
      ofOpened: (n: number) => `из ${n} открытых`,
      boksWritten: "боков написано",
      writtenDetail: (published: number, pending: number) => `опубликовано: ${published} · на проверке: ${pending}`,
      last30Label: "Чтение за последние 30 дней",
      last30: "Последние 30 дней",
      min: (n: number) => `${n} мин`,
      perDay: (peak: number) => `Минуты чтения по дням, пик ${peak}`,
      dayTitle: (day: string, minutes: number, boks: number) => `${day}: ${minutes} мин, ${boks} ${ru(boks, "бок", "бока", "боков")}`,
      boks: "Боки",
      whichBoks: "Какие боки",
      showing: (shown: number, count: number) => `Показаны последние ${shown} из ${count}.`,
      noneWritten: "Не написал ни одного бока.",
      wroteDetail: (date: string, readers: number, likes: number, comments: number) =>
        `${date} · ${readers} ${ru(readers, "читатель", "читателя", "читателей")} · ♥ ${likes} · ${comments} ${ru(comments, "комментарий", "комментария", "комментариев")}`,
      noneLiked: "Ничего не лайкнул.",
      likedDetail: (author: string | undefined, date: string) => `${author} · лайк ${date}`,
      noneCommented: "Не комментировал.",
      reply: "ответ · ",
      noneRead: "Пока ничего не читал.",
      finished: "дочитан",
      notFinished: "не дочитан",
      export: "Экспорт аккаунта в JSON",
      details: "Аккаунт и детали измерений",
      activeDays: "активных дней",
      skips: "пропусков",
      likesGiven: "лайков поставлено",
      comments: "комментариев",
      following: "подписок",
      followers: "подписчиков",
      lastSignIn: "Последний вход",
      firstRead: "Первое чтение",
      lastRead: "Последнее чтение",
      terms: "Условия приняты",
      languages: "Языки",
      none: "Нет",
      readersReached: "читателей охвачено",
      likesReceived: "лайков получено",
      commentsReceived: "комментариев получено",
      archivedBoks: "боков в архиве",
    },
  }
);

type ListKey = "wrote" | "liked" | "commented" | "read";

/**
 * One account for an admin: who they are, how they read, what they wrote,
 * liked and said. Every boks in it opens the boks view.
 */
export function PersonInspector({ userId, currentUserId, onChanged }: { userId: string; currentUserId: string | null; onChanged: () => void }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const { openBok } = useAdminInspector();
  const [person, setPerson] = useState<AdminPersonDetail | null>(null);
  const [error, setError] = useState("");
  const [list, setList] = useState<ListKey>("wrote");

  const refresh = useCallback(async () => {
    try {
      setPerson(await loadAdminPerson(userId));
      setError("");
    } catch (caught) {
      setError(readableBoksError(caught, words[currentUiLanguage()].couldNotOpen));
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
  if (!person) return <p className="p-6 text-sm text-[var(--muted-foreground)]">{t.loading}</p>;

  const m = person.metrics;
  const peak = Math.max(1, ...days.map((entry) => entry.minutes));
  const perSession = m.sessions ? Math.round((m.minutes / m.sessions) * 10) / 10 : 0;
  // The tabs carry the true totals; the lists under them are the newest
  // few hundred, and say so when they are cut short.
  const lists: { key: ListKey; label: string; count: number; shown: number }[] = [
    { key: "wrote", label: t.lists.wrote, count: m.authored.total, shown: person.authoredBoks.length },
    { key: "liked", label: t.lists.liked, count: m.likesGiven, shown: person.likedBoks.length },
    { key: "commented", label: t.lists.commented, count: m.commentsWritten, shown: person.comments.length },
    { key: "read", label: t.lists.read, count: m.boksOpened, shown: person.readBoks.length },
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
        <p className="studio-eyebrow">{t.eyebrow}</p>
        <h2>@{person.handle || "reader"}</h2>
      </header>
      <div className="studio-person-head">
        <div className="studio-person-avatar" aria-hidden="true">{(person.handle || "r").slice(0, 1)}</div>
        <div><span className={`studio-role ${person.bannedAt ? "is-suspended" : person.role === "admin" ? "is-admin" : ""}`}>{person.bannedAt ? t.suspended : person.role === "admin" ? t.admin : t.activeReader}</span>
          <p>{person.email || t.guestSession}</p><small>{t.joined(new Date(person.joinedAt).toLocaleDateString(language))} · {person.algorithmId || t.unassigned}</small>
        </div>
      </div>
      {person.bannedAt && <p className="studio-hint">{t.suspendedNote(formatAdminDate(person.bannedAt), person.bannedBy, person.banReason)}</p>}
      {error && <p role="alert" className="studio-meta">{error}</p>}
      <section className="inspector-metrics" aria-label={t.reading}>
        <Metric label={t.foregroundMinutes} value={m.minutes} detail={t.last7(m.minutesLast7Days)} />
        <Metric label={t.sessions} value={m.sessions} detail={t.perSession(perSession)} />
        <Metric label={t.boksRead} value={m.boksFinished} detail={t.ofOpened(m.boksOpened)} />
        <Metric label={t.boksWritten} value={m.authored.total} detail={t.writtenDetail(m.authored.published, m.authored.pending)} />
      </section>

      <section className="grid gap-2" aria-label={t.last30Label}>
        <h3 className="inspector-heading">
          {t.last30} <span>{t.min(m.minutesLast30Days)}</span>
        </h3>
        <div className="inspector-activity" role="img" aria-label={t.perDay(peak)}>
          {days.map((entry) => (
            <span
              key={entry.day}
              style={{ height: `${Math.max(entry.minutes ? 8 : 2, (entry.minutes / peak) * 100)}%` }}
              data-empty={entry.minutes === 0 ? "true" : undefined}
              title={t.dayTitle(entry.day, entry.minutes, entry.boks)}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3" aria-label={t.boks}>
        <div className="admin-segmented admin-segmented--wide" role="group" aria-label={t.whichBoks}>
          {lists.map((entry) => (
            <button key={entry.key} type="button" aria-pressed={list === entry.key} aria-label={`${entry.label}: ${entry.count}`} onClick={() => setList(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
        {activeList.shown < activeList.count && (
          <p className="text-xs text-[var(--muted-foreground)]">
            {t.showing(activeList.shown, activeList.count)}
          </p>
        )}

        {list === "wrote" && (
          <BokList
            empty={t.noneWritten}
            rows={person.authoredBoks.map((bok) => ({
              id: bok.id,
              title: bok.title,
              status: bok.status,
              detail: t.wroteDetail(formatAdminDate(bok.createdAt), bok.readers, bok.likes, bok.comments),
            }))}
            onOpen={openBok}
          />
        )}
        {list === "liked" && (
          <BokList
            empty={t.noneLiked}
            rows={person.likedBoks.map((bok) => ({
              id: bok.id,
              title: bok.title,
              status: bok.status,
              detail: t.likedDetail(bok.authorName, formatAdminDate(bok.at)),
            }))}
            onOpen={openBok}
          />
        )}
        {list === "commented" && (
          <BokList
            empty={t.noneCommented}
            rows={person.comments.map((comment) => ({
              key: String(comment.id),
              id: comment.reelId,
              title: comment.title,
              status: comment.status,
              detail: `${comment.isReply ? t.reply : ""}${formatAdminDate(comment.at)}`,
              quote: comment.body,
            }))}
            onOpen={openBok}
          />
        )}
        {list === "read" && (
          <BokList
            empty={t.noneRead}
            rows={person.readBoks.map((bok) => ({
              id: bok.id,
              title: bok.title,
              status: bok.status,
              detail: `${bok.authorName} · ${t.min(Math.round(bok.activeSeconds / 6) / 10)} · ${bok.finished ? t.finished : t.notFinished} · ${formatAdminDate(bok.at)}`,
            }))}
            onOpen={openBok}
          />
        )}
      </section>
      {!person.isAnonymous && <PersonActions row={person} currentUserId={currentUserId} onChanged={async () => { onChanged(); await refresh(); }} />}
      <Button variant="ghost" className="studio-export" onClick={exportPerson}><Download /> {t.export}</Button>
      <details className="studio-details"><summary>{t.details} <span>＋</span></summary><div className="studio-details-body">
        <section className="inspector-metrics"><Metric label={t.activeDays} value={m.activeDays} /><Metric label={t.skips} value={m.skips} /><Metric label={t.likesGiven} value={m.likesGiven} /><Metric label={t.comments} value={m.commentsWritten} /><Metric label={t.following} value={m.following} /><Metric label={t.followers} value={m.followers} /></section>
        <dl className="inspector-facts"><Fact label={t.lastSignIn}>{formatAdminDate(person.lastSignInAt)}</Fact><Fact label={t.firstRead}>{formatAdminDate(m.firstReadAt)}</Fact><Fact label={t.lastRead}>{formatAdminDate(m.lastReadAt)}</Fact><Fact label={t.terms}>{formatAdminDate(person.termsAcceptedAt)}</Fact><Fact label={t.languages}>{person.readingLanguages.join(", ") || t.none}</Fact></dl>
        {m.authored.total > 0 && <section className="inspector-metrics"><Metric label={t.readersReached} value={m.readersReached} /><Metric label={t.likesReceived} value={m.likesReceived} /><Metric label={t.commentsReceived} value={m.commentsReceived} /><Metric label={t.archivedBoks} value={m.authored.archived} /></section>}
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
