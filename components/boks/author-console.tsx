"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { estimateMinutes, wordCount } from "@/components/boks/client-format";
import { genres, moods } from "@/components/boks/constants";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { Field, MetricTile } from "@/components/boks/shared-ui";
import { useBoksData } from "@/components/boks/use-boks-data";

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
          <Link href="/" prefetch={false} className="brand-word">boks</Link>
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
