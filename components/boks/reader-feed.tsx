"use client";

import { randomBoksId } from "@/lib/boks/browser-id";
import { supportEmail, supportMailto } from "@/lib/boks/contact";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Music,
  Flag,
  Heart,
  Link as LinkIcon,
  MessageCircle,
  MoreHorizontal,
  Share2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  readerSlateSize,
  recordAnonymousBoksRead,
  saveAnonymousNoticeState,
  saveProfile,
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
import { ActionButton } from "@/components/boks/shared-ui";
import {
  readingMusicWanted,
  startReadingMusic,
  stopReadingMusic,
} from "@/components/boks/reading-music";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { FeedbackForm } from "@/components/boks/feedback-form";
import { CinemaMode } from "@/components/boks/cinema/cinema-mode";
import { ImmersivePoem } from "@/components/boks/poetry/immersive-poem";
import type { FinaleActions } from "@/components/boks/reading-finale";
import { loadPoemManifest, poemManifestFor } from "@/components/boks/poetry/poems";
import type { PoemManifest } from "@/lib/boks/poetry/manifest";
import { isBoksSeriesPiece } from "@/components/boks/cinema/series";
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
  surfaceForMilestone,
  type FeedbackState,
} from "@/components/boks/feedback";
import { readableBoksError } from "@/lib/boks/errors";
import {
  emptyFeedNotice,
  effectiveReadingLanguages,
  normalizeReadingLanguages,
  readingLanguageChangeKeepsFeed,
  readingLanguageNames,
  rememberReadingLanguages,
} from "@/components/boks/reading-languages";
import { displayedLikeCount } from "@/components/boks/client-format";
import { attachReaderClock, createReaderClock, type ReaderClock } from "@/components/boks/reader-clock";
import { formatReaderBody } from "@/components/boks/reader-text";
import { haptic } from "@/components/boks/reader-haptics";
import { AuthorSheet } from "@/components/boks/author-sheet";
import { CommentsSheet } from "@/components/boks/comments-sheet";
import { BokLifecycleDialog, type BokLifecycleTarget } from "@/components/boks/admin/bok-lifecycle-dialog";
import {
  createReaderEventQueue,
  flushReaderEventsOnExit,
  type ReaderEventQueue,
} from "@/components/boks/reader-events";
import {
  loadBoksUserContext,
  loadFollowedAuthors,
  loadSupabaseStory,
  setAuthorFollow,
  recordSupabaseReaderEvents,
  recordSupabaseView,
  reportBok,
  setMyReadingLanguages,
  setSupabaseLike,
  submitSupabaseComment,
} from "@/components/boks/supabase-browser-data";
import type { ReaderEvent, ReaderEventType } from "@/lib/boks/contracts";
import { emptyReaderSignals, type ReaderSignals } from "@/lib/boks/recommendations";
import { completePendingBoksMagicLinkProfile, consumeBoksMagicLinkRedirectNotice, supabase } from "@/lib/boks/supabase-client";
import { currentBoksTermsVersion, UserAuthPanel } from "@/components/boks/user-auth-panel";
import { useBoksData } from "@/components/boks/use-boks-data";

const firstVisitHintKey = "boks-first-visit-hint-seen";

/** Drops focus after a mouse click so the reader's Space cannot press the button again. */
function releaseFocus(event: React.MouseEvent<HTMLElement>) {
  if (event.detail > 0) event.currentTarget.blur();
}

/** "Follow", or "Follow @boks" when the byline is a writer the account publishes. */
function followLabel(following: boolean, authorName: string | undefined, authorHandle: string) {
  const handle = authorHandle.replace(/^@+/, "");
  const underByline = Boolean(authorName && handle && authorName.toLowerCase() !== handle.toLowerCase());
  const verb = following ? "Following" : "Follow";
  return underByline ? `${verb} @${handle}` : verb;
}

type AuthIntent = "general" | "like" | "comment" | "follow";

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

export function ReaderFeed() {
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
  /** The boks the reader is on, held across a feed reload. See the effect below. */
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
  const [authNotice, setAuthNotice] = useState("");
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
  const [firstVisitHint, setFirstVisitHint] = useState<"touch" | "pointer" | null>(null);
  /**
   * A message for the reader: "Link copied", or why a like, follow, report or
   * language change did not go through. These used to go only to `status`,
   * which the reader shows on the empty-feed screen and nowhere else - so with
   * a bok on screen every one of them vanished, and a failed action looked
   * like a tap that did nothing. `status` still gets it, for that screen.
   */
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

  const notify = useCallback(
    (message: string) => {
      if (!message) return;
      setReaderFlash(message);
      setStatus(message);
    },
    [setStatus]
  );
  const [followedAuthorIds, setFollowedAuthorIds] = useState<string[]>([]);
  const [followBusy, setFollowBusy] = useState(false);
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
  const [reportKind, setReportKind] = useState<"copyright" | "other">("copyright");
  const [reportReason, setReportReason] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState<"received" | "already" | null>(null);
  const [storyHasMore, setStoryHasMore] = useState(false);
  const [storyTransition, setStoryTransition] = useState<StoryTransition>({ phase: "idle", direction: null, axis: null });
  const [boundaryPull, setBoundaryPull] = useState<BoundaryPullState | null>(null);
  const [pendingLibraryStoryId, setPendingLibraryStoryId] = useState<string | null>(null);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const touchStart = useRef<GestureStart | null>(null);
  const pointerStart = useRef<GestureStart | null>(null);
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
  const recordOutcomeRef = useRef<(reason: ReadOutcomeReason) => void>(() => undefined);
  const openReadBoksRef = useRef<(storyId: string) => Promise<void>>(async () => undefined);
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
    };
  }, []);

  /**
   * Personalized strategies read affinity the reader built by behavior. The
   * reader is never asked to configure genres or moods.
   */
  const readerSignals = useMemo<ReaderSignals>(
    () => ({
      genreAffinity: profile.genreScore,
      moodAffinity: profile.moodScore,
      completedStoryIds: profile.completed,
      likedStoryIds: profile.liked,
      skippedStoryIds: profile.skipped,
    }),
    [profile.completed, profile.genreScore, profile.liked, profile.moodScore, profile.skipped]
  );

  useEffect(() => {
    readerSignalsRef.current = readerSignals;
  }, [readerSignals]);

  const loadFeed = useCallback(
    () =>
      load({
        view: "reader",
        limit: readerSlateSize,
        visitorId: visitorId.current,
        sessionId: sessionId.current,
        reader: readerSignalsRef.current,
        // The profile the ranking saw. It changes with every read, so without a
        // snapshot this serve could never be replayed.
        profileSnapshot: { ...readerSignalsRef.current },
        // A guest's language filter. Sent from the browser's languages until
        // the reader says otherwise; a signed-in reader's stored choice wins
        // inside the RPC, so this is never the authority for an account.
        readingLanguages: readingLanguagesRef.current,
      }),
    [load]
  );

  /**
   * The next slate, added after this one. The reader used to stop dead at the
   * end of the first slate: swipes did nothing and the pull still said
   * "release for next bok". The slate is ranked with everything read so far,
   * so fatigue keeps what was seen out of it; boks already in the feed are
   * skipped by the append. A slate that adds nothing means there is nothing
   * left for this reader, and it is not asked for again this visit.
   */
  const loadingMore = useRef(false);
  const feedExhausted = useRef(false);
  const knownStoryIds = useRef<Set<string>>(new Set());
  const loadMoreFeed = useCallback(async () => {
    if (loadingMore.current || feedExhausted.current) return;
    loadingMore.current = true;
    try {
      const data = await load({
        view: "reader",
        limit: readerSlateSize,
        visitorId: visitorId.current,
        sessionId: sessionId.current,
        reader: readerSignalsRef.current,
        profileSnapshot: { ...readerSignalsRef.current },
        readingLanguages: readingLanguagesRef.current,
        append: true,
      });
      const fresh = (data?.stories ?? []).filter((story) => !knownStoryIds.current.has(String(story.id)));
      if (!fresh.length) feedExhausted.current = true;
    } catch {
      // Silently: the reader still has boks ahead, and the next approach to
      // the end tries again.
    } finally {
      loadingMore.current = false;
    }
  }, [load]);

  useEffect(() => {
    visitorId.current = getBrowserId("boks-reader");
    feedbackState.current = readFeedbackState();
    sessionId.current = `${Date.now()}-${randomBoksId()}`;
    const profileTimer = window.setTimeout(() => setProfile(readProfile()), 0);
    // Read before the address bar is cleaned below, which would take the utm
    // tags and the shared-link marker with it.
    visitAttribution.current = journeyAttribution(window.location.href, document.referrer);
    // A shared link carries the boks id. Strip it from the address bar once it
    // has been used, so a refresh does not reopen it over the reader's feed.
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("bok");
    const sharedAuthor = params.get("author");
    if (shared || sharedAuthor) window.history.replaceState(null, "", window.location.pathname);

    // The filter has to be in place before the first feed request, or the
    // reader's first page is unfiltered and then changes under them.
    readingLanguagesRef.current = effectiveReadingLanguages(null);

    loadFeed()
      .then(async () => {
        let context: BoksUserContext | null = null;
        try {
          context = await loadBoksUserContext();
        } catch {
          context = null;
        }
        setUser(context);
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
          setHold((current) => ({ ...current, release: true }));
          await loadFeed();
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
        if (context && !context.isAnonymous) {
          loadFollowedAuthors()
            .then((authors) => setFollowedAuthorIds(authors.map((author) => author.authorUserId)))
            .catch(() => undefined);
        }
        if (shared) await openReadBoksRef.current(shared);
        // A shared author link names an account, so it opens the publisher.
        if (sharedAuthor) setAuthorSheet({ handle: sharedAuthor.replace(/^@+/, "") });
      })
      .catch((error) => notify(error.message))
      // A failed feed load must still settle the identity, or a real guest
      // never meets the sign-up gate at all.
      .finally(() => setIdentitySettled(true));
    return () => window.clearTimeout(profileTimer);
  }, [loadFeed, notify, setStatus]);

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
    const onTeardown = () => recordOutcomeRef.current("exit");
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      const story = currentStoryRef.current;
      if (story) recordHeartbeatRef.current(story);
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
   * One queue per reading session. The transport follows whichever backend the
   * feed came from, so attribution is identical on Supabase and on D1.
   */
  useEffect(() => {
    const queue = createReaderEventQueue({
      transport: async (events, delivery) => {
        if (isSupabaseReader) {
          await recordSupabaseReaderEvents(events, delivery);
          return;
        }

        const response = await fetch("/api/boks", {
          method: "POST",
          keepalive: delivery.keepalive,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "events",
            events,
            visitorId: visitorId.current,
            sessionId: sessionId.current,
          }),
        });
        if (!response.ok) throw new Error("Could not record reader events.");
      },
    });

    eventQueue.current = queue;
    const stopExitFlush = flushReaderEventsOnExit(queue);

    return () => {
      stopExitFlush();
      queue.dispose();
      eventQueue.current = null;
    };
  }, [isSupabaseReader]);

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
        .then(async (context) => {
          const nextUser = context ?? (await loadBoksUserContext());
          setUser(nextUser);
          loadFeed().catch((error) => notify(error instanceof Error ? error.message : "Could not refresh feed."));
        })
        .catch((error) => notify(error instanceof Error ? error.message : "Could not finish sign in."));
    });

    return () => result.data.subscription.unsubscribe();
  }, [loadFeed, notify, setStatus]);

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
      const experimentContext = experimentRef.current;
      const activeSeconds = readingClock.current.activeSeconds();

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
        rank: selectedIndex,
        clientElapsedSeconds: activeSeconds,
        sessionId: sessionId.current,
        visitorId: visitorId.current,
        // Derived from the real word count, not from `minutes`: every published
        // boks currently reports one minute, so the old estimate was a constant.
        estimatedSeconds: expectedReadingSeconds(story),
        feedId: provenanceRef.current.feedId,
        servingBackend: provenanceRef.current.servingBackend,
        labelingVersion: provenanceRef.current.labelingVersion,
        metadata,
      };

      eventQueue.current?.record(event);

      // `views` stays the reader-facing history table behind "recently read".
      if (eventType === "impression" && isSupabaseReader) {
        recordSupabaseView(supabaseUserId, story.id).catch(() => undefined);
      }
    },
    [isSupabaseReader, selectedIndex, supabaseUserId]
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
  const currentAuthorLabel = currentStory?.authorName || (currentStory?.authorHandle ? `@${currentStory.authorHandle.replace(/^@+/, "")}` : "boks author");
  const persistedLikedStoryIds = useMemo(() => new Set(likedStoryIds), [likedStoryIds]);

  // Ask for the next slate a few boks before the end, so it is there in time.
  useEffect(() => {
    knownStoryIds.current = new Set(rankedStories.map((story) => story.id));
    if (!isSupabaseReader || !shouldLoadMore(rankedStories.length, selectedIndex)) return;
    void loadMoreFeed();
  }, [isSupabaseReader, loadMoreFeed, rankedStories, selectedIndex]);
  const isCurrentStoryLiked = currentStory ? liked[currentStory.id] ?? persistedLikedStoryIds.has(currentStory.id) : false;
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
  /**
   * Answered once per opening, however many times it is replayed.
   *
   * Listening again and landing on the question a second time is not a second
   * opinion - it is the same reader on the same evening - and the recommender
   * would count it twice. Reset when a format is opened.
   */
  const finaleAnswered = useRef(false);
  /**
   * What the end of a boks series piece does, built once and handed to every
   * format, so the end of a poem and the end of a story are the same buttons
   * doing the same things. A new format takes this object and nothing else.
   */
  const finale: FinaleActions = {
    liked: isCurrentStoryLiked,
    onLike: () => void likeStory(),
    onShare: () => void shareStory(),
    onNext: () => {
      setCinemaOpen(false);
      setPoem(null);
      void nextStory("button");
    },
    onAftertaste: (tags) => {
      // The one thing a format records. Reading outcomes stay out of it
      // deliberately, but this is a reader telling us something no clock can.
      if (!currentStory || finaleAnswered.current) return;
      finaleAnswered.current = true;
      recordReaderEvent("aftertaste", currentStory, tags.length, { tags });
    },
  };
  const readerInteractionBlocked = Boolean(
    authPanelOpen || commentOpen || authorSheet || bokMenuOpen || hideTarget || cinemaOpen
  );

  /**
   * A first visit gets one line of how-to. With the controls hidden a new
   * reader sees only the text, and on a phone the next/previous buttons are
   * not there at all - moving on is a swipe nobody has been told about. Shown
   * once per device, a moment after the first boks appears, and gone at the
   * first swipe, tap or keypress, or after ten seconds.
   */
  useEffect(() => {
    if (!currentStoryId) return;
    let seen = true;
    try {
      seen = window.localStorage.getItem(firstVisitHintKey) === "1";
    } catch {
      seen = true;
    }
    if (seen) return;
    const show = window.setTimeout(() => {
      try {
        window.localStorage.setItem(firstVisitHintKey, "1");
      } catch {
        // Shown this once anyway.
      }
      setFirstVisitHint(window.matchMedia("(pointer: coarse)").matches ? "touch" : "pointer");
    }, 1200);
    return () => window.clearTimeout(show);
    // Once, for the first boks only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(currentStoryId)]);

  useEffect(() => {
    if (!firstVisitHint) return;
    const hide = window.setTimeout(() => setFirstVisitHint(null), 10000);
    return () => window.clearTimeout(hide);
  }, [firstVisitHint]);

  useEffect(() => {
    if (!firstVisitHint) return;
    const hide = window.setTimeout(() => setFirstVisitHint(null), 0);
    return () => window.clearTimeout(hide);
    // A swipe, a tap that opens the controls, or a key: the reader has it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, readerChromeVisible]);

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
    setReaderFlash(`“${bok.title}” is hidden from readers. Restore it in Admin → Content → Deleted.`);
  }

  function showSuspension() {
    notify(user?.banReason || "This account is suspended. Reading remains available.");
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
    const { currentStory: story, recordReaderEvent: record } = arrivalContext.current;
    if (!story || !currentStoryId) return;
    readingClock.current.restart();
    if (storyScroll.current) storyScroll.current.scrollTop = 0;
    if (wheelIdleTimer.current !== null) {
      window.clearTimeout(wheelIdleTimer.current);
      wheelIdleTimer.current = null;
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
    record("impression", story, 1, {
      genre: story.genre,
      mood: story.mood,
      // How much was there to choose from, and how much of it was new. A feed
      // ranked over three unread boks is not a ranking.
      ...catalogContextRef.current,
    });

    const startTimer = window.setTimeout(() => {
      record("start", story, 1, { genre: story.genre, mood: story.mood });
    }, 2600);

    return () => {
      window.clearTimeout(overflowTimer);
      window.clearTimeout(wheelArmTimer);
      window.clearTimeout(startTimer);
    };
  }, [currentStoryId]);

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
    const handle = window.setTimeout(() => {
      countedAnonymousStories.current.add(storyId);
      const nextCount = recordAnonymousBoksRead(storyId);
      setGuestReadCount(nextCount);

      const notices = readAnonymousNoticeState();
      if (nextCount === anonymousReadLimits.firstNotice && !notices.first) {
        setGuestNoticeStep("first");
        saveAnonymousNoticeState({ ...notices, first: true });
      } else if (nextCount === anonymousReadLimits.secondNotice && !notices.second) {
        setGuestNoticeStep("second");
        saveAnonymousNoticeState({ ...notices, second: true });
      }
    }, guestReadDwellMs);
    return () => window.clearTimeout(handle);
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

  function persistProfile(next: ReaderProfile) {
    setProfile(next);
    saveProfile(next);
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

  function openAccount(reason: "manual" | "notice" | "required" = "manual", intent: AuthIntent = "general") {
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
    setAuthIntent(intent);
    setAuthNotice("");
    setAuthPanelOpen(true);
    setGuestNoticeStep(null);
    revealReaderChrome(0);
  }

  async function openReadBoks(storyId: string) {
    if (currentStoryId === storyId) {
      if (storyScroll.current) storyScroll.current.scrollTop = 0;
      setAuthPanelOpen(false);
      hideReaderChrome();
      recordReaderEvent("impression", currentStory, 1, { from: "library", reread: true });
      return;
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
      if (!loaded) {
        notify("This bok is no longer available.");
        return;
      }

      const { story, likedByMe } = loaded;
      setLiked((state) => ({ ...state, [story.id]: likedByMe }));
      setLibraryEntry({ story, index: selectedIndex });
      setPendingLibraryStoryId(story.id);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not open this bok.");
    }
  }


  /** Whether the text on screen has anywhere to scroll to. */
  function isStoryScrollable() {
    const node = storyScroll.current;
    if (!node) return false;
    return node.scrollHeight > node.clientHeight + 4;
  }

  function updateStoryProgress() {
    if (!currentStory || !storyScroll.current) return 0;
    const node = storyScroll.current;
    const distance = Math.max(1, node.scrollHeight - node.clientHeight);
    const progress = node.scrollHeight <= node.clientHeight + 4 ? 0 : Math.min(1, Math.max(0, node.scrollTop / distance));
    const existing = storyProgress.current[currentStory.id] ?? 0;
    storyProgress.current[currentStory.id] = Math.max(existing, progress);
    return storyProgress.current[currentStory.id];
  }

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
  });

  function recordReadingOutcome(reason: ReadOutcomeReason) {
    if (!currentStory) return;
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

    persistProfile(profileBump(profile, currentStory, outcome));

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
        notify("Finding more boks for you…");
        void loadMoreFeed();
      } else {
        notify("That is everything boks has for you right now.");
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

    try {
      if (hasSignedInAccount) {
        await setMyReadingLanguages(next);
        setUser(await loadBoksUserContext());
      }
      setHold((current) => ({ ...current, release: true }));
      await loadFeed();
    } catch (error) {
      notify(readableBoksError(error, "Could not change your languages."));
    }
  }

  function openBokMenu() {
    setCommentOpen(false);
    setReportReason("");
    setReportDone(null);
    setReportKind("copyright");
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
      notify("Link copied");
    } catch {
      notify(url);
    }
  }

  async function sendReport() {
    if (!currentStory) return;
    if (accountSuspended) {
      showSuspension();
      return;
    }

    setReportSending(true);
    setStatus("");
    try {
      const result = await reportBok({
        reelId: currentStory.id,
        reason: reportReason,
        kind: reportKind,
      });
      setReportDone(result.status);
      setReportReason("");
    } catch (error) {
      notify(readableBoksError(error, "Could not send that report."));
    } finally {
      setReportSending(false);
    }
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
      notify(readableBoksError(error, "Could not update the like. Try again."));
      return;
    } finally {
      likesInFlight.current.delete(story.id);
    }

    if (nextLiked) {
      recordReaderEvent("like", story);
      persistProfile(profileBump(profile, story, "like"));
    }
    // No feed reload. The count and the heart are already right locally
    // (`displayedLikeCount`), and reloading 80 boks for one tap was most of
    // the Worker's CPU and the database's load; the next feed ranks with it.
  }

  const isFollowingCurrentAuthor = Boolean(
    currentStory?.authorUserId && followedAuthorIds.includes(currentStory.authorUserId)
  );

  /**
   * Following is a durable relationship, so it needs a durable identity. A
   * guest is asked to create an account rather than silently failing.
   */
  async function toggleFollow() {
    const authorUserId = currentStory?.authorUserId;
    if (!authorUserId) return;

    if (accountSuspended) {
      showSuspension();
      return;
    }

    if (!hasSignedInAccount) {
      openAccount("manual", "follow");
      return;
    }

    const next = !isFollowingCurrentAuthor;
    if (next) haptic("confirm");
    setFollowBusy(true);
    // Optimistic: the button is the only feedback, and a round trip on every
    // tap makes it feel broken.
    setFollowedAuthorIds((current) =>
      next ? [...current, authorUserId] : current.filter((id) => id !== authorUserId)
    );

    try {
      const saved = await setAuthorFollow(authorUserId, next);
      setFollowedAuthorIds((current) =>
        saved.following
          ? [...new Set([...current, authorUserId])]
          : current.filter((id) => id !== authorUserId)
      );
    } catch (error) {
      setFollowedAuthorIds((current) =>
        next ? current.filter((id) => id !== authorUserId) : [...current, authorUserId]
      );
      notify(error instanceof Error ? error.message : "Could not update following.");
    } finally {
      setFollowBusy(false);
    }
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
    setAuthorSheet({ handle: handle.replace(/^@+/, ""), authorName });
    revealReaderChrome(0);
  }

  async function shareStory() {
    if (!currentStory) return;
    const story = currentStory;
    // The feed URL would open a different bok for whoever received it.
    const url = `${window.location.origin}/b/${story.id}`;
    try {
      if (navigator.share) {
        // The link alone. Given a text as well, Telegram joins the two with no
        // space - `…/b/<id>Read "Конкурс" on boks` - and then links everything up
        // to the first space, so the id is damaged and the preview is empty.
        // Nothing is lost by sending less: the preview itself now carries the
        // title, the writer and the opening lines. `title` stays, because
        // targets use it as a subject rather than joining it to the link.
        await navigator.share({ title: story.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        notify("Link copied");
      }
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === "AbortError") return;
      // No clipboard (some in-app browsers) or it was refused: show the link
      // so it can be copied by hand.
      notify(url);
      return;
    }
    recordReaderEvent("share", story);
  }

  function adjustCommentCount(story: Story, change: number) {
    setCommentCountDeltas((current) => {
      const previous = current[story.id];
      const base = story.commentsCount;
      const added = (previous && previous.base === base ? previous.added : 0) + change;
      return { ...current, [story.id]: { base, added } };
    });
  }

  async function submitComment(body: string, parentCommentId: number | null): Promise<Comment> {
    if (!currentStory) throw new Error("That bok is no longer open.");
    if (accountSuspended) {
      showSuspension();
      throw new Error(user?.banReason || "This account is suspended.");
    }
    if (!hasSignedInAccount) {
      openAccount("manual", "comment");
      throw new Error("Create a free account to join the conversation.");
    }

    let created: Comment;
    if (isSupabaseReader) {
      created = await submitSupabaseComment(currentStory.id, body, parentCommentId);
    } else {
      if (parentCommentId != null) throw new Error("Replies are available in the hosted reader.");
      const response = await fetch("/api/boks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "comment",
          storyId: currentStory.id,
          body,
          visitorName: user?.handle || "reader",
          visitorId: visitorId.current,
          sessionId: sessionId.current,
          surface: "reader",
        }),
      });
      if (!response.ok) throw new Error("Could not send comment.");
      created = {
        id: Date.now(),
        storyId: currentStory.id,
        visitorName: user?.handle || "reader",
        visitorHandle: user?.handle,
        body,
        createdAt: new Date().toISOString(),
        parentCommentId: null,
        likesCount: 0,
        likedByMe: false,
      };
    }

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

      if (readingLanguageChangeKeepsFeed(previous, next)) {
        feedExhausted.current = false;
        return;
      }

      setHold((current) => ({ ...current, release: true }));
      loadFeed().catch((error) => notify(readableBoksError(error, "Could not load the feed in those languages.")));
    },
    [loadFeed, notify]
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

  if (!currentStory) {
    /**
     * A feed emptied by the language filter has to say so. The alternative -
     * quietly adding a language back - would break the only promise this
     * feature makes, and a reader who asked for Russian and found none is also
     * the most useful thing the console can learn about what to acquire.
     *
     * The rule itself lives in `emptyFeedNotice`, where it is tested.
     */
    const notice = emptyFeedNotice({
      phase,
      message: status,
      languages: readingLanguagesRef.current,
      coverage: user?.languageCoverage,
    });

    return (
      <main className="reader-shell grid min-h-screen place-items-center px-6">
        <div className="max-w-md text-center">
          <p className="brand-word">boks</p>
          {notice.kind === "language" ? (
            <>
              <h1 className="mt-4 text-2xl font-semibold tracking-normal">{notice.title}</h1>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{notice.body}</p>
              {notice.offer.length > 0 && (
                <Button
                  className="mt-4"
                  onClick={() =>
                    void applyReadingLanguages([...readingLanguagesRef.current, ...notice.offer])
                  }
                >
                  Add {notice.offer.map((language) => readingLanguageNames[language]).join(" and ")}
                </Button>
              )}
              <Button className="mt-2 w-full" variant="ghost" onClick={() => openAccount("manual")}>
                Change my languages
              </Button>
            </>
          ) : notice.kind === "unreachable" ? (
            <>
              {/* The reader can act on this one, so it says what to try. The
                  page itself arrived, which means our server is up and the
                  network is stopping the call the app makes next - on some
                  providers that call is blocked while the site is not. */}
              <h1 className="mt-4 text-2xl font-semibold tracking-normal">
                boks cannot reach its server from this network
              </h1>
              <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                The page loaded, so boks itself is running. What failed is the connection your browser
                makes next, and that is usually the network in between: another Wi-Fi, mobile data, or a
                VPN normally fixes it.
              </p>
              <Button className="mt-4" onClick={() => void loadFeed()}>
                Try again
              </Button>
              <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
                Still nothing? Write to{" "}
                <a className="auth-link" href={supportMailto}>
                  {supportEmail}
                </a>{" "}
                - tell us your provider and we will move the address boks talks to.
              </p>
            </>
          ) : (
            <p className="mt-3 text-[var(--muted-foreground)]">{notice.message}</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main
      className={`reader-shell h-[100svh] overflow-hidden text-[var(--foreground)] ${
        readerChromeVisible || commentOpen ? "reader-shell--chrome" : "reader-shell--focus"
      } ${guestNoticeStep ? "reader-shell--notice" : ""}`}
    >
      <section
        // One column, always. A second column for the controls took 116px off
        // the right of a 1120px page, so the text was centred in what was left
        // and sat left of the middle of the screen with an empty band beside
        // it - https://github.com/IvanCherep/boks/issues/2. The controls float
        // over the page now, and the reading column is centred on the screen.
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
          {/* Account and the bok menu, one in each corner. On a wide screen
              they lift out of the flow (see `.reader-topbar` at 1024px) so the
              row they used to hold goes back to the text; the reading column
              is narrow and centred, so nothing ever scrolls under them. */}
          <header className="reader-topbar z-10 flex items-center justify-between px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-6">
            <button
              className="reader-account-trigger reader-ui"
              onClick={() => openAccount("manual")}
              aria-label={hasSignedInAccount ? "Open settings" : "Sign in or create an account"}
              title={hasSignedInAccount ? "Settings" : "Sign in"}
            >
              <UserRound className="size-5" />
            </button>
            <button type="button" className="reader-more reader-ui" onClick={openBokMenu} aria-label="More about this bok">
              <MoreHorizontal className="size-5" />
            </button>
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
            {/* At 1024px the top bar floats, so the column takes its own room
                above the byline - enough to clear the two corner buttons -
                and gives back what the bar and the old footer row were
                holding. */}
            <div className="reader-content mx-auto flex min-h-full max-w-[720px] flex-col justify-start pb-16 pt-5 sm:pb-20 sm:pt-10 lg:pb-10 lg:pt-[4.5rem]">
              <div className="reader-author reader-author-intro">
                <span className="reader-author-avatar" aria-hidden="true">
                  {currentAuthorLabel.replace(/^@/, "").slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  {currentStory.authorName ? (
                    <span className="reader-byline">
                      <button
                        type="button"
                        className="reader-byline-name"
                        onClick={() => openAuthor(currentStory.authorHandle, currentStory.authorName)}
                        disabled={!currentStory.authorHandle}
                      >
                        {currentStory.authorName}
                      </button>
                      <button
                        type="button"
                        className="reader-byline-handle"
                        onClick={() => openAuthor(currentStory.authorHandle)}
                        disabled={!currentStory.authorHandle}
                      >
                        {currentStory.authorHandle ? `@${currentStory.authorHandle.replace(/^@+/, "")}` : "boks author"}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="reader-byline-name"
                      onClick={() => openAuthor(currentStory.authorHandle)}
                      disabled={!currentStory.authorHandle}
                    >
                      {currentAuthorLabel}
                    </button>
                  )}
                </div>
                {currentStory.authorUserId && currentStory.authorUserId !== supabaseUserId && (
                  <button
                    type="button"
                    className={`follow-button${isFollowingCurrentAuthor ? " follow-button--following" : ""}`}
                    onClick={(event) => {
                      releaseFocus(event);
                      void toggleFollow();
                    }}
                    disabled={followBusy}
                    aria-pressed={isFollowingCurrentAuthor}
                  >
                    {/* Following is per account. Under a byline - "Anton Chekhov,
                        @boks" - a bare "Follow" read as following Chekhov and
                        followed the whole publisher; say whose account it is,
                        as the author sheet does. */}
                    {isFollowingCurrentAuthor ? <Check className="size-3.5" /> : null}
                    {followLabel(isFollowingCurrentAuthor, currentStory.authorName, currentStory.authorHandle)}
                  </button>
                )}
              </div>

              <h1 className="reader-title max-w-[680px] break-words text-[var(--foreground)]">
                {currentStory.title}
              </h1>
              <div className="story-copy mt-7 max-w-[680px] text-[var(--foreground)]">
                {storyBlocks.map((block, index) => (
                  <p
                    key={`${currentStory.id}-${index}`}
                    className={block.kind === "verse" ? "story-verse" : ""}
                  >
                    {block.lines.join("\n")}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {boundaryPull && (
            <div
              className={`boundary-pull-cue boundary-pull-cue--${boundaryPull.direction}${
                boundaryPull.progress >= 1 ? " boundary-pull-cue--armed" : ""
              }`}
              style={{
                // Visible from the moment the pull engages. Opacity used to
                // *equal* progress, so for most of a pull the cue was a faint
                // ghost, and it was removed the instant it filled - nobody saw
                // it full. The ring now shows progress; the cue is simply there.
                opacity: 0.55 + boundaryPull.progress * 0.45,
                transform: `translate(-50%, ${boundaryPull.direction === "next" ? "" : "-"}${Math.round((1 - boundaryPull.progress) * 20)}px)`,
              }}
              aria-hidden="true"
            >
              <span
                className="boundary-pull-ring"
                style={{
                  background: `conic-gradient(var(--primary) ${Math.round(boundaryPull.progress * 360)}deg, var(--border) 0deg)`,
                }}
              >
                <span className="boundary-pull-ring__inner">
                  {boundaryPull.direction === "next" ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronUp className="size-4" />
                  )}
                </span>
              </span>
              {/* Armed says what letting go will do, so the reader decides it
                  rather than discovering it. */}
              <span>
                {boundaryPull.progress >= 1
                  ? boundaryPull.direction === "next"
                    ? "release for next bok"
                    : "release for previous bok"
                  : boundaryPull.direction === "next"
                    ? "next bok"
                    : "previous bok"}
              </span>
            </div>
          )}

        </article>

        {/*
         * One cluster, bottom right: what this boks can be done with, and
         * where to go from it. They used to be a column of the page and a row
         * under it - which pushed the reading column off centre and took a
         * strip of height that the text wanted. Floating them leaves the page
         * to the text. On a phone the rail returns to a bar across the bottom
         * and the two buttons go away, because a swipe is the way there.
         */}
        <div className="reader-dock">
          <aside
            className="action-rail reader-ui pointer-events-none"
            inert={readerInteractionBlocked ? true : undefined}
          >
          {/* Likes and replies carry their counts to the right of the icon,
              always. The like total is public as an aggregate - how many,
              never who - and is reconciled with this reader's own like so the
              number moves the moment the heart does. A share has no count: it
              cannot be seen once the link leaves the app. */}
          <ActionButton
            label={isCurrentStoryLiked ? "Remove like" : "Like"}
            value={displayedLikeCount(
              currentStory.likes,
              persistedLikedStoryIds.has(currentStory.id),
              isCurrentStoryLiked
            )}
            onClick={likeStory}
            active={isCurrentStoryLiked}
          >
            {/* Filled when liked: the state has to read at a glance, not only
                through a tinted background. */}
            <Heart className="size-5" fill={isCurrentStoryLiked ? "currentColor" : "none"} />
          </ActionButton>
          <ActionButton label="Comments" value={currentCommentCount} onClick={() => setCommentOpen(true)}>
            <MessageCircle className="size-5" />
          </ActionButton>
          <ActionButton label="Share" onClick={shareStory}>
            <Share2 className="size-5" />
          </ActionButton>
          {/* A boks read aloud over pictures that change as it goes. Open to
              everyone on a piece that is finished - its own paintings and its
              own voice - and to admins alone on every other, where it is still
              a prototype dressed in a shared stand-in. */}
          {cinemaOffered && (
            <ActionButton
              label={cinemaIsFinished ? "Listen and read" : "Listen and read (prototype, admins only)"}
              onClick={() => {
                // Either renderer brings its own voice. Silence the reading
                // music without forgetting the choice, so it returns after.
                stopReadingMusic(false);
                setMusicOn(false);
                finaleAnswered.current = false;
                if (poemManifestUrl) {
                  loadPoemManifest(poemManifestUrl).then(setPoem, () =>
                    notify("This poem could not be opened.")
                  );
                  return;
                }
                setCinemaOpen(true);
              }}
            >
              <Clapperboard className="size-5" />
            </ActionButton>
          )}
          {/* Something to read to: one track for the whole catalogue, off
              until asked for. */}
          <ActionButton
            label={musicOn ? "Turn the music off" : "Play music while you read"}
            onClick={() => {
              if (musicOn) stopReadingMusic();
              else startReadingMusic();
              setMusicOn(!musicOn);
            }}
            active={musicOn}
          >
            <Music className="size-5" />
          </ActionButton>
          {/* Admins only, and only as a convenience: see `isAdminReader`. */}
          {isAdminReader && (
            <ActionButton label="Hide this bok from readers (admin)" onClick={openHideBok} tone="danger">
              <Trash2 className="size-5" />
            </ActionButton>
          )}
          </aside>

          <nav className="reader-footer reader-ui" aria-label="Move through the feed">
            {selectedIndex > 0 && (
              <button className="swipe-cue" onClick={(event) => { releaseFocus(event); previousStory("button"); }} aria-label="Previous bok">
                <ChevronLeft className="size-4" />
                <span>previous</span>
              </button>
            )}
            {selectedIndex < rankedStories.length - 1 && (
              <button className="swipe-cue" onClick={(event) => { releaseFocus(event); nextStory("button"); }} aria-label="Next bok">
                <span>next bok</span>
                <ChevronRight className="size-4" />
              </button>
            )}
          </nav>
        </div>

        {guestNoticeStep && isGuestReader && !authPanelOpen && (
          <div className="guest-notice" role="status" aria-live="polite">
            <div className="guest-notice__copy">
              <p className="text-sm font-semibold">
                {guestNoticeStep === "first"
                  ? `${anonymousReadLimits.requiredSignup - anonymousReadLimits.firstNotice} more without an account`
                  : `${anonymousReadLimits.requiredSignup - anonymousReadLimits.secondNotice} more without an account`}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Reading is always free. An account saves your history and helps recommendations learn what you enjoy.
              </p>
            </div>
            <button className="guest-notice__dismiss" type="button" onClick={() => setGuestNoticeStep(null)} aria-label="Not now">
              <X className="size-4" />
            </button>
            <Button className="guest-notice__action" onClick={() => openAccount("notice")}>Create free account</Button>
          </div>
        )}

        {authorSheet && (
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
              void openReadBoks(storyId);
            }}
            onRequestAccount={() => {
              setAuthorSheet(null);
              openAccount("manual", "follow");
            }}
            onFollowChanged={(authorUserId, following) =>
              setFollowedAuthorIds((current) =>
                following
                  ? [...new Set([...current, authorUserId])]
                  : current.filter((id) => id !== authorUserId)
              )
            }
          />
        )}

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

        {/* Asked mid-story, so it asks for one thing and then gets out of the
            way. Once the note is sent the sheet has nothing left to ask: the
            heading thanks, and the button that used to say "Not now" - still
            offering to decline something already done - says Close. */}
        {feedbackMilestone !== null && (
          <ReaderSheet label="Tell us what you think" onClose={closeFeedbackSheet}>
            <ReaderSheetHeader
              label="Tell us what you think"
              onClose={closeFeedbackSheet}
              title={
                feedbackSent
                  ? "Thank you"
                  : feedbackMilestone === 3
                    ? "Three boks in - what do you think?"
                    : feedbackMilestone === 10
                      ? "Ten boks in - how is it going?"
                      : "Thirty boks in - you know this place now"
              }
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <FeedbackForm
                surface={surfaceForMilestone(feedbackMilestone)}
                boksRead={feedbackState.current.reads}
                visitorId={visitorId.current}
                onSent={() => setFeedbackSent(true)}
                autoFocus
              />
              <Button className="mt-4 w-full" variant="ghost" onClick={closeFeedbackSheet}>
                {feedbackSent ? "Close" : "Not now"}
              </Button>
            </div>
          </ReaderSheet>
        )}

        {bokMenuOpen && currentStory && (
          <ReaderSheet label="This bok" onClose={() => setBokMenuOpen(false)}>
            <ReaderSheetHeader label="This bok" onClose={() => setBokMenuOpen(false)} title="This bok" />

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <p className="truncate text-sm font-medium">{currentStory.title}</p>
              <p className="mt-0.5 truncate text-sm text-[var(--muted-foreground)]">
                {currentStory.authorName
                  ? `${currentStory.authorName} · @${currentStory.authorHandle.replace(/^@+/, "")}`
                  : `@${currentStory.authorHandle.replace(/^@+/, "")}`}
              </p>

              <Button className="mt-4 w-full justify-start" variant="outline" onClick={copyBokLink}>
                <LinkIcon className="size-4" /> Copy link to this bok
              </Button>

              {reportDone ? (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--reader)] p-4">
                  <p className="text-sm font-semibold">
                    {reportDone === "received" ? "Report sent" : "You have already reported this bok"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                    {reportDone === "received"
                      ? "A boks admin reads every report. If the piece has to come down, its author is told why."
                      : "It is already with an admin. There is nothing more to do."}
                  </p>
                  <Button className="mt-3 w-full" variant="ghost" onClick={() => setBokMenuOpen(false)}>
                    Back to reading
                  </Button>
                </div>
              ) : (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold">Report a problem</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">
                    Only boks admins see this. Tell us what is wrong and, if it is your work, how we
                    can tell.
                  </p>

                  <div className="mt-3 flex gap-2">
                    {(
                      [
                        ["copyright", "Copyright"],
                        ["other", "Something else"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`report-kind${reportKind === value ? " report-kind--on" : ""}`}
                        aria-pressed={reportKind === value}
                        onClick={() => setReportKind(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <Textarea
                    className="mt-3 min-h-[96px]"
                    value={reportReason}
                    placeholder={
                      reportKind === "copyright"
                        ? "This is my translation, first published in 1998. I never gave permission."
                        : "What is wrong with this bok?"
                    }
                    onChange={(event) => setReportReason(event.target.value)}
                  />

                  <Button
                    className="mt-3 w-full"
                    onClick={sendReport}
                    disabled={reportSending || reportReason.trim().length < 10}
                  >
                    <Flag className="size-4" /> {reportSending ? "Sending…" : "Send report"}
                  </Button>
                  {reportReason.trim().length > 0 && reportReason.trim().length < 10 && (
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                      A sentence or two, so an admin can act on it.
                    </p>
                  )}
                </div>
              )}
            </div>
          </ReaderSheet>
        )}

        <UserAuthPanel
          open={authPanelOpen}
          intent={authIntent}
          reason={authReason}
          notice={authNotice}
          guestReadCount={guestReadCount}
          currentUser={user}
          onClose={() => setAuthPanelOpen(false)}
          onOpenReadBoks={openReadBoks}
          onFollowsChanged={setFollowedAuthorIds}
          onUserChanged={handleUserChanged}
          onReadingLanguagesChanged={adoptReadingLanguages}
        />

        {isAdminReader && (
          <BokLifecycleDialog target={hideTarget} onClose={() => setHideTarget(null)} onDone={afterHideBok} />
        )}
        {firstVisitHint && (
          <p className="reader-hint" role="status">
            {firstVisitHint === "touch"
              ? "Swipe left for the next bok. Tap the page for likes, comments and more."
              : "Press → for the next bok. Click the page for likes, comments and more."}
          </p>
        )}
        {readerFlash && (
          <div className="reader-flash" role="status" aria-live="polite">
            <span>{readerFlash}</span>
            <button type="button" onClick={() => setReaderFlash("")} aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Above everything, and only for an admin. Nothing in here writes a
            reading event, so a demo does not become recommendation data. */}
        {cinemaOpen && currentStory && cinemaOffered && (
          <CinemaMode story={currentStory} finale={finale} onClose={() => setCinemaOpen(false)} />
        )}

        {poem && (
          <ImmersivePoem manifest={poem} finale={finale} onClose={() => setPoem(null)} />
        )}
      </section>
    </main>
  );
}
