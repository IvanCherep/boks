"use client";

import { useEffect, useState } from "react";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";
import { loadInviteGreeting, loadMyInvites, type InviteOffer } from "./data";

/**
 * An author the team invited who signs in on the reading side - the feed or
 * the Series shelf - rather than by the link in the letter: a card says their
 * page is waiting and opens the cabinet, which opens on the invitation
 * (`author-cabinet.tsx`). Closed, it stays closed for this visit.
 */

const words = defineMessages(
  {
    ready: "Your author's page in boks is ready",
    lead: "The boks team has prepared it. Readers see nothing until you publish it yourself.",
    open: "Open my page",
    later: "Later",
  },
  {
    ru: {
      ready: "Ваша страница автора в boks готова",
      lead: "Её подготовила редакция. Читатели ничего не увидят, пока вы сами не опубликуете.",
      open: "Открыть мою страницу",
      later: "Позже",
    },
  }
);

const closedKey = "boks-invite-nudge-closed";

export function InviteNudge({ userId }: { userId: string | null }) {
  const t = useMessages(words);
  const [offer, setOffer] = useState<InviteOffer | null>(null);
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    try {
      if (window.sessionStorage.getItem(closedKey) === userId) return;
    } catch {
      // No storage: the card shows.
    }
    let live = true;
    void loadMyInvites().then(async (offers) => {
      const first = offers[0];
      if (!live || !first) return;
      const words = await loadInviteGreeting(null, first.inviteId);
      if (!live) return;
      setGreeting(words ? String(words) : null);
      setOffer(first);
    });
    return () => {
      live = false;
    };
  }, [userId]);

  if (!offer || !userId) return null;

  function close() {
    try {
      window.sessionStorage.setItem(closedKey, userId!);
    } catch {
      // Closed for this render only.
    }
    setOffer(null);
  }

  return (
    <div className="invite-nudge-scrim" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <aside className="invite-nudge" role="dialog" aria-modal="true" aria-label={t.ready}>
      <span className="invite-nudge__mark" aria-hidden="true">b.</span>
      {greeting && <p className="invite-nudge__hello">{greeting}!</p>}
      <p className="invite-nudge__title">{t.ready}</p>
      <p className="invite-nudge__lead">{t.lead}</p>
      <div className="invite-nudge__actions">
        <a className="invite-nudge__open" href="/author">{t.open} →</a>
        <button type="button" className="invite-nudge__later" onClick={close}>{t.later}</button>
      </div>
    </aside>
    </div>
  );
}
