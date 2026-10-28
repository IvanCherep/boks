"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Search } from "lucide-react";
import type { Story } from "@/components/boks/client-types";
import { createReaderClock } from "@/components/boks/reader-clock";
import { inferReadOutcome } from "@/components/boks/reader-behavior";
import { formatReaderBody, type ReaderBlock } from "@/components/boks/reader-text";
import type { StudyWords } from "@/components/boks/studies/study-copy";
import { BokCard, BokCover } from "@/components/boks/studies/study-forms";
import type { SessionMeasurement, SessionRead } from "@/lib/boks/studies/session";

/**
 * Reading inside a study, measured the way the feed measures: foreground
 * time only, how far down the text, and whether there was anything to scroll.
 * The outcome uses the feed's own rule (`inferReadOutcome`), so "read" means
 * the same thing in a study as in the product.
 */

export type ReadingMeasure = { activeSeconds: number; progress: number; scrollable: boolean };

/**
 * A foreground clock and the furthest scroll position of one element.
 * `subject` names what is being read; a new one starts both again.
 */
export function useReadingMeasure(active: boolean, subject?: string) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const clock = useRef(createReaderClock());
  const furthest = useRef(0);

  useEffect(() => {
    const current = clock.current;
    if (!active) {
      current.pause();
      return;
    }
    current.restart();
    furthest.current = 0;
    if (document.hidden) current.pause();
    const onVisibility = () => (document.hidden ? current.pause() : current.resume());
    const tick = window.setInterval(() => current.mark(), 2000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      current.pause();
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active, subject]);

  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const reach = (element.scrollTop + element.clientHeight) / Math.max(1, element.scrollHeight);
    furthest.current = Math.max(furthest.current, Math.min(1, reach));
  }, []);

  const read = useCallback((): ReadingMeasure => {
    clock.current.mark();
    const element = scroller.current;
    const scrollable = element ? element.scrollHeight > element.clientHeight + 24 : false;
    return {
      activeSeconds: Math.round(clock.current.activeSeconds() * 10) / 10,
      progress: scrollable ? Math.round(furthest.current * 1000) / 1000 : 1,
      scrollable,
    };
  }, []);

  return { scroller, onScroll, read };
}

export function TextBody({ story, blocks }: { story: Story; blocks?: ReaderBlock[] }) {
  const shaped = useMemo(() => blocks ?? formatReaderBody(story.body, story.title), [blocks, story.body, story.title]);
  return (
    <div className="study-text" lang={story.language && story.language !== "und" ? story.language : undefined}>
      {story.authorName && <p className="study-eyebrow">{story.authorName}</p>}
      {story.title && <h1>{story.title}</h1>}
      {shaped.map((block, index) =>
        block.kind === "verse" ? (
          <p key={index} className="study-text__verse">
            {block.lines.map((line, at) => <span key={at}>{line}<br /></span>)}
          </p>
        ) : (
          <p key={index}>{block.lines.join(" ")}</p>
        )
      )}
    </div>
  );
}

/** One text to read to its end, then a button. Used by the protocols that hand out a text. */
export function StudyTextReader({ story, words, note, doneLabel, onDone }: {
  story: Story;
  words: StudyWords;
  note?: ReactNode;
  doneLabel?: string;
  onDone: (measure: ReadingMeasure) => void;
}) {
  const { scroller, onScroll, read } = useReadingMeasure(true);
  return (
    <div className="study-reader" ref={scroller} onScroll={onScroll}>
      {note && <p className="study-reader__note">{note}</p>}
      <TextBody story={story} />
      <button type="button" className="study-button study-reader__done" onClick={() => onDone(read())}>
        {doneLabel ?? words.finishReading}
      </button>
    </div>
  );
}

function formatLeft(seconds: number) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Below this much attention a text was passed over, and the survey does not ask about it. */
export const surveyMinimumSeconds = 5;

/**
 * Ten minutes in one interface, measured.
 *
 * The session clock is wall time, as a real break is; each text's own clock
 * is foreground time. Leaving a text - swiping on, going back to the cards or
 * the catalogue, the timer running out - closes its read.
 */
function useSession(kind: SessionMeasurement["interface"], set: SessionMeasurement["set"], minutes: number, offered: string[]) {
  const started = useRef(0);
  const reads = useRef<SessionRead[]>([]);
  const counters = useRef({ searches: 0, filters: 0 });
  useEffect(() => {
    started.current = Date.now();
  }, []);
  const elapsed = () => (started.current ? (Date.now() - started.current) / 1000 : 0);
  const close = (story: Story, openedAt: number, measure: ReadingMeasure) => {
    if (measure.activeSeconds <= 0 && measure.progress <= 0) return;
    reads.current.push({
      bokId: story.id,
      openedAt: Math.round(openedAt),
      activeSeconds: measure.activeSeconds,
      progress: measure.progress,
      scrollable: measure.scrollable,
      outcome: inferReadOutcome(story, measure.activeSeconds, measure.progress, { scrollable: measure.scrollable }),
    });
  };
  const finish = (endedBy: SessionMeasurement["endedBy"]): SessionMeasurement => ({
    interface: kind,
    ...(set ? { set } : {}),
    minutes,
    offered,
    reads: reads.current,
    ...(kind === "catalogue" ? { searches: counters.current.searches, filters: counters.current.filters } : {}),
    endedBy,
    elapsedSeconds: Math.round(elapsed()),
  });
  const count = (what: "searches" | "filters") => {
    counters.current[what] += 1;
  };
  return { elapsed, close, finish, count };
}

function SessionTimer({ words, minutes, onExpire, onEnd }: {
  words: StudyWords;
  minutes: number;
  onExpire: () => void;
  onEnd: () => void;
}) {
  const [left, setLeft] = useState(minutes * 60);
  const expire = useRef(onExpire);
  useEffect(() => {
    expire.current = onExpire;
  });
  useEffect(() => {
    const until = Date.now() + minutes * 60 * 1000;
    const handle = window.setInterval(() => {
      const remaining = (until - Date.now()) / 1000;
      setLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(handle);
        expire.current();
      }
    }, 500);
    return () => window.clearInterval(handle);
  }, [minutes]);
  return (
    <div className="study-session__bar">
      <span role="timer" aria-live="off">{words.timeLeft(formatLeft(left))}</span>
      <button type="button" className="study-button study-button--outline" onClick={onEnd}>{words.endSession}</button>
    </div>
  );
}

/** The text currently open, with its own measure; reports on the way out. */
function OpenText({ story, words, measureRef, onBack }: {
  story: Story;
  words: StudyWords;
  /** Lets the session read this text's measure when the timer ends it. */
  measureRef: { current: (() => ReadingMeasure) | null };
  onBack: (measure: ReadingMeasure) => void;
}) {
  const { scroller, onScroll, read } = useReadingMeasure(true);
  useEffect(() => {
    measureRef.current = read;
    return () => {
      measureRef.current = null;
    };
  }, [measureRef, read]);
  return (
    <div className="study-reader study-reader--session" ref={scroller} onScroll={onScroll}>
      <button type="button" className="study-reader__back" onClick={() => onBack(read())}>
        <ArrowLeft aria-hidden="true" /> {words.back}
      </button>
      <TextBody story={story} />
    </div>
  );
}

type BrowseProps = {
  words: StudyWords;
  stories: Story[];
  minutes: number;
  set?: "a" | "b";
  onFinish: (measurement: SessionMeasurement, opened: Story[]) => void;
};

/** Texts with enough attention to ask about, in the order they were first opened. */
function openedStories(measurement: SessionMeasurement, stories: Story[]) {
  const seen = new Set<string>();
  const byId = new Map(stories.map((story) => [story.id, story]));
  const result: Story[] = [];
  for (const read of measurement.reads) {
    if (seen.has(read.bokId) || read.activeSeconds < surveyMinimumSeconds) continue;
    seen.add(read.bokId);
    const story = byId.get(read.bokId);
    if (story) result.push(story);
  }
  return result;
}

/**
 * The feed: one bok a screen, in the order given, previous and next.
 *
 * `inline` shows the text itself on the screen (study a2's "text in the
 * feed"); `cards` shows a cover with a Read button that opens the text on its
 * own screen - the live product's mobile reader, and the shape rg2's feed arm
 * uses. The order is the slate's and is never changed here.
 */
export function FeedBrowser({ words, stories, minutes, set, mode, onFinish }: BrowseProps & { mode: "inline" | "cards" | "feed" }) {
  const session = useSession(mode, set, minutes, stories.map((story) => story.id));
  const [index, setIndex] = useState(0);
  const [reading, setReading] = useState<{ story: Story; openedAt: number } | null>(null);
  const inline = mode === "inline";
  const story = stories[index];
  const shownAt = useRef(0);
  const { scroller: inlineScroller, onScroll: onInlineScroll, read: readInline } = useReadingMeasure(inline && !reading, story?.id);
  const openMeasure = useRef<(() => ReadingMeasure) | null>(null);
  const ended = useRef(false);

  useEffect(() => {
    shownAt.current = session.elapsed();
    inlineScroller.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const leaveInline = () => {
    if (inline && story) session.close(story, shownAt.current, readInline());
  };
  const go = (step: 1 | -1) => {
    const next = index + step;
    if (next < 0 || next >= stories.length) return;
    leaveInline();
    setIndex(next);
  };
  const end = (endedBy: "timer" | "participant") => {
    if (ended.current) return;
    ended.current = true;
    if (reading && openMeasure.current) session.close(reading.story, reading.openedAt, openMeasure.current());
    else leaveInline();
    const measurement = session.finish(endedBy);
    onFinish(measurement, openedStories(measurement, stories));
  };

  if (reading) {
    return (
      <div className="study-session">
        <SessionTimer words={words} minutes={minutes} onExpire={() => end("timer")} onEnd={() => end("participant")} />
        <OpenText story={reading.story} words={words} measureRef={openMeasure} onBack={(measure) => {
          session.close(reading.story, reading.openedAt, measure);
          setReading(null);
        }} />
      </div>
    );
  }

  return (
    <div className="study-session">
      <SessionTimer words={words} minutes={minutes} onExpire={() => end("timer")} onEnd={() => end("participant")} />
      {story && (inline ? (
        <div className="study-reader study-reader--session" ref={inlineScroller} onScroll={onInlineScroll} key={story.id}>
          <TextBody story={story} />
        </div>
      ) : (
        <div className="study-feed-card" key={story.id}>
          <BokCover story={story} words={words} onOpen={() => setReading({ story, openedAt: session.elapsed() })} />
        </div>
      ))}
      <nav className="study-feed__nav" aria-label={words.feedNav}>
        <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label={words.back}><ArrowUp aria-hidden="true" /></button>
        <span>{index + 1} / {stories.length}</span>
        <button type="button" onClick={() => go(1)} disabled={index >= stories.length - 1} aria-label={words.next}><ArrowDown aria-hidden="true" /></button>
      </nav>
    </div>
  );
}

/** Verse or prose, read from the text the way the reader lays it out. */
function isVerse(story: Story) {
  const blocks = formatReaderBody(story.body, story.title);
  const verse = blocks.filter((block) => block.kind === "verse").reduce((sum, block) => sum + block.lines.length, 0);
  const prose = blocks.filter((block) => block.kind === "prose").reduce((sum, block) => sum + block.lines.length, 0);
  return verse > prose;
}

/** rg2's control: the same texts as a catalogue with search and filters. */
export function CatalogueBrowser({ words, stories, minutes, onFinish }: BrowseProps) {
  const session = useSession("catalogue", undefined, minutes, stories.map((story) => story.id));
  const [query, setQuery] = useState("");
  const [shape, setShape] = useState<"all" | "verse" | "prose">("all");
  const [short, setShort] = useState(false);
  const [language, setLanguage] = useState("all");
  const [reading, setReading] = useState<{ story: Story; openedAt: number } | null>(null);
  const openMeasure = useRef<(() => ReadingMeasure) | null>(null);
  const ended = useRef(false);
  const verse = useMemo(() => new Map(stories.map((story) => [story.id, isVerse(story)])), [stories]);
  const languages = useMemo(
    () => [...new Set(stories.map((story) => story.language).filter((code): code is string => Boolean(code && code !== "und")))].sort(),
    [stories]
  );
  const searched = useRef("");

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Alphabetical: a catalogue's order is not a recommendation.
    return stories
      .filter((story) => !needle || `${story.title} ${story.authorName}`.toLowerCase().includes(needle))
      .filter((story) => shape === "all" || (shape === "verse") === verse.get(story.id))
      .filter((story) => !short || story.minutes <= 5)
      .filter((story) => language === "all" || story.language === language)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [stories, query, shape, short, language, verse]);

  const end = (endedBy: "timer" | "participant") => {
    if (ended.current) return;
    ended.current = true;
    if (reading && openMeasure.current) session.close(reading.story, reading.openedAt, openMeasure.current());
    const measurement = session.finish(endedBy);
    onFinish(measurement, openedStories(measurement, stories));
  };
  const filter = (apply: () => void) => {
    session.count("filters");
    apply();
  };

  return (
    <div className="study-session">
      <SessionTimer words={words} minutes={minutes} onExpire={() => end("timer")} onEnd={() => end("participant")} />
      {reading ? (
        <OpenText story={reading.story} words={words} measureRef={openMeasure} onBack={(measure) => {
          session.close(reading.story, reading.openedAt, measure);
          setReading(null);
        }} />
      ) : (
        <div className="study-catalogue">
          <label className="study-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={words.search}
              onChange={(event) => setQuery(event.target.value)}
              onBlur={() => {
                if (query.trim() && query.trim() !== searched.current) {
                  searched.current = query.trim();
                  session.count("searches");
                }
              }}
            />
          </label>
          <div className="study-filters">
            {(["all", "verse", "prose"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={shape === value} onClick={() => filter(() => setShape(value))}>
                {value === "all" ? words.filterAll : value === "verse" ? words.filterPoems : words.filterProse}
              </button>
            ))}
            <button type="button" aria-pressed={short} onClick={() => filter(() => setShort(!short))}>{words.filterShort}</button>
            {languages.length > 1 && (
              <select aria-label={words.filterLanguage} value={language} onChange={(event) => filter(() => setLanguage(event.target.value))}>
                <option value="all">{words.filterLanguage}</option>
                {languages.map((code) => <option key={code} value={code}>{code.toUpperCase()}</option>)}
              </select>
            )}
          </div>
          {shown.length === 0 && <p className="study-muted">{words.nothingFound}</p>}
          <div className="study-boks study-boks--catalogue">
            {shown.map((story) => (
              <BokCard key={story.id} story={story} words={words} onOpen={() => setReading({ story, openedAt: session.elapsed() })} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
