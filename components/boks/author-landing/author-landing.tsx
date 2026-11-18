"use client";

import { useEffect, useRef } from "react";
import { setUiLanguagePreference, useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { getBrowserId } from "@/components/boks/reader-behavior";
import {
  submitAuthorApplication,
  type AuthorAccess,
  type AuthorApplicationOffer,
} from "@/components/boks/supabase-browser-data";
import { landingFrameId, landingFrameSrc, landingFrameStyle } from "./early-frame";
import { landingMessages } from "./messages";

/** What the page in the frame calls (`scripts/author-landing/bridge.js`). */
type LandingHost = {
  signedIn: boolean;
  application: { status: string; createdAt: string } | null;
  submit: (fields: { offer: AuthorApplicationOffer; name: string; contact: string; links: string; audience: string; message: string }) => Promise<void>;
  signIn?: () => void;
  setLanguage: (language: string) => void;
};

declare global {
  interface Window {
    boksAuthorLanding?: LandingHost;
  }
}

/**
 * /author for an account with nothing published yet, and for a guest: the
 * designers' page for authors (`public/author-landing/`, imported with
 * `scripts/author-landing/import.mjs`), framed over the whole screen. Its
 * styles reset the whole document, so it lives in its own frame; the
 * application goes through this component, with the reader's session or as a
 * guest (`docs/author-applications.md`). An account with a published work,
 * an author page or Studio sees the cabinet instead.
 */
export function AuthorLanding({ access, signedIn, onSignIn }: {
  access: AuthorAccess | null;
  signedIn: boolean;
  /**
   * Opens sign-in, for a guest: an author the team invited, or one with a
   * cabinet, signs in here and the cabinet opens on their invitation or page.
   */
  onSignIn?: () => void;
}) {
  const t = useMessages(landingMessages);
  const language = useUiLanguage();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const slot = useRef<HTMLDivElement>(null);

  // The frame /author's HTML already started for a guest (early-frame.ts), or a new one; it outlives language changes.
  useEffect(() => {
    let node = document.getElementById(landingFrameId) as HTMLIFrameElement | null;
    if (!node) {
      node = document.createElement("iframe");
      node.id = landingFrameId;
      node.allow = "autoplay";
      node.style.cssText = landingFrameStyle;
      node.src = landingFrameSrc(language, window.location.hash);
      slot.current?.appendChild(node);
    }
    node.dataset.claimed = "true";
    const ready = () => node?.contentWindow?.dispatchEvent(new Event("boks:host"));
    node.addEventListener("load", ready);
    frame.current = node;
    return () => {
      node?.removeEventListener("load", ready);
      node?.remove();
      frame.current = null;
      delete window.boksAuthorLanding;
    };
    // Created once; the page switches its own language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (frame.current) frame.current.title = t.frameTitle;
  }, [t.frameTitle]);

  const application = access?.application ?? null;
  useEffect(() => {
    window.boksAuthorLanding = {
      signedIn,
      application: application ? { status: application.status, createdAt: application.createdAt } : null,
      // A guest applies too: the team answers through the contact, and the device id limits how often.
      submit: async (fields) => {
        try {
          await submitAuthorApplication({ ...fields, visitorId: signedIn ? undefined : getBrowserId("boks-reader") });
        } catch (failure) {
          const readable = readableBoksError(failure, t.failed, language);
          throw Object.assign(new Error(readable), { readable });
        }
      },
      signIn: onSignIn,
      setLanguage: (next) => {
        if (next === "ru" || next === "en") setUiLanguagePreference(next);
      },
    };
    frame.current?.contentWindow?.dispatchEvent(new Event("boks:host"));
  }, [signedIn, application, onSignIn, t.failed, language]);

  return <div ref={slot} />;
}
