"use client";

import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlignLeft, Check, Headphones, Info, Loader2, Play, RotateCcw, Sparkles, UserRound } from "lucide-react";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { loadSeriesBoks } from "@/components/boks/supabase-browser-data";
import {
  isPremiere,
  orderSeries,
  seriesDurationLabel,
  seriesFeatures,
  seriesPieces,
  shortAuthor,
  type SeriesCopyLanguage,
  type SeriesPiece,
} from "@/components/boks/series/series-catalogue";

/**
 * The series tab: every piece made in the new format, on one shelf.
 *
 * Deliberately not a catalogue. One piece leads - the newest the reader has
 * not heard, in a language they read - and the rest sit under it as small
 * cards. There is no search, filter or sort, because there are a handful of
 * pieces and the shelf's job is to get one of them started.
 *
 * Opening a piece is the feed's business: it loads the boks, so the like,
 * the share and the aftertaste at the end are the same ones every boks has,
 * and opens it in its format. This component only draws and asks.
 */

const copy = {
  ru: {
    lede: "Литературные постановки с голосом, иллюстрациями и интерактивными сценами.",
    premiere: "Премьера",
    heard: "Прослушано",
    series: "boks series",
    start: "Начать",
    again: "Ещё раз",
    opening: "Открываем…",
    more: "Ещё в Series",
    moreNote: "короткие постановки",
    other: "На других языках",
    otherNote: "с голосом автора языка",
    about: "О boks series",
    aboutTitle: "Что такое boks series",
    aboutBody:
      "Произведения, которые не только читаются. Текст читает голос, картины сменяются вместе с историей, в стихах слова появляются прямо в кадре, а в некоторых рассказах история останавливается и просит вас что-то сделать.",
    aboutFeatures: [
      ["Голос", "живое прочтение, текст подсвечивается вместе с ним"],
      ["Иллюстрации", "написаны для каждой сцены этого произведения"],
      ["Живой текст", "в стихах слова приходят в картину в момент, когда звучат"],
      ["Интерактивные моменты", "история ждёт, пока вы коснётесь, проведёте или задержите палец"],
    ],
    aboutHeadphones: "Лучше всего в наушниках, в тишине. Постановки также встречаются в ленте — там их можно открыть кнопкой с хлопушкой.",
    aboutNext: "Новые постановки появляются здесь, как только готовы.",
    account: "Аккаунт",
    feed: "feed",
    seriesTab: "series",
    newBadge: "new",
    tabs: "Разделы",
  },
  en: {
    lede: "Literary productions with a voice, illustrations and interactive scenes.",
    premiere: "Premiere",
    heard: "Heard",
    series: "boks series",
    start: "Start",
    again: "Again",
    opening: "Opening…",
    more: "More in Series",
    moreNote: "short productions",
    other: "In other languages",
    otherNote: "read by a native voice",
    about: "About boks series",
    aboutTitle: "What boks series is",
    aboutBody:
      "Pieces that are not only read. A voice reads the text, the pictures change with the story, in verse the words arrive inside the frame, and in some stories the story stops and asks you to do something.",
    aboutFeatures: [
      ["Voice", "a real reading, the text lit as it goes"],
      ["Illustrations", "painted for each scene of this piece"],
      ["Living text", "in verse, words arrive in the picture as they are spoken"],
      ["Interactive moments", "the story waits for a tap, a swipe or a held finger"],
    ],
    aboutHeadphones:
      "Best with headphones, somewhere quiet. Productions turn up in the feed too - open them there with the clapperboard button.",
    aboutNext: "New productions appear here as soon as they are ready.",
    account: "Account",
    feed: "feed",
    seriesTab: "series",
    newBadge: "new",
    tabs: "Sections",
  },
} as const;

export function seriesCopy(language: SeriesCopyLanguage) {
  return copy[language];
}

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
  language,
  readerLanguages,
  heard,
  openingStoryId,
  signedIn,
  onOpenPiece,
  onOpenAccount,
}: {
  language: SeriesCopyLanguage;
  readerLanguages: readonly string[];
  heard: ReadonlySet<string>;
  /** The piece being loaded, so its card can say so. */
  openingStoryId: string | null;
  signedIn: boolean;
  onOpenPiece: (piece: SeriesPiece) => void;
  onOpenAccount: () => void;
}) {
  const words = copy[language];
  const [catalogue, setCatalogue] = useState<CatalogueAnswer>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

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
    return orderSeries(published, readerLanguages, heard);
  }, [catalogue, heard, readerLanguages]);

  const [lead, ...rest] = shelf.mine.length ? shelf.mine : shelf.other;
  const others = shelf.mine.length ? shelf.other : [];
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
        <button type="button" className="reader-more" onClick={() => setAboutOpen(true)} aria-label={words.about}>
          <Info className="size-5" />
        </button>
      </header>

      <div className="series__scroll">
        <p className="series__lede">{words.lede}</p>

        {lead && (
          <SeriesHero
            piece={lead}
            words={words}
            language={language}
            premiere={isPremiere(lead, today)}
            heard={heard.has(lead.storyId)}
            opening={openingStoryId === lead.storyId}
            busy={Boolean(openingStoryId)}
            onOpen={() => onOpenPiece(lead)}
          />
        )}

        {rest.length > 0 && (
          <SeriesShelf
            title={words.more}
            note={words.moreNote}
            pieces={rest}
            words={words}
            language={language}
            heard={heard}
            openingStoryId={openingStoryId}
            onOpenPiece={onOpenPiece}
          />
        )}

        {others.length > 0 && (
          <SeriesShelf
            title={words.other}
            note={words.otherNote}
            pieces={others}
            words={words}
            language={language}
            heard={heard}
            openingStoryId={openingStoryId}
            onOpenPiece={onOpenPiece}
            showLanguage
          />
        )}

        <p className="series__foot">
          <Headphones className="size-4" aria-hidden="true" />
          {words.aboutNext}
        </p>
      </div>

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

type Words = (typeof copy)[SeriesCopyLanguage];

function SeriesHero({
  piece,
  words,
  language,
  premiere,
  heard,
  opening,
  busy,
  onOpen,
}: {
  piece: SeriesPiece;
  words: Words;
  language: SeriesCopyLanguage;
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
          {piece.author} · {seriesDurationLabel(piece.durationSeconds, language)}
        </span>
        <span className="series-hero__title">{piece.title}</span>
        <span className="series-hero__features">{seriesFeatures(piece, language).join(" · ")}</span>
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
  title,
  note,
  pieces,
  words,
  language,
  heard,
  openingStoryId,
  onOpenPiece,
  showLanguage = false,
}: {
  title: string;
  note: string;
  pieces: readonly SeriesPiece[];
  words: Words;
  language: SeriesCopyLanguage;
  heard: ReadonlySet<string>;
  openingStoryId: string | null;
  onOpenPiece: (piece: SeriesPiece) => void;
  showLanguage?: boolean;
}) {
  return (
    <section className="series-shelf">
      <div className="series-shelf__heading">
        <h2>{title}</h2>
        <span>{note}</span>
      </div>
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
                  <span>{seriesDurationLabel(piece.durationSeconds, language)}</span>
                  {showLanguage && <span className="series-card__lang">{piece.language.toUpperCase()}</span>}
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
  language,
  seriesIsNew,
  onFeed,
  onSeries,
  className = "",
}: {
  active: "feed" | "series";
  language: SeriesCopyLanguage;
  seriesIsNew: boolean;
  onFeed: () => void;
  onSeries: () => void;
  className?: string;
}) {
  const words = copy[language];
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
