"use client";
/* eslint-disable @next/next/no-img-element -- the series' own pictures, as everywhere else in boks (no next/image here) */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, Headphones } from "lucide-react";
import "@/app/author-landing.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { getBrowserId } from "@/components/boks/reader-behavior";
import {
  sendBoksFeedback,
  submitAuthorApplication,
  type AuthorAccess,
  type AuthorApplicationOffer,
} from "@/components/boks/supabase-browser-data";
import { landingMessages } from "./messages";

/** Прохоров's page: the example the hero shows (`components/boks/author-portraits.ts`). */
const examplePortrait = "/l/XFKejQcwEa7M_7jI_1T6LA/f/prokhorov-portrait.webp";
const exampleHandle = "prokhorov";
const offerOrder = ["page", "launch", "series"] as const;
/** The free joint launch: the main offer, in the middle and set apart. */
const leadOffer = "launch";
/** Read once by the author page's Back, so it returns here (`reader-feed.tsx`). */
const returnKey = "boks-return-to-author-landing";

/**
 * /author for an account with nothing published yet, and for a guest: an
 * invitation, what boks is, the author's path and tools, what readers get,
 * how authors are chosen, the terms, the application and a question to the
 * team (`docs/author-applications.md`). An account with a
 * published work, an author page or Studio sees the cabinet instead.
 */
export function AuthorLanding({ access, signedIn }: {
  access: AuthorAccess | null;
  signedIn: boolean;
}) {
  const t = useMessages(landingMessages);
  const [offer, setOffer] = useState<AuthorApplicationOffer>("unsure");
  const form = useRef<HTMLElement>(null);

  // A mark left by an example opened earlier and not closed with its Back does not outlive this page.
  useEffect(() => {
    try {
      sessionStorage.removeItem(returnKey);
    } catch {
      // Nothing to clear.
    }
  }, []);

  const apply = (choice: AuthorApplicationOffer) => {
    setOffer(choice);
    form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const markReturn = () => {
    try {
      sessionStorage.setItem(returnKey, JSON.stringify({ handle: exampleHandle, at: Date.now() }));
    } catch {
      // Without storage, the browser's own Back still comes here.
    }
  };

  return <div className="alp">
    <header className="alp-hero">
      <nav className="alp-nav">
        <a href="/" className="alp-logo" aria-label="boks">boks<i>.</i></a>
        <span>
          <a href="#about">{t.navAbout}</a>
          <a href="#authors">{t.navAuthors}</a>
          <a href="#readers">{t.navReaders}</a>
          <a href="#offers">{t.navOffers}</a>
          <a href="#apply" className="is-strong">{t.navApply} <ArrowRight aria-hidden="true" /></a>
        </span>
      </nav>
      <div className="alp-hero__body">
        <div className="alp-hero__text">
          <i className="alp-rule" aria-hidden="true" />
          <p className="alp-kicker">{t.heroKicker}</p>
          <h1>{t.heroTitle}<em>{t.heroTitleAccent}</em></h1>
          <p>{t.heroLead}</p>
          <div className="alp-hero__actions">
            <a href="#apply" className="alp-button">{t.heroApply} <ArrowRight aria-hidden="true" /></a>
            <a href={`/@${exampleHandle}`} className="alp-link" onClick={markReturn}>{t.example}</a>
          </div>
          <p className="alp-hero__note">{t.heroNote}</p>
        </div>
        <figure className="alp-collage">
          <div className="alp-collage__frame">
            <img className="alp-collage__land" src="/series/prokhorov-pobeg.webp" alt="" />
            <img className="alp-collage__night" src="/series/malyo-subbotina-zvyozdnoe.webp" alt="" />
            <a href={`/@${exampleHandle}`} className="alp-card" aria-label={t.collageCaption} onClick={markReturn}>
              <span className="alp-card__curtain" aria-hidden="true"><i /></span>
              <img src={examplePortrait} alt="" />
              <span className="alp-card__name"><em>Алексей</em><span>Прохоров<i>.</i></span><small>@{exampleHandle}</small></span>
            </a>
          </div>
          <figcaption>{t.collageCaption}</figcaption>
        </figure>
      </div>
    </header>

    <section id="about" className="alp-about">
      <div className="alp-about__text">
        <p className="alp-kicker">{t.aboutKicker}</p>
        <h2>{t.aboutTitle}<em>{t.aboutTitleAccent}</em></h2>
        {t.aboutLead.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>
      <div className="alp-modes">
        <h3>{t.modesTitle}</h3>
        <ol>
          {t.modes.map((mode, index) => {
            const Icon = index === 0 ? BookOpen : Headphones;
            return <li key={mode.title}>
              <span className="alp-modes__icon" aria-hidden="true"><Icon /></span>
              <span><strong>{mode.title}</strong><small>{mode.lead}</small></span>
            </li>;
          })}
        </ol>
      </div>
      <blockquote className="alp-mission">
        <p>{t.mission}</p>
        <footer>{t.missionSign}</footer>
      </blockquote>
    </section>

    <section id="authors" className="alp-journey">
      <div className="alp-section-head">
        <div>
          <p className="alp-kicker">{t.journeyKicker}</p>
          <h2>{t.journeyTitle}</h2>
        </div>
        <p>{t.journeyLead}</p>
      </div>
      <ol className="alp-journey__path">
        {t.journey.map((step, index) => <li key={step.title} style={{ "--i": index } as React.CSSProperties}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <h3>{step.title}</h3>
          <p>{step.lead}</p>
        </li>)}
      </ol>
    </section>

    <section className="alp-features">
      <div className="alp-section-head">
        <h2>{t.featuresTitle}</h2>
        <p>{t.featuresLead}</p>
      </div>
      {[false, true].map((soon) => <ul key={String(soon)} className={soon ? "alp-features__grid alp-features__grid--soon" : "alp-features__grid"}>
        {t.features.filter((feature) => Boolean(feature.soon) === soon).map((feature) => <li key={feature.title} className={soon ? "is-soon" : ""}>
          {soon ? <span className="alp-soon">{t.soon}</span> : <Check className="alp-features__mark" aria-hidden="true" />}
          <h3>{feature.title}</h3>
          <p>{feature.lead}</p>
        </li>)}
      </ul>)}
    </section>

    <section id="recorder" className="alp-recorder">
      <div className="alp-recorder__text">
        <p className="alp-kicker">{t.recorderKicker}</p>
        <h2>{t.recorderTitle}</h2>
        <p className="alp-recorder__lead">{t.recorderLead}</p>
        <ol className="alp-steps">
          {t.recorderSteps.map(([name, lead], index) => <li key={name}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <span><strong>{name}</strong><small>{lead}</small></span>
          </li>)}
        </ol>
        <p className="alp-recorder__note">{t.recorderNote}</p>
      </div>
      <div className="alp-phone" aria-hidden="true">
        <img src="/series/prokhorov-azbuka-very.webp" alt="" />
        <span className="alp-phone__veil" />
        <span className="alp-phone__curtain alp-phone__curtain--left" />
        <span className="alp-phone__curtain alp-phone__curtain--right" />
        <p className="alp-phone__verse"><span>Люблю грозу в начале мая,</span><b>когда весенний, первый гром</b></p>
      </div>
    </section>

    <section id="readers" className="alp-readers">
      <div className="alp-letter">
        <p className="alp-kicker">{t.readersKicker}</p>
        <h2>{t.readersTitle}</h2>
        {t.readersLetter.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>
      <div className="alp-readers__lists">
        <h3>{t.readersNowTitle}</h3>
        <ul className="alp-readers__now">
          {t.readersNow.map((item) => <li key={item.title}>
            <Check aria-hidden="true" />
            <span><strong>{item.title}</strong><small>{item.lead}</small></span>
          </li>)}
        </ul>
        <h3>{t.readersSoonTitle}</h3>
        <ul className="alp-readers__soon">
          {t.readersSoon.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </section>

    <section className="alp-selection">
      <div className="alp-selection__head">
        <p className="alp-kicker">{t.selectionKicker}</p>
        <h2>{t.selectionTitle}</h2>
      </div>
      <ol>
        {t.selection.map((item, index) => <li key={item.title} className={index === t.selection.length - 1 ? "is-free" : ""}>
          <b>{String(index + 1).padStart(2, "0")}</b>
          <h3>{item.title}</h3>
          <p>{item.lead}</p>
        </li>)}
      </ol>
    </section>

    <section id="offers" className="alp-offers">
      <div className="alp-section-head">
        <h2>{t.startTitle}</h2>
        <p>{t.startLead}</p>
      </div>
      <ol className="alp-offers__list">
        {offerOrder.map((key, index) => {
          const item = t.offers[key];
          return <li key={key} className={`alp-offer${key === leadOffer ? " is-lead" : ""}`} style={{ "--i": index } as React.CSSProperties}>
            <span className="alp-offer__top">
              <span className="alp-offer__num">{String(index + 1).padStart(2, "0")}</span>
              {item.tag && <span className="alp-offer__tag">{item.tag}</span>}
            </span>
            <h3>{item.name}</h3>
            <p className="alp-offer__price">
              {item.oldPrice && <s>{item.oldPrice}</s>}
              <b>{item.price}</b>
              <span>{item.term}</span>
            </p>
            {item.badge && <p className="alp-offer__badge">{item.badge}</p>}
            <ul>{item.points.map((point) => <li key={point}><Check aria-hidden="true" />{point}</li>)}</ul>
            <button type="button" className={key === leadOffer ? "alp-button" : "alp-button alp-button--line"} onClick={() => apply(key)}>
              {t.applyFor}
            </button>
          </li>;
        })}
      </ol>
    </section>

    <section id="apply" ref={form} className="alp-apply">
      <div className="alp-section-head">
        <h2>{t.applyTitle}</h2>
        <p>{t.applyLead}</p>
      </div>
      <ApplicationForm key={access?.application?.id ?? "new"} access={access} offer={offer} onOffer={setOffer} signedIn={signedIn} />
    </section>

    <section className="alp-ask">
      <AskTheTeam />
    </section>

    <footer className="alp-footer">
      <span>{t.footer}</span>
      <a href="/">{t.toReading} <ArrowRight aria-hidden="true" /></a>
    </footer>
  </div>;
}

/** Kept on this device until it is sent, so nothing they wrote is lost on a reload. */
const draftKey = "boks-author-application-draft";
type Fields = { name: string; links: string; audience: string; contact: string; message: string };
const emptyFields: Fields = { name: "", links: "", audience: "", contact: "", message: "" };

function readDraft(): Fields {
  try {
    return { ...emptyFields, ...(JSON.parse(sessionStorage.getItem(draftKey) ?? "{}") as Partial<Fields>) };
  } catch {
    return emptyFields;
  }
}

function ApplicationForm({ access, offer, onOffer, signedIn }: {
  access: AuthorAccess | null;
  offer: AuthorApplicationOffer;
  onOffer: (offer: AuthorApplicationOffer) => void;
  signedIn: boolean;
}) {
  const t = useMessages(landingMessages);
  const language = useUiLanguage();
  // The page appears only once the account is known, in the browser: the draft can be read at once.
  const [fields, setFields] = useState<Fields>(() => (typeof window === "undefined" ? emptyFields : readDraft()));
  const [state, setState] = useState<"editing" | "sending" | "sent">(access?.application ? "sent" : "editing");
  const [sentAt, setSentAt] = useState<string | null>(access?.application?.createdAt ?? null);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(fields));
    } catch {
      // Private mode: the draft lasts for this page only.
    }
  }, [fields]);

  const set = (name: keyof Fields) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => ({ ...f, [name]: event.target.value }));
  const ready = fields.name.trim() && fields.links.trim().length >= 3 && fields.contact.trim().length >= 3;

  // A guest applies too: the team answers through the contact, and the device id limits how often.
  const send = async () => {
    setState("sending");
    setError("");
    try {
      await submitAuthorApplication({ offer, ...fields, visitorId: signedIn ? undefined : getBrowserId("boks-reader") });
      setSentAt(new Date().toISOString());
      setState("sent");
      setFields(emptyFields);
      try {
        sessionStorage.removeItem(draftKey);
      } catch {
        // Nothing to clear.
      }
    } catch (failure) {
      setError(readableBoksError(failure, t.failed, language));
      setState("editing");
    }
  };

  if (state === "sent" && sentAt) {
    const date = new Date(sentAt).toLocaleDateString(language, { day: "numeric", month: "long" });
    const status = access?.application && access.application.createdAt === sentAt ? access.application.status : "new";
    return <div className="alp-sent" role="status">
      <span className="alp-sent__mark" aria-hidden="true"><Check /></span>
      <div>
        <h3>{t.sentTitle}</h3>
        <p>{t.sentLead(date)}</p>
        <p className="alp-sent__status">{t.sentStatus[status]}</p>
        <button type="button" className="alp-link" onClick={() => setState("editing")}>{t.sendAnother}</button>
      </div>
    </div>;
  }

  return <form className="alp-form" onSubmit={(event) => {
    event.preventDefault();
    if (ready) void send();
  }}>
    <fieldset className="alp-choice">
      <legend>{t.offerLabel}</legend>
      {(["page", "launch", "series", "unsure"] as const).map((key) => <label key={key} className={offer === key ? "is-on" : ""}>
        <input type="radio" name="offer" value={key} checked={offer === key} onChange={() => onOffer(key)} />
        {t.offerNames[key]}
      </label>)}
    </fieldset>
    <div className="alp-form__row">
      <label><span>{t.name}</span><input value={fields.name} onChange={set("name")} maxLength={120} autoComplete="name" required /></label>
      <label><span>{t.contact}</span><input value={fields.contact} onChange={set("contact")} maxLength={200} placeholder={t.contactPlaceholder} required /></label>
    </div>
    <label><span>{t.links}</span>
      <textarea value={fields.links} onChange={set("links")} maxLength={1500} rows={3} placeholder="https://t.me/…" required />
    </label>
    <label><span>{t.audience}</span><input value={fields.audience} onChange={set("audience")} maxLength={120} placeholder={t.audiencePlaceholder} /></label>
    <label><span>{t.message}</span><textarea value={fields.message} onChange={set("message")} maxLength={3000} rows={4} placeholder={t.messagePlaceholder} /></label>
    {error && <p className="alp-error" role="alert">{error}</p>}
    <div className="alp-form__send">
      <button type="submit" className="alp-button alp-button--ink" disabled={!ready || state === "sending"}>
        {state === "sending" ? t.sending : t.send} <ArrowRight aria-hidden="true" />
      </button>
      {!signedIn && <small>{t.guestNote}</small>}
    </div>
  </form>;
}

/**
 * A question to the team, with where to answer it: it lands in Studio →
 * Feedback as `author_landing`, and in the team's Telegram (`deploy/ops/inbox.py`).
 */
function AskTheTeam() {
  const t = useMessages(landingMessages);
  const [question, setQuestion] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const ready = question.trim().length >= 2 && contact.trim().length >= 3;

  return <div className="alp-ask__inner">
    <div className="alp-ask__head">
      <h2>{t.askTitle}</h2>
      <p>{t.askLead}</p>
    </div>
    {state === "sent"
      ? <p className="alp-ask__sent" role="status"><Check aria-hidden="true" />{t.askThanks}</p>
      : <form className="alp-ask__form" onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        setState("sending");
        sendBoksFeedback({ message: `${question.trim()}\n\n${t.askReplyTo}: ${contact.trim()}`, surface: "author_landing" })
          .then(() => setState("sent"), () => setState("failed"));
      }}>
        <label><span>{t.askQuestion}</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1800} rows={3} /></label>
        <div className="alp-ask__row">
          <label><span>{t.askContact}</span><input value={contact} onChange={(event) => setContact(event.target.value)} maxLength={150} placeholder={t.askContactPlaceholder} /></label>
          <button type="submit" className="alp-button alp-button--ink" disabled={!ready || state === "sending"}>{state === "sending" ? t.askSending : t.askSend}</button>
        </div>
        {state === "failed" && <p className="alp-error">{t.askFailed}</p>}
      </form>}
  </div>;
}
