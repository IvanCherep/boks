"use client";

import { X } from "lucide-react";
import "@/app/daily.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { guestBokLimit, weekdayNames, type GuestReminder } from "@/lib/boks/daily/days";
import { Envelope } from "./envelope";
import { keepToSelf } from "./day-card";
import { welcomeMessages } from "./welcome-messages";
import { useEscape } from "./use-escape";


/** Ten marks, the ones read filled: where a guest stands. */
function GuestMarks({ count }: { count: number }) {
  return <div className="guest-marks" aria-hidden="true">
    {Array.from({ length: guestBokLimit }, (_, index) => <span key={index} className={index < count ? "is-read" : ""} style={{ "--mark-delay": `${index * 40}ms` } as React.CSSProperties} />)}
  </div>;
}

/**
 * A guest's first bok: what boks is, and what an account adds - the letter,
 * the game, a kept history - with the allowance stated plainly. Reading on
 * without an account is a real choice, not a hidden link.
 */
export function GuestWelcome({ onCreate, onClose }: { onCreate: () => void; onClose: () => void }) {
  const words = useMessages(welcomeMessages);
  useEscape(onClose);
  return <aside className="guest-card guest-card--welcome" role="dialog" aria-label={words.guestEyebrow} {...keepToSelf}>
    <button type="button" className="day-card__close" aria-label={words.notNow} onClick={onClose}><X size={20} /></button>
    <p className="day-card__eyebrow">{words.guestEyebrow}</p>
    <h2 className="day-card__title">{words.guestTitle}</h2>
    <p className="day-card__lead">{words.guestLead}</p>
    <ul className="guest-perks">
      <li><span className="guest-perks__art" aria-hidden="true"><Envelope state="sealed" size="small" /></span>{words.perkLetter}</li>
      <li><span className="guest-perks__art guest-perks__art--game" aria-hidden="true">?</span>{words.perkGame}</li>
      <li><span className="guest-perks__art guest-perks__art--days" aria-hidden="true"><i /><i /><i className="is-on" /><i className="is-on" /><i className="is-today" /></span>{words.perkKeep}</li>
    </ul>
    <button type="button" className="daily-button daily-button--accent guest-card__create" onClick={onCreate}>{words.createAccount}</button>
    <button type="button" className="day-card__read" onClick={onClose}>{words.readFirst}</button>
    <p className="guest-card__small">{words.guestAllowance(guestBokLimit)}</p>
  </aside>;
}

/** Every two boks: one reason an account is worth it, and how many boks are left. */
export function GuestReminderCard({ kind, count, onCreate, onClose }: {
  kind: GuestReminder;
  count: number;
  onCreate: () => void;
  onClose: () => void;
}) {
  const words = useMessages(welcomeMessages);
  const language = useUiLanguage();
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
        {kind === "letter" && <Envelope state="sealed" size="small" />}
        {kind === "game" && <b>?</b>}
        {kind === "progress" && <span className="guest-card__week">{weekdayNames(language).slice(0, 5).map((name, index) => <i key={name} className={index < 3 ? "is-on" : index === 3 ? "is-today" : ""}>{name}</i>)}</span>}
        {kind === "last" && <b>{left}</b>}
      </span>
    </div>
    <p className="day-card__lead">{lead}</p>
    <GuestMarks count={count} />
    <button type="button" className="daily-button daily-button--accent guest-card__create" onClick={onCreate}>{words.createAccount}</button>
    <button type="button" className="day-card__read" onClick={onClose}>{words.keepReading}</button>
  </aside>;
}
