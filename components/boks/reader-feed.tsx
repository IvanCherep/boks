"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Flag,
  Heart,
  Link as LinkIcon,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { initialMetrics, initialProfile } from "@/components/boks/constants";
import type {
  BoksUserContext,
  Metrics,
  ReaderProfile,
  FeedProvenance,
  RecommendationExperiment,
  Story,
} from "@/components/boks/client-types";
import {
  anonymousReadLimits,
  expectedReadingSeconds,
  getAnonymousBoksReadCount,
  getBrowserId,
  inferReadOutcome,
  profileBump,
  readAnonymousReadState,
  readAnonymousNoticeState,
  readProfile,
  recordAnonymousBoksRead,
  saveAnonymousNoticeState,
  saveProfile,
} from "@/components/boks/reader-behavior";
import { recoverReaderPlace } from "@/components/boks/reader-place";
import {
  edgeTapIntent,
  getScrollBoundary,
  horizontalNavigationIntent,
  verticalBoundaryIntent,
  type ReaderNavigationDirection,
} from "@/components/boks/reader-navigation";
import { ActionButton } from "@/components/boks/shared-ui";
import { ReaderSheet, ReaderSheetHeader } from "@/components/boks/reader-sheet";
import { readableBoksError } from "@/lib/boks/errors";
import {
  emptyFeedNotice,
  effectiveReadingLanguages,
  normalizeReadingLanguages,
  readingLanguageNames,
  rememberReadingLanguages,
} from "@/components/boks/reading-languages";
import { shortTimeAgo } from "@/components/boks/client-format";
import { attachReaderClock, createReaderClock, type ReaderClock } from "@/components/boks/reader-clock";
import { formatReaderBody } from "@/components/boks/reader-text";
import { haptic } from "@/components/boks/reader-haptics";
import { AuthorSheet } from "@/components/boks/author-sheet";
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
import { currentBoksTermsVersion, type AuthPanelMode, UserAuthPanel } from "@/components/boks/user-auth-panel";
import { useBoksData } from "@/components/boks/use-boks-data";

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

type StoryTransition =
  | { phase: "idle"; direction: null }
  | { phase: "entering"; direction: ReaderNavigationDirection };

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
  const [commentText, setCommentText] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [readerChromeVisible, setReaderChromeVisible] = useState(true);
  /** The boks the reader is on, held across a feed reload. See the effect below. */
  const pinnedStoryId = useRef<string | null>(null);
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
  const [authInitialMode, setAuthInitialMode] = useState<AuthPanelMode>("signup");
  const [authIntent, setAuthIntent] = useState<AuthIntent>("general");
  const [authNotice, setAuthNotice] = useState("");
  const [guestReadCount, setGuestReadCount] = useState(0);
  const [guestNoticeStep, setGuestNoticeStep] = useState<"first" | "second" | null>(null);
  const [libraryStories, setLibraryStories] = useState<Story[]>([]);
  const [followedAuthorIds, setFollowedAuthorIds] = useState<string[]>([]);
  const [followBusy, setFollowBusy] = useState(false);
  const [authorSheet, setAuthorSheet] = useState<{ handle: string; authorName?: string } | null>(null);
  const [bokMenuOpen, setBokMenuOpen] = useState(false);
  const [reportKind, setReportKind] = useState<"copyright" | "other">("copyright");
  const [reportReason, setReportReason] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone] = useState<"received" | "already" | null>(null);
  const [storyHasMore, setStoryHasMore] = useState(false);
  const [storyTransition, setStoryTransition] = useState<StoryTransition>({ phase: "idle", direction: null });
  const [pendingLibraryStoryId, setPendingLibraryStoryId] = useState<string | null>(null);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const touchStart = useRef<{ x: number; y: number; atTop: boolean; atBottom: boolean } | null>(null);
  const pointerStart = useRef<{ x: number; y: number; atTop: boolean; atBottom: boolean } | null>(null);
  const wheelTravel = useRef({ x: 0, y: 0, lastAt: 0 });
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
        limit: 80,
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

  const reloadFeedKeepingPlace = useCallback(async () => {
    pinnedStoryId.current = currentStoryRef.current?.id ?? null;
    await loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    visitorId.current = getBrowserId("boks-reader");
    sessionId.current = `${Date.now()}-${crypto.randomUUID()}`;
    const profileTimer = window.setTimeout(() => setProfile(readProfile()), 0);
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
          await loadFeed();
        }
        setGuestReadCount(getAnonymousBoksReadCount());
        const magicLinkNotice = consumeBoksMagicLinkRedirectNotice();
        if (magicLinkNotice) {
          setAuthNotice(magicLinkNotice);
          setAuthReason("required");
          setAuthInitialMode("signin");
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
      .catch((error) => setStatus(error.message))
      // A failed feed load must still settle the identity, or a real guest
      // never meets the sign-up gate at all.
      .finally(() => setIdentitySettled(true));
    return () => window.clearTimeout(profileTimer);
  }, [loadFeed, setStatus]);

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

    const result = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      completePendingBoksMagicLinkProfile(currentBoksTermsVersion)
        .then(async (context) => {
          const nextUser = context ?? (await loadBoksUserContext());
          setUser(nextUser);
          loadFeed().catch((error) => setStatus(error instanceof Error ? error.message : "Could not refresh feed."));
        })
        .catch((error) => setStatus(error instanceof Error ? error.message : "Could not finish sign in."));
    });

    return () => result.data.subscription.unsubscribe();
  }, [loadFeed, setStatus]);

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
   * Feed order comes from the ranking, not from the browser. Boks opened from
   * the reader's history are appended so they can be reopened by id.
   */
  const rankedStories = useMemo(() => {
    const feedIds = new Set(stories.map((story) => story.id));
    return [...stories, ...libraryStories.filter((story) => !feedIds.has(story.id))];
  }, [libraryStories, stories]);

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
  const currentAuthorLabel = currentStory?.authorName || (currentStory?.authorHandle ? `@${currentStory.authorHandle.replace(/^@+/, "")}` : "boks author");
  const persistedLikedStoryIds = useMemo(() => new Set(likedStoryIds), [likedStoryIds]);
  const isCurrentStoryLiked = currentStory ? liked[currentStory.id] ?? persistedLikedStoryIds.has(currentStory.id) : false;
  // Nobody is a guest before the account lookup has answered.
  const isGuestReader = identitySettled && isSupabaseReader && (!user || user.isAnonymous);
  const hasSignedInAccount = Boolean(user && !user.isAnonymous);
  const readerInteractionBlocked = Boolean(authPanelOpen || commentOpen || authorSheet || bokMenuOpen);

  /**
   * A reload re-ranks the feed, and the reader's place is an index into that
   * ranking - so the same index can land on a different boks. Liking, sharing
   * or commenting all refresh the feed, and none of them may move a reader off
   * the piece they are acting on, so the boks id is pinned across the reload
   * and the index is recovered from it.
   */
  useEffect(() => {
    const pinned = pinnedStoryId.current;
    if (!pinned || !rankedStories.length) return;
    pinnedStoryId.current = null;
    setSelectedIndex((index) => recoverReaderPlace(rankedStories.map((story) => story.id), pinned, index));
  }, [rankedStories]);

  useEffect(() => {
    if (!pendingLibraryStoryId) return;
    const index = rankedStories.findIndex((story) => story.id === pendingLibraryStoryId);
    if (index < 0) return;

    const handle = window.setTimeout(() => {
      setCommentOpen(false);
      setSelectedIndex(index);
      setAuthPanelOpen(false);
      setPendingLibraryStoryId(null);
      revealReaderChrome(3800);
    }, 0);

    return () => window.clearTimeout(handle);
  }, [pendingLibraryStoryId, rankedStories, revealReaderChrome]);

  useEffect(() => {
    if (!currentStory || !currentStoryId) return;
    readingClock.current.restart();
    if (storyScroll.current) storyScroll.current.scrollTop = 0;
    const overflowTimer = window.setTimeout(updateStoryOverflow, 0);
    const revealTimer = window.setTimeout(() => revealReaderChrome(5200), 0);
    recordReaderEvent("impression", currentStory, 1, {
      genre: currentStory.genre,
      mood: currentStory.mood,
      // How much was there to choose from, and how much of it was new. A feed
      // ranked over three unread boks is not a ranking.
      ...catalogContextRef.current,
    });

    if (isGuestReader && !countedAnonymousStories.current.has(currentStoryId)) {
      const anonymousState = readAnonymousReadState();
      const alreadyRead = anonymousState.storyIds.includes(currentStoryId);

      if (!alreadyRead && anonymousState.storyIds.length >= anonymousReadLimits.requiredSignup) {
        window.setTimeout(() => {
          setGuestReadCount(anonymousState.storyIds.length);
          setAuthReason("required");
          setAuthPanelOpen(true);
          setGuestNoticeStep(null);
        }, 0);
      } else {
        countedAnonymousStories.current.add(currentStoryId);
        const nextCount = recordAnonymousBoksRead(currentStoryId);
        window.setTimeout(() => setGuestReadCount(nextCount), 0);

        const notices = readAnonymousNoticeState();
        if (nextCount === anonymousReadLimits.firstNotice && !notices.first) {
          window.setTimeout(() => setGuestNoticeStep("first"), 0);
          saveAnonymousNoticeState({ ...notices, first: true });
        } else if (nextCount === anonymousReadLimits.secondNotice && !notices.second) {
          window.setTimeout(() => setGuestNoticeStep("second"), 0);
          saveAnonymousNoticeState({ ...notices, second: true });
        }
      }
    }

    const startTimer = window.setTimeout(() => {
      recordReaderEvent("start", currentStory, 1, { genre: currentStory.genre, mood: currentStory.mood });
      hideReaderChrome();
    }, 2600);

    return () => {
      window.clearTimeout(overflowTimer);
      window.clearTimeout(revealTimer);
      window.clearTimeout(startTimer);
    };
  }, [
    currentStory,
    currentStoryId,
    hideReaderChrome,
    isGuestReader,
    recordReaderEvent,
    revealReaderChrome,
  ]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (readerInteractionBlocked) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, a, input, textarea, select, [role='dialog'], [contenteditable='true']")) return;

      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        revealReaderChrome(4200);
        nextStory("keyboard");
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        revealReaderChrome(4200);
        previousStory("keyboard");
      }
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

  function transitionToStory(targetIndex: number) {
    if (!rankedStories.length || storyTransitionLocked.current) return false;

    const boundedIndex = Math.max(0, Math.min(rankedStories.length - 1, targetIndex));
    if (boundedIndex === selectedIndex) return false;

    setCommentOpen(false);
    revealReaderChrome(3800);
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
    setStoryTransition({ phase: "entering", direction });

    const transitionTimer = window.setTimeout(() => {
      storyTransitionLocked.current = false;
      setStoryTransition({ phase: "idle", direction: null });
      storyTransitionTimers.current = [];
    }, storyTransitionDurationMs);
    storyTransitionTimers.current.push(transitionTimer);
    return true;
  }

  function move(delta: number) {
    return transitionToStory(selectedIndex + delta);
  }

  function previousStory(reason: "swipe" | "button" | "keyboard" = "swipe") {
    if (storyTransitionLocked.current) return;
    if (selectedIndex <= 0) {
      revealReaderChrome(2400);
      return;
    }
    recordReadingOutcome(reason);
    haptic("selection");
    move(-1);
  }

  function navigateStory(direction: ReaderNavigationDirection, reason: "swipe" | "button" | "keyboard" = "swipe") {
    if (direction === "previous") previousStory(reason);
    else void nextStory(reason);
  }

  function openAccount(
    reason: "manual" | "notice" | "required" = "manual",
    initialMode: AuthPanelMode = "signup",
    intent: AuthIntent = "general"
  ) {
    setAuthReason(reason);
    setAuthInitialMode(initialMode);
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
      revealReaderChrome(3800);
      recordReaderEvent("impression", currentStory, 1, { from: "library", reread: true });
      return;
    }

    const existingIndex = rankedStories.findIndex((story) => story.id === storyId);
    if (existingIndex >= 0) {
      setCommentOpen(false);
      setSelectedIndex(existingIndex);
      setAuthPanelOpen(false);
      revealReaderChrome(3800);
      return;
    }

    try {
      const story = await loadSupabaseStory(storyId);
      if (!story) {
        setStatus("This boks is no longer available.");
        return;
      }

      setLibraryStories((current) => [story, ...current.filter((item) => item.id !== story.id)]);
      setPendingLibraryStoryId(story.id);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open this boks.");
    }
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
    const outcome = inferReadOutcome(currentStory, elapsedSeconds, progress);

    persistProfile(profileBump(profile, currentStory, outcome));
    recordReaderEvent(outcome, currentStory, outcome === "complete" ? Math.max(5, elapsedSeconds) : 1, {
      from: reason,
      inferred: true,
      progress: Math.round(progress * 100) / 100,
      genre: currentStory.genre,
      mood: currentStory.mood,
    });
  }

  async function nextStory(reason: "swipe" | "button" | "keyboard" = "swipe") {
    if (storyTransitionLocked.current) return;
    if (selectedIndex >= rankedStories.length - 1) {
      revealReaderChrome(2400);
      return;
    }
    recordReadingOutcome(reason);
    if (isGuestReader && getAnonymousBoksReadCount() >= anonymousReadLimits.requiredSignup) {
      openAccount("required");
      return;
    }
    haptic("selection");
    move(1);
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
      await loadFeed();
    } catch (error) {
      setStatus(readableBoksError(error, "Could not change your languages."));
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

  async function copyBokLink() {
    if (!currentStory) return;
    const url = `${window.location.origin}/b/${currentStory.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("Link copied");
    } catch {
      setStatus(url);
    }
  }

  async function sendReport() {
    if (!currentStory) return;

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
      setStatus(readableBoksError(error, "Could not send that report."));
    } finally {
      setReportSending(false);
    }
  }

  async function likeStory() {
    if (!currentStory) return;
    if (!hasSignedInAccount) {
      setCommentOpen(false);
      openAccount("manual", "signup", "like");
      return;
    }

    const nextLiked = !isCurrentStoryLiked;
    if (nextLiked) haptic("confirm");
    setLiked((state) => ({ ...state, [currentStory.id]: nextLiked }));

    try {
      if (isSupabaseReader) {
        await setSupabaseLike(supabaseUserId, currentStory.id, nextLiked);
      }

      if (nextLiked) {
        recordReaderEvent("like", currentStory);
        persistProfile(profileBump(profile, currentStory, "like"));
      }
      await reloadFeedKeepingPlace();
      const nextUser = await loadBoksUserContext();
      setUser(nextUser);
    } catch (error) {
      setLiked((state) => ({ ...state, [currentStory.id]: !nextLiked }));
      setStatus(error instanceof Error ? error.message : "Could not update like");
    }
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

    if (!hasSignedInAccount) {
      openAccount("manual", "signup", "follow");
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
      setStatus(error instanceof Error ? error.message : "Could not update following.");
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
    const text = `Read "${currentStory.title}" on boks`;
    // The feed URL would open a different boks for whoever received it.
    const url = `${window.location.origin}/b/${currentStory.id}`;
    if (navigator.share) {
      await navigator.share({ title: currentStory.title, text, url });
    } else {
      await navigator.clipboard.writeText(`${text}: ${url}`);
      setStatus("Link copied");
    }
    recordReaderEvent("share", currentStory);
    await reloadFeedKeepingPlace();
  }

  async function submitComment() {
    if (!currentStory || !commentText.trim()) return;

    if (!hasSignedInAccount) {
      openAccount("manual", "signup", "comment");
      return;
    }

    setSubmitting(true);
    try {
      if (isSupabaseReader) {
        await submitSupabaseComment(currentStory.id, commentText);
      } else {
        const response = await fetch("/api/boks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "comment",
            storyId: currentStory.id,
            body: commentText,
            visitorName: user?.handle || "reader",
            visitorId: visitorId.current,
            sessionId: sessionId.current,
            surface: "reader",
          }),
        });
        if (!response.ok) throw new Error("Could not send comment.");
      }

      recordReaderEvent("comment", currentStory);
      setCommentText("");
      await reloadFeedKeepingPlace();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not send comment.");
    } finally {
      setSubmitting(false);
    }
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
    if (nextUser && !nextUser.isAnonymous) {
      setAuthReason("manual");
      loadFeed().catch((error) => setStatus(error.message));
    }
  }, [loadFeed, setStatus]);

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
    const boundary = storyScroll.current
      ? getScrollBoundary(storyScroll.current)
      : { atTop: true, atBottom: true };
    touchStart.current = { x: touch.clientX, y: touch.clientY, ...boundary };
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
    const vertical = verticalBoundaryIntent(dy, start);
    if (horizontal || vertical) navigateStory(horizontal ?? vertical!, "swipe");
  }

  function onReaderPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (readerInteractionBlocked) {
      pointerStart.current = null;
      return;
    }
    if (event.pointerType === "touch") return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select, [role='dialog']")) return;
    const boundary = storyScroll.current
      ? getScrollBoundary(storyScroll.current)
      : { atTop: true, atBottom: true };
    pointerStart.current = { x: event.clientX, y: event.clientY, ...boundary };
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

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const moved = Math.hypot(dx, dy);
    const dragged = horizontalNavigationIntent(dx, dy) ?? verticalBoundaryIntent(dy, start);
    if (dragged) {
      navigateStory(dragged, "swipe");
      return;
    }

    if (moved <= 10) {
      if (window.getSelection()?.toString()) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const edge = edgeTapIntent(event.clientX, bounds.left, bounds.width);
      if (edge) navigateStory(edge, "button");
      else revealReaderChrome(6200);
    }
  }

  function onStoryWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (readerInteractionBlocked) return;
    const now = performance.now();
    if (now - lastWheelNavigationAt.current < 700) return;
    if (now - wheelTravel.current.lastAt > 240) wheelTravel.current = { x: 0, y: 0, lastAt: now };

    wheelTravel.current.x += event.deltaX;
    wheelTravel.current.y += event.deltaY;
    wheelTravel.current.lastAt = now;

    const horizontal = horizontalNavigationIntent(wheelTravel.current.x, wheelTravel.current.y, 120);
    const boundary = storyScroll.current
      ? getScrollBoundary(storyScroll.current)
      : { atTop: true, atBottom: true };
    const vertical = verticalBoundaryIntent(-wheelTravel.current.y, boundary, 150);
    const intent = horizontal ?? vertical;
    if (!intent) return;

    lastWheelNavigationAt.current = now;
    wheelTravel.current = { x: 0, y: 0, lastAt: now };
    navigateStory(intent, "swipe");
  }

  function onStoryScroll() {
    updateStoryProgress();
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
        className="relative mx-auto grid h-full min-w-0 w-full max-w-[1120px] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_84px]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onPointerDown={onReaderPointerDown}
        onPointerUp={onReaderPointerUp}
      >
        <article
          className="reader-card relative grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--reader)]"
          inert={readerInteractionBlocked ? true : undefined}
        >
          <header className="reader-topbar z-10 grid grid-cols-[1fr_auto_1fr] items-center px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-6">
            <button className="reader-account-trigger reader-ui" onClick={() => openAccount("manual")} aria-label="Open settings">
              <UserRound className="size-5" />
            </button>
            <span className="brand-word reader-brand-mark" aria-label="boks">boks</span>
            <button type="button" className="reader-more reader-ui justify-self-end" onClick={openBokMenu} aria-label="More about this bok">
              <MoreHorizontal className="size-5" />
            </button>
          </header>

          <div
            key={currentStory.id}
            ref={storyScroll}
            className={`story-scroll reader-story-stage min-h-0 min-w-0 overflow-y-auto px-6 pb-32 sm:px-10 sm:pb-16 lg:px-16 ${
              storyHasMore ? "story-scroll--more" : ""
            } ${
              storyTransition.phase === "idle"
                ? ""
                : `story-transition--${storyTransition.phase}-${storyTransition.direction}`
            }`}
            onScroll={onStoryScroll}
            onWheel={onStoryWheel}
          >
            <div className="reader-content mx-auto flex min-h-full max-w-[720px] flex-col justify-start pb-16 pt-5 sm:pb-20 sm:pt-10">
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
                    onClick={toggleFollow}
                    disabled={followBusy}
                    aria-pressed={isFollowingCurrentAuthor}
                  >
                    {isFollowingCurrentAuthor ? <><Check className="size-3.5" /> Following</> : "Follow"}
                  </button>
                )}
              </div>

              <h1 className="reader-title max-w-[680px] break-words text-[var(--foreground)]">
                {currentStory.title}
              </h1>
              {currentStory.hook?.trim() && (
                <p className="reader-hook mt-6 max-w-[650px] text-[var(--soft-foreground)]">
                  {currentStory.hook}
                </p>
              )}
              <div className={`story-copy max-w-[680px] text-[var(--foreground)] ${currentStory.hook?.trim() ? "mt-8" : "mt-7"}`}>
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

          <footer className="reader-footer reader-ui z-10 flex items-center justify-end gap-2 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-8 sm:pb-6">
            {selectedIndex > 0 && (
              <button className="swipe-cue" onClick={() => previousStory("button")} aria-label="Previous bok">
                <ChevronLeft className="size-4" />
                <span>previous</span>
              </button>
            )}
            {selectedIndex < rankedStories.length - 1 && (
              <button className="swipe-cue" onClick={() => nextStory("button")} aria-label="Next bok">
                <span>next bok</span>
                <ChevronRight className="size-4" />
              </button>
            )}
          </footer>
        </article>

        <aside
          className="action-rail reader-ui pointer-events-none absolute inset-x-4 z-20 flex justify-center gap-2 lg:static lg:inset-auto lg:flex-col lg:justify-center"
          inert={readerInteractionBlocked ? true : undefined}
        >
          {/* Only the comment count is a real public number. A like is visible
              to no one but the reader who made it, and a share cannot be
              counted at all once the link leaves the app, so both are shown as
              actions rather than as a tally that would always read 0 or 1. */}
          <ActionButton
            label={isCurrentStoryLiked ? "Remove like" : "Like"}
            onClick={likeStory}
            active={isCurrentStoryLiked}
          >
            <Heart className="size-5" />
          </ActionButton>
          <ActionButton label="Comment" value={currentStory.commentsCount} onClick={() => setCommentOpen(true)}>
            <MessageCircle className="size-5" />
          </ActionButton>
          <ActionButton label="Share" onClick={shareStory}>
            <Share2 className="size-5" />
          </ActionButton>
        </aside>

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
            <Button className="guest-notice__action" onClick={() => openAccount("notice", "signup")}>Create free account</Button>
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
            onOpenBok={(storyId) => {
              setAuthorSheet(null);
              void openReadBoks(storyId);
            }}
            onRequestAccount={() => {
              setAuthorSheet(null);
              openAccount("manual", "signup", "follow");
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

        {commentOpen && (
          <ReaderSheet label="Responses" onClose={() => setCommentOpen(false)}>
            <ReaderSheetHeader
              label="Responses"
              onClose={() => setCommentOpen(false)}
              title={`Responses${currentComments.length ? ` · ${currentComments.length}` : ""}`}
            />

            {/* Takes the height the sheet actually has. A fixed 220px box left
                most of a phone screen empty and made reading a scroll inside a
                scroll. */}
            <div className="comment-list min-h-0 flex-1 overflow-y-auto px-4 pb-2">
              {currentComments.length ? (
                <ul className="grid gap-3 py-1">
                  {currentComments.map((comment) => {
                    const handle = (comment.visitorHandle || comment.visitorName || "reader").replace(/^@+/, "");
                    const isAuthor =
                      Boolean(currentStory.authorHandle) &&
                      handle.toLowerCase() === currentStory.authorHandle.replace(/^@+/, "").toLowerCase();

                    return (
                      <li key={comment.id} className="comment-item">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="text-sm font-semibold">@{handle}</span>
                          {isAuthor && <span className="comment-author-tag">author</span>}
                          <span className="text-xs text-[var(--muted-foreground)]">
                            {shortTimeAgo(comment.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[var(--foreground)]">{comment.body}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">
                  No responses yet. Say the first thing.
                </p>
              )}
            </div>

            {/* One row, always reachable with a thumb. */}
            <div className="comment-composer">
              {hasSignedInAccount ? (
                <>
                  <Textarea
                    aria-label="Comment"
                    placeholder="One sentence after reading"
                    rows={1}
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    onKeyDown={(event) => {
                      // Enter sends; Shift+Enter keeps the line break. A one-line
                      // reply should not need a reach for the button.
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (!isSubmitting && commentText.trim()) submitComment();
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    onClick={submitComment}
                    disabled={isSubmitting || !commentText.trim()}
                    aria-label="Send response"
                  >
                    <Send className="size-4" />
                  </Button>
                </>
              ) : (
                <Button className="w-full" onClick={() => openAccount("manual", "signup", "comment")}>
                  Create a free account to respond
                </Button>
              )}
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
          initialMode={authInitialMode}
          notice={authNotice}
          guestReadCount={guestReadCount}
          currentUser={user}
          onClose={() => setAuthPanelOpen(false)}
          onOpenReadBoks={openReadBoks}
          onFollowsChanged={setFollowedAuthorIds}
          onUserChanged={handleUserChanged}
        />
      </section>
    </main>
  );
}
