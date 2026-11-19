"use client";

import { useEffect, useState } from "react";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

/**
 * The cookie notice (2026-11-20): what boks keeps in the browser and why, once,
 * until the reader closes it. Everything boks keeps there is needed for the
 * site to work - the sign-in, the interface language, theme and reading
 * settings, a guest's count of read boks (`/privacy#storage`) - and there are
 * no advertising or third-party trackers, so this informs rather than asks.
 *
 * It waits for the reading to be free: never over the guest welcome, the day
 * card or an open sheet, and never inside a frame (Studio's previews).
 */

const words = defineMessages(
  {
    title: "Cookies",
    body: "We use cookies to make the site work: to remember your sign-in and your settings.",
    short: "We use cookies for sign-in and settings.",
    more: "Privacy",
    ok: "Got it",
  },
  {
    ru: {
      title: "Cookie",
      body: "Мы используем cookie, чтобы сайт работал: помнил вход и ваши настройки.",
      short: "Мы используем cookie для входа и настроек.",
      more: "Подробнее",
      ok: "Понятно",
    },
  }
);

export const cookieNoticeKey = "boks-cookie-notice";

function seen() {
  try {
    return window.localStorage.getItem(cookieNoticeKey) === "1";
  } catch {
    return false;
  }
}

/** Something already asks for the reader's attention: the notice waits its turn. */
function busy() {
  return Boolean(document.querySelector(".guest-card, .day-card, [aria-modal='true'], .auth-overlay, .scrim"));
}

export function CookieNotice() {
  const w = useMessages(words);
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (window.self !== window.top || seen()) return;
    if (/^\/(study|l)\//.test(window.location.pathname)) return;
    let timer = window.setTimeout(function check() {
      if (seen()) return;
      if (busy()) { timer = window.setTimeout(check, 1500); return; }
      setShown(true);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, []);

  if (!shown) return null;

  function close() {
    try {
      window.localStorage.setItem(cookieNoticeKey, "1");
    } catch {
      // Private mode: it closes for this visit.
    }
    setLeaving(true);
    window.setTimeout(() => setShown(false), 220);
  }

  return (
    <aside className={`cookie-notice${leaving ? " is-leaving" : ""}`} role="region" aria-label={w.title}>
      <span className="cookie-notice__mark" aria-hidden="true">b.</span>
      <p className="cookie-notice__text">
        {/* A phone gets the same sentence in two lines, clear of Read. */}
        <span className="cookie-notice__long">{w.body}</span>
        <span className="cookie-notice__short">{w.short}</span>{" "}
        <a href="/privacy#storage">{w.more}</a>
      </p>
      <button type="button" className="cookie-notice__ok" onClick={close}>{w.ok}</button>
    </aside>
  );
}
