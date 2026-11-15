"use client";

import { X } from "lucide-react";
import "@/app/daily.css";
import { useMessages } from "@/components/boks/ui-language";
import { guestBokLimit, stampDate, type GuestReminder } from "@/lib/boks/daily/days";
import { keepToSelf } from "./day-card";
import { Postmark } from "./postmark";
import { useEscape } from "./use-escape";
import { welcomeMessages } from "./welcome-messages";

/** Ten marks, the ones read filled: where a guest stands. */
function GuestMarks({ count }: { count: number }) {
  return <div className="guest-marks" aria-hidden="true">
    {Array.from({ length: guestBokLimit }, (_, index) => <span key={index} className={index < count ? "is-read" : ""} style={{ "--i": index } as React.CSSProperties} />)}
  </div>;
}

/**
 * A guest's first bok: what boks is, then three numbered things an account
 * adds, the way a contents page would list them, and the allowance stated
 * plainly. Reading on without an account is a real choice.
 */
export function GuestWelcome({ onCreate, onClose }: { onCreate: () => void; onClose: () => void }) {
  const words = useMessages(welcomeMessages);
  useEscape(onClose);
  const perks: [string, string][] = [
    [words.perkLetter, words.perkLetterLead],
    [words.perkGame, words.perkGameLead],
    [words.perkDays, words.perkDaysLead],
  ];
  return <aside className="guest-card guest-card--welcome" role="dialog" aria-label={words.guestTitle} {...keepToSelf}>
    <button type="button" className="day-card__close" aria-label={words.notNow} onClick={onClose}><X size={20} /></button>
    <p className="guest-card__mark" aria-hidden="true">boks</p>
    <h2 className="day-card__title">{words.guestTitle}</h2>
    <p className="day-card__lead">{words.guestLead}</p>
    <ol className="guest-perks">
      {perks.map(([title, lead], index) => <li key={title} style={{ "--i": index } as React.CSSProperties}>
        <b aria-hidden="true">{String(index + 1).padStart(2, "0")}</b>
        <span><strong>{title}</strong><small>{lead}</small></span>
      </li>)}
    </ol>
    <button type="button" className="daily-button guest-card__create" onClick={onCreate}>{words.createAccount}</button>
    <button type="button" className="day-card__read" onClick={onClose}>{words.readWithout}</button>
    <p className="guest-card__small">{words.guestAllowance(guestBokLimit)}</p>
  </aside>;
}

/** Every two boks: one reason, in one sentence, and how many boks are left. */
export function GuestReminderCard({ kind, count, onCreate, onClose }: {
  kind: GuestReminder;
  count: number;
  onCreate: () => void;
  onClose: () => void;
}) {
  const words = useMessages(welcomeMessages);
  useEscape(onClose);
  const left = Math.max(0, guestBokLimit - count);
  const title = kind === "letter" ? words.reminderLetterTitle : kind === "game" ? words.reminderGameTitle : kind === "progress" ? words.reminderProgressTitle : words.reminderLastTitle(left);
  const lead = kind === "letter" ? words.reminderLetterLead : kind === "game" ? words.reminderGameLead : kind === "progress" ? words.reminderProgressLead : words.reminderLastLead;
  return <aside className={`guest-card guest-card--reminder guest-card--${kind}`} role="dialog" aria-label={title} {...keepToSelf}>
    <button type="button" className="day-card__close" aria-label={words.notNow} onClick={onClose}><X size={20} /></button>
    <p className="day-card__eyebrow">{words.guestProgress(count, guestBokLimit)}</p>
    <div className="guest-card__row">
      <h2 className="day-card__title">{title}</h2>
      <span className="guest-card__art" aria-hidden="true">
        {kind === "letter" && <Postmark caption={stampDate(new Date().toISOString().slice(0, 10))} sealed size="l" />}
        {kind === "game" && <b>?</b>}
        {kind === "progress" && <b>{count}</b>}
        {kind === "last" && <b>{left}</b>}
      </span>
    </div>
    <p className="day-card__lead">{lead}</p>
    <GuestMarks count={count} />
    <button type="button" className="daily-button guest-card__create" onClick={onCreate}>{words.createAccount}</button>
    <button type="button" className="day-card__read" onClick={onClose}>{words.keepReading}</button>
  </aside>;
}
