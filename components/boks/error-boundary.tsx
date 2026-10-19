"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import { currentUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

const messages = defineMessages(
  {
    title: "boks stopped before it could open",
    body: "Something in this browser stopped the app rather than the network: the page arrived, then the reader failed to start. Reloading often works, and another browser almost always does.",
    reload: "Reload boks",
    sendTo: "If it keeps happening, send the lines below to",
    withBrowser: "with your browser name - that is usually enough for us to fix it.",
    what: "What went wrong",
  },
  {
    ru: {
      title: "boks остановился, не успев открыться",
      body: "Приложение остановило что-то в этом браузере, а не сеть: страница загрузилась, но читалка не запустилась. Часто помогает перезагрузка, а другой браузер - почти всегда.",
      reload: "Перезагрузить boks",
      sendTo: "Если это повторяется, пришлите строки ниже на",
      withBrowser: "и укажите ваш браузер - обычно этого хватает, чтобы мы всё исправили.",
      what: "Что пошло не так",
    },
  }
);

/**
 * The last line before a white screen.
 *
 * Until 2026-09-21 this app had no error boundary at all, which means any
 * exception while the reader booted left the page blank - no message, no
 * retry, nothing to report. A reader in Russia on Yandex Browser hit exactly
 * that, and from the outside "white screen" is indistinguishable from "the site
 * is down", so nobody can even tell us what broke.
 *
 * Two things this must do, and they are in tension: say something a reader can
 * act on, and carry the technical detail without shouting it. So the detail is
 * behind a disclosure, in a form that can be pasted into a message to support -
 * which is how a crash that only happens on someone else's browser ever gets
 * diagnosed.
 *
 * A class component because that is still the only way to catch a render
 * error in React.
 */
type BoundaryState = { error: Error | null };

export class BoksErrorBoundary extends Component<{ children: ReactNode; v44?: boolean }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console, because that is where a reader who knows how to look will look,
    // and because a remote report is the only evidence we get.
    console.error("boks crashed while rendering", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A class component has no hooks; the language is read once, as it fails.
    const t = messages[currentUiLanguage()];

    if (this.props.v44) return (
      <main className="reader-v44 reader-system-page">
        <div className="reader-system-page__body">
          <header className="reader-system-page__header"><span>boks</span></header>
          <div className="reader-system-art reader-system-art--offline" aria-hidden="true">·<i>—</i>·</div>
          <h1 className="reader-system-title">Couldn’t open boks.</h1>
          <p className="mt-5">The app stopped while opening. Reload to try again.</p>
          <button type="button" data-slot="button" data-variant="default" className="mt-5 items-center justify-center" onClick={() => window.location.reload()}>Reload boks</button>
          <p className="mt-5">If it keeps happening, send the details below to <a className="auth-link" href={supportMailto}>{supportEmail}</a>.</p>
          <details className="reader-system-diagnostics">
            <summary>What went wrong</summary>
            <p>{error.name}: {error.message}</p>
            <p>{typeof navigator === "undefined" ? "" : navigator.userAgent}</p>
          </details>
        </div>
      </main>
    );

    return (
      <main className="reader-shell grid min-h-screen place-items-center px-6">
        <div className="max-w-md text-center">
          <p className="brand-word">boks</p>
          <h1 className="mt-4 text-2xl font-semibold tracking-normal">{t.title}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
            {t.body}
          </p>
          <button
            type="button"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-foreground)]"
            onClick={() => window.location.reload()}
          >
            {t.reload}
          </button>
          <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
            {t.sendTo}{" "}
            <a className="auth-link" href={supportMailto}>
              {supportEmail}
            </a>{" "}
            {t.withBrowser}
          </p>
          <details className="settings-disclosure mt-4 text-left">
            <summary>{t.what}</summary>
            <div className="settings-disclosure__body">
              <p className="break-words font-mono text-xs leading-5">
                {error.name}: {error.message}
              </p>
              <p className="mt-2 break-words font-mono text-xs leading-5 text-[var(--muted-foreground)]">
                {navigator.userAgent}
              </p>
            </div>
          </details>
        </div>
      </main>
    );
  }
}
