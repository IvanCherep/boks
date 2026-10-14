"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  AlignLeft,
  Check,
  Headphones,
  Info,
  Languages,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { loadSeriesBoks } from "@/components/boks/supabase-browser-data";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { contentLanguageName } from "@/lib/i18n/content-languages";
import { defineMessages } from "@/lib/i18n/messages";
import type { UiLanguage } from "@/lib/i18n/ui-language";
import {
  effectiveSeriesFilter,
  isPremiere,
  rememberSeriesFilter,
  seriesLanguages,
  storedSeriesFilter,
  orderSeries,
  seriesDurationLabel,
  seriesFeatures,
  seriesPieces,
  shortAuthor,
  type SeriesPiece,
} from "@/components/boks/series/series-catalogue";

/**
 * The series tab: every piece made in the new format, on one shelf.
 *
 * Deliberately not a catalogue. One piece leads - the newest the reader has
 * not heard - and the rest sit under it as small cards. Every language is on
 * the shelf by default; the one control is a language filter, kept on this
 * device, which offers exactly the languages the pieces carry - so Italian or
 * Serbian pieces bring their own option. There is no search or sort, because
 * the shelf's job is to get one piece started.
 *
 * Opening a piece is the feed's business: it loads the boks, so the like,
 * the share and the aftertaste at the end are the same ones every boks has,
 * and opens it in its format. This component only draws and asks.
 */

/** Titles and texts keep their own language; only the interface is translated. */
const messages = defineMessages(
  {
    premiere: "Premiere",
    heard: "Heard",
    series: "boks series",
    start: "Start",
    again: "Again",
    opening: "Opening…",
    more: "More in Series",
    empty: "No productions in the languages you picked.",
    emptyAction: "Show all languages",
    about: "About boks series",
    aboutTitle: "What boks series is",
    aboutBody:
      "Pieces that are not only read. A voice reads the text, the pictures change with the story, in verse the words arrive inside the frame, and in some stories the story stops and asks you to do something.",
    aboutFeatures: [
      ["Voice", "a real reading, the text lit as it goes"],
      ["Illustrations", "painted for each scene of this piece"],
      ["Living text", "in verse, words arrive in the picture as they are spoken"],
      ["Interactive moments", "the story waits for a tap, a swipe or a held finger"],
    ] as [string, string][],
    aboutHeadphones:
      "Best with headphones, somewhere quiet. Productions turn up in the feed too - open them there with the clapperboard button.",
    aboutNext: "New productions appear here.",
    account: "Account",
    feed: "feed",
    seriesTab: "series",
    newBadge: "new",
    tabs: "Sections",
    languages: "Languages",
    languagesTitle: "Show productions in",
    languagesHint: "Nothing picked means every language.",
    allLanguages: "All languages",
    filtered: (names: string) => `Showing: ${names}`,
  },
  {
    ru: {
      premiere: "Премьера",
      heard: "Прослушано",
      series: "boks series",
      start: "Начать",
      again: "Ещё раз",
      opening: "Открываем…",
      more: "Ещё в Series",
      empty: "На выбранных языках постановок пока нет.",
      emptyAction: "Показать все языки",
      about: "О boks series",
      aboutTitle: "Что такое boks series",
      aboutBody:
        "Произведения, которые не только читают. Голос читает текст, картины меняются вместе с историей, в стихах слова появляются прямо в кадре, а в некоторых историях сюжет останавливается и просит вас что-то сделать.",
      aboutFeatures: [
        ["Голос", "настоящее чтение, текст подсвечивается по ходу"],
        ["Иллюстрации", "нарисованы для каждой сцены этого произведения"],
        ["Живой текст", "в стихах слова появляются в картине, когда их произносят"],
        ["Интерактивные моменты", "история ждёт касания, свайпа или удержания пальца"],
      ],
      aboutHeadphones:
        "Лучше в наушниках и в тишине. Постановки встречаются и в ленте - открывайте их там кнопкой с хлопушкой.",
      aboutNext: "Новые постановки появятся здесь.",
      account: "Аккаунт",
      feed: "лента",
      seriesTab: "series",
      newBadge: "new",
      tabs: "Разделы",
      languages: "Языки",
      languagesTitle: "Показывать постановки на",
      languagesHint: "Если ничего не выбрано - показываются все языки.",
      allLanguages: "Все языки",
      filtered: (names: string) => `Показаны: ${names}`,
    },
  }
);

type CatalogueAnswer = Map<string, { title: string; authorName: string }> | null;

/** One answer per page: the shelf is opened and closed, the catalogue does not change under it. */
let catalogueAnswer: Promise<CatalogueAnswer> | null = null;

function loadCatalogueOnce() {
  catalogueAnswer ??= loadSeriesBoks(seriesPieces.map((piece) => piece.storyId)).catch(() => {
    catalogueAnswer = null;
    return null;
  });
  return catalogueAnswer;
}

export function SeriesView({
  heard,
  openingStoryId,
  signedIn,
  onOpenPiece,
  onOpenAccount,
}: {
  heard: ReadonlySet<string>;
  /** The piece being loaded, so its card can say so. */
  openingStoryId: string | null;
  signedIn: boolean;
  onOpenPiece: (piece: SeriesPiece) => void;
  onOpenAccount: () => void;
}) {
  const [catalogue, setCatalogue] = useState<CatalogueAnswer>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const [filter, setFilter] = useState<string[]>([]);
  const words = useMessages(messages);
  const uiLanguage = useUiLanguage();

  // Stored on the device; read after mount so the server's markup matches.
  useEffect(() => setFilter(storedSeriesFilter()), []);

  useEffect(() => {
    let live = true;
    void loadCatalogueOnce().then((answer) => {
      if (live) setCatalogue(answer);
    });
    return () => {
      live = false;
    };
  }, []);

  const shelf = useMemo(() => {
    // The catalogue's titles, once it has answered; and only what it still
    // publishes. Before it answers - or when there is no catalogue to ask -
    // the shelf draws from its own list rather than from nothing.
    const published = catalogue
      ? seriesPieces
          .filter((piece) => catalogue.has(piece.storyId))
          .map((piece) => {
            const row = catalogue.get(piece.storyId)!;
            return { ...piece, title: row.title || piece.title, author: row.authorName || piece.author };
          })
      : seriesPieces;
    return published;
  }, [catalogue]);

  const available = useMemo(() => seriesLanguages(shelf), [shelf]);
  const availableCodes = available.map((entry) => entry.language);
  const activeFilter = effectiveSeriesFilter(filter, availableCodes);
  const ordered = useMemo(() => orderSeries(shelf, activeFilter, heard), [shelf, activeFilter.join(), heard]);

  function chooseFilter(next: string[]) {
    const kept = effectiveSeriesFilter(next, availableCodes);
    setFilter(kept);
    rememberSeriesFilter(kept);
  }

  function toggleLanguage(language: string) {
    const current = activeFilter.length ? activeFilter : [];
    chooseFilter(current.includes(language) ? current.filter((l) => l !== language) : [...current, language]);
  }

  const [lead, ...rest] = ordered;
  const today = new Date();

  return (
    <div
      className="series"
      role="region"
      aria-label={words.series}
      // The feed under this listens for swipes on the page; nothing done on
      // the shelf is a swipe through the feed.
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
    >
      <header className="series__top">
        <button
          type="button"
          className="reader-account-trigger"
          onClick={onOpenAccount}
          aria-label={words.account}
          title={signedIn ? words.account : undefined}
        >
          <UserRound className="size-5" />
        </button>
        <h1 className="series__mark" aria-label={words.series}>
          <span>boks</span>
          <strong>series</strong>
        </h1>
        <span className="series__actions">
          {available.length > 1 && (
            <button
              type="button"
              className={`reader-more series__filter${activeFilter.length ? " is-active" : ""}`}
              onClick={() => setLanguagesOpen(true)}
              aria-label={words.languages}
              aria-haspopup="dialog"
            >
              <Languages className="size-5" />
              {activeFilter.length > 0 && <span className="series__filter-dot" aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="reader-more" onClick={() => setAboutOpen(true)} aria-label={words.about}>
            <Info className="size-5" />
          </button>
        </span>
      </header>

      <div className="series__scroll">
        {activeFilter.length > 0 && (
          <button type="button" className="series__filtered" onClick={() => setLanguagesOpen(true)}>
            {words.filtered(activeFilter.map((language) => contentLanguageName(language, uiLanguage)).join(", "))}
          </button>
        )}

        {lead && (
          <SeriesHero
            piece={lead}
            words={words}
            uiLanguage={uiLanguage}
            premiere={isPremiere(lead, today)}
            heard={heard.has(lead.storyId)}
            opening={openingStoryId === lead.storyId}
            busy={Boolean(openingStoryId)}
            onOpen={() => onOpenPiece(lead)}
          />
        )}

        {rest.length > 0 && (
          <SeriesShelf
            pieces={rest}
            words={words}
            uiLanguage={uiLanguage}
            heard={heard}
            openingStoryId={openingStoryId}
            onOpenPiece={onOpenPiece}
          />
        )}

        {!lead && (
          <div className="series-empty">
            <p>{words.empty}</p>
            <button type="button" className="series-empty__action" onClick={() => chooseFilter([])}>
              {words.emptyAction}
            </button>
          </div>
        )}

        <p className="series__foot">
          <Headphones className="size-4" aria-hidden="true" />
          {words.aboutNext}
        </p>
      </div>

      {languagesOpen && (
        <ReaderSheet label={words.languages} onClose={() => setLanguagesOpen(false)} className="series-about">
          <ReaderSheetHeader
            label={words.languages}
            onClose={() => setLanguagesOpen(false)}
            title={words.languagesTitle}
          />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            <ul className="series-languages">
              <li>
                <label className="series-languages__option">
                  <input
                    type="checkbox"
                    checked={activeFilter.length === 0}
                    onChange={() => chooseFilter([])}
                  />
                  <span>{words.allLanguages}</span>
                  <span className="series-languages__count">{shelf.length}</span>
                </label>
              </li>
              {available.map(({ language, count }) => (
                <li key={language}>
                  <label className="series-languages__option">
                    <input
                      type="checkbox"
                      checked={activeFilter.includes(language)}
                      onChange={() => toggleLanguage(language)}
                    />
                    <span lang={language}>{contentLanguageName(language, uiLanguage)}</span>
                    <span className="series-languages__count">{count}</span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="series-about__note">{words.languagesHint}</p>
          </div>
        </ReaderSheet>
      )}

      {aboutOpen && (
        <ReaderSheet label={words.about} onClose={() => setAboutOpen(false)} className="series-about">
          <ReaderSheetHeader label={words.about} onClose={() => setAboutOpen(false)} title={words.aboutTitle} />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
            <p className="text-sm leading-6 text-[var(--soft-foreground)]">{words.aboutBody}</p>
            <dl className="series-about__list">
              {words.aboutFeatures.map(([term, detail]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{detail}</dd>
                </div>
              ))}
            </dl>
            <p className="series-about__note">
              <Headphones className="size-4 shrink-0" aria-hidden="true" />
              <span>{words.aboutHeadphones}</span>
            </p>
          </div>
        </ReaderSheet>
      )}
    </div>
  );
}

function stop(event: React.SyntheticEvent) {
  event.stopPropagation();
}

type Words = (typeof messages)["en"];

function SeriesHero({
  piece,
  words,
  uiLanguage,
  premiere,
  heard,
  opening,
  busy,
  onOpen,
}: {
  piece: SeriesPiece;
  words: Words;
  uiLanguage: UiLanguage;
  premiere: boolean;
  heard: boolean;
  opening: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`series-hero${opening ? " is-opening" : ""}`}
      onClick={onOpen}
      disabled={busy}
      aria-label={`${piece.title}, ${piece.author}. ${heard ? words.again : words.start}`}
    >
      {/* A plain image: the covers are already sized for the card, and this
          build has no image optimiser to hand them to. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="series-hero__art"
        src={piece.cover}
        alt=""
        style={{ objectPosition: piece.coverFocus }}
        // The first thing on the tab; it is worth asking for early.
        fetchPriority="high"
        decoding="async"
      />
      <span className="series-hero__glow" aria-hidden="true" />
      <span className="series-hero__veil" aria-hidden="true" />
      <span className="series-chip">
        {heard ? (
          <>
            <Check className="size-3" aria-hidden="true" />
            {words.heard}
          </>
        ) : premiere ? (
          words.premiere
        ) : (
          words.series
        )}
      </span>
      <span className="series-hero__body">
        <span className="series-hero__meta">
          {piece.author} · {seriesDurationLabel(piece.durationSeconds, uiLanguage)}
        </span>
        <span className="series-hero__title">{piece.title}</span>
        <span className="series-hero__features">{seriesFeatures(piece, uiLanguage).join(" · ")}</span>
        <span className="series-hero__cta">
          {opening ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : heard ? (
            <RotateCcw className="size-4" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
          {opening ? words.opening : heard ? words.again : words.start}
        </span>
      </span>
    </button>
  );
}

function SeriesShelf({
  pieces,
  words,
  uiLanguage,
  heard,
  openingStoryId,
  onOpenPiece,
}: {
  pieces: readonly SeriesPiece[];
  words: Words;
  uiLanguage: UiLanguage;
  heard: ReadonlySet<string>;
  openingStoryId: string | null;
  onOpenPiece: (piece: SeriesPiece) => void;
}) {
  return (
    <section className="series-shelf">
      <h2 className="series-shelf__heading">{words.more}</h2>
      <ul className="series-shelf__grid">
        {pieces.map((piece) => {
          const opening = openingStoryId === piece.storyId;
          const done = heard.has(piece.storyId);
          return (
            <li key={piece.storyId}>
              <button
                type="button"
                className={`series-card${opening ? " is-opening" : ""}`}
                onClick={() => onOpenPiece(piece)}
                disabled={Boolean(openingStoryId)}
                aria-label={`${piece.title}, ${piece.author}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="series-card__art"
                  src={piece.cover}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ objectPosition: piece.coverFocus }}
                />
                <span className="series-card__veil" aria-hidden="true" />
                <span className="series-card__top">
                  <span>{seriesDurationLabel(piece.durationSeconds, uiLanguage)}</span>
                  {done && (
                    <span className="series-card__done" title={words.heard}>
                      <Check className="size-3" aria-hidden="true" />
                    </span>
                  )}
                  {opening && <Loader2 className="series-card__spinner size-4 animate-spin" aria-hidden="true" />}
                </span>
                <span className="series-card__body">
                  <span className="series-card__author">{shortAuthor(piece.author)}</span>
                  <span className="series-card__title">{piece.title}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The two sections of the reader, at the bottom of the screen.
 *
 * In the feed it belongs to the reader's controls and goes when they go - the
 * story owns the screen while it is read. On the shelf there is nothing to
 * read, so it stays.
 */
export function ReaderTabs({
  active,
  seriesIsNew,
  onFeed,
  onSeries,
  className = "",
}: {
  active: "feed" | "series";
  seriesIsNew: boolean;
  onFeed: () => void;
  onSeries: () => void;
  className?: string;
}) {
  const words = useMessages(messages);
  return (
    <nav className={`reader-tabs ${className}`} aria-label={words.tabs}>
      <button
        type="button"
        className={`reader-tabs__tab${active === "feed" ? " is-active" : ""}`}
        aria-current={active === "feed" ? "page" : undefined}
        onClick={onFeed}
      >
        <AlignLeft className="size-5" aria-hidden="true" />
        <span>{words.feed}</span>
      </button>
      <button
        type="button"
        className={`reader-tabs__tab reader-tabs__tab--series${active === "series" ? " is-active" : ""}`}
        aria-current={active === "series" ? "page" : undefined}
        onClick={onSeries}
      >
        <span className="reader-tabs__icon">
          <Sparkles className="size-5" aria-hidden="true" />
          {seriesIsNew && <span className="reader-tabs__new">{words.newBadge}</span>}
        </span>
        <span className="reader-tabs__series-word">{words.seriesTab}</span>
      </button>
    </nav>
  );
}
