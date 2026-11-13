"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { ReaderBackIcon } from "@/components/boks/reader/reader-icons";
import { useUiLanguage } from "@/components/boks/ui-language";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import type { UiLanguage } from "@/lib/i18n/ui-language";

/**
 * The shared frame of /terms and /privacy: a top bar with the way back to
 * reading and an explicit RU / EN switch, the two documents as tabs, a first
 * screen (title, effective date, one sentence, three highlights), then the
 * document with a contents list - beside the text on a wide screen, behind a
 * button on a phone.
 *
 * The edition follows `?lang=ru|en` when the address names one, so a link can
 * open a given edition; otherwise the interface language (ADR 0015). The
 * switch only changes the address, never the reader's interface preference.
 * Section ids are the same in both editions, so `/terms#author-content` lands
 * on the same section whichever one opens.
 */

export type LegalPage = "terms" | "privacy";

export type LegalSection = { id: string; title: string; body: ReactNode };

export type LegalDocumentProps = {
  page: LegalPage;
  language: UiLanguage;
  title: string;
  effective: string;
  intro: ReactNode;
  highlights: { title: string; body: ReactNode }[];
  sections: LegalSection[];
};

const words = {
  en: {
    back: "Back to reading",
    terms: "Terms",
    privacy: "Privacy",
    documents: "Documents",
    language: "Language",
    highlights: "In short",
    contents: "On this page",
    questions: "Questions about this page?",
    write: "Write to",
  },
  ru: {
    back: "К чтению",
    terms: "Условия",
    privacy: "Конфиденциальность",
    documents: "Документы",
    language: "Язык",
    highlights: "Главное",
    contents: "На этой странице",
    questions: "Остались вопросы?",
    write: "Напишите на",
  },
} satisfies Record<UiLanguage, Record<string, string>>;

function readAddressLanguage(): UiLanguage | null {
  const value = new URLSearchParams(window.location.search).get("lang");
  return value === "ru" || value === "en" ? value : null;
}

function subscribeAddress(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

/** The edition to show and whether the address chose it. */
export function useLegalLanguage(): { language: UiLanguage; explicit: boolean } {
  const fromAddress = useSyncExternalStore(subscribeAddress, readAddressLanguage, () => null);
  const ui = useUiLanguage();
  const language = fromAddress ?? ui;
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return { language, explicit: fromAddress !== null };
}

function Contents({ sections }: { sections: LegalSection[] }) {
  return (
    <ol>
      {sections.map((section) => (
        <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
      ))}
    </ol>
  );
}

export function LegalDocument({ page, language, title, effective, intro, highlights, sections, explicit }: LegalDocumentProps & { explicit: boolean }) {
  const w = words[language];
  const keep = explicit ? `?lang=${language}` : "";
  const tabs: { key: LegalPage; label: string }[] = [
    { key: "terms", label: w.terms },
    { key: "privacy", label: w.privacy },
  ];

  return (
    <main className="legal-page legal-v45" lang={language}>
      <div className="legal-shell">
        <header className="legal-topbar">
          <a className="legal-back" href="/"><ReaderBackIcon /><span>{w.back}</span></a>
          <a className="legal-mark" href="/" aria-label="boks"><BoksLogo seasonal={false} /><span className="legal-mark__star" aria-hidden="true">*</span></a>
          <nav className="legal-languages" aria-label={w.language}>
            <a href={`?lang=ru`} hrefLang="ru" lang="ru" aria-current={language === "ru" ? "true" : undefined}>RU</a>
            <span aria-hidden="true">/</span>
            <a href={`?lang=en`} hrefLang="en" lang="en" aria-current={language === "en" ? "true" : undefined}>EN</a>
          </nav>
        </header>

        <nav className="legal-tabs" aria-label={w.documents}>
          {tabs.map((tab) => (
            <a key={tab.key} href={`/${tab.key}${keep}`} aria-current={tab.key === page ? "page" : undefined}>{tab.label}</a>
          ))}
        </nav>

        <div className="legal-hero">
          <p className="legal-effective">{effective}</p>
          <h1>{title}</h1>
          <p className="legal-intro">{intro}</p>
        </div>

        <section className="legal-highlights" aria-labelledby="legal-highlights-title">
          <h2 id="legal-highlights-title">{w.highlights}</h2>
          <ul>
            {highlights.map((item) => (
              <li key={item.title}><h3>{item.title}</h3><p>{item.body}</p></li>
            ))}
          </ul>
        </section>

        <div className="legal-body">
          <nav className="legal-contents legal-contents--wide" aria-label={w.contents}>
            <p>{w.contents}</p>
            <Contents sections={sections} />
          </nav>
          <details className="legal-contents legal-contents--narrow">
            <summary>{w.contents}</summary>
            <nav aria-label={w.contents}><Contents sections={sections} /></nav>
          </details>

          <article className="legal-document">
            {sections.map((section) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                {section.body}
              </section>
            ))}
            <footer className="legal-support">
              <p><strong>{w.questions}</strong> {w.write} <a href={supportMailto}>{supportEmail}</a>.</p>
            </footer>
          </article>
        </div>
      </div>
    </main>
  );
}
