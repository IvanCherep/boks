"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Clock3, Languages, Loader2 } from "lucide-react";
import { ReaderBookIcon as BookOpen, ReaderFilmIcon as Clapperboard, ReaderPlayIcon as Play, ReaderSettingsIcon as SlidersHorizontal, ReaderUserIcon as UserRound } from "@/components/boks/reader/reader-icons";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { loadSeriesBoks } from "@/components/boks/supabase-browser-data";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { contentLanguageName } from "@/lib/i18n/content-languages";
import { defineMessages } from "@/lib/i18n/messages";
import { useMessages } from "@/components/boks/ui-language";
import {
  effectiveSeriesFilter, rememberSeriesFilter, seriesLanguages, storedSeriesFilter,
  activeCollection,
  arrangeSeriesShelf,
  publishedSeriesShelf,
  seriesPieces,
  seriesDurationLabel,
  type SeriesPiece,
} from "@/components/boks/series/series-catalogue";

/**
 * The series tab: every piece made in the new format, on one shelf.
 *
 * Deliberately not a catalogue. One piece leads - the newest the reader has
 * not heard - and the rest sit under it as small cards. All languages are
 * shown by default; the shelf's own language filter is independent of the feed.
 *
 * Opening a piece is the feed's business: it loads the boks, so the like,
 * the share and the aftertaste at the end are the same ones every boks has,
 * and opens it in its format. This component only draws and asks.
 */

/** Titles and bylines keep their own language. */
const seriesMessages = defineMessages({
  series: "boks series", start: "Play", again: "Again", opening: "Opening…", more: "All series",
  empty: "No series pieces in the selected languages yet.", emptyAction: "Change languages",
  account: "Account", feed: "Feed", seriesTab: "Series", newBadge: "new", tabs: "Sections", duration: "Duration",
}, { ru: {
  series: "boks series", start: "Слушать", again: "Ещё раз", opening: "Открываем…", more: "Все серии",
  empty: "Пока нет серий на выбранных языках.", emptyAction: "Изменить языки",
  account: "Аккаунт", feed: "Лента", seriesTab: "Серии", newBadge: "new", tabs: "Разделы", duration: "Длительность",
} });
function useSeriesWords() { return useMessages(seriesMessages); }

/** A seasonal collection's name, by its id in `seriesCollections`. The numbered cards say the rest. */
const collectionMessages = defineMessages({
  halloween: "Halloween",
  position: "of",
}, { ru: {
  halloween: "Хэллоуин",
  position: "из",
} });

type CatalogueAnswer = Map<string, { title: string; authorName: string }> | null;

const filterMessages = defineMessages({ title: "Series languages", hint: "Choose languages for this shelf. Nothing selected shows every language.", all: "All languages", done: "Done" }, { ru: { title: "Языки серий", hint: "Выберите языки для этой полки. Если ничего не выбрано, показаны все языки.", all: "Все языки", done: "Готово" } });

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
  onPiecesChanged,
}: {
  readerLanguages: readonly string[];
  heard: ReadonlySet<string>;
  /** The piece being loaded, so its card can say so. */
  openingStoryId: string | null;
  signedIn: boolean;
  onOpenPiece: (piece: SeriesPiece) => void;
  onOpenAccount: () => void;
  onOpenLanguages?: () => void;
  /** Actual hero-first visible order, empty until this language scope is ready. */
  onPiecesChanged?: (pieces: SeriesPiece[]) => void;
}) {
  const words = useSeriesWords();
  const { t, preferences } = useReaderPreferences();
  const filterWords = useMessages(filterMessages);
  const [filterOpen, setFilterOpen] = useState(false);
  const [languageFilter, setLanguageFilter] = useState<string[]>([]);
  useEffect(() => { const timer = window.setTimeout(() => setLanguageFilter(storedSeriesFilter()), 0); return () => window.clearTimeout(timer); }, []);
  const languageScope = [...languageFilter].sort().join(",");
  const [catalogue, setCatalogue] = useState<{ scope: string; answer: CatalogueAnswer } | null>(null);
  const [catalogueStatus, setCatalogueStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadCatalogueOnce().then((answer) => {
      if (live) { setCatalogue({ scope: languageScope, answer }); setCatalogueStatus(answer ? "ready" : "error"); }
    });
    return () => {
      live = false;
    };
  }, [attempt, languageScope]);

  const currentStatus = catalogue?.scope === languageScope ? catalogueStatus : "loading";
  const languages = useMemo(() => seriesLanguages(seriesPieces.filter(piece => catalogue?.answer?.has(piece.storyId))), [catalogue]);
  const activeFilter = useMemo(() => effectiveSeriesFilter(languageFilter, languages.map(item => item.language)), [languageFilter, languages]);
  const shelf = useMemo(() => {
    return publishedSeriesShelf(currentStatus === "ready" ? catalogue?.answer ?? null : null, activeFilter, heard);
  }, [catalogue, currentStatus, heard, activeFilter]);
  // Read once: a shelf left open over midnight keeps the collection it opened with.
  const [today] = useState(() => new Date());
  const arranged = useMemo(() => arrangeSeriesShelf(shelf, activeCollection(today)), [shelf, today]);
  function changeFilter(next: string[]) { const value = effectiveSeriesFilter(next, languages.map(item => item.language)); rememberSeriesFilter(value); setLanguageFilter(value); }
  useEffect(() => { onPiecesChanged?.(arranged.order); }, [onPiecesChanged, arranged]);

  const { lead, rest, collection } = arranged;

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
          aria-label={t("You and settings", "Вы и настройки")}
          title={signedIn ? words.account : undefined}
        >
          <SlidersHorizontal className="size-5" />
        </button>
        <h1 className="series__mark" aria-label={words.series}>
          <BoksLogo series />
        </h1>
        <button type="button" className="reader-more" onClick={() => setFilterOpen(true)} aria-label={filterWords.title}>
          <Languages className="size-5" />
        </button>
      </header>

      <div className="series__scroll">

        {collection && (
          <SeriesCollectionRow
            id={collection.id}
            pieces={collection.pieces}
            openingStoryId={openingStoryId}
            onOpenPiece={onOpenPiece}
          />
        )}

        {lead && (
          <SeriesHero
            piece={lead}
            heard={heard.has(lead.storyId)}
            opening={openingStoryId === lead.storyId}
            busy={Boolean(openingStoryId)}
            onOpen={() => onOpenPiece(lead)}
          />
        )}

        {rest.length > 0 && (
          <SeriesShelf
            pieces={rest}
            openingStoryId={openingStoryId}
            onOpenPiece={onOpenPiece}
          />
        )}

        {currentStatus === "loading" && <p className="series-empty" role="status">{t("Loading series…", "Загружаем серии…")}</p>}
        {currentStatus === "error" && <div className="series-empty" role="alert"><p>{t("Series could not load.", "Не удалось загрузить серии.")}</p><button type="button" className="series-empty__action" onClick={() => { catalogueAnswer = null; setCatalogueStatus("loading"); setAttempt((value) => value + 1); }}>{t("Try again", "Попробовать снова")}</button></div>}
        {!lead && currentStatus === "ready" && (
          <div className="series-empty">
            <p>{words.empty}</p>
            <button type="button" className="series-empty__action" onClick={() => setFilterOpen(true)}>
              {words.emptyAction}
            </button>
          </div>
        )}

      </div>
      {filterOpen && <ReaderSheet label={filterWords.title} onClose={() => setFilterOpen(false)} className="series-language-filter">
        <ReaderSheetHeader title={filterWords.title} label={filterWords.title} onClose={() => setFilterOpen(false)} />
        <p className="social-muted">{filterWords.hint}</p>
        <div className="series-language-filter__choices">
          <button type="button" aria-pressed={activeFilter.length === 0} onClick={() => changeFilter([])}>{filterWords.all}</button>
          {languages.map(({ language, count }) => <button type="button" key={language} aria-pressed={activeFilter.includes(language)} onClick={() => changeFilter(activeFilter.includes(language) ? activeFilter.filter(value => value !== language) : [...activeFilter, language])}>{contentLanguageName(language, preferences.locale)}<span>{count}</span></button>)}
        </div>
        <button type="button" className="you-wide-button" onClick={() => setFilterOpen(false)}>{filterWords.done}</button>
      </ReaderSheet>}
    </div>
  );
}

function stop(event: React.SyntheticEvent) {
  event.stopPropagation();
}

function SeriesDuration({ seconds }: { seconds: number }) {
  const { preferences } = useReaderPreferences();
  const label = seriesDurationLabel(seconds, preferences.locale);
  return <span className="series-duration" aria-hidden="true"><Clock3 />{label}</span>;
}

function SeriesHero({
  piece,
  heard,
  opening,
  busy,
  onOpen,
}: {
  piece: SeriesPiece;
  heard: boolean;
  opening: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  const words = useSeriesWords();
  const { preferences } = useReaderPreferences();
  return (
    <button
      type="button"
      className={`series-hero${opening ? " is-opening" : ""}`}
      onClick={onOpen}
      disabled={busy}
      aria-label={`${piece.title}, ${piece.author}. ${words.duration}: ${seriesDurationLabel(piece.durationSeconds, preferences.locale)}. ${opening ? words.opening : heard ? words.again : words.start}`}
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
      <SeriesDuration seconds={piece.durationSeconds} />
      <span className="series-hero__body">
        <span className="series-hero__meta">
          {piece.author}
        </span>
        <span className="series-hero__title">{piece.title}</span>
        <span className="series-hero__cta" aria-hidden="true">
          {opening ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-4" aria-hidden="true" />
          )}
        </span>
      </span>
    </button>
  );
}

function SeriesCollectionRow({
  id,
  pieces,
  openingStoryId,
  onOpenPiece,
}: {
  id: "halloween";
  pieces: readonly SeriesPiece[];
  openingStoryId: string | null;
  onOpenPiece: (piece: SeriesPiece) => void;
}) {
  const words = useSeriesWords();
  const collectionWords = useMessages(collectionMessages);
  const { preferences } = useReaderPreferences();
  const title = collectionWords[id];
  return (
    <section className={`series-collection series-collection--${id}`} aria-label={title}>
      <header className="series-collection__head">
        <h2 className="series-collection__title">{title}</h2>
      </header>
      <ol className="series-collection__row">
        {pieces.map((piece, index) => {
          const opening = openingStoryId === piece.storyId;
          return (
            <li key={piece.storyId}>
              <button
                type="button"
                className={`series-collection__card${opening ? " is-opening" : ""}`}
                onClick={() => onOpenPiece(piece)}
                disabled={Boolean(openingStoryId)}
                aria-label={`${index + 1} ${collectionWords.position} ${pieces.length}. ${piece.title}, ${piece.author}. ${words.duration}: ${seriesDurationLabel(piece.durationSeconds, preferences.locale)}. ${opening ? words.opening : words.start}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="series-collection__art"
                  src={piece.cover}
                  alt=""
                  decoding="async"
                  style={{ objectPosition: piece.coverFocus }}
                />
                <span className="series-collection__veil" aria-hidden="true" />
                <span className="series-collection__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {opening && <Loader2 className="series-collection__spinner size-4 animate-spin" aria-hidden="true" />}
                <SeriesDuration seconds={piece.durationSeconds} />
                <span className="series-collection__body">
                  <span className="series-collection__card-title">{piece.title}</span>
                  <span className="series-collection__author">{piece.author}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function SeriesShelf({
  pieces,
  openingStoryId,
  onOpenPiece,
}: {
  pieces: readonly SeriesPiece[];
  openingStoryId: string | null;
  onOpenPiece: (piece: SeriesPiece) => void;
}) {
  const words = useSeriesWords();
  const { preferences } = useReaderPreferences();
  return (
    <section className="series-shelf">
      <h2 className="series-shelf__heading">{words.more}</h2>
      <ul className="series-shelf__grid">
        {pieces.map((piece) => {
          const opening = openingStoryId === piece.storyId;
          return (
            <li key={piece.storyId}>
              <button
                type="button"
                className={`series-card${opening ? " is-opening" : ""}`}
                onClick={() => onOpenPiece(piece)}
                disabled={Boolean(openingStoryId)}
                aria-label={`${piece.title}, ${piece.author}. ${words.duration}: ${seriesDurationLabel(piece.durationSeconds, preferences.locale)}. ${opening ? words.opening : words.start}`}
              >
                <span className="series-card__preview">
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
                  {opening && <span className="series-card__top"><Loader2 className="series-card__spinner size-4 animate-spin" aria-hidden="true" /></span>}
                  <SeriesDuration seconds={piece.durationSeconds} />
                </span>
                <span className="series-card__body">
                  <span className="series-card__title">{piece.title}</span>
                  <span className="series-card__author">{piece.author}</span>
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
 * The three sections of the reader, at the bottom of the screen.
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
  onYou,
  className = "",
}: {
  active: "feed" | "series" | "you";
  seriesIsNew: boolean;
  onFeed: () => void;
  onSeries: () => void;
  onYou?: () => void;
  className?: string;
}) {
  const words = useSeriesWords();
  const { t } = useReaderPreferences();
  return (
    <nav className={`reader-tabs ${className}`} aria-label={words.tabs}>
      <button
        type="button"
        className={`reader-tabs__tab${active === "feed" ? " is-active" : ""}`}
        aria-current={active === "feed" ? "page" : undefined}
        onClick={onFeed}
      >
        <BookOpen className="size-5" aria-hidden="true" />
        <span>{words.feed}</span>
      </button>
      <button
        type="button"
        className={`reader-tabs__tab reader-tabs__tab--series${active === "series" ? " is-active" : ""}`}
        aria-current={active === "series" ? "page" : undefined}
        onClick={onSeries}
      >
        <span className="reader-tabs__icon">
          <Clapperboard className="size-5" aria-hidden="true" />
          {seriesIsNew && <span className="reader-tabs__new">{words.newBadge}</span>}
        </span>
        <span className="reader-tabs__series-word">{words.seriesTab}</span>
      </button>
      {onYou && <button type="button" className={`reader-tabs__tab${active === "you" ? " is-active" : ""}`} aria-current={active === "you" ? "page" : undefined} onClick={onYou}><UserRound className="size-5" aria-hidden="true" /><span>{t("You", "Вы")}</span></button>}
    </nav>
  );
}
