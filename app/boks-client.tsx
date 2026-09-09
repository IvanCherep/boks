"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Heart,
  MessageCircle,
  PenLine,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
};

const moods = ["quiet", "warm", "tense", "strange", "playful"];
const genres = ["literary", "mystery", "slice of life", "speculative", "fantasy"];

const initialMetrics: Metrics = { funnel: {}, stories: [], recentEvents: [] };

function getBrowserId(key: string) {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const id = `${key}-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, id);
  return id;
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

export function BoksClient() {
  const [stories, setStories] = useState<Story[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [preferredMood, setPreferredMood] = useState("warm");
  const [maxMinutes, setMaxMinutes] = useState(15);
  const [reading, setReading] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [commentText, setCommentText] = useState("");
  const [readerName, setReaderName] = useState("Reader");
  const [authorForm, setAuthorForm] = useState({
    title: "",
    authorName: "",
    authorHandle: "",
    hook: "",
    body: "",
    genre: "literary",
    mood: "quiet",
  });
  const [status, setStatus] = useState("Loading stories");
  const [isSubmitting, setSubmitting] = useState(false);
  const visitorId = useRef("anonymous");
  const sessionId = useRef("session");
  const readStartedAt = useRef<number | null>(null);
  const metricsRef = useRef<Metrics>(initialMetrics);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  async function load() {
    setStatus("Loading stories");
    const response = await fetch("/api/boks", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load boks.");
    setStories(data.stories);
    setComments(data.comments);
    setMetrics(data.metrics);
    setStatus("Ready");
  }

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

  useEffect(() => {
    visitorId.current = getBrowserId("boks-reader");
    sessionId.current = getBrowserId("boks-session");
    load().catch((error) => setStatus(error.message));
  }, []);

  const rankedStories = useMemo(() => {
    return [...stories]
      .filter((story) => story.minutes <= maxMinutes)
      .sort((a, b) => {
        const score = (story: Story) =>
          (story.mood === preferredMood ? 60 : 0) +
          Math.max(0, 15 - story.minutes) * 2 +
          story.likes * 3 +
          story.commentsCount * 4 +
          story.completes * 5 -
          story.starts;
        return score(b) - score(a);
      });
  }, [maxMinutes, preferredMood, stories]);

  const currentStory = rankedStories[selectedIndex] ?? rankedStories[0];
  const currentComments = comments.filter((comment) => comment.storyId === currentStory?.id);
  const authorMinutes = estimateMinutes(authorForm.body);
  const authorWords = wordCount(authorForm.body);
  const funnel = metrics.funnel ?? {};
  const impressions = numberValue(funnel.impressions);
  const starts = numberValue(funnel.starts);
  const completes = numberValue(funnel.completes);

  useEffect(() => {
    if (!currentStory) return;
    setReading(false);
    readStartedAt.current = null;
    track("impression", currentStory.id, 1, { preferredMood, maxMinutes }).catch(() => undefined);
  }, [currentStory?.id]);

  function move(delta: number) {
    if (!rankedStories.length) return;
    setSelectedIndex((index) => (index + delta + rankedStories.length) % rankedStories.length);
  }

  async function startReading() {
    if (!currentStory) return;
    setReading(true);
    readStartedAt.current = Date.now();
    await track("start", currentStory.id, 1, { preferredMood, maxMinutes });
  }

  async function completeReading() {
    if (!currentStory) return;
    const seconds = readStartedAt.current
      ? Math.max(5, Math.round((Date.now() - readStartedAt.current) / 1000))
      : currentStory.minutes * 60;
    setReading(false);
    await track("complete", currentStory.id, seconds);
    await load();
    move(1);
  }

  async function likeStory() {
    if (!currentStory || liked[currentStory.id]) return;
    setLiked((state) => ({ ...state, [currentStory.id]: true }));
    await track("like", currentStory.id);
    await load();
  }

  async function shareStory() {
    if (!currentStory) return;
    const text = `Read "${currentStory.title}" on boks`;
    if (navigator.share) {
      await navigator.share({ title: currentStory.title, text, url: window.location.href });
    } else {
      await navigator.clipboard.writeText(`${text}: ${window.location.href}`);
      setStatus("Share link copied");
    }
    await track("share", currentStory.id);
    await load();
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
      await load();
    }
  }

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
    setStatus("Story published");
    await load();
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const register = async () => {
      await context.registerTool(
        {
          name: "boks_get_metrics",
          title: "Get boks metrics",
          description:
            "Read the current boks experiment metrics shown in the Metrics tab.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute() {
            const currentMetrics = metricsRef.current;
            return {
              funnel: currentMetrics.funnel,
              stories: currentMetrics.stories,
              recentEvents: currentMetrics.recentEvents,
            };
          },
        },
        { signal: lifecycle.signal }
      );

      await context.registerTool(
        {
          name: "boks_publish_story",
          title: "Publish boks story",
          description:
            "Publish a short story into the boks reader feed using the same limits as the author cabinet.",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1, maxLength: 90 },
              authorName: { type: "string", minLength: 1, maxLength: 60 },
              authorHandle: { type: "string", maxLength: 40 },
              hook: { type: "string", maxLength: 180 },
              body: { type: "string", minLength: 1, maxLength: 9000 },
              genre: { type: "string", enum: genres },
              mood: { type: "string", enum: moods },
            },
            required: ["title", "authorName", "body"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            const payload = input as Partial<typeof authorForm>;
            const body = typeof payload.body === "string" ? payload.body : "";
            if (!payload.title || !payload.authorName || !body) {
              throw new Error("title, authorName, and body are required");
            }
            const minutes = estimateMinutes(body);
            if (minutes > 15) {
              throw new Error("Story is longer than 15 minutes");
            }
            const response = await fetch("/api/boks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "create-story",
                title: payload.title,
                authorName: payload.authorName,
                authorHandle: payload.authorHandle ?? "",
                hook: payload.hook ?? "",
                body,
                genre: payload.genre ?? "literary",
                mood: payload.mood ?? "quiet",
                minutes,
                visitorId: visitorId.current,
                sessionId: sessionId.current,
              }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Could not publish story");
            await load();
            return { storyId: data.storyId, minutes };
          },
        },
        { signal: lifecycle.signal }
      );
    };

    register().catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  function downloadMetrics() {
    const payload = {
      exportedAt: new Date().toISOString(),
      funnel,
      stories: metrics.stories,
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
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-[var(--primary)] text-[var(--primary-foreground)]">
              <BookOpen className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[1.55rem] font-semibold leading-none tracking-normal">boks</p>
              <p className="text-sm text-[var(--muted-foreground)]">15 minute literature feed</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted-foreground)]">
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1">
              {numberValue(funnel.visitors)} testers
            </span>
            <span className="rounded-md border border-[var(--border)] px-2.5 py-1">
              {pct(completes, starts)}% finish rate
            </span>
          </div>
        </header>

        <Tabs defaultValue="read" className="pt-4">
          <TabsList className="grid h-auto w-full grid-cols-3 rounded-md bg-[var(--muted)] p-1 sm:w-[420px]">
            <TabsTrigger value="read" className="h-10 gap-2">
              <Sparkles className="size-4" /> Read
            </TabsTrigger>
            <TabsTrigger value="author" className="h-10 gap-2">
              <PenLine className="size-4" /> Author
            </TabsTrigger>
            <TabsTrigger value="metrics" className="h-10 gap-2">
              <BarChart3 className="size-4" /> Metrics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="read" className="pt-4">
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="grid gap-4 rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--muted-foreground)]">Recommendation test</p>
                    <h1 className="text-2xl font-semibold tracking-normal sm:text-4xl">
                      Swipe-sized stories for real breaks.
                    </h1>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Preferred mood"
                      className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
                      value={preferredMood}
                      onChange={(event) => {
                        setPreferredMood(event.target.value);
                        setSelectedIndex(0);
                        currentStory &&
                          track("preference", currentStory.id, 1, { mood: event.target.value }).catch(
                            () => undefined
                          );
                      }}
                    >
                      {moods.map((mood) => (
                        <option key={mood} value={mood}>
                          {mood}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Maximum reading time"
                      className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
                      value={maxMinutes}
                      onChange={(event) => {
                        setMaxMinutes(Number(event.target.value));
                        setSelectedIndex(0);
                      }}
                    >
                      {[5, 10, 15].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          up to {minutes} min
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {currentStory ? (
                  <article className="grid min-h-[560px] gap-4 rounded-md bg-[var(--reader)] p-4 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-2xl">
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-[var(--muted-foreground)]">
                          <span className="rounded-md bg-[var(--accent)] px-2 py-1">{currentStory.genre}</span>
                          <span className="rounded-md bg-[var(--accent)] px-2 py-1">{currentStory.mood}</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-4" /> {currentStory.minutes} min
                          </span>
                        </div>
                        <h2 className="max-w-3xl text-3xl font-semibold tracking-normal sm:text-5xl">
                          {currentStory.title}
                        </h2>
                        <p className="mt-3 max-w-2xl text-lg leading-7 text-[var(--muted-foreground)]">
                          {currentStory.hook}
                        </p>
                        <p className="mt-4 text-sm font-medium">
                          {currentStory.authorName}{" "}
                          <span className="text-[var(--muted-foreground)]">{currentStory.authorHandle}</span>
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="icon" aria-label="Previous story" onClick={() => move(-1)}>
                          <ChevronLeft />
                        </Button>
                        <Button variant="outline" size="icon" aria-label="Next story" onClick={() => move(1)}>
                          <ChevronRight />
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-4 sm:p-6">
                      {!reading ? (
                        <div className="flex min-h-[240px] flex-col justify-between gap-6">
                          <p className="max-w-2xl text-lg leading-8">
                            {currentStory.body.split("\n")[0]}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button onClick={startReading} className="h-11">
                              <BookOpen /> Start reading
                            </Button>
                            <Button variant="outline" onClick={likeStory} disabled={liked[currentStory.id]}>
                              <Heart /> {liked[currentStory.id] ? "Liked" : "Like"}
                            </Button>
                            <Button variant="outline" onClick={shareStory}>
                              <Share2 /> Share
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="story-body max-h-[52vh] overflow-y-auto pr-1 text-[1.12rem] leading-8 sm:text-[1.2rem]">
                          {currentStory.body.split("\n").map((paragraph) => (
                            <p key={paragraph} className="mb-5">
                              {paragraph}
                            </p>
                          ))}
                          <Button onClick={completeReading} className="mt-2 h-11">
                            <Check /> Done reading
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <MetricTile label="Starts" value={currentStory.starts} />
                      <MetricTile label="Completed" value={currentStory.completes} />
                      <MetricTile label="Love + comments" value={currentStory.likes + currentStory.commentsCount} />
                    </div>
                  </article>
                ) : (
                  <div className="rounded-md border border-[var(--border)] p-8">{status}</div>
                )}
              </div>

              <aside className="grid content-start gap-4">
                <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
                  <h2 className="text-lg font-semibold tracking-normal">Reader response</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    Ask testers to leave one sentence after a story. This is usually more useful than a generic survey.
                  </p>
                  <div className="mt-4 grid gap-2">
                    <Input
                      aria-label="Reader name"
                      value={readerName}
                      onChange={(event) => setReaderName(event.target.value)}
                    />
                    <Textarea
                      aria-label="Comment"
                      placeholder="What did this make you feel or want next?"
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                    />
                    <Button onClick={submitComment} disabled={isSubmitting || !commentText.trim()}>
                      <MessageCircle /> Comment
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
                  <h2 className="text-lg font-semibold tracking-normal">Latest comments</h2>
                  <div className="mt-3 grid max-h-[360px] gap-3 overflow-y-auto">
                    {currentComments.length ? (
                      currentComments.map((comment) => (
                        <div key={comment.id} className="rounded-md bg-[var(--muted)] p-3">
                          <p className="text-sm font-medium">{comment.visitorName}</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{comment.body}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-[var(--muted-foreground)]">No comments yet.</p>
                    )}
                  </div>
                </div>
              </aside>
            </section>
          </TabsContent>

          <TabsContent value="author" className="pt-4">
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm sm:p-6">
                <h1 className="text-2xl font-semibold tracking-normal sm:text-4xl">Author cabinet</h1>
                <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
                  Publish a short piece directly into the test feed. Keep it readable in one commute, coffee break, or lunch pause.
                </p>
                <div className="mt-6 grid gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Title">
                      <Input
                        value={authorForm.title}
                        onChange={(event) => setAuthorForm({ ...authorForm, title: event.target.value })}
                      />
                    </Field>
                    <Field label="Author name">
                      <Input
                        value={authorForm.authorName}
                        onChange={(event) => setAuthorForm({ ...authorForm, authorName: event.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Handle">
                    <Input
                      placeholder="@name"
                      value={authorForm.authorHandle}
                      onChange={(event) => setAuthorForm({ ...authorForm, authorHandle: event.target.value })}
                    />
                  </Field>
                  <Field label="Opening hook">
                    <Textarea
                      value={authorForm.hook}
                      onChange={(event) => setAuthorForm({ ...authorForm, hook: event.target.value })}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Genre">
                      <select
                        className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
                        value={authorForm.genre}
                        onChange={(event) => setAuthorForm({ ...authorForm, genre: event.target.value })}
                      >
                        {genres.map((genre) => (
                          <option key={genre} value={genre}>
                            {genre}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Mood">
                      <select
                        className="h-10 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm"
                        value={authorForm.mood}
                        onChange={(event) => setAuthorForm({ ...authorForm, mood: event.target.value })}
                      >
                        {moods.map((mood) => (
                          <option key={mood} value={mood}>
                            {mood}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Story body">
                    <Textarea
                      className="min-h-[340px] text-base leading-7"
                      value={authorForm.body}
                      onChange={(event) => setAuthorForm({ ...authorForm, body: event.target.value })}
                    />
                  </Field>
                  <Button
                    className="h-11 w-full sm:w-fit"
                    onClick={publishStory}
                    disabled={isSubmitting || !authorForm.title.trim() || !authorForm.body.trim() || authorMinutes > 15}
                  >
                    <Send /> Publish to feed
                  </Button>
                </div>
              </div>
              <aside className="grid content-start gap-4">
                <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
                  <h2 className="text-lg font-semibold tracking-normal">15 minute guardrail</h2>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <MetricTile label="Words" value={authorWords} />
                    <MetricTile label="Minutes" value={authorMinutes} />
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div
                      className="h-full rounded-full bg-[var(--primary)] transition-all"
                      style={{ width: `${Math.min(100, (authorMinutes / 15) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted-foreground)]">
                    {authorMinutes > 15
                      ? "Too long for the boks promise. Split it into episodes."
                      : "Fits the boks promise."}
                  </p>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
                  <h2 className="text-lg font-semibold tracking-normal">Pitch line</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                    boks is a mobile-first literature feed where readers discover complete short stories in under 15 minutes, and authors learn what keeps people reading.
                  </p>
                </div>
              </aside>
            </section>
          </TabsContent>

          <TabsContent value="metrics" className="pt-4">
            <section className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm sm:p-6">
                <div>
                  <h1 className="text-2xl font-semibold tracking-normal sm:text-4xl">Experiment metrics</h1>
                  <p className="mt-2 max-w-2xl text-[var(--muted-foreground)]">
                    Use this view during user tests: completion, likes, comments, and shares show whether short literature has a repeatable hook.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => load().catch((error) => setStatus(error.message))}>
                    <RefreshCw /> Refresh
                  </Button>
                  <Button onClick={downloadMetrics}>
                    <Download /> Export
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <MetricTile label="Visitors" value={numberValue(funnel.visitors)} />
                <MetricTile label="Impressions" value={impressions} />
                <MetricTile label="Starts" value={starts} />
                <MetricTile label="Completes" value={completes} />
                <MetricTile label="Likes" value={numberValue(funnel.likes)} />
                <MetricTile label="Shares" value={numberValue(funnel.shares)} />
              </div>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--card)] shadow-sm">
                  <div className="grid grid-cols-[1.6fr_.6fr_.6fr_.6fr_.6fr] gap-3 border-b border-[var(--border)] bg-[var(--muted)] px-4 py-3 text-sm font-medium">
                    <span>Story</span>
                    <span>Start</span>
                    <span>Finish</span>
                    <span>Love</span>
                    <span>Signal</span>
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {metrics.stories.map((story) => {
                      const storyStarts = numberValue(story.starts);
                      const storyCompletes = numberValue(story.completes);
                      const signal =
                        numberValue(story.likes) +
                        numberValue(story.shares) +
                        numberValue(story.comments) * 2 +
                        storyCompletes;
                      return (
                        <div
                          key={String(story.id)}
                          className="grid grid-cols-[1.6fr_.6fr_.6fr_.6fr_.6fr] gap-3 px-4 py-3 text-sm"
                        >
                          <span className="font-medium">{String(story.title)}</span>
                          <span>{storyStarts}</span>
                          <span>{pct(storyCompletes, storyStarts)}%</span>
                          <span>{numberValue(story.likes)}</span>
                          <span>{signal}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm">
                  <h2 className="text-lg font-semibold tracking-normal">Validation targets</h2>
                  <div className="mt-4 grid gap-4">
                    <Target label="Story start rate" value={pct(starts, impressions)} target="40%" />
                    <Target label="Finish after start" value={pct(completes, starts)} target="55%" />
                    <Target label="Reaction per finish" value={pct(numberValue(funnel.likes) + numberValue(funnel.shares), completes)} target="20%" />
                  </div>
                </div>
              </div>
            </section>
          </TabsContent>
        </Tabs>
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

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
      <p className="text-sm text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-normal">{Number.isFinite(value) ? value : 0}</p>
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
