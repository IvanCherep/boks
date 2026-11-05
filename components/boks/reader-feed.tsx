"use client";

import { randomBoksId } from "@/lib/boks/browser-id";
import { useCoverInspection } from "@/components/boks/reader/use-cover-inspection";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X,
} from "lucide-react";
import { ReaderHeartIcon, ReaderCommentsIcon, ReaderShareIcon, ReaderMoreIcon, ReaderSettingsIcon, ReaderDownIcon, ReaderBackIcon, ReaderPlayIcon, ReaderTypeIcon } from "@/components/boks/reader/reader-icons";
import { Button } from "@/components/ui/button";
import { initialMetrics, initialProfile } from "@/components/boks/constants";
import type {
  BoksUserContext,
  Comment,
  Metrics,
  ReaderProfile,
  FeedProvenance,
  RecommendationExperiment,
  Story,
} from "@/components/boks/client-types";
import {
  anonymousReadLimits,
  guestReadDwellMs,
  expectedReadingSeconds,
  getAnonymousBoksReadCount,
  getBrowserId,
  inferReadOutcome,
  profileBump,
  readAnonymousReadState,
  readAnonymousNoticeState,
  readProfile,
  readerSignalsFromProfile,
  readerSlateSize,
  recordAnonymousBoksRead,
  saveAnonymousNoticeState,
  saveProfile,
  touchKind,
} from "@/components/boks/reader-behavior";
import {
  composeReaderRanking,
  recoverReaderPlace,
  shouldLoadMore,
  type HeldPlace,
} from "@/components/boks/reader-place";
import {
  readerKeyAction,
  readerTapAction,
  getScrollBoundary,
  horizontalNavigationIntent,
  horizontalWheelIntent,
  verticalBoundaryIntent,
  verticalBoundaryPull,
  type ReaderNavigationDirection,
} from "@/components/boks/reader-navigation";
import {
  readingMusicWanted,
  startReadingMusic,
  stopReadingMusic,
} from "@/components/boks/reading-music";
import { CinemaMode } from "@/components/boks/cinema/cinema-mode";
import { FormatStatus } from "@/components/boks/cinema/format-controls";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import { recordingRequested } from "@/components/boks/recording-mode";
import { ReadingFinale, type FinaleActions } from "@/components/boks/reading-finale";
import { giveScreenBack, takeScreen } from "@/components/boks/reading-fullscreen";
import { loadPoemManifest, poemManifestFor } from "@/components/boks/poetry/poems";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { isBoksSeriesPiece } from "@/components/boks/cinema/series";
import { ReaderTabs, SeriesView } from "@/components/boks/series/series-view";
import {
  seriesPieceFor,
  seriesPieces,
  type SeriesPiece,
} from "@/components/boks/series/series-catalogue";
import {
  hasUnseenSeries,
  readHeardSeries,
  readSeenSeries,
  rememberHeardSeries,
  rememberSeenSeries,
} from "@/components/boks/series/series-progress";
import {
  fetchVisitorCountry,
  journeyAttribution,
  recordJourneyEvent,
  signupReason,
  type JourneyAttribution,
} from "@/lib/boks/journey";
import {
  countRead,
  dueMilestone,
  markPrompted,
  readFeedbackState,
  saveFeedbackState,
  type FeedbackState,
} from "@/components/boks/feedback";
import { localizeBoksMessage, readableBoksError } from "@/lib/boks/errors";
import {
  emptyFeedNotice,
  effectiveReadingLanguages,
  normalizeReadingLanguages,
  readingLanguageChangeKeepsFeed,
  rememberReadingLanguages,
} from "@/components/boks/reading-languages";
import { displayedLikeCount, formatCompactCount } from "@/components/boks/client-format";
import { attachReaderClock, createReaderClock, type ReaderClock } from "@/components/boks/reader-clock";
import { formatReaderBody } from "@/components/boks/reader-text";
import { haptic } from "@/components/boks/reader-haptics";
import { AuthorSheet } from "@/components/boks/author-sheet";
import { ReaderSheet } from "@/components/boks/reader-sheet";
import { CommentsSheet } from "@/components/boks/comments-sheet";
import { BokLifecycleDialog, type BokLifecycleTarget } from "@/components/boks/admin/bok-lifecycle-dialog";
import {
  createReaderEventQueue,
  flushReaderEventsOnExit,
  type ReaderEventQueue,
} from "@/components/boks/reader-events";
import {
  loadBoksUserContext,
  loadSupabaseStory,
  recordSupabaseReaderEvents,
  recordSupabaseView,
  reportBok,
  setMyReadingLanguages,
  setSupabaseLike,
  submitSupabaseComment,
} from "@/components/boks/supabase-browser-data";
import type { ReaderEvent, ReaderEventType, AftertasteTag, TouchKind } from "@/lib/boks/contracts";
import { emptyReaderSignals, type ReaderSignals } from "@/lib/boks/recommendations";
import { completePendingBoksMagicLinkProfile, consumeBoksMagicLinkRedirectNotice, supabase } from "@/lib/boks/supabase-client";
import { currentBoksTermsVersion, UserAuthPanel } from "@/components/boks/user-auth-panel";
import { useBoksData } from "@/components/boks/use-boks-data";
import { currentUiLanguage, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { atHandle, bareHandle } from "@/components/boks/reader/handles";
import { BokMenuSheet, type BokReportKind, type BokReportOutcome } from "@/components/boks/reader/bok-menu-sheet";
import { EmptyFeedScreen } from "@/components/boks/reader/empty-feed-screen";
import { FeedbackSheet } from "@/components/boks/reader/feedback-sheet";

import { bokCoverStyle } from "@/components/boks/reader/bok-cover-palette";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { bokArtworkStyle, getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { CoverArtwork } from "@/components/boks/reader/cover-artwork";
import { CoverHeading } from "@/components/boks/reader/cover-heading";
import { textReadingState, type TextReadingPhase } from "@/components/boks/reader/text-reading-state";
import { useReaderPreferences } from "@/components/boks/reader-preferences";
import { ShareCard } from "@/components/boks/share-card";


/** Drops focus after a mouse click so the reader's Space cannot press the button again. */
function releaseFocus(event: React.MouseEvent<HTMLElement>) {
  if (event.detail > 0) event.currentTarget.blur();
}

/** "Follow", or "Follow @boks" when the byline is a writer the account publishes. */
const messages = defineMessages(
  {
    follow: "Follow",
    following: "Following",
    bokAuthor: "boks author",
    noBackend: "The reader has no backend yet.",
    couldNotRefresh: "Could not refresh feed.",
    couldNotSignIn: "Could not finish sign in.",
    hidden: (title: string) => `“${title}” is hidden from readers. Restore it in Admin → Content → Deleted.`,
    suspendedReading: "This account is suspended. Reading remains available.",
    suspended: "This account is suspended.",
    couldNotLoad: "Could not load boks.",
    unavailable: "This bok is no longer available.",
    couldNotOpen: "Could not open this bok.",
    poemFailed: "This poem could not be opened.",
    findingMore: "Finding more boks for you…",
    everything: "That is everything boks has for you right now.",
    languagesFailed: "Could not change your languages.",
    linkCopied: "Link copied",
    reportFailed: "Could not send that report.",
    likeFailed: "Could not update the like. Try again.",
    followFailed: "Could not update following.",
    noLongerOpen: "That bok is no longer open.",
    joinConversation: "Create a free account to join the conversation.",
    commentsUnavailable: "Comments are not available right now.",
    feedLanguagesFailed: "Could not load the feed in those languages.",
    openSettings: "Open settings",
    signInOrCreate: "Sign in or create an account",
    settings: "Settings",
    signIn: "Sign in",
    moreAboutBok: "More about this bok",
    listenProduction: "listen to the production",
    releaseNext: "release for next bok",
    releasePrevious: "release for previous bok",
    nextBok: "next bok",
    previousBok: "previous bok",
    listenAndRead: "Listen and read",
    listenAndReadPrototype: "Listen and read (prototype, admins only)",
    moveThroughFeed: "Move through the feed",
    previousLabel: "Previous bok",
    nextLabel: "Next bok",
    previous: "previous",
    moreWithoutAccount: (count: number) => `${count} more without an account`,
    alwaysFree:
      "Reading is always free. An account saves your history and helps recommendations learn what you enjoy.",
    notNow: "Not now",
    createAccount: "Create free account",
    hintTouch: "Swipe left for the next bok. Tap the page for likes, comments and more.",
    hintPointer: "Press → for the next bok. Click the page for likes, comments and more.",
    dismiss: "Dismiss",
  },
  {
    ru: {
      follow: "Подписаться",
      following: "Вы подписаны",
      bokAuthor: "автор boks",
      noBackend: "У читалки пока нет сервера.",
      couldNotRefresh: "Не удалось обновить ленту.",
      couldNotSignIn: "Не удалось завершить вход.",
      hidden: (title: string) => `«${title}» скрыт от читателей. Вернуть можно в админке, раздел «Контент», вкладка «Удалённые».`,
      suspendedReading: "Этот аккаунт заблокирован. Читать по-прежнему можно.",
      suspended: "Этот аккаунт заблокирован.",
      couldNotLoad: "Не удалось загрузить boks.",
      unavailable: "Этот текст больше недоступен.",
      couldNotOpen: "Не удалось открыть этот текст.",
      poemFailed: "Не удалось открыть это стихотворение.",
      findingMore: "Подбираем для вас ещё…",
      everything: "Пока это всё, что boks может вам предложить.",
      languagesFailed: "Не удалось сменить языки.",
      linkCopied: "Ссылка скопирована",
      reportFailed: "Не удалось отправить жалобу.",
      likeFailed: "Не удалось обновить лайк. Попробуйте ещё раз.",
      followFailed: "Не удалось обновить подписку.",
      noLongerOpen: "Этот текст уже закрыт.",
      joinConversation: "Создайте бесплатный аккаунт, чтобы участвовать в обсуждении.",
      commentsUnavailable: "Комментарии сейчас недоступны.",
      feedLanguagesFailed: "Не удалось загрузить ленту на этих языках.",
      openSettings: "Открыть настройки",
      signInOrCreate: "Войти или создать аккаунт",
      settings: "Настройки",
      signIn: "Войти",
      moreAboutBok: "Подробнее об этом тексте",
      listenProduction: "слушать постановку",
      releaseNext: "отпустите - следующий текст",
      releasePrevious: "отпустите - предыдущий текст",
      nextBok: "следующий текст",
      previousBok: "предыдущий текст",
      listenAndRead: "Слушать и читать",
      listenAndReadPrototype: "Слушать и читать (прототип, только для админов)",
      moveThroughFeed: "Перемещение по ленте",
      previousLabel: "Предыдущий текст",
      nextLabel: "Следующий текст",
      previous: "назад",
      moreWithoutAccount: (count: number) =>
        `Ещё ${count} ${plural("ru", count, { one: "текст", few: "текста", many: "текстов", other: "текста" })} без аккаунта`,
      alwaysFree:
        "Читать всегда бесплатно. Аккаунт сохранит вашу историю и поможет рекомендациям понять, что вам нравится.",
      notNow: "Не сейчас",
      createAccount: "Создать бесплатный аккаунт",
      hintTouch: "Свайп влево - следующий текст. Нажмите на страницу - лайки, комментарии и не только.",
      hintPointer: "Нажмите → для следующего текста. Кликните по странице - лайки, комментарии и не только.",
      dismiss: "Закрыть",
    },
  }
);

/** The words for a callback or a helper, read in the language of the moment it runs. */
function wordsNow() {
  return messages[currentUiLanguage()];
}

type AuthIntent = "general" | "like" | "comment" | "follow";

/** How a reader reached a boks no ranker chose for them. See `entryRef`. */
type ReaderEntry = "series" | "share" | "library" | "author";

/**
 * `exit` is the one that was missing. Until now an outcome was only recorded
 * when the reader moved to the next boks, so the last boks of every session -
 * including every abandoned read - produced neither a completion nor a skip.
 */
type ReadOutcomeReason = "swipe" | "button" | "keyboard" | "exit";

/** Foreground seconds between heartbeats while a boks is open. */
const readerHeartbeatSeconds = 60;
const storyTransitionDurationMs = 480;
/**
 * The pull that changes bok, tuned so it has to be meant.
 *
 * It used to be 104px from the first pixel. A short poem fits on one screen, so
 * it is at its end the moment it opens, and an ordinary flick - the kind made
 * to read - covered 104px and changed bok before the cue could be seen. Now the
 * first stretch counts for nothing and the pull is half as long again.
 */
const touchBoundaryPullThreshold = 150;
const touchBoundaryPullDeadZone = 18;
const wheelBoundaryPullThreshold = 260;
const wheelBoundaryPullDeadZone = 40;
/**
 * A wheel has no "let go", so the wheel going quiet stands in for it - and the
 * armed cue is held on screen at least this long first. Before, a trackpad
 * flick reached the end of its travel in a fraction of a second and changed bok
 * mid-momentum, with the cue gone before it was ever seen.
 */
// Longer than the 300-400 ms pauses trackpad momentum takes in the middle of
// a single swipe (see `onStoryWheel`), or "the wheel went quiet" would fire in
// one of them and change bok mid-momentum - the very thing this replaces.
const wheelReleaseMs = 450;
const wheelArmedMinMs = 320;

type StoryTransitionAxis = "horizontal" | "vertical";

type StoryTransition =
  | { phase: "idle"; direction: null; axis: null }
  | { phase: "entering"; direction: ReaderNavigationDirection; axis: StoryTransitionAxis };

type BoundaryPullState = {
  direction: ReaderNavigationDirection;
  progress: number;
};

type GestureStart = {
  x: number;
  y: number;
  atTop: boolean;
  atBottom: boolean;
  /** `performance.now()` at the start, so a long press is not taken for a tap. */
  at: number;
  msSinceScroll: number;
};

export type ReaderView = "feed" | "series";

const seriesStoryIds = seriesPieces.map((piece) => piece.storyId);

/** The shelf's filter: the same reading languages the feed uses. */
function seriesContextFor(readerLanguages: readonly string[]) {
  return { readerLanguages };
}

export function ReaderFeed({ initialView = "feed" }: { initialView?: ReaderView } = {}) {
  const {
    stories,
    comments,
    metrics,
    experiment,
    likedStoryIds,
    supabaseUserId,
    isSupabaseReader,
    provenance,
    status,
    setStatus,
    phase,
    load,
  } = useBoksData();
  const uiLanguage = useUiLanguage();
  const { t } = useReaderPreferences();
  const [readingPhase, setReadingPhase] = useState<TextReadingPhase>("cover");
  const [textProgress, setTextProgress] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);
  const [formatPlaying, setFormatPlaying] = useState(false);
  const [formatEnded, setFormatEnded] = useState(false);
  const [formatLoading, setFormatLoading] = useState(false);
  const formatRequest = useRef(0);
  const storyOpenRequest = useRef(0);
  const exposedStories = useRef(new Set<string>());
  const [publishedSeriesPieces, setPublishedSeriesPieces] = useState<SeriesPiece[]>([]);
  const [seriesSequence, setSeriesSequence] = useState<SeriesPiece[]>([]);
  const [openIssue, setOpenIssue] = useState<({ kind: "unavailable" | "story"; storyId: string; entry: ReaderEntry } | { kind: "audio"; storyId: string }) | null>(null);
  const [aftertastes, setAftertastes] = useState<Record<string, AftertasteTag[]>>({});
  const aftertasteDrafts = useRef<Record<string, AftertasteTag[]>>({});
  const sentAftertastes = useRef(new Set<string>());
  const flushAftertasteRef = useRef<(exit?: boolean) => void>(() => undefined);
  const textRegion = useRef<HTMLDivElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [profile, setProfile] = useState<ReaderProfile>(initialProfile);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [commentOpen, setCommentOpen] = useState(false);
  // Comments this reader added or removed, per boks, against the count they
  // were added to. A fresher copy of the boks - a reload, opening it from the
  // library - already includes them and has a different base, so the change
  // stops applying instead of being counted twice.
  const [commentCountDeltas, setCommentCountDeltas] = useState<Record<string, { base: number; added: number }>>({});
  // Hidden from the start. It used to open with the controls showing and
  // flash them again on every new bok; now reading comes first and the
  // controls appear when the reader asks, with a tap.
  const [readerChromeVisible, setReaderChromeVisible] = useState(false);
  /**
   * The language filter in force. Held in a ref because the feed loader is
   * memoised on `load` alone, and a stale closure here would keep serving the
   * previous filter after the reader changed it.
   */
  const readingLanguagesRef = useRef<readonly string[]>([]);
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  /**
   * Whether the account behind this browser has been looked up yet.
   *
   * The feed loads first and the account is fetched after it, so there is a
   * window in which the reader is signed in and `user` is still null. The
   * sign-up gate read that window as "a guest who has used up their free
   * reads" and opened the account panel over the text on every single page
   * load, for a reader who already had an account. The one promise the product
   * makes is that you open it and read.
   */
  const [identitySettled, setIdentitySettled] = useState(false);
  const [authReason, setAuthReason] = useState<"manual" | "notice" | "required">("manual");
  const [authIntent, setAuthIntent] = useState<AuthIntent>("general");
  const [authInitialSection, setAuthInitialSection] = useState<"home" | "typography" | "languages" | "feedback" | undefined>();
  const [authNotice, setAuthNotice] = useState("");
  const [pendingCommentStoryId, setPendingCommentStoryId] = useState<string | null>(null);
  const [guestReadCount, setGuestReadCount] = useState(0);
  const [guestNoticeStep, setGuestNoticeStep] = useState<"first" | "second" | null>(null);
  // A boks opened from account history is a one-item entry into the current
  // recommendation sequence. Keeping only one prevents previously opened
  // library items from becoming an accidental second feed after it.
  const [libraryEntry, setLibraryEntry] = useState<HeldPlace | null>(null);
  // The boks on screen, carried through reloads - see the block after
  // `rankedStories` and `holdPinnedStory`. `place` applies to `feed`, the feed
  // on screen, with `likedIds` its liked set; `next` is a boks the reader has
  // just acted on, with its counts already settled, for whichever feed
  // replaces this one. `release` marks a reload that changes what the feed may
  // contain - the reading languages - where the boks on screen may no longer
  // belong and is let go.
  const [hold, setHold] = useState<{
    place: HeldPlace | null;
    next: HeldPlace | null;
    feed: readonly Story[];
    likedIds: readonly string[];
    release: boolean;
  }>(() => ({ place: null, next: null, feed: stories, likedIds: likedStoryIds, release: false }));
  // Boks an admin hid from this page. They are gone on the server already;
  // this takes them out of the sequence the page is holding.
  const [hiddenStoryIds, setHiddenStoryIds] = useState<ReadonlySet<string>>(() => new Set());
  const [hideTarget, setHideTarget] = useState<BokLifecycleTarget | null>(null);
  const [readerFlash, setReaderFlash] = useState("");
  /** Something to read to. Off until asked for; see `reading-music.ts`. */
  const [musicOn, setMusicOn] = useState(false);
  /** A poem opens in its own renderer behind the same button. */
  const [poem, setPoem] = useState<PoemManifest | null>(null);
  const likesInFlight = useRef<Set<string>>(new Set());
  // The one-time "how this works" line - see the effect near the render.
  /*
   * A reader who had it on last time gets it back - but only after they touch
   * something, because no browser will start audio before that and silently
   * failing would leave the button lit with nothing playing.
   */
  useEffect(() => {
    if (!readingMusicWanted()) return;
    const resume = () => {
      startReadingMusic();
      setMusicOn(true);
    };
    window.addEventListener("pointerdown", resume, { once: true });
    return () => window.removeEventListener("pointerdown", resume);
  }, []);

  useEffect(() => () => stopReadingMusic(false), []);

  /**
   * A message for the reader: "Link copied", or why a like, follow, report or
   * language change did not go through. These used to go only to `status`,
   * which the reader shows on the empty-feed screen and nowhere else - so with
   * a bok on screen every one of them vanished, and a failed action looked
   * like a tap that did nothing. `status` still gets it, for that screen.
   */
  const notify = useCallback(
    (message: string) => {
      if (!message) return;
      // A sentence the database or sign-in wrote in English, in the interface language.
      const shown = localizeBoksMessage(message);
      setReaderFlash(shown);
      setStatus(shown);
    },
    [setStatus]
  );
  const [authorSheet, setAuthorSheet] = useState<{ handle: string; authorName?: string } | null>(null);
  /** Where this visit came from; sent once the reader's identity is known. */
  const visitAttribution = useRef<JourneyAttribution | null>(null);
  const visitRecorded = useRef(false);
  /** The milestone being offered, or null. See `components/boks/feedback.ts`. */
  const [feedbackMilestone, setFeedbackMilestone] = useState<number | null>(null);
  /** Once the note is away the sheet stops asking and starts thanking. */
  const [feedbackSent, setFeedbackSent] = useState(false);
  const feedbackState = useRef<FeedbackState>({ reads: 0, prompted: [] });
  const [bokMenuOpen, setBokMenuOpen] = useState(false);
  /** The admin-only "listen and read" prototype. See `components/boks/cinema`. */
  const [cinemaOpen, setCinemaOpen] = useState(false);
  /**
   * `?recording=1`, read once before the address bar is cleaned. Only the
   * admin role turns it into anything - see `recording-mode.ts`.
   */
  const [recordingAsked] = useState(() =>
    typeof window === "undefined" ? false : recordingRequested(window.location.search)
  );
  /** A format took the whole screen, so closing it owes the screen back. */
  const formatTookScreen = useRef(false);
  /** A format silenced music the reader had on, so closing it owes the music back. */
  const musicPausedForFormat = useRef(false);
  /**
   * The series shelf, over the feed rather than instead of it. The feed keeps
   * its place, its clock is paused, and a piece opened from the shelf is loaded
   * into the feed exactly as a boks from the library is - so its like, share and
   * aftertaste are the ordinary ones.
   */
  const [seriesOpen, setSeriesOpen] = useState(initialView === "series");
  /** The reader's languages, read on the client only. */
  const [seriesContext, setSeriesContext] = useState<{
    readerLanguages: readonly string[];
  } | null>(null);
  const [seriesHeard, setSeriesHeard] = useState<ReadonlySet<string>>(() => new Set());
  const [seriesIsNew, setSeriesIsNew] = useState(false);
  /** The piece being loaded from the shelf; its card shows a spinner. */
  const [seriesOpening, setSeriesOpening] = useState<string | null>(null);
  /** Whether the format on screen was opened from the shelf, so its end leads back there. */
  const formatFromSeries = useRef(false);
  /** Waiting for the feed to land on this boks before opening its format. */
  const pendingSeriesFormat = useRef<string | null>(null);
  /**
   * A boks the reader reached by their own choice - the shelf, a shared link,
   * their library, an author's page - not through the ranker. Its events carry
   * `entry`, so a comparison of algorithms can leave out reads no algorithm
   * chose. `arrived` turns true once it is on screen; moving off it after that
   * ends the tag.
   */
  const entryRef = useRef<{ storyId: string; entry: ReaderEntry; arrived: boolean } | null>(null);
  /**
   * Where each boks sat in the slate that served it, and which served feed
   * that was. The contract's `rank` is the position in the delivered feed and
   * `feedId` the feed that delivered it - neither is the index on screen,
   * which shifts when a library entry is inserted and keeps counting across
   * appended slates.
   */
  const servedPlacement = useRef<Map<string, { rank: number; feedId: string | null }>>(new Map());
  /**
   * The boks a reading format was opened on, and which format. Time spent
   * listening counts as reading, by decision; the tag lets an analysis tell
   * a listened piece from a read one.
   */
  const formatUsed = useRef<{ storyId: string; format: "poem" | "cinema" } | null>(null);
  const [storyHasMore, setStoryHasMore] = useState(false);
  const [storyTransition, setStoryTransition] = useState<StoryTransition>({ phase: "idle", direction: null, axis: null });
  const [boundaryPull, setBoundaryPull] = useState<BoundaryPullState | null>(null);
  const [pendingLibraryStoryId, setPendingLibraryStoryId] = useState<string | null>(null);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const touchStart = useRef<GestureStart | null>(null);
  const pointerStart = useRef<GestureStart | null>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  /** When the text last scrolled - to tell a tap from the touch that stops a flick. */
  const lastScrollAt = useRef(0);
  /** When the current wheel pull became armed, and the timer that commits it. */
  const wheelArmedAt = useRef<number | null>(null);
  const wheelReleaseTimer = useRef<number | null>(null);
  /** Whether the pull cue is armed, so the haptic tick fires once per arming. */
  const pullArmed = useRef(false);
  const wheelTravel = useRef({
    x: 0,
    y: 0,
    lastAt: 0,
    atTop: false,
    atBottom: false,
    allowPrevious: false,
    allowNext: false,
  });
  const wheelBoundaryArmed = useRef({ previous: false, next: false });
  const wheelIdleTimer = useRef<number | null>(null);
  const boundaryPullResetTimer = useRef<number | null>(null);
  const lastWheelNavigationAt = useRef(0);
  const readingClock = useRef<ReaderClock>(createReaderClock());
  const currentStoryRef = useRef<Story | null>(null);
  const catalogContextRef = useRef<{ catalogSize: number; unseenCount: number }>({
    catalogSize: 0,
    unseenCount: 0,
  });
  const recordHeartbeatRef = useRef<(story: Story) => void>(() => undefined);
  const recordTouchRef = useRef<(kind: TouchKind) => void>(() => undefined);
  const recordOutcomeRef = useRef<(reason: ReadOutcomeReason) => void>(() => undefined);
  const openReadBoksRef = useRef<(storyId: string, entry: ReaderEntry) => Promise<boolean>>(async () => false);
  const chromeTimer = useRef<number | null>(null);
  const storyScroll = useRef<HTMLDivElement | null>(null);
  const storyTransitionLocked = useRef(false);
  const storyTransitionTimers = useRef<number[]>([]);
  const storyProgress = useRef<Record<string, number>>({});
  const trackedOutcomes = useRef<Set<string>>(new Set());
  const countedAnonymousStories = useRef<Set<string>>(new Set());
  const metricsRef = useRef<Metrics>(initialMetrics);
  const eventQueue = useRef<ReaderEventQueue | null>(null);
  const experimentRef = useRef<RecommendationExperiment | null>(null);
  const provenanceRef = useRef<FeedProvenance>(provenance);
  const readerSignalsRef = useRef<ReaderSignals>(emptyReaderSignals);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    experimentRef.current = experiment;
  }, [experiment]);

  useEffect(() => {
    provenanceRef.current = provenance;
  }, [provenance]);

  useEffect(() => {
    return () => {
      storyTransitionTimers.current.forEach((timer) => window.clearTimeout(timer));
      storyTransitionTimers.current = [];
      storyTransitionLocked.current = false;
      if (boundaryPullResetTimer.current !== null) {
        window.clearTimeout(boundaryPullResetTimer.current);
      }
      if (wheelIdleTimer.current !== null) {
        window.clearTimeout(wheelIdleTimer.current);
      }
      if (wheelReleaseTimer.current !== null) {
        window.clearTimeout(wheelReleaseTimer.current);
      }
    };
  }, []);

  /**
   * Personalized strategies read affinity the reader built by behavior. The
   * reader is never asked to configure genres or moods.
   */
  const readerSignals = useMemo<ReaderSignals>(() => readerSignalsFromProfile(profile), [profile]);

  useEffect(() => {
    readerSignalsRef.current = readerSignals;
  }, [readerSignals]);

  /**
   * One feed request, for a new feed or the next slate. `profileSnapshot` is
   * the profile the ranking saw: it changes with every read, so without it a
   * serve could never be replayed. `readingLanguages` is a guest's filter - a
   * signed-in reader's stored choice wins inside the RPC.
   */
  const feedRequest = useCallback(
    (append: boolean): Parameters<typeof load>[0] => ({
      view: "reader",
      limit: readerSlateSize,
      visitorId: visitorId.current,
      sessionId: sessionId.current,
      reader: readerSignalsRef.current,
      profileSnapshot: { ...readerSignalsRef.current },
      readingLanguages: readingLanguagesRef.current,
      ...(append ? { append: true } : {}),
    }),
    []
  );

  /** Records each newly served boks' slate position and feed - see `servedPlacement`. */
  const rememberServedPlacement = useCallback((data: unknown, append: boolean) => {
    if (!data || typeof data !== "object") return;
    const served = data as { stories?: Story[]; provenance?: FeedProvenance };
    if (!Array.isArray(served.stories)) return;
    if (!append) servedPlacement.current = new Map();
    const feedId = served.provenance?.feedId ?? null;
    served.stories.forEach((story, rank) => {
      const id = String(story.id);
      // An append skips boks already in the feed; they keep the slate that put them there.
      if (append && servedPlacement.current.has(id)) return;
      servedPlacement.current.set(id, { rank, feedId });
    });
  }, []);

  /**
   * The next slate, added after this one. The reader used to stop dead at the
   * end of the first slate: swipes did nothing and the pull still said
   * "release for next bok". The slate is ranked with everything read so far,
   * so fatigue keeps what was seen out of it; boks already in the feed are
   * skipped by the append. A slate that adds nothing means there is nothing
   * left for this reader, and it is not asked for again this visit.
   */
  const loadingMore = useRef<Promise<void> | null>(null);
  const feedExhausted = useRef(false);
  /** A new feed is on its way; an append now would extend the one it replaces. */
  const fullLoadsInFlight = useRef(0);
  const knownStoryIds = useRef<Set<string>>(new Set());

  /**
   * A new feed. An append still in flight is waited for first: landing after
   * this load, it would add a slate ranked under the old filter to the new
   * feed, and it could take the hold's `release` meant for this one.
   */
  const loadFeed = useCallback(async () => {
    fullLoadsInFlight.current += 1;
    try {
      if (loadingMore.current) await loadingMore.current;
      feedExhausted.current = false;
      const data = await load(feedRequest(false));
      rememberServedPlacement(data, false);
      return data;
    } finally {
      fullLoadsInFlight.current -= 1;
    }
  }, [feedRequest, load, rememberServedPlacement]);

  /**
   * A new feed that changes what the feed may contain - the reading
   * languages - so the boks on screen is let go rather than held.
   */
  const reloadFeedReleasing = useCallback(async () => {
    if (loadingMore.current) await loadingMore.current;
    setHold((current) => ({ ...current, release: true }));
    return loadFeed();
  }, [loadFeed]);

  const loadMoreFeed = useCallback(async () => {
    if (loadingMore.current || feedExhausted.current || fullLoadsInFlight.current > 0) return;
    const appending = (async () => {
      try {
        const data = await load(feedRequest(true));
        rememberServedPlacement(data, true);
        const fresh = (data?.stories ?? []).filter((story) => !knownStoryIds.current.has(String(story.id)));
        if (!fresh.length) feedExhausted.current = true;
      } catch {
        // Silently: the reader still has boks ahead, and the next approach to
        // the end tries again.
      }
    })();
    loadingMore.current = appending;
    try {
      await appending;
    } finally {
      loadingMore.current = null;
    }
  }, [feedRequest, load, rememberServedPlacement]);

  /**
   * Who is reading, once it can be known. Separate from the feed: a reader
   * whose first feed load failed used to stay a "guest" for the whole visit
   * after a successful retry - likes asked them to sign up, and the 15-boks
   * gate could fire on an account holder.
   */
  const adoptIdentity = useCallback(async (): Promise<BoksUserContext | null> => {
    let context: BoksUserContext | null = null;
    try {
      context = await loadBoksUserContext();
    } catch {
      context = null;
    }
    setUser(context);
    return context;
  }, []);

  useEffect(() => {
    visitorId.current = getBrowserId("boks-reader");
    feedbackState.current = readFeedbackState();
    sessionId.current = `${Date.now()}-${randomBoksId()}`;
    // The first feed request below reads the ref, so it gets the stored
    // profile now; state follows on the next tick. Deferring both ranked every
    // returning reader's first slate - usually the whole visit - as a stranger.
    const storedProfile = readProfile();
    readerSignalsRef.current = readerSignalsFromProfile(storedProfile);
    const profileTimer = window.setTimeout(() => setProfile(storedProfile), 0);
    // Read before the address bar is cleaned below, which would take the utm
    // tags and the shared-link marker with it.
    visitAttribution.current = journeyAttribution(window.location.href, document.referrer);
    // A shared link carries the boks id. Strip it from the address bar once it
    // has been used, so a refresh does not reopen it over the reader's feed.
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("bok");
    const sharedAuthor = params.get("author");
    // A tracked link on its own (`/?link=…`, `/series?link=…`) is cleaned too:
    // a refresh is a new page load, and it should not arrive through the link twice.
    if (shared || sharedAuthor || params.has("link")) window.history.replaceState(null, "", window.location.pathname);

    // The filter has to be in place before the first feed request, or the
    // reader's first page is unfiltered and then changes under them.
    readingLanguagesRef.current = effectiveReadingLanguages(null);
    const seriesTimer = window.setTimeout(() => {
      setSeriesHeard(readHeardSeries());
      refreshSeriesContext();
      if (initialView === "series") rememberSeenSeries(seriesStoryIds);
      else setSeriesIsNew(hasUnseenSeries(seriesStoryIds, readSeenSeries()));
    }, 0);

    loadFeed()
      .then(async () => {
        const context = await adoptIdentity();
        // The identity is now known, whichever way it came out. Until this
        // moment nobody is a guest - see `isGuestReader`.
        setIdentitySettled(true);
        // An account's stored languages are the authority. If they differ from
        // what the first request used - a reader signed in on a new device -
        // adopt them and reload once, rather than leaving the page showing a
        // filter the account does not have.
        const accountLanguages = effectiveReadingLanguages(context?.readingLanguages);
        if (accountLanguages.join() !== readingLanguagesRef.current.join()) {
          readingLanguagesRef.current = accountLanguages;
          refreshSeriesContext();
          await reloadFeedReleasing();
        }
        setGuestReadCount(getAnonymousBoksReadCount());
        // A link that did not work. A reader who is signed in anyway - an old
        // link tapped twice - has nothing to fix and is not interrupted. For
        // anyone else the panel opens on sign-in with the reason, and can be
        // closed: it used to open as the forced guest gate, with no way out
        // and a message about having read 15 boks.
        const magicLinkNotice = consumeBoksMagicLinkRedirectNotice();
        if (magicLinkNotice && !(context && !context.isAnonymous)) {
          setAuthNotice(magicLinkNotice);
          setAuthReason("manual");
          setAuthIntent("general");
          setAuthPanelOpen(true);
          setReaderChromeVisible(true);
        }
        if (shared) await openReadBoksRef.current(shared, "share");
        // A shared author link names an account, so it opens the publisher.
        if (sharedAuthor) setAuthorSheet({ handle: bareHandle(sharedAuthor) });
      })
      .catch((error) => {
        notify(error.message);
        // The account is still worth knowing - see `adoptIdentity`.
        void adoptIdentity();
      })
      // A failed feed load must still settle the identity, or a real guest
      // never meets the sign-up gate at all.
      .finally(() => setIdentitySettled(true));
    return () => {
      window.clearTimeout(profileTimer);
      window.clearTimeout(seriesTimer);
    };
    // `initialView` is the route's, fixed for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptIdentity, loadFeed, notify, reloadFeedReleasing, setStatus]);

  useEffect(() => {
    const detach = attachReaderClock(readingClock.current);
    return detach;
  }, []);

  /**
   * A heartbeat per minute of foreground time. Reading time is cumulative per
   * boks and rolled up with a maximum, so a duplicate or a late heartbeat is
   * harmless - and a reader who lingers then closes the tab still contributes
   * the minutes they actually spent.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      const story = currentStoryRef.current;
      if (!story) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (readingClock.current.activeSeconds() < readerHeartbeatSeconds) return;
      recordHeartbeatRef.current(story);
    }, readerHeartbeatSeconds * 1000);

    return () => window.clearInterval(timer);
  }, []);

  /**
   * The reader who stops reading and leaves used to be invisible: the outcome
   * only fired when they moved to the next boks, so the last read of every
   * session recorded nothing.
   *
   * The outcome is recorded when the read genuinely ends - the page is being
   * torn down, or the reader has left the feed. Deliberately NOT on every
   * `visibilitychange`: glancing at a notification three seconds in would
   * otherwise lock in a "skip" that the next five minutes of reading could
   * never correct, because a boks gets one verdict per session. Backgrounding
   * emits a heartbeat instead, so the time and progress are still recorded and
   * the verdict stays open.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      flushAftertasteRef.current(true);
      const story = currentStoryRef.current;
      if (story) recordHeartbeatRef.current(story);
    };
    // A page kept in the back/forward cache comes back - iOS Safari does this
    // for every link followed and returned from - so that is backgrounding,
    // not an ending, and the verdict stays open.
    const onTeardown = (event?: PageTransitionEvent) => {
      if (event?.persisted) onHidden();
      else { flushAftertasteRef.current(true); recordOutcomeRef.current("exit"); }
    };

    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onTeardown);

    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onTeardown);
      onTeardown();
    };
  }, []);

  /**
   * One queue for the life of the page. Events go to Supabase once the reader
   * has a Supabase feed; until then the queue holds them (a transient failure
   * keeps a batch), so nothing recorded before the first feed lands is lost,
   * and nothing is sent anywhere else.
   */
  const isSupabaseReaderRef = useRef(isSupabaseReader);
  useEffect(() => {
    isSupabaseReaderRef.current = isSupabaseReader;
  }, [isSupabaseReader]);
  useEffect(() => {
    const queue = createReaderEventQueue({
      transport: async (events, delivery) => {
        if (!isSupabaseReaderRef.current) throw new Error(wordsNow().noBackend);
        await recordSupabaseReaderEvents(events, delivery);
      },
    });

    eventQueue.current = queue;
    const stopExitFlush = flushReaderEventsOnExit(queue);

    return () => {
      stopExitFlush();
      queue.dispose();
      eventQueue.current = null;
    };
  }, []);

  const hideReaderChrome = useCallback(() => {
    if (!commentOpen) setReaderChromeVisible(false);
  }, [commentOpen]);

  /**
   * The explicit request for the controls: a tap shows them, the next tap
   * hides them. No timer - someone who asked for the controls to like a piece
   * should not watch them fade while deciding. Scrolling, which means reading
   * has resumed, hides them. Changing boks does not: the controls belong to
   * the reader and follow them through the feed.
   */
  const toggleReaderChrome = useCallback(() => {
    if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    chromeTimer.current = null;
    setReaderChromeVisible((visible) => (visible && !commentOpen ? false : true));
  }, [commentOpen]);

  const revealReaderChrome = useCallback((hideAfterMs = 5200) => {
    setReaderChromeVisible(true);
    if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    if (hideAfterMs > 0) {
      chromeTimer.current = window.setTimeout(() => {
        if (!commentOpen) setReaderChromeVisible(false);
      }, hideAfterMs);
    }
  }, [commentOpen]);

  useEffect(() => {
    if (!supabase) return;

    /**
     * Reload for a sign-in, not for every `SIGNED_IN`. auth-js emits it again
     * whenever the tab becomes visible and the session is recovered, and when
     * a guest session is created - so returning to the app, or a new guest's
     * first load, fetched the whole feed a second time, wrote another served
     * feed and rebuilt everything around the boks on screen. The identity is
     * taken from `INITIAL_SESSION`, which every subscriber receives first.
     */
    let lastIdentity: string | null = null;
    const result = supabase.auth.onAuthStateChange((event, session) => {
      const identity = session?.user ? `${session.user.id}:${session.user.is_anonymous ? "guest" : "account"}` : "";
      if (event === "INITIAL_SESSION") {
        lastIdentity = identity;
        return;
      }
      if (event !== "SIGNED_IN" || identity === lastIdentity) return;
      lastIdentity = identity;
      // A guest session being created: the first feed load already covers it.
      if (!session?.user || session.user.is_anonymous) return;
      completePendingBoksMagicLinkProfile(currentBoksTermsVersion)
        .then(async () => {
          // The same settling as a page load: the account, who it follows, and
          // its stored languages, which are the authority once there is one.
          const nextUser = await adoptIdentity();
          const accountLanguages = effectiveReadingLanguages(nextUser?.readingLanguages);
          const languagesChanged = accountLanguages.join() !== readingLanguagesRef.current.join();
          if (languagesChanged) {
            readingLanguagesRef.current = accountLanguages;
            setSeriesContext(seriesContextFor(accountLanguages));
          }
          (languagesChanged ? reloadFeedReleasing() : loadFeed()).catch((error) =>
            notify(error instanceof Error ? error.message : wordsNow().couldNotRefresh)
          );
        })
        .catch((error) => notify(error instanceof Error ? error.message : wordsNow().couldNotSignIn));
    });

    return () => result.data.subscription.unsubscribe();
  }, [adoptIdentity, loadFeed, notify, reloadFeedReleasing, setStatus]);

  useEffect(() => {
    return () => {
      if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    };
  }, []);

  /**
   * Records one attributed behavior signal. Every field the recommendation spec
   * requires is filled here, at the one place that knows the story, its feed
   * rank, the assigned algorithm and how long the reader has been on it.
   */
  const recordReaderEvent = useCallback(
    (eventType: ReaderEventType, story: Story, value = 1, metadata: Record<string, unknown> = {}) => {
      if (!exposedStories.current.has(story.id)) return;
      const experimentContext = experimentRef.current;
      const activeSeconds = readingClock.current.activeSeconds();
      const placement = servedPlacement.current.get(story.id);
      const entry = entryRef.current?.storyId === story.id ? entryRef.current.entry : null;
      const format = formatUsed.current?.storyId === story.id ? formatUsed.current.format : null;

      const event: ReaderEvent = {
        eventType,
        storyId: story.id,
        value: Math.max(0, Math.round(value)),
        activeSeconds,
        progress: Math.round((storyProgress.current[story.id] ?? 0) * 1000) / 1000,
        algorithmId: experimentContext?.algorithmId ?? "unassigned",
        experimentKey: experimentContext?.experimentKey ?? "",
        userSegment: experimentContext?.userSegment ?? "general",
        surface: "reader",
        // A boks no slate served - opened from a link or the library - has no
        // rank; `entry` says so, and the database stores 0.
        rank: placement?.rank ?? 0,
        clientElapsedSeconds: activeSeconds,
        sessionId: sessionId.current,
        visitorId: visitorId.current,
        // Derived from the real word count, not from `minutes`: every published
        // boks currently reports one minute, so the old estimate was a constant.
        estimatedSeconds: expectedReadingSeconds(story),
        feedId: placement?.feedId ?? null,
        servingBackend: provenanceRef.current.servingBackend,
        labelingVersion: provenanceRef.current.labelingVersion,
        metadata: { ...metadata, ...(entry ? { entry } : {}), ...(format ? { format } : {}) },
      };

      eventQueue.current?.record(event);

      // `views` stays the reader-facing history table behind "recently read".
      if (eventType === "impression" && isSupabaseReader) {
        recordSupabaseView(supabaseUserId, story.id).catch(() => undefined);
      }
    },
    [isSupabaseReader, supabaseUserId]
  );

  /**
   * Feed order comes from the ranking, not from the browser. A boks opened
   * from the account is inserted at the reader's current place; the item after
   * it remains the next recommendation.
   */
  const rankedStories = useMemo(() => {
    return composeReaderRanking(stories, libraryEntry, hold.place, hiddenStoryIds);
  }, [hiddenStoryIds, hold.place, libraryEntry, stories]);

  /*
   * A new feed has landed. Whatever the reader was looking at stays under
   * them: a reload re-ranks, so the old index can name a different boks in the
   * new feed, and the boks itself may have left the slate.
   *
   * That was a family of bugs. A like pushed the liked boks out of the slate
   * (fatigue) and the reader was moved to a stranger's piece. A shared link
   * opened its boks and then lost it when the page's second feed request - the
   * one that adopts the account's reading languages - landed on top.
   *
   * So the boks on screen is found by id in the new feed, or carried into it
   * at the reader's place - unless the reload changed the reading languages,
   * which is a new feed on purpose and may exclude the boks. A boks the reader has just acted on (`next`) is
   * carried with the counts its action settled. Anything else carried out of
   * the slate is given the same convention: its total without this reader's
   * like, which moves to local state, because the new feed will not report a
   * like on a boks it does not contain.
   *
   * Done during render - React's pattern for state that follows a prop - so no
   * frame is committed with the wrong boks. Done in an effect, that frame
   * existed, and the arrival effect logged an impression for it, scrolled to
   * the top, and then did both again for the right one.
   */
  if (stories !== hold.feed) {
    const shown = composeReaderRanking(hold.feed, libraryEntry, hold.place, hiddenStoryIds);
    const onScreen: Story | undefined = shown[selectedIndex];
    const acted = hold.next && (!onScreen || onScreen.id === hold.next.story.id) ? hold.next : null;
    const likedOnScreen = Boolean(onScreen && hold.likedIds.includes(onScreen.id));
    const place: HeldPlace | null =
      acted ??
      (onScreen && !hold.release
        ? { story: { ...onScreen, likes: Math.max(0, onScreen.likes - (likedOnScreen ? 1 : 0)) }, index: selectedIndex }
        : null);

    setHold({ place, next: null, feed: stories, likedIds: likedStoryIds, release: false });
    if (place && !acted && likedOnScreen) {
      setLiked((state) => (onScreen.id in state ? state : { ...state, [onScreen.id]: true }));
    }
    if (place) {
      const next = composeReaderRanking(stories, libraryEntry, place, hiddenStoryIds);
      setSelectedIndex(recoverReaderPlace(next.map((story) => story.id), place.story.id, selectedIndex));
    } else if (hold.release) {
      // A deliberately new feed starts at its beginning.
      setSelectedIndex(0);
    }
  }

  const currentStory = rankedStories[selectedIndex] ?? rankedStories[0];
  /**
   * Stored text is whatever the author pasted. Shaping it - reflowing wrapped
   * prose, keeping stanza breaks, dropping a repeated title - happens once per
   * boks rather than on every render.
   */
  const storyBlocks = useMemo(
    () => (currentStory ? formatReaderBody(currentStory.body, currentStory.title) : []),
    [currentStory]
  );
  const currentStoryId = currentStory?.id;
  const currentComments = comments.filter((comment) => comment.storyId === currentStory?.id);
  const currentCommentDelta = currentStory ? commentCountDeltas[currentStory.id] : undefined;
  const currentCommentCount = currentStory
    ? Math.max(
        0,
        currentStory.commentsCount +
          (currentCommentDelta && currentCommentDelta.base === currentStory.commentsCount ? currentCommentDelta.added : 0)
      )
    : 0;
  const currentAuthorLabel = currentStory?.authorName || (atHandle(currentStory?.authorHandle) || wordsNow().bokAuthor);
  const persistedLikedStoryIds = useMemo(() => new Set(likedStoryIds), [likedStoryIds]);

  // Ask for the next slate a few boks before the end, so it is there in time.
  useEffect(() => {
    knownStoryIds.current = new Set(rankedStories.map((story) => story.id));
    if (!isSupabaseReader || !shouldLoadMore(rankedStories.length, selectedIndex)) return;
    void loadMoreFeed();
  }, [isSupabaseReader, loadMoreFeed, rankedStories, selectedIndex]);
  const isCurrentStoryLiked = currentStory ? liked[currentStory.id] ?? persistedLikedStoryIds.has(currentStory.id) : false;
  const currentLikeCount = currentStory
    ? displayedLikeCount(currentStory.likes, persistedLikedStoryIds.has(currentStory.id), isCurrentStoryLiked)
    : 0;
  // Nobody is a guest before the account lookup has answered.
  const isGuestReader = identitySettled && isSupabaseReader && (!user || user.isAnonymous);

  // One visit per page load, sent only once the reader's identity has settled:
  // recorded earlier, a signed-in reader's visit would arrive with no user and
  // be counted as a guest's, and the funnel would be wrong in the direction
  // that flatters it.
  useEffect(() => {
    if (!identitySettled || visitRecorded.current || !visitAttribution.current) return;
    visitRecorded.current = true;
    const attribution = visitAttribution.current;
    // The country comes from our own Worker, off the reading path: the visit
    // waits for it, the reader does not.
    void fetchVisitorCountry().then((country) =>
      recordJourneyEvent(
        { event: "visit", attribution, country },
        { visitorId: visitorId.current, sessionId: sessionId.current }
      )
    );
  }, [identitySettled]);
  const hasSignedInAccount = Boolean(user && !user.isAnonymous);
  const accountSuspended = Boolean(user?.bannedAt);
  /**
   * Whether to offer the admin Hide button. This only decides what is drawn:
   * the role comes from `get_boks_user_context`, and the action itself is
   * `archive_bok`, which checks `is_boks_admin` in the database on every call.
   * Anyone who forces the button onto their screen gets "Admin access
   * required." and the boks stays where it is.
   */
  const isAdminReader = Boolean(user && !user.isAnonymous && user.role === "admin" && !user.bannedAt);
  /** Finished pieces are for everyone; the prototype stays with the admins. */
  const cinemaIsFinished = Boolean(currentStory && isBoksSeriesPiece(currentStory.id));
  /**
   * A poem gets a different renderer behind the same button.
   *
   * Verse read over a picture with the words laid across it is a different
   * thing from prose read over scenes, and the reader should not have to know
   * which they are about to get - the piece decides.
   */
  const poemManifestUrl = currentStory ? poemManifestFor(currentStory.id) : null;
  const cinemaOffered = cinemaIsFinished || Boolean(poemManifestUrl) || isAdminReader;
  /** The formats open without their interface, for filming. */
  const recording = recordingAsked && isAdminReader;
  const currentSeriesPiece = seriesPieceFor(currentStory?.id);
  /** Exactly the condition the two players below are rendered under. */
  const formatOnScreen = Boolean(poem) || (cinemaOpen && Boolean(currentStory) && cinemaOffered);

  /** The screen and the browser's colour go back together, however a format closed. */
  function closedFormat() {
    // The music the format silenced comes back with the feed. Closing is a
    // tap, which is what a browser needs before it will play.
    if (musicPausedForFormat.current) {
      musicPausedForFormat.current = false;
      if (readingMusicWanted()) {
        startReadingMusic();
        // The button follows on the next tick: this also runs from the effect
        // that watches the format close.
        window.setTimeout(() => setMusicOn(true), 0);
      }
    }
    if (!formatTookScreen.current) return;
    formatTookScreen.current = false;
    giveScreenBack();
  }

  useEffect(() => {
    if (!formatOnScreen) closedFormat();
  }, [formatOnScreen]);
  const seriesIndex = seriesSequence.findIndex(piece => piece.storyId === currentStoryId);
  const nextSeriesPiece = seriesIndex >= 0 ? seriesSequence[seriesIndex + 1] : undefined;
  const nextBok = formatFromSeries.current
    ? nextSeriesPiece ? { id: nextSeriesPiece.storyId, title: nextSeriesPiece.title, authorName: nextSeriesPiece.author } : undefined
    : rankedStories[selectedIndex + 1];
  function flushAftertaste(exit = false) {
    if (!currentStory || sentAftertastes.current.has(currentStory.id)) return;
    const tags = aftertasteDrafts.current[currentStory.id] ?? [];
    if (!tags.length) return;
    sentAftertastes.current.add(currentStory.id);
    setAftertastes(current => ({ ...current }));
    recordReaderEvent("aftertaste", currentStory, tags.length, { tags });
    void eventQueue.current?.flush({ keepalive: exit });
  }
  useEffect(() => { flushAftertasteRef.current = flushAftertaste; });
  const finale: FinaleActions = {
    liked: isCurrentStoryLiked,
    likeCount: currentLikeCount,
    commentCount: currentCommentCount,
    onLike: () => void likeStory(),
    onShare: () => setShareOpen(true),
    onComments: () => setCommentOpen(true),
    onInteract: () => { readingClock.current.hold(); setReadingPhase("finale"); },
    nextBok: nextBok ? { id: nextBok.id, title: nextBok.title, authorName: nextBok.authorName, artwork: getBokArtwork(nextBok) } : undefined,
    nextLabel: formatFromSeries.current ? t("Back to Series", "Вернуться к сериям") : t("Find more boks", "Найти ещё боки"),
    onNext: () => {
      flushAftertaste();
      setCinemaOpen(false); setPoem(null); setFormatPlaying(false);
      if (formatFromSeries.current) {
        if (nextSeriesPiece) void openSeriesPiece(nextSeriesPiece, true);
        else { recordReadingOutcome("button"); openSeries(); }
        return;
      }
      void nextStory("button");
    },
    onReached: () => {
      readingClock.current.hold(); setFormatPlaying(false);
      if (currentStory && seriesPieceFor(currentStory.id)) setSeriesHeard(rememberHeardSeries(currentStory.id));
    },
    aftertaste: currentStory ? aftertastes[currentStory.id] ?? [] : [],
    aftertasteSubmitted: currentStory ? sentAftertastes.current.has(currentStory.id) : false,
    onAftertaste: (tags) => {
      if (!currentStory || sentAftertastes.current.has(currentStory.id)) return;
      readingClock.current.hold(); setReadingPhase("finale");
      aftertasteDrafts.current[currentStory.id] = tags;
      setAftertastes(current => ({ ...current, [currentStory.id]: tags }));
    },
  };
  const readerOverlayOpen = Boolean(authPanelOpen || commentOpen || authorSheet || bokMenuOpen || shareOpen || hideTarget || openIssue || formatLoading || feedbackMilestone !== null);
  const readerInteractionBlocked = Boolean(
    authPanelOpen || commentOpen || authorSheet || bokMenuOpen || shareOpen || hideTarget || cinemaOpen || poem || seriesOpen || openIssue || formatLoading || feedbackMilestone !== null
  );
  const coverInspection = useCoverInspection(coverRef, currentStoryId,
    Boolean(currentStory && getBokArtwork(currentStory) && !readerInteractionBlocked && storyTransition.phase === "idle"),
    () => {
      touchStart.current = null;
      pointerStart.current = null;
      clearBoundaryPull(true);
    });

  const guestNoticeVisible = Boolean(guestNoticeStep && isGuestReader && !readerOverlayOpen && (formatOnScreen ? formatEnded : !seriesOpen && readingPhase !== "reading"));
  useEffect(() => {
    if (!guestNoticeVisible || !guestNoticeStep) return;
    saveAnonymousNoticeState({ ...readAnonymousNoticeState(), [guestNoticeStep]: true });
  }, [guestNoticeVisible, guestNoticeStep]);

  useEffect(() => {
    if (!readerInteractionBlocked) return;
    // A delayed trackpad release belongs to the surface where it began.
    // Opening a sheet or player cancels it before it can turn the bok behind it.
    if (wheelReleaseTimer.current !== null) window.clearTimeout(wheelReleaseTimer.current);
    if (wheelIdleTimer.current !== null) window.clearTimeout(wheelIdleTimer.current);
    if (boundaryPullResetTimer.current !== null) window.clearTimeout(boundaryPullResetTimer.current);
    wheelReleaseTimer.current = null;
    wheelIdleTimer.current = null;
    boundaryPullResetTimer.current = null;
    wheelArmedAt.current = null;
    wheelBoundaryArmed.current = { previous: false, next: false };
    wheelTravel.current = { x: 0, y: 0, lastAt: 0, atTop: false, atBottom: false, allowPrevious: false, allowNext: false };
    touchStart.current = null;
    pointerStart.current = null;
    pullArmed.current = false;
    const frame = window.requestAnimationFrame(() => setBoundaryPull(null));
    return () => window.cancelAnimationFrame(frame);
  }, [readerInteractionBlocked]);

  useEffect(() => {
    if (!readerFlash) return;
    const handle = window.setTimeout(() => setReaderFlash(""), 6000);
    return () => window.clearTimeout(handle);
  }, [readerFlash]);

  function openHideBok() {
    if (!currentStory || !isAdminReader) return;
    setHideTarget({ kind: "archive", bok: { id: currentStory.id, title: currentStory.title } });
  }

  /** Hidden for everyone; out of this page now, and the next boks moves up. */
  function afterHideBok({ bok }: BokLifecycleTarget) {
    setHideTarget(null);
    setHiddenStoryIds((current) => new Set(current).add(bok.id));
    setReaderFlash(wordsNow().hidden(bok.title));
  }

  function showSuspension() {
    notify(user?.banReason || wordsNow().suspendedReading);
    openAccount("manual");
  }


  useEffect(() => {
    if (!pendingLibraryStoryId) return;
    const index = rankedStories.findIndex((story) => story.id === pendingLibraryStoryId);
    if (index < 0) return;

    const handle = window.setTimeout(() => {
      setCommentOpen(false);
      setSelectedIndex(index);
      setAuthPanelOpen(false);
      setPendingLibraryStoryId(null);
      // Not the same as moving through the feed, which now leaves the controls
      // alone: here they are only up because the account panel put them up, and
      // the reader has just asked to read something. Closing the panel closes
      // what came with it.
      hideReaderChrome();
    }, 0);

    return () => window.clearTimeout(handle);
  }, [pendingLibraryStoryId, rankedStories, hideReaderChrome]);

  // Activity opens a conversation only after the selected bok has arrived.
  // Opening the sheet at fetch completion would briefly show the old bok.
  useEffect(() => {
    if (!pendingCommentStoryId || pendingLibraryStoryId || currentStoryId !== pendingCommentStoryId) return;
    const handle = window.setTimeout(() => {
      setPendingCommentStoryId(null);
      setCommentOpen(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [currentStoryId, pendingCommentStoryId, pendingLibraryStoryId]);

  /**
   * A piece opened from the shelf: once the feed has landed on it, open it in
   * its format. Waits for the feed rather than opening on a boks that is not
   * the one on screen, so the finale's like and share act on the right piece.
   */
  useEffect(() => {
    const waiting = pendingSeriesFormat.current;
    if (!waiting || currentStoryId !== waiting) return;
    pendingSeriesFormat.current = null;
    const handle = window.setTimeout(() => openReadingFormat(waiting), 0);
    return () => window.clearTimeout(handle);
    // Only the arrival matters; `openReadingFormat` reads nothing stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStoryId]);

  /** Moving off a boks the reader chose ends its `entry` tag. */
  useEffect(() => {
    const chosen = entryRef.current;
    if (!chosen) return;
    if (currentStoryId === chosen.storyId) chosen.arrived = true;
    else if (chosen.arrived) entryRef.current = null;
  }, [currentStoryId]);

  /** The browser's back and forward move between the feed and the shelf. */
  useEffect(() => {
    const onPopState = () => {
      formatRequest.current += 1;
      storyOpenRequest.current += 1;
      pendingSeriesFormat.current = null;
      setPendingCommentStoryId(null);
      setFormatLoading(false); setSeriesOpening(null); setOpenIssue(null);
      flushAftertasteRef.current();
      setCinemaOpen(false); setPoem(null); setFormatPlaying(false);
      setCommentOpen(false); setShareOpen(false); setBokMenuOpen(false);
      const onShelf = window.location.pathname === "/series";
      setSeriesOpen(onShelf);
      if (onShelf) refreshSeriesContext();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Visibility may resume a clock only when its reading surface is eligible.
  // Settings, decorative covers, final actions and paused audio are all holds.
  useEffect(() => {
    const overlay = authPanelOpen || commentOpen || authorSheet || bokMenuOpen || shareOpen || hideTarget || openIssue || feedbackMilestone !== null || formatLoading;
    const reading = formatOnScreen ? formatPlaying : !seriesOpen && readingPhase === "reading";
    if (overlay || !reading) readingClock.current.hold();
    else {
      readingClock.current.release();
      if (document.visibilityState === "visible") readingClock.current.resume();
    }
  }, [authPanelOpen, commentOpen, authorSheet, bokMenuOpen, shareOpen, hideTarget, openIssue, feedbackMilestone, formatLoading, formatOnScreen, formatPlaying, seriesOpen, readingPhase]);

  // Start is measured in foreground reading seconds, never cover dwell.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const story = currentStoryRef.current;
      if (story && readingClock.current.isRunning() && readingClock.current.activeSeconds() >= 3) {
        recordReaderEvent("start", story, 1, { genre: story.genre, mood: story.mood });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recordReaderEvent]);

  // The latest values the arrival effect needs, without making them reasons
  // to run it. See below.
  const arrivalContext = useRef({ currentStory, recordReaderEvent });
  useEffect(() => {
    arrivalContext.current = { currentStory, recordReaderEvent };
  }, [currentStory, recordReaderEvent]);

  /**
   * Arriving at a boks: back to the top, a fresh reading clock, one
   * impression. The controls are left exactly as the reader had them.
   *
   * Keyed on the boks id alone. It used to depend on the story object and on
   * callbacks that change whenever the comment sheet opens or closes, so a
   * like - whose reload hands back a new object for the same boks - or simply
   * closing the comments ran it again: the text jumped to the top, the rail
   * the reader had just used vanished, the clock restarted and another
   * impression was logged for a boks already on screen.
   */
  useEffect(() => {
    const { currentStory: story } = arrivalContext.current;
    if (!story || !currentStoryId) return;
    readingClock.current.hold();
    readingClock.current.restart();
    setReadingPhase("cover");
    setTextProgress(0);
    setFormatPlaying(false);
    if (storyScroll.current) storyScroll.current.scrollTop = 0;
    if (wheelIdleTimer.current !== null) {
      window.clearTimeout(wheelIdleTimer.current);
      wheelIdleTimer.current = null;
    }
    // A wheel pull armed on the previous boks must not move on from this one.
    if (wheelReleaseTimer.current !== null) {
      window.clearTimeout(wheelReleaseTimer.current);
      wheelReleaseTimer.current = null;
    }
    wheelBoundaryArmed.current = { previous: false, next: false };
    wheelTravel.current = {
      x: 0,
      y: 0,
      lastAt: 0,
      atTop: false,
      atBottom: false,
      allowPrevious: false,
      allowNext: false,
    };
    const overflowTimer = window.setTimeout(updateStoryOverflow, 0);
    const wheelArmTimer = window.setTimeout(armWheelBoundary, 700);
    // Arriving at a boks neither shows the controls nor hides them. Showing
    // them read as the interface popping up by itself; hiding them took away
    // a rail the reader had deliberately opened, one boks after another, which
    // is what https://github.com/IvanCherep/boks/issues/1 reports. The reader
    // decides, and their decision carries across the whole feed.


    return () => {
      window.clearTimeout(overflowTimer);
      window.clearTimeout(wheelArmTimer);
    };
  }, [currentStoryId]);

  // Loading a feed under a directly opened Series shelf is not a view.
  // Expose only the bok actually drawn in the reader or its real player.
  useEffect(() => {
    const { currentStory: story, recordReaderEvent: record } = arrivalContext.current;
    if (!story || (seriesOpen && !formatOnScreen) || exposedStories.current.has(story.id)) return;
    exposedStories.current.add(story.id);
    record("impression", story, 1, { genre: story.genre, mood: story.mood, ...catalogContextRef.current });
  }, [currentStoryId, seriesOpen, formatOnScreen]);

  /**
   * A guest's read count. Separate from arrival because it has a second
   * trigger: nobody is a guest until the account lookup answers, so the first
   * boks is counted when that answer arrives, not when the boks does.
   */
  useEffect(() => {
    if (!currentStoryId || !isGuestReader || countedAnonymousStories.current.has(currentStoryId)) return;
    const anonymousState = readAnonymousReadState();
    const alreadyRead = anonymousState.storyIds.includes(currentStoryId);

    if (!alreadyRead && anonymousState.storyIds.length >= anonymousReadLimits.requiredSignup) {
      window.setTimeout(() => {
        setGuestReadCount(anonymousState.storyIds.length);
        setAuthReason("required");
        setAuthPanelOpen(true);
        setGuestNoticeStep(null);
      }, 0);
      return;
    }

    // Counted once it has actually been read a while - see `guestReadDwellMs`.
    const storyId = currentStoryId;
    const handle = window.setInterval(() => {
      if (!readingClock.current.isRunning() || readingClock.current.activeSeconds() * 1000 < guestReadDwellMs) return;
      window.clearInterval(handle);
      countedAnonymousStories.current.add(storyId);
      const nextCount = recordAnonymousBoksRead(storyId);
      setGuestReadCount(nextCount);

      const notices = readAnonymousNoticeState();
      // Prepare the notice after real dwell, but show it only at a reading
      // break (ending or next cover). Persist it only once actually visible.
      if (nextCount >= anonymousReadLimits.secondNotice && !notices.second) {
        setGuestNoticeStep("second");
      } else if (nextCount >= anonymousReadLimits.firstNotice && !notices.first && nextCount < anonymousReadLimits.secondNotice) {
        setGuestNoticeStep("first");
      }
    }, 500);
    return () => window.clearInterval(handle);
  }, [currentStoryId, isGuestReader]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (readerInteractionBlocked) return;
      // `instanceof` rather than a cast: a key event aimed at the window or
      // the document has no `closest`, and calling it threw.
      const target = event.target;
      if (target instanceof Element && target.closest("button, a, input, textarea, select, [role='dialog'], [contenteditable='true']")) return;

      // Leave the browser's own shortcuts alone.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Space and the down arrow used to change bok outright, so the first
      // press threw someone paging through a long story out of it. They
      // scroll now, and change bok only from the end of the text - the rule
      // the pull follows on a phone. See `readerKeyAction`.
      const element = storyScroll.current;
      const boundary = element ? getScrollBoundary(element) : { atTop: true, atBottom: true };
      const action = readerKeyAction(event.key, event.shiftKey, boundary);
      if (!action) return;
      event.preventDefault();

      if (action === "scroll-down" || action === "scroll-up") {
        if (!element) return;
        // A page for Space and the Page keys, a few lines for the arrows -
        // what the browser does for a page that scrolls on its own.
        const paging = event.key === " " || event.key === "PageDown" || event.key === "PageUp";
        const step = paging ? Math.round(element.clientHeight * 0.85) : 72;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        element.scrollBy({ top: action === "scroll-down" ? step : -step, behavior: reduceMotion ? "auto" : "smooth" });
        return;
      }

      // Changing bok no longer flashes the controls in; see `toggleReaderChrome`.
      const axis = event.key === "ArrowLeft" || event.key === "ArrowRight" ? "horizontal" : "vertical";
      if (action === "next") void nextStory("keyboard", axis);
      else previousStory("keyboard", axis);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: "boks_get_metrics",
          title: "Get boks metrics",
          description: "Read the current boks experiment metrics.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute() {
            return metricsRef.current;
          },
        },
        { signal: lifecycle.signal }
      );
    };

    register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  /**
   * Applies a change to the latest profile, not the one this render saw: a
   * like resolving after a swipe used to write back a profile without the
   * swipe's outcome, and the boks it had skipped could be served again.
   */
  function updateProfile(change: (current: ReaderProfile) => ReaderProfile) {
    setProfile((current) => {
      const next = change(current);
      saveProfile(next);
      return next;
    });
  }

  function clearStoryTransitionTimers() {
    storyTransitionTimers.current.forEach((timer) => window.clearTimeout(timer));
    storyTransitionTimers.current = [];
  }

  function transitionToStory(targetIndex: number, axis: StoryTransitionAxis = "horizontal") {
    if (!rankedStories.length || storyTransitionLocked.current) return false;

    const boundedIndex = Math.max(0, Math.min(rankedStories.length - 1, targetIndex));
    if (boundedIndex === selectedIndex) return false;

    // The comment sheet belongs to the boks being left; the controls belong to
    // the reader, and moving to the next boks is not a reason to take them away.
    setCommentOpen(false);
    const direction: ReaderNavigationDirection = boundedIndex < selectedIndex ? "previous" : "next";

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSelectedIndex(boundedIndex);
      return true;
    }

    clearStoryTransitionTimers();
    storyTransitionLocked.current = true;
    // Replace the story immediately, then let the new page settle. Waiting for
    // an exit animation made the gesture feel ignored and the eventual change
    // feel like a short jump rather than one continuous response.
    setSelectedIndex(boundedIndex);
    setStoryTransition({ phase: "entering", direction, axis });

    const transitionTimer = window.setTimeout(() => {
      storyTransitionLocked.current = false;
      setStoryTransition({ phase: "idle", direction: null, axis: null });
      storyTransitionTimers.current = [];
    }, storyTransitionDurationMs);
    storyTransitionTimers.current.push(transitionTimer);
    return true;
  }

  function move(delta: number, axis: StoryTransitionAxis = "horizontal") {
    formatFromSeries.current = false;
    return transitionToStory(selectedIndex + delta, axis);
  }

  function previousStory(
    reason: "swipe" | "button" | "keyboard" = "swipe",
    axis: StoryTransitionAxis = "horizontal"
  ) {
    if (storyTransitionLocked.current) return;
    if (selectedIndex <= 0) {
      revealReaderChrome(2400);
      return;
    }
    recordReadingOutcome(reason);
    haptic("selection");
    move(-1, axis);
  }

  function navigateStory(
    direction: ReaderNavigationDirection,
    reason: "swipe" | "button" | "keyboard" = "swipe",
    axis: StoryTransitionAxis = "horizontal"
  ) {
    if (direction === "previous") previousStory(reason, axis);
    else void nextStory(reason, axis);
  }

  /** "Try again" on a feed that failed: the feed, and the account if it never loaded. */
  async function retryFeed() {
    try {
      await loadFeed();
      if (!user) await adoptIdentity();
    } catch (error) {
      notify(readableBoksError(error, wordsNow().couldNotLoad));
    }
  }

  function openAccount(reason: "manual" | "notice" | "required" = "manual", intent: AuthIntent = "general", section?: "home" | "typography" | "languages" | "feedback") {
    // The moment a guest meets the sign-up, and why - the limit, a like, a
    // follow, a comment, the notice, or their own tap on the account button.
    // An account holder opening Settings is not a sign-up prompt.
    if (!hasSignedInAccount) {
      recordJourneyEvent(
        { event: "signup_prompt", reason: signupReason({ reason, intent }) },
        { visitorId: visitorId.current, sessionId: sessionId.current }
      );
    }
    setAuthReason(reason);
    setAuthInitialSection(section);
    setAuthIntent(intent);
    setAuthNotice("");
    setAuthPanelOpen(true);
    setGuestNoticeStep(null);
    revealReaderChrome(0);
  }

  /**
   * Opens a boks the reader chose. `entry` says how, and goes on its events -
   * see `entryRef`. The boks already on screen is simply shown from the top:
   * it already has its impression for this session.
   */
  async function openReadBoks(storyId: string, entry: ReaderEntry): Promise<boolean> {
    const request = ++storyOpenRequest.current;
    setOpenIssue(null);
    if (currentStoryId === storyId) {
      formatFromSeries.current = entry === "series";
      entryRef.current = { storyId, entry, arrived: true };
      if (storyScroll.current) storyScroll.current.scrollTop = 0;
      setAuthPanelOpen(false);
      hideReaderChrome();
      return true;
    }

    // Always fetched and resolved by id in the pending effect, against the
    // ranking as it is when the effect runs. This used to jump to an index
    // into this closure's ranking when the boks was already in it - but a
    // shared link is opened straight after the page's second feed request,
    // before that feed has rendered, and the index taken from the first feed
    // pointed at a different boks once the second landed. If the feed has the
    // boks too, the feed's copy wins in `rankedStories`.

    try {
      const loaded = await loadSupabaseStory(storyId);
      if (request !== storyOpenRequest.current) return false;
      if (!loaded) {
        setAuthPanelOpen(false);
        setOpenIssue({ kind: "unavailable", storyId, entry });
        return false;
      }

      const { story, likedByMe } = loaded;
      if (currentStoryRef.current && currentStoryRef.current.id !== story.id) recordOutcomeRef.current("button");
      formatFromSeries.current = entry === "series";
      entryRef.current = { storyId: story.id, entry, arrived: false };
      setLiked((state) => ({ ...state, [story.id]: likedByMe }));
      setLibraryEntry({ story, index: selectedIndex });
      setPendingLibraryStoryId(story.id);
      return true;
    } catch {
      if (request !== storyOpenRequest.current) return false;
      setAuthPanelOpen(false);
      setOpenIssue({ kind: "story", storyId, entry });
      return false;
    }
  }

  /** Read on the client: the browser's languages are not known on the server. */
  function refreshSeriesContext() {
    setSeriesContext(seriesContextFor(readingLanguagesRef.current));
  }

  /**
   * Opens a piece in the format it was made for: a registered poem in the
   * poetry player, anything else in the cinema. The piece decides, never the
   * reader - the same rule the rail button has always followed.
   */
  function openReadingFormat(storyId: string) {
    setOpenIssue(null);
    setFormatEnded(false);
    const request = ++formatRequest.current;
    // A format is reading too, so a guest who has used up their free boks
    // meets the same gate here as in the feed - it used to play over it.
    if (
      isGuestReader &&
      getAnonymousBoksReadCount() >= anonymousReadLimits.requiredSignup &&
      !readAnonymousReadState().storyIds.includes(storyId)
    ) {
      setSeriesOpening(null);
      closedFormat();
      openAccount("required");
      return;
    }
    // Either renderer brings its own voice. Silence the reading music without
    // forgetting the choice, so it returns after - see `closedFormat`.
    if (musicOn) musicPausedForFormat.current = true;
    stopReadingMusic(false);
    setMusicOn(false);
    setFormatPlaying(false);
    setFormatLoading(true);
    // Now, before the manifest loads: the tap that opened the format is what
    // lets a browser hand over the whole screen.
    if (takeScreen()) formatTookScreen.current = true;
    const manifestUrl = poemManifestFor(storyId);
    formatUsed.current = { storyId, format: manifestUrl ? "poem" : "cinema" };
    if (manifestUrl) {
      loadPoemManifest(manifestUrl)
        .then((manifest) => { if (request === formatRequest.current) setPoem(manifest); }, () => {
          if (request !== formatRequest.current) return;
          setOpenIssue({ kind: "audio", storyId });
          closedFormat();
        })
        .finally(() => { if (request === formatRequest.current) { setSeriesOpening(null); setFormatLoading(false); } });
      return;
    }
    setCinemaOpen(true);
    setFormatLoading(false);
    setSeriesOpening(null);
  }

  function openSeries() {
    flushAftertaste();
    refreshSeriesContext();
    rememberSeenSeries(seriesStoryIds);
    setSeriesIsNew(false);
    setCommentOpen(false);
    setBokMenuOpen(false);
    setAuthorSheet(null);
    setSeriesOpen(true);
    if (window.location.pathname !== "/series") {
      window.history.pushState({ boksView: "series" }, "", "/series");
    }
  }

  function openFeed(clearSeriesOrigin = true) {
    if (clearSeriesOrigin) {
      formatFromSeries.current = false;
      formatRequest.current += 1; storyOpenRequest.current += 1;
      pendingSeriesFormat.current = null;
      setFormatLoading(false); setSeriesOpening(null); setOpenIssue(null);
    }
    setSeriesOpen(false);
    if (window.location.pathname === "/series") {
      // Back to where the shelf was opened from, when it was opened here;
      // a page that landed on /series has nothing behind it to go back to.
      // Read text stays in this reader instance. Traversing history lets the
      // app router remount it, discarding the chosen bok and its audio place.
      if (!clearSeriesOrigin) window.history.replaceState(null, "", "/");
      else if (window.history.state?.boksView === "series") window.history.back();
      else window.history.replaceState(null, "", "/");
    }
  }

  async function openSeriesPiece(piece: SeriesPiece, continueSequence = false) {
    if (seriesOpening) return;
    // Heard marks may reorder the live shelf at an ending. Keep the actual
    // order chosen when this Series reading started, without wrapping.
    if (!continueSequence) setSeriesSequence(publishedSeriesPieces);
    formatFromSeries.current = true;
    if (currentStoryId === piece.storyId) {
      entryRef.current = { storyId: piece.storyId, entry: "series", arrived: true };
      openReadingFormat(piece.storyId);
      return;
    }
    // The screen is asked for on the tap, not when the feed has landed: by
    // then the gesture that allows it may have gone stale.
    if (takeScreen()) formatTookScreen.current = true;
    setSeriesOpening(piece.storyId);
    pendingSeriesFormat.current = piece.storyId;
    const found = await openReadBoks(piece.storyId, "series");
    if (!found) {
      pendingSeriesFormat.current = null;
      setSeriesOpening(null);
      closedFormat();
    }
  }


  function measureText() {
    const viewport = storyScroll.current;
    const body = textRegion.current;
    if (!viewport || !body) return { phase: "cover" as const, progress: 0, scrollable: false };
    return textReadingState({ top: body.getBoundingClientRect().top - viewport.getBoundingClientRect().top, height: body.offsetHeight, viewport: viewport.clientHeight });
  }
  function isStoryScrollable() {
    // Listening uses real playback progress and the same time threshold.
    return formatUsed.current?.storyId === currentStory?.id || measureText().scrollable;
  }
  function updateStoryProgress() {
    if (!currentStory) return 0;
    if (formatOnScreen) return storyProgress.current[currentStory.id] ?? 0;
    const measured = measureText();
    const existing = storyProgress.current[currentStory.id] ?? 0;
    storyProgress.current[currentStory.id] = Math.max(existing, measured.progress);
    return storyProgress.current[currentStory.id];
  }
  function readText(fromStart = false) {
    formatRequest.current += 1;
    setFormatLoading(false); setSeriesOpening(null); setOpenIssue(null);
    closedFormat();
    setCinemaOpen(false); setPoem(null); setFormatPlaying(false);
    if (seriesOpen) openFeed(false);
    requestAnimationFrame(() => {
      const viewport = storyScroll.current;
      const body = textRegion.current;
      if (viewport && body && (fromStart || body.getBoundingClientRect().top >= viewport.getBoundingClientRect().bottom || body.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().top + 80)) viewport.scrollTo({ top: viewport.scrollTop + (body.closest(".reader-content") ?? body).getBoundingClientRect().top - viewport.getBoundingClientRect().top, behavior: "instant" });
      setReadingPhase("reading");
    });
  }
  function onFormatPlayback(state: { playing: boolean; progress: number; ended: boolean }) {
    if (currentStory) storyProgress.current[currentStory.id] = Math.max(storyProgress.current[currentStory.id] ?? 0, state.progress);
    setFormatPlaying(state.playing && !state.ended);
    setFormatEnded(state.ended);
  }

  useEffect(() => {
    const viewport = storyScroll.current;
    const body = textRegion.current;
    if (!viewport || !body) return;
    const measure = () => {
      if (formatOnScreen) return;
      const reading = textReadingState({ top: body.getBoundingClientRect().top - viewport.getBoundingClientRect().top, height: body.offsetHeight, viewport: viewport.clientHeight });
      setReadingPhase(reading.phase); setTextProgress(reading.progress);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport); observer.observe(body);
    const frame = requestAnimationFrame(measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [currentStoryId, formatOnScreen]);

  // Keep the exit and heartbeat handlers pointing at the current closures
  // without re-binding listeners, which must survive the reading session.
  useEffect(() => {
    recordOutcomeRef.current = recordReadingOutcome;
    openReadBoksRef.current = openReadBoks;
    currentStoryRef.current = currentStory ?? null;
    catalogContextRef.current = {
      // The published catalog, as counted by the server that ranked it - not
      // the slate length, which is capped by the feed limit.
      catalogSize: provenanceRef.current.catalogSize || rankedStories.length,
      unseenCount: rankedStories.filter((story) => !profile.completed.includes(story.id)).length,
    };
    recordHeartbeatRef.current = (story) => {
      updateStoryProgress();
      recordReaderEvent("heartbeat", story);
    };
    // Once per bok and session - the queue drops the rest - so this can be
    // called on every touch without counting them.
    recordTouchRef.current = (kind) => {
      const story = currentStoryRef.current;
      if (story) recordReaderEvent("touch", story, 1, { kind });
    };
  });

  /*
   * Did the reader touch the bok at all?
   *
   * On the window, in the capture phase, so every hand on the page counts -
   * the text, the controls, an immersive poem over the feed - and nothing the
   * reader's own handlers do (stopping propagation, changing bok) can hide it.
   * A press is classified when it is let go, while the bok it began on is
   * still the current one.
   */
  useEffect(() => {
    let down: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (!down) return;
      recordTouchRef.current(touchKind(event.clientX - down.x, event.clientY - down.y));
      down = null;
    };
    let cancelled = 0;
    const onCancel = () => {
      // A cancelled press is the browser taking over a gesture. When it is
      // scrolling the text the scroll handler says so first; give it the
      // moment to, so a reader is not counted as swiping who was reading.
      if (down) cancelled = window.setTimeout(() => recordTouchRef.current("swipe"), 300);
      down = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey && !event.altKey) recordTouchRef.current("key");
    };
    const options = { capture: true, passive: true };
    window.addEventListener("pointerdown", onDown, options);
    window.addEventListener("pointerup", onUp, options);
    window.addEventListener("pointercancel", onCancel, options);
    window.addEventListener("keydown", onKey, options);
    return () => {
      window.removeEventListener("pointerdown", onDown, options);
      window.removeEventListener("pointerup", onUp, options);
      window.removeEventListener("pointercancel", onCancel, options);
      window.removeEventListener("keydown", onKey, options);
      window.clearTimeout(cancelled);
    };
  }, []);

  function recordReadingOutcome(reason: ReadOutcomeReason) {
    flushAftertaste(reason === "exit");
    if (!currentStory || !exposedStories.current.has(currentStory.id)) return;
    const key = `${sessionId.current}:${currentStory.id}`;
    if (trackedOutcomes.current.has(key)) return;

    trackedOutcomes.current.add(key);
    const elapsedSeconds = readingClock.current.activeSeconds();
    const progress = updateStoryProgress();
    const outcome = inferReadOutcome(currentStory, elapsedSeconds, progress, {
      // A bok that fits the screen never scrolls, and the outcome has to judge
      // it on attention alone rather than on a progress that cannot move.
      scrollable: isStoryScrollable(),
    });

    const judged = currentStory;
    updateProfile((current) => profileBump(current, judged, outcome));

    // A bok actually read is the only thing that moves the feedback count, and
    // the prompt waits for the third, tenth and thirtieth. Asking here rather
    // than on a timer means the question always follows a finished piece.
    if (outcome === "complete") {
      const counted = countRead(feedbackState.current);
      const milestone = dueMilestone(counted);
      feedbackState.current = milestone ? markPrompted(counted, milestone) : counted;
      saveFeedbackState(feedbackState.current);
      if (milestone) setFeedbackMilestone(milestone);
    }
    recordReaderEvent(outcome, currentStory, outcome === "complete" ? Math.max(5, elapsedSeconds) : 1, {
      from: reason,
      inferred: true,
      progress: Math.round(progress * 100) / 100,
      genre: currentStory.genre,
      mood: currentStory.mood,
    });
  }

  async function nextStory(
    reason: "swipe" | "button" | "keyboard" = "swipe",
    axis: StoryTransitionAxis = "horizontal"
  ) {
    if (storyTransitionLocked.current) return;
    if (selectedIndex >= rankedStories.length - 1) {
      revealReaderChrome(2400);
      if (isSupabaseReader && !feedExhausted.current) {
        notify(wordsNow().findingMore);
        void loadMoreFeed();
      } else {
        notify(wordsNow().everything);
      }
      return;
    }
    recordReadingOutcome(reason);
    if (isGuestReader && getAnonymousBoksReadCount() >= anonymousReadLimits.requiredSignup) {
      openAccount("required");
      return;
    }
    haptic("selection");
    move(1, axis);
  }

  /**
   * Applies a language filter and reloads. Stored on the account when there is
   * one, and always remembered locally so a guest keeps their choice.
   */
  async function applyReadingLanguages(languages: readonly string[]) {
    const next = normalizeReadingLanguages(languages);
    readingLanguagesRef.current = next;
    rememberReadingLanguages(next);
    setSeriesContext(seriesContextFor(next));

    try {
      if (hasSignedInAccount) {
        await setMyReadingLanguages(next);
        setUser(await loadBoksUserContext());
      }
      await reloadFeedReleasing();
    } catch (error) {
      notify(readableBoksError(error, wordsNow().languagesFailed));
    }
  }

  function openBokMenu() {
    setCommentOpen(false);
    setBokMenuOpen(true);
    revealReaderChrome(0);
  }

  /** Closing forgets the thank-you, so the next milestone opens asking again. */
  function closeFeedbackSheet() {
    setFeedbackMilestone(null);
    setFeedbackSent(false);
  }

  async function copyBokLink() {
    if (!currentStory) return;
    const url = `${window.location.origin}/b/${currentStory.id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify(wordsNow().linkCopied);
    } catch {
      notify(url);
    }
  }

  async function reportCurrentBok(kind: BokReportKind, reason: string): Promise<BokReportOutcome | null> {
    if (!currentStory) return null;
    if (accountSuspended) {
      showSuspension();
      return null;
    }

    setStatus("");
    const result = await reportBok({ reelId: currentStory.id, reason, kind });
    return result.status;
  }

  async function likeStory() {
    if (!currentStory) return;
    if (accountSuspended) {
      showSuspension();
      return;
    }
    if (!hasSignedInAccount) {
      setCommentOpen(false);
      openAccount("manual", "like");
      return;
    }

    // One write per boks at a time: a quick second tap used to race an
    // insert against a delete, and whichever landed last won.
    const story = currentStory;
    if (likesInFlight.current.has(story.id)) return;
    likesInFlight.current.add(story.id);

    const nextLiked = !isCurrentStoryLiked;
    if (nextLiked) haptic("confirm");
    setLiked((state) => ({ ...state, [story.id]: nextLiked }));

    try {
      if (isSupabaseReader) {
        await setSupabaseLike(supabaseUserId, story.id, nextLiked);
      }
    } catch (error) {
      // Rolled back only when the write itself failed. It used to be rolled
      // back when the feed reload after it failed too, which showed a saved
      // like as not liked for the rest of the visit.
      setLiked((state) => ({ ...state, [story.id]: !nextLiked }));
      notify(readableBoksError(error, wordsNow().likeFailed));
      return;
    } finally {
      likesInFlight.current.delete(story.id);
    }

    if (nextLiked) {
      recordReaderEvent("like", story);
      updateProfile((current) => profileBump(current, story, "like"));
    }
    // No feed reload. The count and the heart are already right locally
    // (`displayedLikeCount`), and reloading 80 boks for one tap was most of
    // the Worker's CPU and the database's load; the next feed ranks with it.
  }

  /**
   * Opening an author closes whatever else was covering the reading.
   *
   * `authorName` narrows it to one writer. The two taps on a byline mean
   * different things: the name is the writer, the @handle is the account that
   * published them. A publisher's catalogue has one account and many writers,
   * and sending both taps to the account answered "more by this writer" with
   * an alphabetical dump of everything the account had ever published.
   */
  function openAuthor(handle: string, authorName?: string) {
    if (!handle) return;
    setCommentOpen(false);
    setBokMenuOpen(false);
    setAuthorSheet({ handle: bareHandle(handle), authorName });
    revealReaderChrome(0);
  }

  function shareStory() { setShareOpen(true); }

  function adjustCommentCount(story: Story, change: number) {
    setCommentCountDeltas((current) => {
      const previous = current[story.id];
      const base = story.commentsCount;
      const added = (previous && previous.base === base ? previous.added : 0) + change;
      return { ...current, [story.id]: { base, added } };
    });
  }

  async function submitComment(body: string, parentCommentId: number | null): Promise<Comment> {
    if (!currentStory) throw new Error(wordsNow().noLongerOpen);
    if (accountSuspended) {
      showSuspension();
      throw new Error(user?.banReason || wordsNow().suspended);
    }
    if (!hasSignedInAccount) {
      openAccount("manual", "comment");
      throw new Error(wordsNow().joinConversation);
    }

    if (!isSupabaseReader) throw new Error(wordsNow().commentsUnavailable);
    const created = await submitSupabaseComment(currentStory.id, body, parentCommentId);

    recordReaderEvent("comment", currentStory);
    adjustCommentCount(currentStory, 1);
    return created;
  }

  /**
   * The account panel reports a changed account: today that is a saved
   * nickname or a sign-out. It used to close the panel on any signed-in user,
   * which meant saving a nickname made the whole panel vanish before the
   * reader could see it had worked - it read as "nothing happened". Sign-in
   * does not arrive through here at all: it lands as an auth state change
   * after the email link, so there is nothing this needs to dismiss.
   */
  const handleUserChanged = useCallback((nextUser: BoksUserContext | null) => {
    setUser(nextUser);
    // Signing in or out is also an answer about who this is.
    setIdentitySettled(true);
    if (nextUser && !nextUser.isAnonymous) setAuthReason("manual");
    // No feed reload: a saved nickname does not change what to read, sign-out
    // reloads the page, and a sign-in arrives as an auth state change.
  }, []);

  /**
   * Languages changed in Settings (already saved there).
   *
   * Turning a language *off* is a new feed, from its first boks: what is on
   * screen, and much of what is queued behind it, may be in a language the
   * reader has just said they do not read.
   *
   * Turning one *on* is not. Nothing on the feed has stopped being readable,
   * so rebuilding it only threw the reader out of the piece they were in the
   * middle of - https://github.com/IvanCherep/boks/issues/5. The feed extends
   * itself as the reader approaches its end (`loadMoreFeed`) and reads the
   * filter from this same ref, so the new language arrives on its own; the
   * exhausted flag is cleared because there is more to fetch than there was.
   */
  const adoptReadingLanguages = useCallback(
    (languages: readonly string[]) => {
      const previous = readingLanguagesRef.current;
      const next = normalizeReadingLanguages(languages);
      readingLanguagesRef.current = next;
      // The shelf follows the same setting as the feed.
      setSeriesContext(seriesContextFor(next));

      if (readingLanguageChangeKeepsFeed(previous, next)) {
        feedExhausted.current = false;
        return;
      }

      reloadFeedReleasing().catch((error) =>
        notify(readableBoksError(error, wordsNow().feedLanguagesFailed))
      );
    },
    [notify, reloadFeedReleasing]
  );

  function clearBoundaryPull(immediate = false) {
    pullArmed.current = false;
    if (boundaryPullResetTimer.current !== null) {
      window.clearTimeout(boundaryPullResetTimer.current);
      boundaryPullResetTimer.current = null;
    }
    if (immediate) {
      setBoundaryPull(null);
      return;
    }
    setBoundaryPull((current) => current ? { ...current, progress: 0 } : null);
    boundaryPullResetTimer.current = window.setTimeout(() => {
      setBoundaryPull(null);
      boundaryPullResetTimer.current = null;
    }, 180);
  }

  function showBoundaryPull(next: BoundaryPullState) {
    if (boundaryPullResetTimer.current !== null) {
      window.clearTimeout(boundaryPullResetTimer.current);
      boundaryPullResetTimer.current = null;
    }
    if (next.direction === "previous" && selectedIndex === 0) { clearBoundaryPull(true); return; }
    // One tick at the moment letting go would change bok, so the commitment is
    // felt as well as seen - and one tick only, not one per touchmove.
    const armed = next.progress >= 1;
    if (armed && !pullArmed.current) haptic("selection");
    pullArmed.current = armed;
    setBoundaryPull(next);
  }

  function armWheelBoundary() {
    const element = storyScroll.current;
    if (!element) return;
    const boundary = getScrollBoundary(element);
    wheelBoundaryArmed.current = {
      previous: boundary.atTop,
      next: boundary.atBottom,
    };
    wheelIdleTimer.current = null;
  }

  function scheduleWheelBoundaryArm() {
    if (wheelIdleTimer.current !== null) window.clearTimeout(wheelIdleTimer.current);
    wheelIdleTimer.current = window.setTimeout(armWheelBoundary, 700);
  }

  function gestureStart(x: number, y: number): GestureStart {
    const boundary = storyScroll.current
      ? getScrollBoundary(storyScroll.current)
      : { atTop: true, atBottom: true };
    const now = performance.now();
    return { x, y, ...boundary, at: now, msSinceScroll: now - lastScrollAt.current };
  }

  /** Mirrors a boundary pull on screen, or takes the cue away if it retreated. */
  function followBoundaryPull(dx: number, dy: number, start: GestureStart) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      clearBoundaryPull();
      return;
    }
    const pull = verticalBoundaryPull(dy, start, touchBoundaryPullThreshold, touchBoundaryPullDeadZone);
    if (pull) showBoundaryPull(pull);
    else clearBoundaryPull();
  }

  function onTouchStart(event: React.TouchEvent<HTMLElement>) {
    if (readerInteractionBlocked) {
      touchStart.current = null;
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='dialog']")) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStart.current = gestureStart(touch.clientX, touch.clientY);
  }

  function onTouchMove(event: React.TouchEvent<HTMLElement>) {
    const start = touchStart.current;
    if (!start || readerInteractionBlocked) return;
    const touch = event.touches[0];
    followBoundaryPull(touch.clientX - start.x, touch.clientY - start.y, start);
  }

  function onTouchEnd(event: React.TouchEvent<HTMLElement>) {
    if (readerInteractionBlocked) {
      touchStart.current = null;
      return;
    }
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    touchStart.current = null;

    const horizontal = horizontalNavigationIntent(dx, dy);
    const vertical = verticalBoundaryIntent(dy, start, touchBoundaryPullThreshold, touchBoundaryPullDeadZone);
    clearBoundaryPull(Boolean(horizontal || vertical));
    if (horizontal) {
      navigateStory(horizontal, "swipe", "horizontal");
      return;
    }
    if (vertical) {
      navigateStory(vertical, "swipe", "vertical");
      return;
    }

    // A tap. There used to be no branch for this at all on a phone - the
    // touch handler looked only for swipes and the pointer handler returns for
    // touch - so the one way to ask for the controls did nothing.
    const tap = readerTapAction({
      dx,
      dy,
      durationMs: performance.now() - start.at,
      msSinceScroll: start.msSinceScroll,
    });
    if (tap && !window.getSelection()?.toString()) toggleReaderChrome();
  }

  function onTouchCancel() {
    touchStart.current = null;
    clearBoundaryPull();
  }

  function onReaderPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (readerInteractionBlocked) {
      pointerStart.current = null;
      return;
    }
    if (event.pointerType === "touch") return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='dialog']")) return;
    pointerStart.current = gestureStart(event.clientX, event.clientY);
  }

  function onReaderPointerMove(event: React.PointerEvent<HTMLElement>) {
    const start = pointerStart.current;
    if (!start || event.pointerType === "touch" || readerInteractionBlocked) return;
    followBoundaryPull(event.clientX - start.x, event.clientY - start.y, start);
  }

  function onReaderPointerCancel() {
    pointerStart.current = null;
    clearBoundaryPull();
  }

  function onReaderPointerUp(event: React.PointerEvent<HTMLElement>) {
    if (readerInteractionBlocked) {
      pointerStart.current = null;
      return;
    }
    if (event.pointerType === "touch") return;
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;

    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='dialog']")) return;

    // A mouse dragged across the text is selecting it - to copy a line - not
    // swiping. The check used to come after the swipe and pull were worked
    // out, so selecting a quote turned the page and recorded a skip.
    if (window.getSelection()?.toString()) {
      clearBoundaryPull();
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const horizontal = horizontalNavigationIntent(dx, dy);
    const vertical = verticalBoundaryIntent(dy, start, touchBoundaryPullThreshold, touchBoundaryPullDeadZone);
    clearBoundaryPull(Boolean(horizontal || vertical));
    if (horizontal) {
      navigateStory(horizontal, "swipe", "horizontal");
      return;
    }
    if (vertical) {
      navigateStory(vertical, "swipe", "vertical");
      return;
    }

    // A click asks for the controls and nothing else. It used to turn the page
    // when it landed in the outer quarter - see `readerTapAction`.
    const tap = readerTapAction({
      dx,
      dy,
      durationMs: performance.now() - start.at,
      msSinceScroll: start.msSinceScroll,
    });
    if (tap && !window.getSelection()?.toString()) toggleReaderChrome();
  }

  function onStoryWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (readerInteractionBlocked) return;
    const now = performance.now();
    if (now - lastWheelNavigationAt.current < 700) return;
    const currentBoundary = storyScroll.current
      ? getScrollBoundary(storyScroll.current)
      : { atTop: true, atBottom: true };
    // Trackpad momentum often pauses for 300-400 ms while one physical swipe
    // is still decelerating. Treat only a longer pause as a new boundary pull,
    // otherwise the reading scroll itself can accidentally advance the feed.
    if (now - wheelTravel.current.lastAt > 520) {
      wheelTravel.current = {
        x: 0,
        y: 0,
        lastAt: now,
        ...currentBoundary,
        allowPrevious: currentBoundary.atTop && wheelBoundaryArmed.current.previous,
        allowNext: currentBoundary.atBottom && wheelBoundaryArmed.current.next,
      };
      wheelBoundaryArmed.current = { previous: false, next: false };
      clearBoundaryPull(true);
    }
    scheduleWheelBoundaryArm();

    wheelTravel.current.x += event.deltaX;
    wheelTravel.current.y += event.deltaY;
    wheelTravel.current.lastAt = now;

    const horizontal = horizontalWheelIntent(wheelTravel.current.x, wheelTravel.current.y);
    if (horizontal) {
      cancelWheelRelease();
      lastWheelNavigationAt.current = now;
      wheelTravel.current = {
        x: 0,
        y: 0,
        lastAt: now,
        atTop: false,
        atBottom: false,
        allowPrevious: false,
        allowNext: false,
      };
      clearBoundaryPull(true);
      navigateStory(horizontal, "swipe", "horizontal");
      return;
    }

    const pull = verticalBoundaryPull(
      -wheelTravel.current.y,
      { atTop: wheelTravel.current.atTop, atBottom: wheelTravel.current.atBottom },
      wheelBoundaryPullThreshold,
      wheelBoundaryPullDeadZone
    );
    const boundaryWasArmed = pull
      ? pull.direction === "next"
        ? wheelTravel.current.allowNext
        : wheelTravel.current.allowPrevious
      : false;
    if (!pull || !boundaryWasArmed || Math.abs(wheelTravel.current.y) <= Math.abs(wheelTravel.current.x)) {
      // Scrolled back, or never a boundary pull: an armed pull is let go.
      cancelWheelRelease();
      return;
    }

    showBoundaryPull(pull);
    if (pull.progress < 1) {
      cancelWheelRelease();
      boundaryPullResetTimer.current = window.setTimeout(() => {
        clearBoundaryPull();
      }, 560);
      return;
    }

    // Armed. It used to change bok right here, the instant the travel filled -
    // which on a trackpad is a fraction of a second into a flick, so the cue
    // vanished before anyone saw it. Now it commits when the wheel goes quiet,
    // the wheel's version of letting go, and never before the armed cue has
    // been on screen long enough to read.
    if (wheelArmedAt.current === null) wheelArmedAt.current = now;
    if (wheelReleaseTimer.current !== null) window.clearTimeout(wheelReleaseTimer.current);
    const direction = pull.direction;
    const wait = Math.max(wheelReleaseMs, wheelArmedMinMs - (now - wheelArmedAt.current));
    wheelReleaseTimer.current = window.setTimeout(() => commitWheelPull(direction), wait);
  }

  function cancelWheelRelease() {
    if (wheelReleaseTimer.current !== null) window.clearTimeout(wheelReleaseTimer.current);
    wheelReleaseTimer.current = null;
    wheelArmedAt.current = null;
  }

  function commitWheelPull(direction: ReaderNavigationDirection) {
    const now = performance.now();
    wheelReleaseTimer.current = null;
    wheelArmedAt.current = null;
    lastWheelNavigationAt.current = now;
    wheelTravel.current = {
      x: 0,
      y: 0,
      lastAt: now,
      atTop: false,
      atBottom: false,
      allowPrevious: false,
      allowNext: false,
    };
    clearBoundaryPull(true);
    navigateStory(direction, "swipe", "vertical");
  }

  function onStoryScroll() {
    lastScrollAt.current = performance.now();
    // A pull at the edge can make the page bounce, and a bounce fires scroll
    // events. Clearing the cue on every one of them is what made it flicker
    // away in the middle of a pull - "sometimes it just isn't there". It goes
    // only if the text has really left the edge the pull started from.
    const element = storyScroll.current;
    if (element) {
      const boundary = getScrollBoundary(element);
      setBoundaryPull((pull) => {
        if (!pull) return pull;
        const stillAtEdge = pull.direction === "next" ? boundary.atBottom : boundary.atTop;
        if (!stillAtEdge) pullArmed.current = false;
        return stillAtEdge ? pull : null;
      });
    }
    updateStoryProgress();
    // A bok arrives at the top, so only a reader moves it this far.
    if (element && element.scrollTop > 24) recordTouchRef.current("scroll");
    const measured = measureText();
    setReadingPhase(measured.phase);
    setTextProgress(measured.progress);
    // Scrolling is reading. It puts the controls away and never brings them up.
    hideReaderChrome();
    updateStoryOverflow();
  }

  /**
   * Is there more text below the fold?
   *
   * Drives a soft fade at the bottom edge. Without it the last visible line is
   * sliced in half by the container, which reads as a rendering fault rather
   * than as "keep going" - and it is the one abrupt edge on an otherwise calm
   * page. The fade is removed at the end of the text so the final line is never
   * dimmed.
   */
  function updateStoryOverflow() {
    const element = storyScroll.current;
    if (!element) return;
    const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
    setStoryHasMore(remaining > 12);
  }

  const issueTitle = openIssue?.kind === "unavailable" ? t("Bok unavailable.", "Бок недоступен.") : openIssue?.kind === "audio" ? t("Audio unavailable", "Аудио недоступно") : t("Couldn’t load the bok.", "Не удалось загрузить бок.");
  const openIssuePanel = openIssue && <ReaderSheet label={issueTitle} onClose={() => setOpenIssue(null)} className="reader-system-dialog">
    <div className="reader-system-page__body">
      <header className="reader-system-page__header"><button type="button" aria-label={t("Back", "Назад")} onClick={() => setOpenIssue(null)}><ReaderBackIcon size={21} /></button><span>{openIssue.kind === "unavailable" ? t("Shared bok", "Ссылка на бок") : t("Connection error", "Ошибка соединения")}</span><span /></header>
      {openIssue.kind === "unavailable" ? <div className="reader-system-missing" aria-hidden="true"><span>b.</span><i /></div> : <div className="reader-system-art reader-system-art--offline" aria-hidden="true">·<i>—</i>·</div>}
      <h1 className="reader-system-title">{openIssue.kind === "unavailable" ? <>{t("Bok", "Бок")}<br />{t("unavailable.", "недоступен.")}</> : issueTitle}</h1>
    <div className="reader-system-actions">
      <p className="text-sm text-[var(--muted-foreground)]">{openIssue.kind === "unavailable" ? t("It may have been removed or is no longer published. You can keep reading from your feed.", "Возможно, его удалили или сняли с публикации. Вы можете продолжить чтение в ленте.") : t("Check your connection and try again.", "Проверьте соединение и попробуйте снова.")}</p>
      {openIssue.kind !== "unavailable" && <Button className="w-full" onClick={() => {
        const issue = openIssue;
        if (issue.kind === "audio") openReadingFormat(issue.storyId);
        else if (issue.entry === "series" && seriesPieceFor(issue.storyId)) void openSeriesPiece(seriesPieceFor(issue.storyId)!);
        else void openReadBoks(issue.storyId, issue.entry);
      }}>{t("Try again", "Попробовать снова")}</Button>}
      {openIssue.kind === "audio" && <Button className="w-full" variant="secondary" onClick={() => readText()}>{t("Read text", "Читать текст")}</Button>}
      <Button className="w-full" variant={openIssue.kind === "unavailable" ? "default" : "ghost"} onClick={() => { setOpenIssue(null); openFeed(); }}>{openIssue.kind === "unavailable" ? t("Open another bok", "Открыть другой бок") : t("Back to the feed", "Вернуться в ленту")}</Button>
      {openIssue.kind === "unavailable" && <Button variant="ghost" onClick={() => { setOpenIssue(null); openAccount("manual", "general", "feedback"); }}>{t("Report a broken link", "Сообщить о нерабочей ссылке")}</Button>}
    </div>
    </div>
  </ReaderSheet>;

  const accountPanel = (
        <UserAuthPanel
          open={authPanelOpen}
          intent={authIntent}
          initialSection={authInitialSection}
          reason={authReason}
          notice={authNotice}
          guestReadCount={guestReadCount}
          currentUser={user}
          onClose={() => setAuthPanelOpen(false)}
          onOpenReadBoks={async (storyId, openComments) => {
            // A boks from the library is read in the feed, so the shelf steps aside.
            if (seriesOpen) openFeed();
            const opened = await openReadBoks(storyId, "library");
            if (opened && openComments) setPendingCommentStoryId(storyId);
          }}
          onUserChanged={handleUserChanged}
          onReadingLanguagesChanged={adoptReadingLanguages}
          onOpenFeed={() => { setAuthPanelOpen(false); openFeed(); }}
          onOpenSeries={() => { setAuthPanelOpen(false); openSeries(); }}
        />
  );

  const authorPanel = authorSheet && (
    <AuthorSheet
      key={`${authorSheet.handle}|${authorSheet.authorName ?? ""}`}
      handle={authorSheet.handle}
      authorName={authorSheet.authorName}
      currentStoryId={currentStoryId}
      canFollow={hasSignedInAccount}
      onClose={() => setAuthorSheet(null)}
      onOpenWriter={(writer) => openAuthor(authorSheet.handle, writer)}
      onOpenAccount={authorSheet.authorName ? () => openAuthor(authorSheet.handle) : undefined}
      onOpenBok={(storyId) => {
        setAuthorSheet(null);
        void openReadBoks(storyId, "author");
      }}
      onRequestAccount={() => {
        setAuthorSheet(null);
        openAccount("manual", "follow");
      }}
    />
  );

  if (!currentStory && seriesOpen && seriesContext) {
    // The shelf does not wait for the feed: a reader who landed on /series
    // sees it while the feed is still on its way, or if it never arrives.
    return (
      <main className="reader-shell reader-v44 reader-viewport reader-shell--focus overflow-hidden text-[var(--foreground)]">
        <div style={{ display: "contents" }} inert={readerOverlayOpen || formatOnScreen}><SeriesView
          readerLanguages={seriesContext.readerLanguages}
          onPiecesChanged={setPublishedSeriesPieces}
          heard={seriesHeard}
          openingStoryId={seriesOpening}
          signedIn={hasSignedInAccount}
          onOpenPiece={(piece) => void openSeriesPiece(piece)}
          onOpenAccount={() => openAccount("manual", "general", "home")}
          onOpenLanguages={() => openAccount("manual", "general", "languages")}
        /></div>
        {!readerOverlayOpen && <ReaderTabs
          className="reader-tabs--pinned"
          active="series"
          seriesIsNew={false}
          onFeed={openFeed}
          onSeries={openSeries}
          onYou={() => openAccount("manual")}
        />}
        {authorPanel}
        {accountPanel}
        {openIssuePanel}
      </main>
    );
  }

  if (!currentStory) {
    return (
      <div className="reader-v44">
        <div style={{ display: "contents" }} inert={readerOverlayOpen}>
          <EmptyFeedScreen
            loading={phase === "loading"}
            notice={emptyFeedNotice({
              phase,
              message: status,
              languages: readingLanguagesRef.current,
              coverage: user?.languageCoverage,
              uiLanguage,
            })}
            onAddLanguages={(offer) => void applyReadingLanguages([...readingLanguagesRef.current, ...offer])}
            onChangeLanguages={() => openAccount("manual", "general", "languages")}
            onRetry={() => void retryFeed()}
          />
        </div>
        {!readerOverlayOpen && <ReaderTabs className="reader-tabs--pinned" active="feed" seriesIsNew={seriesIsNew} onFeed={openFeed} onSeries={openSeries} onYou={() => openAccount("manual")} />}
        {authorPanel}
        {accountPanel}
        {openIssuePanel}
      </div>
    );
  }

  return (
    <main
      style={{ ...bokCoverStyle(currentStory.id), ...bokArtworkStyle(currentStory.id) } as React.CSSProperties}
      className={`reader-shell reader-v44 reader-viewport reader-phase--${readingPhase} overflow-hidden text-[var(--foreground)] ${
        readerChromeVisible || commentOpen ? "reader-shell--chrome" : "reader-shell--focus"
      } ${guestNoticeVisible ? "reader-shell--notice" : ""} ${coverInspection ? "reader-shell--artwork" : ""}`}
    >
      <section
        className="relative mx-auto grid h-full min-w-0 w-full max-w-[1120px] grid-cols-1 overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onPointerDown={onReaderPointerDown}
        onPointerMove={onReaderPointerMove}
        onPointerUp={onReaderPointerUp}
        onPointerCancel={onReaderPointerCancel}
      >
        <article
          className="reader-card relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--reader)]"
          inert={readerInteractionBlocked ? true : undefined}
        >
          <header className="reader-topbar z-10 flex items-center justify-between px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-6">
            <button
              className="reader-account-trigger reader-ui"
              onClick={() => readingPhase === "cover" ? openAccount("manual", "general", "home") : storyScroll.current?.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label={readingPhase === "cover" ? t("Settings", "Настройки") : t("Back to cover", "К обложке")}
            >
              {readingPhase === "cover" ? <ReaderSettingsIcon className="size-5" /> : <ReaderBackIcon className="size-5" />}
            </button>
            <span className="reader-topbar__mark"><BoksLogo seasonal={readingPhase === "cover"} /></span>
            <div className="reader-topbar__tools reader-ui">
              {readingPhase !== "cover" && <button type="button" aria-label={t("Text settings", "Настройки текста")} onClick={() => openAccount("manual", "general", "typography")}><ReaderTypeIcon size={23} /></button>}
            <button type="button" className="reader-more reader-ui" onClick={openBokMenu} aria-label={t("More about this bok", "Об этом боке")}>
              <ReaderMoreIcon className="size-5" />
            </button>
            </div>
          </header>

          <div
            key={currentStory.id}
            ref={storyScroll}
            className={`story-scroll reader-story-stage min-h-0 min-w-0 overflow-y-auto px-6 pb-32 sm:px-10 sm:pb-16 lg:px-16 lg:pb-6 ${
              storyHasMore ? "story-scroll--more" : ""
            } ${
              storyTransition.phase === "idle"
                ? ""
                : `story-transition--${storyTransition.phase}-${storyTransition.direction} story-transition--${storyTransition.axis}`
            }`}
            onScroll={onStoryScroll}
            onWheel={onStoryWheel}
          >
            <div className="reader-cover" ref={coverRef}>
              <header className="reader-cover__desktop-bar">
                <button type="button" onClick={() => openAccount("manual", "general", "home")} aria-label={t("Settings", "Настройки")}><ReaderSettingsIcon size={23} /></button>
                <BoksLogo seasonal />
                <button type="button" onClick={openBokMenu} aria-label={t("More about this bok", "Об этом боке")}><ReaderMoreIcon size={23} /></button>
              </header>
              {getBokArtwork(currentStory) ? <CoverArtwork bokId={currentStory.id} artwork={getBokArtwork(currentStory)!} active={!readerInteractionBlocked && storyTransition.phase === "idle"} /> : <span className="reader-cover__letter" aria-hidden="true">{currentStory.title.charAt(0)}</span>}
              <CoverHeading artwork={getBokArtwork(currentStory)}>
                <h1>{currentStory.title}</h1>
                <button type="button" className="reader-cover__byline" onClick={() => openAuthor(currentStory.authorHandle, currentStory.authorName)} disabled={!currentStory.authorHandle}>{currentAuthorLabel}</button>
                {currentStory.summary && <p className="reader-cover__summary" lang={currentStory.language || "und"} translate="no">{currentStory.summary}</p>}
              </CoverHeading>
              <div className="reader-cover__caption">
                <div className="reader-cover__buttons">
                  <button type="button" className="reader-read-button" onClick={() => readText(true)}>{t("Read", "Читать")}<ReaderDownIcon size={19} /></button>
                  {currentSeriesPiece && <button type="button" className="reader-play-button" onClick={() => openReadingFormat(currentStory.id)}><ReaderPlayIcon size={18} />{t("Play", "Слушать")}</button>}
                </div>
                <button type="button" className="feed-swipe-hint" onClick={() => void nextStory("button")}>
                  <span>{selectedIndex > 0 ? t("Swipe between boks", "Листайте боки в обе стороны") : t("Swipe left for next bok", "Смахните влево к следующему боку")}</span>
                  <span className={`feed-swipe-gesture${selectedIndex > 0 ? " feed-swipe-gesture--both" : ""}`} aria-hidden="true"><i /><i /></span>
                </button>
              </div>
            </div>
            <div className="reader-content">
              <div className="reader-text-heading"><span className="reader-text-heading__eyebrow">boks</span><div className="reader-text-heading__desktop-tools"><span>{currentAuthorLabel}</span><button type="button" aria-label={t("Reading settings", "Настройки чтения")} onClick={() => openAccount("manual", "general", "typography")}><ReaderTypeIcon size={23} /></button></div><h2>{currentStory.title}</h2><button type="button" onClick={() => openAuthor(currentStory.authorHandle, currentStory.authorName)} disabled={!currentStory.authorHandle}>{currentAuthorLabel}</button></div>
              <div ref={textRegion} className={`story-copy${storyBlocks[0]?.kind !== "verse" ? " story-copy--prose" : ""}`} lang={currentStory.language || "und"} translate="no">
                {storyBlocks.map((block, index) => (
                  <p
                    key={`${currentStory.id}-${index}`}
                    className={block.kind === "verse" ? "story-verse" : ""}
                  >
                    {block.lines.join("\n")}
                  </p>
                ))}
              </div>
              <div className="bok-endmark" aria-hidden="true">b.</div>
              <ReadingFinale key={currentStory.id} inline actions={finale} onAgain={() => readText(true)} />
            </div>
          </div>

          <div className="reader-progress-ray" aria-hidden="true" style={{ width: `${textProgress * 100}%` }} />
          {boundaryPull && !readerInteractionBlocked && (boundaryPull.direction === "next" || selectedIndex > 0) && (
            <div className={`reader-edge-pull reader-edge-pull--${boundaryPull.direction}`} aria-hidden="true">
              <span style={{ transform: `scaleX(${boundaryPull.progress})`, opacity: .35 + boundaryPull.progress * .65 }} />
            </div>
          )}
        </article>

        <nav className="reader-actions reader-ui" aria-label={t("Bok actions", "Действия с боком")} inert={readerInteractionBlocked}>
          <button type="button" className="reader-previous" aria-label={t("Previous bok", "Предыдущий бок")} disabled={selectedIndex === 0} onClick={() => previousStory("button")}><ReaderBackIcon size={23} /></button>
          <button type="button" className="reader-counted-action" aria-label={`${t(isCurrentStoryLiked ? "Remove like" : "Like", isCurrentStoryLiked ? "Убрать отметку нравится" : "Нравится")}, ${currentLikeCount}`} aria-pressed={isCurrentStoryLiked} onClick={() => void likeStory()}><ReaderHeartIcon size={23} fill={isCurrentStoryLiked ? "currentColor" : "none"} /><span className="reader-action-count" aria-hidden="true">{formatCompactCount(currentLikeCount)}</span></button>
          <button type="button" className="reader-counted-action" aria-label={`${t("Comments", "Комментарии")}, ${currentCommentCount}`} onClick={() => setCommentOpen(true)}><ReaderCommentsIcon size={23} /><span className="reader-action-count" aria-hidden="true">{formatCompactCount(currentCommentCount)}</span></button>
          <button type="button" aria-label={t("Share", "Поделиться")} onClick={() => void shareStory()}><ReaderShareIcon size={23} /></button>
          <button type="button" className="reader-next-arrow" onClick={(event) => { releaseFocus(event); nextStory("button"); }}>{t("Next bok", "Следующий бок")}</button>
        </nav>

        {seriesOpen && seriesContext && (
          <div style={{ display: "contents" }} inert={readerOverlayOpen || formatOnScreen}><SeriesView
            readerLanguages={seriesContext.readerLanguages}
            onPiecesChanged={setPublishedSeriesPieces}
            heard={seriesHeard}
            openingStoryId={seriesOpening}
            signedIn={hasSignedInAccount}
            onOpenPiece={(piece) => void openSeriesPiece(piece)}
            onOpenAccount={() => openAccount("manual", "general", "home")}
          onOpenLanguages={() => openAccount("manual", "general", "languages")}
          /></div>
        )}
        {seriesContext && !readerOverlayOpen && !formatOnScreen && (
          <ReaderTabs
            // In the feed the tabs are part of the reader's controls and leave
            // with them; on the shelf they stay.
            className={seriesOpen ? "reader-tabs--pinned" : "reader-ui"}
            active={seriesOpen ? "series" : "feed"}
              seriesIsNew={seriesIsNew}
            onFeed={openFeed}
            onSeries={openSeries}
            onYou={() => openAccount("manual")}
          />
        )}

        {guestNoticeVisible && (
          <aside className="reader-guest-notice" role="status" aria-live="polite">
            <button className="reader-guest-notice__close" type="button" onClick={() => setGuestNoticeStep(null)} aria-label={t("Not now", "Не сейчас")}><X size={21} /></button>
            <small>{t(`${guestReadCount} OF ${anonymousReadLimits.requiredSignup} GUEST BOKS`, `${guestReadCount} ИЗ ${anonymousReadLimits.requiredSignup} BOKS БЕЗ АККАУНТА`)}</small>
            <h2>{t(`${Math.max(0, anonymousReadLimits.requiredSignup - guestReadCount)} boks left without an account.`, `Ещё ${Math.max(0, anonymousReadLimits.requiredSignup - guestReadCount)} boks без аккаунта.`)}</h2>
            <p>{t("Reading is always free. An account keeps your history with you.", "Чтение всегда бесплатно. Аккаунт сохраняет вашу историю.")}</p>
            <button className="reader-guest-notice__action" type="button" onClick={() => openAccount("notice")}>{t("Create account", "Создать аккаунт")}</button>
            <button className="reader-guest-notice__keep" type="button" onClick={() => setGuestNoticeStep(null)}>{t("Keep reading", "Продолжить чтение")}</button>
            <div className="reader-guest-notice__marks" aria-hidden="true">{Array.from({ length: anonymousReadLimits.requiredSignup }, (_, index) => <span key={index} className={index < guestReadCount ? "is-read" : undefined} />)}</div>
          </aside>
        )}

        {authorPanel}

        {commentOpen && currentStory && (
          <CommentsSheet
            key={currentStory.id}
            storyId={currentStory.id}
            authorHandle={currentStory.authorHandle}
            initialComments={currentComments}
            hasSignedInAccount={hasSignedInAccount}
            viewerHandle={user?.handle ?? null}
            isSupabaseReader={isSupabaseReader}
            onClose={() => setCommentOpen(false)}
            onRequestAccount={() => openAccount("manual", "comment")}
            onSubmit={submitComment}
            onStatus={notify}
            canModerate={isAdminReader}
            onDeleted={(removed) => adjustCommentCount(currentStory, -removed)}
          />
        )}

        {feedbackMilestone !== null && (
          <FeedbackSheet
            milestone={feedbackMilestone}
            sent={feedbackSent}
            boksRead={feedbackState.current.reads}
            visitorId={visitorId.current}
            onSent={() => setFeedbackSent(true)}
            onClose={closeFeedbackSheet}
          />
        )}

        {bokMenuOpen && currentStory && (
          <BokMenuSheet
            story={currentStory}
            onClose={() => setBokMenuOpen(false)}
            onCopyLink={() => void copyBokLink()}
            onReport={reportCurrentBok}
            onShare={() => { setBokMenuOpen(false); setShareOpen(true); }}
            onSettings={() => { setBokMenuOpen(false); openAccount("manual", "general", "typography"); }}
            formatLabel={cinemaOffered ? (cinemaIsFinished || poemManifestUrl ? t("Listen and read", "Слушать и читать") : t("Preview audio (admin)", "Проверить аудио (администратор)")) : undefined}
            onOpenFormat={cinemaOffered ? () => { setBokMenuOpen(false); openReadingFormat(currentStory.id); } : undefined}
            musicOn={musicOn}
            onToggleMusic={() => { if (musicOn) stopReadingMusic(); else startReadingMusic(); setMusicOn(!musicOn); }}
            onHide={isAdminReader ? () => { setBokMenuOpen(false); openHideBok(); } : undefined}
            onAuthor={() => openAuthor(currentStory.authorHandle, currentStory.authorName)}
          />
        )}

        {accountPanel}
        {openIssuePanel}

        {isAdminReader && (
          <BokLifecycleDialog target={hideTarget} onClose={() => setHideTarget(null)} onDone={afterHideBok} />
        )}
        {readerFlash && (
          <div className="reader-flash" role="status" aria-live="polite">
            <span>{readerFlash}</span>
            <button type="button" onClick={() => setReaderFlash("")} aria-label={t("Dismiss", "Закрыть")}>
              <X className="size-4" />
            </button>
          </div>
        )}

        {shareOpen && <ShareCard story={currentStory} artwork={getBokArtwork(currentStory)} onClose={() => setShareOpen(false)} onShared={() => recordReaderEvent("share", currentStory)} />}
        {formatLoading && <div className="format-loading">
          {getBokArtwork(currentStory) && <img className="format-status__cover" src={getBokArtwork(currentStory)!} alt="" />}
          <header className="format-top"><button type="button" aria-label={t("Back", "Назад")} onClick={() => readText()}><ReaderBackIcon /></button><span className="format-top__title">{currentStory.title}</span><span /></header>
          <FormatStatus onReadText={() => readText()} />
        </div>}
        {/* Above everything. The cinema prototype is offered to admins only;
            finished pieces to everyone. Time in a format counts as reading
            the boks under it, and its events carry `metadata.format` so an
            analysis can tell listening from reading - see `formatUsed`. */}
        {cinemaOpen && currentStory && cinemaOffered && (
          <div style={{ display: "contents" }} inert={readerOverlayOpen}><CinemaMode
            story={currentStory}
            finale={finale}
            recording={recording}
            autoPlay
            suspended={readerOverlayOpen}
            onPlaybackChange={onFormatPlayback}
            onComments={() => setCommentOpen(true)}
            onReadText={readText}
            onClose={() => { if (seriesOpen) flushAftertaste(); setCinemaOpen(false); }}
          /></div>
        )}

        {poem && (
          <div style={{ display: "contents" }} inert={readerOverlayOpen}><ImmersivePoem manifest={poem} finale={finale} recording={recording} autoPlay
            coverArtwork={getBokArtwork(currentStory) ?? undefined}
            suspended={readerOverlayOpen}
            onPlaybackChange={onFormatPlayback} onComments={() => setCommentOpen(true)} onReadText={readText}
            onClose={() => { if (seriesOpen) flushAftertaste(); setPoem(null); }} /></div>
        )}
      </section>
    </main>
  );
}
