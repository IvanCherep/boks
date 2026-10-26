"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Story } from "@/components/boks/client-types";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { effectiveReadingLanguages, storedReadingLanguages } from "@/components/boks/reading-languages";
import { inferReadOutcome } from "@/components/boks/reader-behavior";
import { loadStudyBoks, loadSupabaseReaderFeed, type StudyFragment } from "@/components/boks/supabase-browser-data";
import type { StudyWords } from "@/components/boks/studies/study-copy";
import {
  BokChoiceForm,
  CheckListForm,
  FragmentRatingForm,
  ScaleForm,
  SessionSurveyForm,
  StudyMessage,
  type ScaleQuestion,
} from "@/components/boks/studies/study-forms";
import {
  CatalogueBrowser,
  FeedBrowser,
  StudyTextReader,
  TextBody,
  useReadingMeasure,
  type ReadingMeasure,
} from "@/components/boks/studies/study-reader";
import { StudySeriesPlayer, type SeriesMeasure } from "@/components/boks/studies/study-series";
import type { StudyMaterials } from "@/lib/boks/studies/materials";
import { b2PieceFor, b2Showcase, planA1, planA2, planB1, planB2, planRg1, type StudyFormat } from "@/lib/boks/studies/plan";
import type { StudyKey, StudyStep } from "@/lib/boks/studies/protocol";
import type { GestureTrace } from "@/lib/boks/studies/gesture-trace";
import type { SessionMeasurement } from "@/lib/boks/studies/session";

/**
 * The seven protocols, each a short sequence of screens. A protocol knows
 * its steps and nothing about storage: it hands every answer to `run.record`,
 * which writes it - or, in a Studio preview, drops it.
 */

export type StudyRun<K extends StudyKey = StudyKey> = {
  key: K;
  words: StudyWords;
  preview: boolean;
  participant: { id: string; condition: string; seed: number };
  materials: StudyMaterials[K];
  record: (step: StudyStep, answers: Record<string, unknown>, extra?: {
    reelId?: string | null;
    fragmentId?: string | null;
    condition?: string | null;
    clientSeconds?: number | null;
  }) => Promise<void>;
  claimTrace: (reelId: string) => Promise<{ traceId: number; trace: GestureTrace } | null>;
  nextFragment: () => Promise<StudyFragment | null>;
  /** Marks the participant finished; the page then thanks them. */
  finish: () => void;
};

const agree = (words: StudyWords, key: string, label: string): ScaleQuestion => ({
  key, label, max: 7, low: words.scaleDisagree, high: words.scaleAgree,
});

const intensity = (words: StudyWords, key: string, label: string): ScaleQuestion => ({
  key, label, max: 7, low: words.scaleWeak, high: words.scaleStrong,
});

/** The scale questions of each protocol, for the participant page and the Studio gallery alike. */
export const studyQuestions = {
  rg1: (words: StudyWords) => [agree(words, "moved", words.rg1Moved), agree(words, "thought", words.rg1Thought)],
  a1: (words: StudyWords) => [agree(words, "closure", words.a1Closure)],
  b1: (words: StudyWords) => [intensity(words, "intensity", words.b1Intensity), intensity(words, "feeling", words.b1Feeling)],
};

/** Published boks by id, loaded once; `null` while loading. */
function useStories(ids: readonly string[]) {
  const key = ids.join(",");
  const [stories, setStories] = useState<Map<string, Story> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadStudyBoks(key ? key.split(",") : []).then(
      (loaded) => { if (!cancelled) setStories(new Map(loaded.map((story) => [story.id, story]))); },
      (failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)); }
    );
    return () => { cancelled = true; };
  }, [key]);
  return { stories, error };
}

function Loading({ words, error }: { words: StudyWords; error?: string }) {
  return error
    ? <StudyMessage title={words.failed} body={<p className="study-muted">{error}</p>} />
    : <p className="study-loading" role="status">{words.loading}</p>;
}

/** A screen with a line of text and one button. */
export function Interstitial({ title, body, action, onAction, eyebrow }: { title: string; body?: ReactNode; action: string; onAction: () => void; eyebrow?: string }) {
  return <StudyMessage eyebrow={eyebrow} title={title} body={body} action={<button type="button" className="study-button" onClick={onAction}>{action}</button>} />;
}

/** Saving, with the button held: an answer is written once. */
function useSaving() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (work: () => Promise<void>, then: () => void) => {
    setBusy(true);
    setError("");
    try {
      await work();
      then();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save };
}

function SaveError({ error }: { error: string }) {
  return error ? <p className="study-error" role="alert">{error}</p> : null;
}

/** A bok in the format a protocol asks for. */
function ReadIn({ story, format, words, note, onDone }: {
  story: Story;
  format: StudyFormat;
  words: StudyWords;
  note?: string;
  onDone: (measure: { format: StudyFormat; seconds: number; progress: number; ended?: boolean; outcome?: string }) => void;
}) {
  if (format === "series") {
    return <StudySeriesPlayer story={story} words={words} onDone={(measure: SeriesMeasure) => onDone({ format, ...measure })} />;
  }
  return (
    <StudyTextReader story={story} words={words} note={note} onDone={(measure: ReadingMeasure) => onDone({
      format,
      seconds: measure.activeSeconds,
      progress: measure.progress,
      outcome: inferReadOutcome(story, measure.activeSeconds, measure.progress, { scrollable: measure.scrollable }),
    })} />
  );
}

// rg1 ---------------------------------------------------------------------

function Rg1({ run }: { run: StudyRun<"rg1"> }) {
  const { words } = run;
  const plan = useMemo(() => planRg1(run.materials, run.participant.condition, run.participant.seed), [run]);
  const { stories, error } = useStories([plan.familiarization.bokId, plan.target.bokId]);
  const [step, setStep] = useState<"intro" | "fam0" | "fam1" | "test" | "read" | "ask">("intro");
  const measure = useRef<Record<string, unknown>>({});
  const saving = useSaving();
  if (!stories) return <Loading words={words} error={error} />;
  const familiar = stories.get(plan.familiarization.bokId);
  const target = stories.get(plan.target.bokId);
  if (!familiar || !target) return <Loading words={words} error="A study text is not published." />;

  if (step === "intro") return <Interstitial eyebrow={words.eyebrow} title={words.familiarizationTitle} body={<p>{words.familiarizationBody}</p>} action={words.start} onAction={() => setStep("fam0")} />;
  if (step === "fam0" || step === "fam1") {
    const format = plan.familiarization.formats[step === "fam0" ? 0 : 1];
    return <ReadIn key={step} story={familiar} format={format} words={words} onDone={() => setStep(step === "fam0" ? "fam1" : "test")} />;
  }
  if (step === "test") return <Interstitial eyebrow={words.eyebrow} title={words.nowTheTest} body={<p>{plan.target.format === "series" ? words.listenThis : words.readThisText}</p>} action={words.start} onAction={() => setStep("read")} />;
  if (step === "read") {
    return <ReadIn story={target} format={plan.target.format} words={words} onDone={(result) => { measure.current = result; setStep("ask"); }} />;
  }
  return (
    <>
      <ScaleForm words={words} questions={studyQuestions.rg1(words)} check={{ key: "knewBefore", label: words.knewBefore }} busy={saving.busy}
        onSubmit={(answers) => saving.save(
          () => run.record("after_reading", { phase: "target", ...answers, ...measure.current }, {
            reelId: target.id, condition: plan.target.format, clientSeconds: Number(measure.current.seconds) || null,
          }),
          run.finish
        )} />
      <SaveError error={saving.error} />
    </>
  );
}

// rg2 and a2: browsing sessions -------------------------------------------

function sessionIntro(words: StudyWords, kind: SessionMeasurement["interface"]) {
  return kind === "catalogue" ? words.sessionIntroCatalogue : kind === "inline" ? words.sessionIntroInline : kind === "cards" ? words.sessionIntroCards : words.sessionIntroFeed;
}

/** One session: intro, ten minutes, survey; reports both halves. */
function Session({ run, index, kind, set, stories, minutes, onSaved }: {
  run: StudyRun;
  index: number;
  kind: SessionMeasurement["interface"];
  set?: "a" | "b";
  stories: Story[];
  minutes: number;
  onSaved: () => void;
}) {
  const { words } = run;
  const [phase, setPhase] = useState<"intro" | "browse" | "survey">("intro");
  const [result, setResult] = useState<{ measurement: SessionMeasurement; opened: Story[] } | null>(null);
  const saving = useSaving();
  if (phase === "intro") {
    return <Interstitial eyebrow={words.eyebrow} title={words.sessionTitle(minutes)} body={<><p>{sessionIntro(words, kind)}</p><p>{words.sessionRules(minutes)}</p></>} action={words.start} onAction={() => setPhase("browse")} />;
  }
  if (phase === "browse" || !result) {
    const done = (measurement: SessionMeasurement, opened: Story[]) => { setResult({ measurement, opened }); setPhase("survey"); };
    return kind === "catalogue"
      ? <CatalogueBrowser words={words} stories={stories} minutes={minutes} onFinish={done} />
      : <FeedBrowser words={words} stories={stories} minutes={minutes} set={set} mode={kind} onFinish={done} />;
  }
  return (
    <>
      <SessionSurveyForm words={words} opened={result.opened} busy={saving.busy} onSubmit={(survey) => saving.save(async () => {
        await run.record("session", { index, measurement: result.measurement }, { condition: kind, clientSeconds: result.measurement.elapsedSeconds });
        await run.record("session_survey", { index, survey }, { condition: kind });
      }, onSaved)} />
      <SaveError error={saving.error} />
    </>
  );
}

function Rg2({ run }: { run: StudyRun<"rg2"> }) {
  const { words } = run;
  const [pool, setPool] = useState<Story[] | null>(null);
  const [error, setError] = useState("");
  const kind = run.participant.condition === "catalogue" ? "catalogue" : "feed";
  useEffect(() => {
    let cancelled = false;
    // Both arms get the reader's own served slate: the feed shows it in its
    // ranked order, the catalogue lists the same texts alphabetically.
    loadSupabaseReaderFeed({
      limit: run.materials.poolSize,
      visitorId: getBrowserId("boks-reader"),
      sessionId: `study-rg2-${run.participant.id}`,
      readingLanguages: effectiveReadingLanguages(storedReadingLanguages()),
    }).then(
      (payload) => { if (!cancelled) setPool(payload.stories.slice(0, run.materials.poolSize)); },
      (failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)); }
    );
    return () => { cancelled = true; };
  }, [run]);
  if (!pool) return <Loading words={words} error={error} />;
  return <Session run={run} index={0} kind={kind} stories={pool} minutes={run.materials.minutes} onSaved={run.finish} />;
}

function A2({ run }: { run: StudyRun<"a2"> }) {
  const { words } = run;
  const plan = useMemo(() => planA2(run.materials, run.participant.condition), [run]);
  const { stories, error } = useStories([...run.materials.setA, ...run.materials.setB]);
  const [step, setStep] = useState<"familiarity" | 0 | 1>("familiarity");
  const saving = useSaving();
  if (!stories) return <Loading words={words} error={error} />;
  if (step === "familiarity") {
    const all = [...run.materials.setA, ...run.materials.setB].map((id) => stories.get(id)).filter((story): story is Story => Boolean(story));
    return (
      <>
        <CheckListForm words={words} title={words.familiarityTitle} body={words.familiarityBody} busy={saving.busy}
          options={all.map((story) => ({ id: story.id, label: story.title, hint: story.authorName }))}
          onSubmit={(known) => saving.save(() => run.record("familiarity", { known }), () => setStep(0))} />
        <SaveError error={saving.error} />
      </>
    );
  }
  const session = plan.sessions[step];
  const list = session.bokIds.map((id) => stories.get(id)).filter((story): story is Story => Boolean(story));
  return <Session key={step} run={run} index={step} kind={session.interface} set={session.set} stories={list} minutes={plan.minutes}
    onSaved={() => (step === 0 ? setStep(1) : run.finish())} />;
}

// a1 ----------------------------------------------------------------------

function A1({ run }: { run: StudyRun<"a1"> }) {
  const { words } = run;
  const plan = useMemo(() => planA1(run.materials, run.participant.condition, run.participant.seed), [run]);
  const { stories, error } = useStories([...plan.reads.map((read) => read.bokId), ...plan.choices.map((choice) => choice.bokId)]);
  const [step, setStep] = useState<number | "ask" | "choose" | "chosen">(0);
  const [asking, setAsking] = useState(0);
  const [chosen, setChosen] = useState<Story | null>(null);
  const measure = useRef<Record<string, unknown>>({});
  const saving = useSaving();
  if (!stories) return <Loading words={words} error={error} />;

  if (typeof step === "number") {
    const read = plan.reads[step];
    const story = stories.get(read.bokId);
    if (!story) return <Loading words={words} error="A study text is not published." />;
    return <ReadIn key={story.id} story={story} format="text" words={words} note={words.readThisText}
      onDone={(result) => { measure.current = result; setAsking(step); setStep("ask"); }} />;
  }
  if (step === "ask") {
    const read = plan.reads[asking];
    return (
      <>
        <ScaleForm key={asking} words={words} questions={studyQuestions.a1(words)} check={{ key: "knewBefore", label: words.knewBefore }} busy={saving.busy}
          onSubmit={(answers) => saving.save(
            () => run.record("after_reading", { kind: read.kind, ...answers, ...measure.current }, { reelId: read.bokId, condition: read.kind }),
            () => setStep(asking + 1 < plan.reads.length ? asking + 1 : "choose")
          )} />
        <SaveError error={saving.error} />
      </>
    );
  }
  if (step === "choose") {
    const offered = plan.choices.map((choice) => stories.get(choice.bokId)).filter((story): story is Story => Boolean(story));
    return (
      <>
        <BokChoiceForm words={words} title={words.a1ChooseTitle} body={words.a1ChooseBody} boks={offered} nothingLabel={words.chooseNothing} busy={saving.busy}
          onChoose={(bokId) => {
            const choice = plan.choices.find((entry) => entry.bokId === bokId);
            saving.save(
              () => run.record("choice", { chosen: bokId, kind: choice?.kind ?? null, offered: plan.choices }, { reelId: bokId }),
              () => {
                const story = bokId ? stories.get(bokId) ?? null : null;
                if (story) { setChosen(story); setStep("chosen"); } else run.finish();
              }
            );
          }} />
        <SaveError error={saving.error} />
      </>
    );
  }
  // The chosen text, to read if they want: the choice is already recorded.
  return chosen ? <StudyTextReader story={chosen} words={words} doneLabel={words.done} onDone={run.finish} /> : null;
}

// b1 ----------------------------------------------------------------------

/**
 * b1's roles. A piece is replayed (passive) when another participant's trace
 * of it is waiting and this participant has not had a passive piece yet;
 * otherwise it is played (active) and its trace recorded. From the second
 * participant on, everyone gets one of each - the within-person comparison
 * the hypothesis asks for - and every trace is replayed exactly once.
 */
function B1Piece({ run, story, mayReplay, onDone }: {
  run: StudyRun<"b1">;
  story: Story;
  mayReplay: boolean;
  onDone: (role: "active" | "passive") => void;
}) {
  const { words } = run;
  const [role, setRole] = useState<{ role: "active" | "passive"; traceId: number | null; trace: GestureTrace | null } | null>(null);
  const [phase, setPhase] = useState<"note" | "play" | "ask">("note");
  const [error, setError] = useState("");
  const measure = useRef<Record<string, unknown>>({});
  const saving = useSaving();

  useEffect(() => {
    let cancelled = false;
    (mayReplay ? run.claimTrace(story.id) : Promise.resolve(null)).then(
      (claimed) => {
        if (cancelled) return;
        setRole(claimed ? { role: "passive", traceId: claimed.traceId, trace: claimed.trace } : { role: "active", traceId: null, trace: null });
      },
      (failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)); }
    );
    return () => { cancelled = true; };
  }, [run, story.id, mayReplay]);

  if (!role) return <Loading words={words} error={error} />;
  if (phase === "note") {
    return <Interstitial eyebrow={words.eyebrow} title={story.title} body={<p>{role.role === "passive" ? words.passiveNote : words.activeNote}</p>} action={words.start} onAction={() => setPhase("play")} />;
  }
  if (phase === "play") {
    const gestureTrace = role.role === "passive" && role.trace
      ? { mode: "replay" as const, trace: role.trace }
      // The trace arrives when the poem ends or closes, which can be after
      // the Continue press; it is written whenever it comes.
      : { mode: "record" as const, onTrace: (trace: GestureTrace) => { void run.record("trace", trace as unknown as Record<string, unknown>, { reelId: story.id, condition: "active" }).catch(() => undefined); } };
    return <StudySeriesPlayer story={story} words={words} gestureTrace={gestureTrace} onDone={(result) => { measure.current = { ...result }; setPhase("ask"); }} />;
  }
  return (
    <>
      <ScaleForm words={words} questions={studyQuestions.b1(words)} busy={saving.busy}
        onSubmit={(answers) => saving.save(
          () => run.record("after_reading", { ...answers, role: role.role, traceId: role.traceId, ...measure.current }, {
            reelId: story.id, condition: role.role, clientSeconds: Number(measure.current.seconds) || null,
          }),
          () => onDone(role.role)
        )} />
      <SaveError error={saving.error} />
    </>
  );
}

function B1({ run }: { run: StudyRun<"b1"> }) {
  const plan = useMemo(() => planB1(run.materials, run.participant.seed), [run]);
  const { stories, error } = useStories(plan.pieces);
  const [index, setIndex] = useState(0);
  const [hadPassive, setHadPassive] = useState(false);
  if (!stories) return <Loading words={run.words} error={error} />;
  const story = stories.get(plan.pieces[index]);
  if (!story) return <Loading words={run.words} error="A study text is not published." />;
  return <B1Piece key={story.id} run={run} story={story} mayReplay={!hadPassive}
    onDone={(role) => {
      if (role === "passive") setHadPassive(true);
      if (index + 1 < plan.pieces.length) setIndex(index + 1);
      else run.finish();
    }} />;
}

// b2 ----------------------------------------------------------------------

/** Started means opened and read for at least this long, or a fifth of the way. */
export const b2StartedSeconds = 10;

function B2({ run }: { run: StudyRun<"b2"> }) {
  const { words } = run;
  const plan = useMemo(() => planB2(run.materials, run.participant.seed), [run]);
  const [piece, setPiece] = useState<StudyMaterials["b2"]["pieces"][number] | null>(null);
  const [phase, setPhase] = useState<"screen" | "meet" | "showcase" | "reading" | "ineligible">("screen");
  const [chosen, setChosen] = useState<Story | null>(null);
  const saving = useSaving();
  const ids = piece ? [piece.series, ...piece.sameAuthor, ...piece.others] : [];
  const { stories, error } = useStories(ids);
  const showcase = useMemo(() => (piece ? b2Showcase(piece, run.participant.seed) : []), [piece, run.participant.seed]);
  const format: StudyFormat = run.participant.condition === "series" ? "series" : "text";

  if (phase === "ineligible") return <StudyMessage title={words.thanksTitle} body={<p>{words.b2Ineligible}</p>} />;
  if (phase === "screen") {
    return (
      <>
        <CheckListForm words={words} title={words.b2ScreenTitle} body={words.b2ScreenBody} busy={saving.busy}
          options={plan.screeningAuthors.map((author) => ({ id: author, label: author }))}
          onSubmit={(knownAuthors) => {
            const next = b2PieceFor(run.materials, plan, knownAuthors);
            saving.save(
              () => run.record("familiarity", { knownAuthors, eligible: Boolean(next), piece: next?.series ?? null }),
              () => {
                if (!next) { setPhase("ineligible"); run.finish(); return; }
                setPiece(next);
                setPhase("meet");
              }
            );
          }} />
        <SaveError error={saving.error} />
      </>
    );
  }
  if (!stories || !piece) return <Loading words={words} error={error} />;
  const series = stories.get(piece.series);
  if (!series) return <Loading words={words} error="A study text is not published." />;
  if (phase === "meet") {
    return <ReadIn story={series} format={format} words={words} note={words.readThisText}
      onDone={(result) => saving.save(
        () => run.record("after_reading", { phase: "meeting", ...result }, { reelId: series.id, condition: format }),
        () => setPhase("showcase")
      )} />;
  }
  const record = (story: Story | null, measure?: ReadingMeasure) => {
    const entry = story ? showcase.find((item) => item.bokId === story.id) : undefined;
    const started = Boolean(measure && (measure.activeSeconds >= b2StartedSeconds || measure.progress >= 0.2));
    return run.record("choice", {
      chosen: story?.id ?? null,
      sameAuthor: entry?.sameAuthor ?? false,
      started,
      activeSeconds: measure?.activeSeconds ?? 0,
      progress: measure?.progress ?? 0,
      offered: showcase,
    }, { reelId: story?.id ?? null, condition: format });
  };
  if (phase === "showcase" || !chosen) {
    const offered = showcase.map((item) => stories.get(item.bokId)).filter((story): story is Story => Boolean(story));
    return (
      <>
        <BokChoiceForm words={words} title={words.b2ShowcaseTitle} body={words.b2ShowcaseBody} boks={offered} nothingLabel={words.b2Leave} busy={saving.busy}
          onChoose={(bokId) => {
            const story = bokId ? stories.get(bokId) ?? null : null;
            if (story) { setChosen(story); setPhase("reading"); }
            else saving.save(() => record(null), run.finish);
          }} />
        <SaveError error={saving.error} />
      </>
    );
  }
  return (
    <>
      <StudyTextReader story={chosen} words={words} doneLabel={words.stopReading}
        onDone={(measure) => saving.save(() => record(chosen, measure), run.finish)} />
      <SaveError error={saving.error} />
    </>
  );
}

// b3 ----------------------------------------------------------------------

export function FragmentScreen({ fragment, words, busy, onRate }: {
  fragment: StudyFragment;
  words: StudyWords;
  busy: boolean;
  onRate: (answer: { standalone: string; complete: string }, measure: ReadingMeasure) => void;
}) {
  const { scroller, onScroll, read } = useReadingMeasure(true, fragment.id);
  const story: Story = {
    id: fragment.id, title: "", authorName: words.b3From(fragment.sourceTitle, fragment.sourceAuthor), authorHandle: "",
    body: fragment.body, genre: "", mood: "", minutes: 0, wordCount: fragment.wordCount, language: fragment.language,
    likes: 0, shares: 0, starts: 0, completes: 0, commentsCount: 0, avgSeconds: 0,
  };
  return (
    <div className="study-reader" ref={scroller} onScroll={onScroll}>
      <p className="study-reader__note">{words.b3Intro}</p>
      <TextBody story={story} />
      <FragmentRatingForm words={words} busy={busy} onSubmit={(answer) => onRate(answer, read())} />
    </div>
  );
}

function B3({ run }: { run: StudyRun<"b3"> }) {
  const { words } = run;
  const [fragment, setFragment] = useState<StudyFragment | null | undefined>(undefined);
  const [rated, setRated] = useState(0);
  const [phase, setPhase] = useState<"rate" | "more">("rate");
  const [error, setError] = useState("");
  const saving = useSaving();
  const fetchNext = () => {
    setFragment(undefined);
    run.nextFragment().then(setFragment, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  useEffect(() => {
    let cancelled = false;
    run.nextFragment().then(
      (next) => { if (!cancelled) setFragment(next); },
      (failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure)); }
    );
    return () => { cancelled = true; };
  }, [run]);

  if (fragment === undefined) return <Loading words={words} error={error} />;
  if (fragment === null) {
    return <StudyMessage title={words.thanksTitle} body={<p>{words.b3NoneLeft}</p>}
      action={<button type="button" className="study-button" onClick={run.finish}>{words.done}</button>} />;
  }
  if (phase === "more") {
    return <StudyMessage title={words.b3Count(rated)}
      action={<div className="study-actions">
        <button type="button" className="study-button" onClick={() => { setPhase("rate"); fetchNext(); }}>{words.b3More}</button>
        <button type="button" className="study-button study-button--plain" onClick={run.finish}>{words.b3Enough}</button>
      </div>} />;
  }
  return (
    <>
      <FragmentScreen key={fragment.id} fragment={fragment} words={words} busy={saving.busy}
        onRate={(answer, measure) => saving.save(
          () => run.record("fragment_rating", { ...answer, activeSeconds: measure.activeSeconds, progress: measure.progress }, { fragmentId: fragment.id }),
          () => { setRated((count) => count + 1); setPhase("more"); }
        )} />
      <SaveError error={saving.error} />
    </>
  );
}

export function StudyProtocol({ run }: { run: StudyRun }) {
  switch (run.key) {
    case "rg1": return <Rg1 run={run as StudyRun<"rg1">} />;
    case "rg2": return <Rg2 run={run as StudyRun<"rg2">} />;
    case "a1": return <A1 run={run as StudyRun<"a1">} />;
    case "a2": return <A2 run={run as StudyRun<"a2">} />;
    case "b1": return <B1 run={run as StudyRun<"b1">} />;
    case "b2": return <B2 run={run as StudyRun<"b2">} />;
    case "b3": return <B3 run={run as StudyRun<"b3">} />;
  }
}
