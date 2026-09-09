"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  BookOpen,
  Check,
  Download,
  Heart,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  Share2,
  TrendingUp,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

declare global {
  interface Document {
    modelContext?: {
      registerTool: (
        tool: {
          name: string;
          title?: string;
          description: string;
          inputSchema: object;
          annotations?: Record<string, boolean>;
          execute: (input: unknown) => unknown | Promise<unknown>;
        },
        options?: { signal?: AbortSignal }
      ) => void | Promise<void>;
    };
  }
}

type Story = {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  hook: string;
  body: string;
  genre: string;
  mood: string;
  minutes: number;
  likes: number;
  shares: number;
  starts: number;
  completes: number;
  commentsCount: number;
  avgSeconds: number;
};

type Comment = {
  id: number;
  storyId: string;
  visitorName: string;
  body: string;
  createdAt: string;
};

type Metrics = {
  funnel: Record<string, number>;
  stories: Array<Record<string, number | string>>;
  recentEvents: Array<Record<string, number | string>>;
  genres?: Array<Record<string, number | string>>;
  moods?: Array<Record<string, number | string>>;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    sort: string;
    query: string;
  };
};

type ReaderProfile = {
  completed: string[];
  liked: string[];
  skipped: string[];
  genreScore: Record<string, number>;
  moodScore: Record<string, number>;
};

const moods = ["quiet", "warm", "tense", "strange", "playful"];
const genres = ["literary", "mystery", "slice of life", "speculative", "fantasy"];
const initialMetrics: Metrics = { funnel: {}, stories: [], recentEvents: [] };
const initialProfile: ReaderProfile = {
  completed: [],
  liked: [],
  skipped: [],
  genreScore: {},
  moodScore: {},
};

type LoadOptions = {
  view?: "reader" | "admin";
  limit?: number;
  offset?: number;
  q?: string;
  sort?: string;
};

function getBrowserId(key: string) {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = `${key}-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, id);
  return id;
}

function readProfile() {
  if (typeof window === "undefined") return initialProfile;
  try {
    return { ...initialProfile, ...JSON.parse(window.localStorage.getItem("boks-profile") ?? "{}") };
  } catch {
    return initialProfile;
  }
}

function saveProfile(profile: ReaderProfile) {
  window.localStorage.setItem("boks-profile", JSON.stringify(profile));
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function estimateMinutes(text: string) {
  return Math.max(1, Math.min(15, Math.ceil(wordCount(text) / 220)));
}

function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : Number(value || 0);
}

function profileBump(profile: ReaderProfile, story: Story, event: "complete" | "like" | "skip") {
  const weight = event === "skip" ? -2 : event === "like" ? 4 : 3;
  const next = {
    completed: profile.completed,
    liked: profile.liked,
    skipped: profile.skipped,
    genreScore: { ...profile.genreScore },
    moodScore: { ...profile.moodScore },
  };

  next.genreScore[story.genre] = (next.genreScore[story.genre] ?? 0) + weight;
  next.moodScore[story.mood] = (next.moodScore[story.mood] ?? 0) + weight;
  if (event === "complete" && !next.completed.includes(story.id)) {
    next.completed = [...next.completed, story.id].slice(-120);
  }
  if (event === "like" && !next.liked.includes(story.id)) {
    next.liked = [...next.liked, story.id].slice(-120);
  }
  if (event === "skip" && !next.skipped.includes(story.id)) {
    next.skipped = [...next.skipped, story.id].slice(-160);
  }
  return next;
}

function storySignal(story: Record<string, number | string>) {
  return (
    numberValue(story.completes) * 4 +
    numberValue(story.likes) * 5 +
    numberValue(story.shares) * 4 +
    numberValue(story.commentsCount ?? story.comments) * 6 -
    Math.max(0, numberValue(story.starts) - numberValue(story.completes))
  );
}

function useBoksData() {
  const [stories, setStories] = useState<Story[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [status, setStatus] = useState("Loading");

  const load = useCallback(async (options: LoadOptions = {}) => {
    setStatus("Loading");
    const view = options.view ?? "reader";
    const params = new URLSearchParams({
      view,
      limit: String(options.limit ?? (view === "admin" ? 100 : 80)),
    });
    if (options.offset) params.set("offset", String(options.offset));
    if (options.q?.trim()) params.set("q", options.q.trim());
    if (options.sort) params.set("sort", options.sort);

    const response = await fetch(`/api/boks?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load boks.");
    setStories(data.stories ?? []);
    setComments(data.comments ?? []);
    setMetrics(data.metrics);
    setStatus("Ready");
    return data;
  }, []);

  return { stories, comments, metrics, status, setStatus, load };
}

export function ReaderFeed() {
  const { stories, comments, metrics, status, setStatus, load } = useBoksData();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [profile, setProfile] = useState<ReaderProfile>(initialProfile);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [readerName, setReaderName] = useState("Reader");
  const [isSubmitting, setSubmitting] = useState(false);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const readStartedAt = useRef<number | null>(null);
  const metricsRef = useRef<Metrics>(initialMetrics);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    visitorId.current = getBrowserId("boks-reader");
    sessionId.current = `${Date.now()}-${crypto.randomUUID()}`;
    const profileTimer = window.setTimeout(() => setProfile(readProfile()), 0);
    load({ view: "reader", limit: 80 }).catch((error) => setStatus(error.message));
    return () => window.clearTimeout(profileTimer);
  }, [load, setStatus]);

  async function track(eventType: string, storyId: string, value = 1, metadata = {}) {
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
      }),
    });
  }

  const rankedStories = useMemo(() => {
    return [...stories].sort((a, b) => {
      const score = (story: Story) => {
        const localTaste = (profile.genreScore[story.genre] ?? 0) * 12 + (profile.moodScore[story.mood] ?? 0) * 10;
        const quality = story.completes * 7 + story.likes * 5 + story.commentsCount * 6 + story.shares * 5;
        const freshness = story.starts < 4 ? 20 : 0;
        const fatigue =
          (profile.completed.includes(story.id) ? 80 : 0) +
          (profile.skipped.includes(story.id) ? 35 : 0);
        return localTaste + quality + freshness + Math.max(0, 15 - story.minutes) - fatigue;
      };
      return score(b) - score(a);
    });
  }, [profile, stories]);

  const currentStory = rankedStories[selectedIndex] ?? rankedStories[0];
  const currentStoryId = currentStory?.id;
  const currentComments = comments.filter((comment) => comment.storyId === currentStory?.id).slice(0, 5);

  useEffect(() => {
    if (!currentStoryId) return;
    readStartedAt.current = Date.now();
    track("impression", currentStoryId, 1, {
      rank: selectedIndex,
      algorithm: "local-behavior-v2",
    }).catch(() => undefined);

    const startTimer = window.setTimeout(() => {
      track("start", currentStoryId, 1, { rank: selectedIndex }).catch(() => undefined);
    }, 1800);

    return () => window.clearTimeout(startTimer);
  }, [currentStoryId, selectedIndex]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown" || event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        skipStory();
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
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
    setSelectedIndex((index) => (index + delta + rankedStories.length) % rankedStories.length);
  }

  async function skipStory() {
    if (!currentStory) return;
    persistProfile(profileBump(profile, currentStory, "skip"));
    await track("skip", currentStory.id, 1, { from: "swipe" });
    move(1);
  }

  async function completeReading() {
    if (!currentStory) return;
    const seconds = readStartedAt.current
      ? Math.max(5, Math.round((Date.now() - readStartedAt.current) / 1000))
      : currentStory.minutes * 60;
    persistProfile(profileBump(profile, currentStory, "complete"));
    await track("complete", currentStory.id, seconds);
    await load({ view: "reader", limit: 80 });
    move(1);
  }

  async function likeStory() {
    if (!currentStory || liked[currentStory.id]) return;
    setLiked((state) => ({ ...state, [currentStory.id]: true }));
    persistProfile(profileBump(profile, currentStory, "like"));
    await track("like", currentStory.id);
    await load({ view: "reader", limit: 80 });
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
    await load({ view: "reader", limit: 80 });
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
      }),
    });
    setSubmitting(false);
    if (response.ok) {
      setCommentText("");
      await load({ view: "reader", limit: 80 });
    }
  }

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
        skipStory();
      } else {
        move(-1);
      }
    }
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        skipStory();
      } else {
        move(-1);
      }
    }
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
    <main className="reader-shell h-[100svh] overflow-hidden text-[var(--foreground)]">
      <section
        className="relative mx-auto grid h-full min-w-0 w-full max-w-[1120px] grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_84px]"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <article className="reader-card relative m-2 grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--reader)] shadow-[0_18px_70px_rgb(40_29_18/12%)] sm:m-4 lg:m-6">
          <header className="z-10 flex items-center justify-between px-5 py-4 sm:px-8">
            <p className="brand-word">boks</p>
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <BookOpen className="size-4" />
              <span>{currentStory.minutes} min</span>
            </div>
          </header>

          <div className="story-scroll min-h-0 min-w-0 overflow-y-auto px-5 pb-28 sm:px-10 sm:pb-12 lg:px-16">
            <div className="mx-auto flex min-h-full max-w-[760px] flex-col justify-start py-7 sm:py-12">
              <div className="mb-5 flex flex-wrap gap-2 text-sm text-[var(--muted-foreground)]">
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

          <footer className="z-10 flex items-end justify-between gap-4 px-5 py-4 sm:px-8">
            <div>
              <p className="text-base font-semibold">{currentStory.authorName}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{currentStory.authorHandle || "boks author"}</p>
            </div>
            <button className="swipe-cue" onClick={skipStory} aria-label="Swipe to next story">
              <span>swipe</span>
              <ArrowDown className="size-4" />
            </button>
          </footer>
        </article>

        <aside className="action-rail pointer-events-none absolute inset-x-4 bottom-4 z-20 flex justify-center gap-3 lg:static lg:inset-auto lg:flex-col lg:justify-center">
          <ActionButton label="Like" value={currentStory.likes} onClick={likeStory} active={liked[currentStory.id]}>
            <Heart className="size-5" />
          </ActionButton>
          <ActionButton label="Comment" value={currentStory.commentsCount} onClick={() => setCommentOpen(true)}>
            <MessageCircle className="size-5" />
          </ActionButton>
          <ActionButton label="Share" value={currentStory.shares} onClick={shareStory}>
            <Share2 className="size-5" />
          </ActionButton>
          <ActionButton label="Done" value={currentStory.completes} onClick={completeReading}>
            <Check className="size-5" />
          </ActionButton>
        </aside>

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
      </section>
    </main>
  );
}

export function AuthorConsole() {
  const { status, setStatus } = useBoksData();
  const [authorForm, setAuthorForm] = useState({
    title: "",
    authorName: "",
    authorHandle: "",
    hook: "",
    body: "",
    genre: "literary",
    mood: "quiet",
  });
  const [isSubmitting, setSubmitting] = useState(false);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const authorMinutes = estimateMinutes(authorForm.body);
  const authorWords = wordCount(authorForm.body);

  useEffect(() => {
    visitorId.current = getBrowserId("boks-author");
    sessionId.current = `${Date.now()}-${crypto.randomUUID()}`;
  }, []);

  async function publishStory() {
    setSubmitting(true);
    const response = await fetch("/api/boks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create-story",
        ...authorForm,
        minutes: authorMinutes,
        visitorId: visitorId.current,
        sessionId: sessionId.current,
      }),
    });
    const data = await response.json();
    setSubmitting(false);
    if (!response.ok) {
      setStatus(data.error || "Could not publish story");
      return;
    }
    setAuthorForm({
      title: "",
      authorName: authorForm.authorName,
      authorHandle: authorForm.authorHandle,
      hook: "",
      body: "",
      genre: "literary",
      mood: "quiet",
    });
    setStatus("Published");
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="panel p-5 sm:p-7">
          <Link href="/" className="brand-word">boks</Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">Author cabinet</h1>
          <p className="mt-3 max-w-2xl text-[var(--muted-foreground)]">
            Publish one focused piece into the test feed. The reader will never choose it manually; the algorithm must earn its place.
          </p>
          <div className="mt-7 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title">
                <Input value={authorForm.title} onChange={(event) => setAuthorForm({ ...authorForm, title: event.target.value })} />
              </Field>
              <Field label="Author name">
                <Input value={authorForm.authorName} onChange={(event) => setAuthorForm({ ...authorForm, authorName: event.target.value })} />
              </Field>
            </div>
            <Field label="Handle">
              <Input placeholder="@name" value={authorForm.authorHandle} onChange={(event) => setAuthorForm({ ...authorForm, authorHandle: event.target.value })} />
            </Field>
            <Field label="Opening hook">
              <Textarea value={authorForm.hook} onChange={(event) => setAuthorForm({ ...authorForm, hook: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Genre">
                <select className="field-control" value={authorForm.genre} onChange={(event) => setAuthorForm({ ...authorForm, genre: event.target.value })}>
                  {genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
                </select>
              </Field>
              <Field label="Mood">
                <select className="field-control" value={authorForm.mood} onChange={(event) => setAuthorForm({ ...authorForm, mood: event.target.value })}>
                  {moods.map((mood) => <option key={mood} value={mood}>{mood}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Story">
              <Textarea className="min-h-[380px] text-base leading-7" value={authorForm.body} onChange={(event) => setAuthorForm({ ...authorForm, body: event.target.value })} />
            </Field>
            <Button className="h-11 w-full sm:w-fit" onClick={publishStory} disabled={isSubmitting || !authorForm.title.trim() || !authorForm.body.trim() || authorMinutes > 15}>
              <Send className="size-4" /> Publish
            </Button>
          </div>
        </section>
        <aside className="grid content-start gap-4">
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Length guardrail</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricTile label="Words" value={authorWords} />
              <MetricTile label="Minutes" value={authorMinutes} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
              <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, (authorMinutes / 15) * 100)}%` }} />
            </div>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {authorMinutes > 15 ? "Split this into episodes." : "Fits the feed."}
            </p>
          </div>
          <div className="panel p-5">
            <h2 className="text-lg font-semibold tracking-normal">Status</h2>
            <p className="mt-2 text-sm text-[var(--muted-foreground)]">{status}</p>
            <a className="mt-4 inline-flex text-sm font-medium text-[var(--primary)]" href="/admin">Open admin</a>
          </div>
        </aside>
      </div>
    </main>
  );
}

export function AdminDashboard() {
  const { metrics, status, setStatus, load } = useBoksData();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("signal");
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const funnel = metrics.funnel ?? {};
  const pagination = metrics.pagination ?? {
    limit: pageSize,
    offset: page * pageSize,
    total: metrics.stories.length,
    hasMore: false,
    sort,
    query,
  };
  const impressions = numberValue(funnel.impressions);
  const starts = numberValue(funnel.starts);
  const completes = numberValue(funnel.completes);
  const pageStart = pagination.total ? pagination.offset + 1 : 0;
  const pageEnd = Math.min(pagination.offset + pagination.limit, pagination.total);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      load({
        view: "admin",
        limit: pageSize,
        offset: page * pageSize,
        q: query,
        sort,
      }).catch((error) => setStatus(error.message));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [load, page, query, setStatus, sort]);

  function downloadMetrics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      funnel,
      stories: metrics.stories,
      pagination,
      genres: metrics.genres,
      moods: metrics.moods,
      recentEvents: metrics.recentEvents,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "boks-metrics.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-5 text-[var(--foreground)] sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/" className="brand-word">boks</Link>
            <h1 className="mt-6 text-3xl font-semibold tracking-normal sm:text-5xl">Business console</h1>
            <p className="mt-3 max-w-3xl text-[var(--muted-foreground)]">
              Funnel health, story-level signal, content inventory, and cohort taste.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                load({
                  view: "admin",
                  limit: pageSize,
                  offset: page * pageSize,
                  q: query,
                  sort,
                }).catch((error) => setStatus(error.message))
              }
            >
              <RefreshCw className="size-4" /> Refresh
            </Button>
            <Button onClick={downloadMetrics}>
              <Download className="size-4" /> Export
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <MetricTile label="Stories" value={numberValue(funnel.totalStories)} />
          <MetricTile label="Visitors" value={numberValue(funnel.visitors)} />
          <MetricTile label="Impressions" value={impressions} />
          <MetricTile label="Starts" value={starts} />
          <MetricTile label="Completes" value={completes} />
          <MetricTile label="Likes" value={numberValue(funnel.likes)} />
        </section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr_1fr]">
          <AdminPanel title="Funnel">
            <Target label="Start rate" value={pct(starts, impressions)} target="40%" />
            <Target label="Finish after start" value={pct(completes, starts)} target="55%" />
            <Target label="Reaction per finish" value={pct(numberValue(funnel.likes) + numberValue(funnel.shares), completes)} target="20%" />
          </AdminPanel>
          <AdminPanel title="Genre signal">
            <Breakdown rows={metrics.genres ?? []} labelKey="genre" />
          </AdminPanel>
          <AdminPanel title="Mood signal">
            <Breakdown rows={metrics.moods ?? []} labelKey="mood" />
          </AdminPanel>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
            <div>
              <h2 className="text-xl font-semibold tracking-normal">Content operations</h2>
              <p className="text-sm text-[var(--muted-foreground)]">
                {pageStart}-{pageEnd} of {pagination.total} · {status}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                <Input
                  className="w-[220px] pl-9"
                  placeholder="Search stories"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <select
                className="field-control w-[180px]"
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value);
                  setPage(0);
                }}
              >
                <option value="signal">Signal</option>
                <option value="finish">Finish rate</option>
                <option value="starts">Starts</option>
                <option value="comments">Comments</option>
                <option value="newest">Newest</option>
                <option value="title">Title</option>
              </select>
            </div>
          </div>
          <div className="admin-table">
            <div className="admin-row admin-head">
              <span>Story</span>
              <span>Start</span>
              <span>Finish</span>
              <span>Love</span>
              <span>Comments</span>
              <span>Signal</span>
            </div>
            {metrics.stories.map((story) => {
              const storyStarts = numberValue(story.starts);
              const storyCompletes = numberValue(story.completes);
              const comments = numberValue(story.commentsCount ?? story.comments);
              return (
                <div key={String(story.id)} className="admin-row">
                  <span>
                    <strong>{String(story.title)}</strong>
                    <small>{String(story.genre)} · {String(story.mood)} · {String(story.minutes)} min</small>
                  </span>
                  <span>{storyStarts}</span>
                  <span>{pct(storyCompletes, storyStarts)}%</span>
                  <span>{numberValue(story.likes)}</span>
                  <span>{comments}</span>
                  <span>{storySignal(story)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] p-4">
            <p className="text-sm text-[var(--muted-foreground)]">
              Showing {metrics.stories.length} stories per request. Search and sort are handled by the server.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
                Previous
              </Button>
              <Button variant="outline" disabled={!pagination.hasMore} onClick={() => setPage((value) => value + 1)}>
                Next
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function ActionButton({
  label,
  value,
  active,
  onClick,
  children,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`action-button pointer-events-auto ${active ? "is-active" : ""}`} onClick={onClick} aria-label={label}>
      {children}
      <span>{value}</span>
    </button>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-tile">
      <p>{label}</p>
      <strong>{Number.isFinite(value) ? value : 0}</strong>
    </div>
  );
}

function AdminPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-normal">
        <TrendingUp className="size-4 text-[var(--primary)]" />
        {title}
      </h2>
      <div className="grid gap-4">{children}</div>
    </div>
  );
}

function Target({ label, value, target }: { label: string; value: number; target: string }) {
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
        <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <p className="mt-1 text-xs text-[var(--muted-foreground)]">Target: {target}</p>
    </div>
  );
}

function Breakdown({ rows, labelKey }: { rows: Array<Record<string, number | string>>; labelKey: string }) {
  const max = Math.max(1, ...rows.map((row) => storySignal(row)));
  if (!rows.length) return <p className="text-sm text-[var(--muted-foreground)]">No data yet.</p>;

  return rows.slice(0, 6).map((row) => {
    const signal = storySignal(row);
    return (
      <div key={String(row[labelKey])}>
        <div className="flex justify-between gap-3 text-sm">
          <span>{String(row[labelKey])}</span>
          <span className="font-medium">{signal}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
          <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${Math.max(4, (signal / max) * 100)}%` }} />
        </div>
      </div>
    );
  });
}
