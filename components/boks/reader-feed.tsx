"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, BookOpen, Heart, MessageCircle, Send, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { initialMetrics, initialProfile } from "@/components/boks/constants";
import type { BoksUserContext, Metrics, ReaderProfile, Story } from "@/components/boks/client-types";
import {
  anonymousReadLimits,
  getAnonymousBoksReadCount,
  getBrowserId,
  inferReadOutcome,
  profileBump,
  readAnonymousNoticeState,
  readProfile,
  recordAnonymousBoksRead,
  saveAnonymousNoticeState,
  saveProfile,
} from "@/components/boks/reader-behavior";
import { ActionButton } from "@/components/boks/shared-ui";
import { loadBoksUserContext, recordSupabaseView, setSupabaseLike } from "@/components/boks/supabase-browser-data";
import { UserAuthPanel } from "@/components/boks/user-auth-panel";
import { useBoksData } from "@/components/boks/use-boks-data";

export function ReaderFeed() {
  const {
    stories,
    comments,
    metrics,
    experiment,
    likedStoryIds,
    supabaseUserId,
    isSupabaseReader,
    status,
    setStatus,
    load,
  } = useBoksData();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [profile, setProfile] = useState<ReaderProfile>(initialProfile);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [readerName, setReaderName] = useState("Reader");
  const [isSubmitting, setSubmitting] = useState(false);
  const [readerChromeVisible, setReaderChromeVisible] = useState(true);
  const [user, setUser] = useState<BoksUserContext | null>(null);
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authReason, setAuthReason] = useState<"manual" | "notice" | "required">("manual");
  const [guestReadCount, setGuestReadCount] = useState(0);
  const [guestNoticeStep, setGuestNoticeStep] = useState<5 | 10 | null>(null);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const readStartedAt = useRef<number | null>(null);
  const chromeTimer = useRef<number | null>(null);
  const scrollIdleTimer = useRef<number | null>(null);
  const storyScroll = useRef<HTMLDivElement | null>(null);
  const storyProgress = useRef<Record<string, number>>({});
  const trackedOutcomes = useRef<Set<string>>(new Set());
  const countedAnonymousStories = useRef<Set<string>>(new Set());
  const metricsRef = useRef<Metrics>(initialMetrics);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    visitorId.current = getBrowserId("boks-reader");
    sessionId.current = `${Date.now()}-${crypto.randomUUID()}`;
    const profileTimer = window.setTimeout(() => setProfile(readProfile()), 0);
    load({ view: "reader", limit: 80, visitorId: visitorId.current })
      .then(async () => {
        let context: BoksUserContext | null = null;
        try {
          context = await loadBoksUserContext();
        } catch {
          context = null;
        }
        setUser(context);
        setGuestReadCount(getAnonymousBoksReadCount());
      })
      .catch((error) => setStatus(error.message));
    return () => window.clearTimeout(profileTimer);
  }, [load, setStatus]);

  const hideReaderChrome = useCallback(() => {
    if (!commentOpen) setReaderChromeVisible(false);
  }, [commentOpen]);

  const revealReaderChrome = useCallback((hideAfterMs = 3200) => {
    setReaderChromeVisible(true);
    if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
    if (hideAfterMs > 0) {
      chromeTimer.current = window.setTimeout(() => {
        if (!commentOpen) setReaderChromeVisible(false);
      }, hideAfterMs);
    }
  }, [commentOpen]);

  useEffect(() => {
    return () => {
      if (chromeTimer.current) window.clearTimeout(chromeTimer.current);
      if (scrollIdleTimer.current) window.clearTimeout(scrollIdleTimer.current);
    };
  }, []);

  const track = useCallback(async (eventType: string, storyId: string, value = 1, metadata = {}) => {
    if (isSupabaseReader) {
      if (eventType === "impression") {
        await recordSupabaseView(supabaseUserId, storyId);
      }
      return;
    }

    const elapsed = readStartedAt.current
      ? Math.max(0, Math.round((Date.now() - readStartedAt.current) / 1000))
      : 0;
    await fetch("/api/boks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "event",
        eventType,
        storyId,
        value,
        metadata,
        visitorId: visitorId.current,
        sessionId: sessionId.current,
        algorithmId: experiment?.algorithmId ?? "unassigned",
        userSegment: experiment?.userSegment ?? "general",
        surface: "reader",
        rank: selectedIndex,
        clientElapsedSeconds: elapsed,
      }),
    });
  }, [experiment?.algorithmId, experiment?.userSegment, isSupabaseReader, selectedIndex, supabaseUserId]);

  const rankedStories = useMemo(() => {
    return [...stories].sort((a, b) => {
      const fatigue = (story: Story) =>
        (profile.completed.includes(story.id) ? 2 : 0) + (profile.skipped.includes(story.id) ? 1 : 0);
      return fatigue(a) - fatigue(b);
    });
  }, [profile.completed, profile.skipped, stories]);

  const currentStory = rankedStories[selectedIndex] ?? rankedStories[0];
  const currentStoryId = currentStory?.id;
  const currentComments = comments.filter((comment) => comment.storyId === currentStory?.id).slice(0, 5);
  const persistedLikedStoryIds = useMemo(() => new Set(likedStoryIds), [likedStoryIds]);
  const isCurrentStoryLiked = currentStory ? liked[currentStory.id] ?? persistedLikedStoryIds.has(currentStory.id) : false;
  const isGuestReader = isSupabaseReader && (!user || user.isAnonymous);

  useEffect(() => {
    if (!currentStoryId) return;
    readStartedAt.current = Date.now();
    if (storyScroll.current) storyScroll.current.scrollTop = 0;
    const revealTimer = window.setTimeout(() => revealReaderChrome(3800), 0);
    track("impression", currentStoryId, 1, {
      rank: selectedIndex,
      algorithm: experiment?.algorithmId ?? "unassigned",
      segment: experiment?.userSegment ?? "general",
    }).catch(() => undefined);

    if (isGuestReader && !countedAnonymousStories.current.has(currentStoryId)) {
      countedAnonymousStories.current.add(currentStoryId);
      const nextCount = recordAnonymousBoksRead(currentStoryId);
      setGuestReadCount(nextCount);

      const notices = readAnonymousNoticeState();
      if (nextCount === anonymousReadLimits.firstNotice && !notices.first) {
        window.setTimeout(() => setGuestNoticeStep(anonymousReadLimits.firstNotice), 0);
        saveAnonymousNoticeState({ ...notices, first: true });
      } else if (nextCount === anonymousReadLimits.secondNotice && !notices.second) {
        window.setTimeout(() => setGuestNoticeStep(anonymousReadLimits.secondNotice), 0);
        saveAnonymousNoticeState({ ...notices, second: true });
      } else if (nextCount >= anonymousReadLimits.requiredSignup) {
        window.setTimeout(() => {
          setAuthReason("required");
          setAuthPanelOpen(true);
        }, 0);
      }
    }

    const startTimer = window.setTimeout(() => {
      track("start", currentStoryId, 1, { rank: selectedIndex }).catch(() => undefined);
      hideReaderChrome();
    }, 1800);

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(startTimer);
    };
  }, [
    currentStoryId,
    experiment?.algorithmId,
    experiment?.userSegment,
    hideReaderChrome,
    isGuestReader,
    revealReaderChrome,
    selectedIndex,
    track,
  ]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        revealReaderChrome(2400);
        nextStory("keyboard");
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        revealReaderChrome(2400);
        move(-1);
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

  function move(delta: number) {
    if (!rankedStories.length) return;
    setCommentOpen(false);
    revealReaderChrome(3800);
    setSelectedIndex((index) => (index + delta + rankedStories.length) % rankedStories.length);
  }

  function openAccount(reason: "manual" | "notice" | "required" = "manual") {
    setAuthReason(reason);
    setAuthPanelOpen(true);
    setGuestNoticeStep(null);
    revealReaderChrome(0);
  }

  function elapsedReadingSeconds() {
    return readStartedAt.current
      ? Math.max(0, Math.round((Date.now() - readStartedAt.current) / 1000))
      : 0;
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

  async function recordReadingOutcome(reason: "swipe" | "button" | "keyboard") {
    if (!currentStory) return;
    const key = `${sessionId.current}:${currentStory.id}`;
    if (trackedOutcomes.current.has(key)) return;

    trackedOutcomes.current.add(key);
    const elapsedSeconds = elapsedReadingSeconds();
    const progress = updateStoryProgress();
    const outcome = inferReadOutcome(currentStory, elapsedSeconds, progress);

    persistProfile(profileBump(profile, currentStory, outcome));
    await track(outcome, currentStory.id, outcome === "complete" ? Math.max(5, elapsedSeconds) : 1, {
      from: reason,
      inferred: true,
      progress: Math.round(progress * 100) / 100,
      elapsedSeconds,
    });
  }

  async function nextStory(reason: "swipe" | "button" | "keyboard" = "swipe") {
    await recordReadingOutcome(reason);
    if (isGuestReader && guestReadCount >= anonymousReadLimits.requiredSignup) {
      openAccount("required");
      return;
    }
    move(1);
  }

  async function likeStory() {
    if (!currentStory) return;
    const nextLiked = !isCurrentStoryLiked;
    setLiked((state) => ({ ...state, [currentStory.id]: nextLiked }));

    try {
      if (isSupabaseReader) {
        await setSupabaseLike(supabaseUserId, currentStory.id, nextLiked);
      } else if (nextLiked) {
        await track("like", currentStory.id);
      }

      if (nextLiked) {
        persistProfile(profileBump(profile, currentStory, "like"));
      }
      await load({ view: "reader", limit: 80, visitorId: visitorId.current });
      const nextUser = await loadBoksUserContext();
      setUser(nextUser);
    } catch (error) {
      setLiked((state) => ({ ...state, [currentStory.id]: !nextLiked }));
      setStatus(error instanceof Error ? error.message : "Could not update like");
    }
  }

  async function shareStory() {
    if (!currentStory) return;
    const text = `Read "${currentStory.title}" on boks`;
    if (navigator.share) {
      await navigator.share({ title: currentStory.title, text, url: window.location.href });
    } else {
      await navigator.clipboard.writeText(`${text}: ${window.location.href}`);
      setStatus("Copied");
    }
    await track("share", currentStory.id);
    await load({ view: "reader", limit: 80, visitorId: visitorId.current });
  }

  async function submitComment() {
    if (!currentStory || !commentText.trim()) return;
    setSubmitting(true);
    const response = await fetch("/api/boks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "comment",
        storyId: currentStory.id,
        body: commentText,
        visitorName: readerName,
        visitorId: visitorId.current,
        sessionId: sessionId.current,
        algorithmId: experiment?.algorithmId ?? "unassigned",
        userSegment: experiment?.userSegment ?? "general",
        surface: "reader",
        rank: selectedIndex,
        clientElapsedSeconds: readStartedAt.current
          ? Math.max(0, Math.round((Date.now() - readStartedAt.current) / 1000))
          : 0,
      }),
    });
    setSubmitting(false);
    if (response.ok) {
      setCommentText("");
      await load({ view: "reader", limit: 80, visitorId: visitorId.current });
    }
  }

  const handleUserChanged = useCallback((nextUser: BoksUserContext | null) => {
    setUser(nextUser);
    if (nextUser && !nextUser.isAnonymous) {
      setAuthReason("manual");
      setAuthPanelOpen(false);
      load({ view: "reader", limit: 80, visitorId: visitorId.current }).catch((error) => setStatus(error.message));
    }
  }, [load, setStatus]);

  function onTouchStart(event: React.TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: React.TouchEvent<HTMLElement>) {
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    touchStart.current = null;
    if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx)) {
      if (dy < 0) {
        nextStory("swipe");
      } else {
        move(-1);
      }
    }
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        nextStory("swipe");
      } else {
        move(-1);
      }
    }
  }

  function onReaderPointerDown(event: React.PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select")) return;
    revealReaderChrome(3600);
  }

  function onStoryScroll() {
    updateStoryProgress();
    hideReaderChrome();
    if (scrollIdleTimer.current) window.clearTimeout(scrollIdleTimer.current);
    scrollIdleTimer.current = window.setTimeout(() => {
      revealReaderChrome(3000);
    }, 1400);
  }

  if (!currentStory) {
    return (
      <main className="reader-shell grid min-h-screen place-items-center px-6">
        <div className="text-center">
          <p className="brand-word">boks</p>
          <p className="mt-3 text-[var(--muted-foreground)]">{status}</p>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`reader-shell h-[100svh] overflow-hidden text-[var(--foreground)] ${
        readerChromeVisible || commentOpen ? "reader-shell--chrome" : "reader-shell--focus"
      }`}
    >
      <section
        className="relative mx-auto grid h-full min-w-0 w-full max-w-[1120px] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_84px]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onPointerDown={onReaderPointerDown}
      >
        <article className="reader-card relative m-2 grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--reader)] shadow-[0_18px_70px_rgb(40_29_18/12%)] sm:m-4 lg:m-6">
          <header className="reader-topbar z-10 flex items-center justify-between px-5 py-4 sm:px-8">
            <button className="brand-word brand-button" onClick={() => openAccount("manual")} aria-label="Open boks account">
              boks
            </button>
            <div className="reader-meta flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <BookOpen className="size-4" />
              <span>{currentStory.minutes} min</span>
            </div>
          </header>

          <div
            ref={storyScroll}
            className="story-scroll min-h-0 min-w-0 overflow-y-auto px-5 pb-28 sm:px-10 sm:pb-12 lg:px-16"
            onScroll={onStoryScroll}
          >
            <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-start py-7 sm:py-12">
              <div className="story-tags mb-5 flex flex-wrap gap-2 text-sm text-[var(--muted-foreground)]">
                <span>{currentStory.genre}</span>
                <span>·</span>
                <span>{currentStory.mood}</span>
              </div>
              <h1 className="max-w-[720px] break-words text-[2.18rem] font-semibold leading-[1.04] tracking-normal text-[var(--foreground)] sm:text-[4.7rem]">
                {currentStory.title}
              </h1>
              <p className="mt-5 max-w-[650px] text-xl leading-8 text-[var(--soft-foreground)]">
                {currentStory.hook}
              </p>
              <div className="story-copy mt-8 max-w-[680px] text-[1.08rem] leading-8 text-[var(--foreground)] sm:text-[1.18rem] sm:leading-9">
                {currentStory.body.split("\n").map((paragraph) => (
                  <p key={paragraph} className="mb-6">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <footer className="reader-footer z-10 flex items-end justify-between gap-4 px-5 py-4 sm:px-8">
            <div className="reader-author">
              <p className="text-base font-semibold">{currentStory.authorName}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{currentStory.authorHandle || "boks author"}</p>
            </div>
            <button className="swipe-cue" onClick={() => nextStory("button")} aria-label="Next story">
              <span>next</span>
              <ArrowDown className="size-4" />
            </button>
          </footer>
        </article>

        <aside className="action-rail reader-ui pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center gap-3 lg:static lg:inset-auto lg:flex-col lg:justify-center">
          <ActionButton label="Like" value={currentStory.likes} onClick={likeStory} active={isCurrentStoryLiked}>
            <Heart className="size-5" />
          </ActionButton>
          <ActionButton label="Comment" value={currentStory.commentsCount} onClick={() => setCommentOpen(true)}>
            <MessageCircle className="size-5" />
          </ActionButton>
          <ActionButton label="Share" value={currentStory.shares} onClick={shareStory}>
            <Share2 className="size-5" />
          </ActionButton>
        </aside>

        {guestNoticeStep && isGuestReader && !authPanelOpen && (
          <div className="guest-notice">
            <div>
              <p className="text-sm font-semibold">
                {guestNoticeStep === 5 ? "You have read 5 boks as a guest." : "You have read 10 boks as a guest."}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Guest reading is open for 15 boks. Sign up when you want to save history and keep going.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setGuestNoticeStep(null)}>Later</Button>
              <Button onClick={() => openAccount("notice")}>Sign in</Button>
            </div>
          </div>
        )}

        {commentOpen && (
          <div className="absolute inset-x-2 bottom-2 z-30 rounded-[24px] border border-[var(--border)] bg-[var(--card)] p-4 shadow-[0_18px_70px_rgb(40_29_18/18%)] sm:inset-x-auto sm:bottom-6 sm:right-24 sm:w-[360px]">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold tracking-normal">Responses</h2>
              <Button variant="ghost" size="icon" onClick={() => setCommentOpen(false)} aria-label="Close comments">
                <X className="size-4" />
              </Button>
            </div>
            <div className="mt-3 grid max-h-[220px] gap-2 overflow-y-auto">
              {currentComments.length ? (
                currentComments.map((comment) => (
                  <div key={comment.id} className="rounded-md bg-[var(--muted)] p-3">
                    <p className="text-sm font-medium">{comment.visitorName}</p>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{comment.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">No responses yet.</p>
              )}
            </div>
            <div className="mt-3 grid gap-2">
              <Input aria-label="Reader name" value={readerName} onChange={(event) => setReaderName(event.target.value)} />
              <Textarea
                aria-label="Comment"
                placeholder="One sentence after reading"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
              />
              <Button onClick={submitComment} disabled={isSubmitting || !commentText.trim()}>
                <Send className="size-4" /> Send
              </Button>
            </div>
          </div>
        )}

        <UserAuthPanel
          open={authPanelOpen}
          reason={authReason}
          guestReadCount={guestReadCount}
          onClose={() => setAuthPanelOpen(false)}
          onUserChanged={handleUserChanged}
        />
      </section>
    </main>
  );
}
