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
 *
 * Shown once is enough (2026-11-20, the same evening): it informs, it does not
 * ask, so it counts as seen the moment it appears, and it leaves by itself after
 * a few seconds or at the reader's first scroll or tap elsewhere. Before, it
 * came back on every visit until "Got it" was pressed, which most never do, and
 * in the VK and Telegram browsers, which forget the site's storage, on nearly
 * every link. The mark is also kept in a cookie for browsers that drop one of the two.
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
const cookieName = "boks_cookie_notice";
/** How long it stays when the reader does nothing about it. */
export const cookieNoticeMs = 9000;

function seen() {
  try {
    if (window.localStorage.getItem(cookieNoticeKey) === "1") return true;
  } catch {
    // Private mode: the cookie below may still know.
  }
  try {
    return document.cookie.split("; ").includes(`${cookieName}=1`);
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(cookieNoticeKey, "1");
  } catch {
    // Private mode: the cookie may still hold it.
  }
  try {
    document.cookie = `${cookieName}=1; max-age=31536000; path=/; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`;
  } catch {
    // Cookies blocked: it closes for this visit.
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
      markSeen();
      setShown(true);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!shown || leaving) return;
    const leave = () => {
      setLeaving(true);
      window.setTimeout(() => setShown(false), 220);
    };
    const away = (event: Event) => {
      if (!(event.target instanceof Element && event.target.closest(".cookie-notice"))) leave();
    };
    const timer = window.setTimeout(leave, cookieNoticeMs);
    // A moment's grace, so the scroll that was already under way does not take it at once.
    const listen = window.setTimeout(() => {
      window.addEventListener("pointerdown", away, true);
      window.addEventListener("wheel", away, { capture: true, passive: true });
      window.addEventListener("touchmove", away, { capture: true, passive: true });
      window.addEventListener("keydown", away, true);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(listen);
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("wheel", away, true);
      window.removeEventListener("touchmove", away, true);
      window.removeEventListener("keydown", away, true);
    };
  }, [shown, leaving]);

  if (!shown) return null;

  function close() {
    markSeen();
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
