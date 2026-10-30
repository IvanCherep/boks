"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Story } from "@/components/boks/client-types";
import { getBrowserId } from "@/components/boks/reader-behavior";
import { effectiveReadingLanguages, storedReadingLanguages } from "@/components/boks/reading-languages";
import { inferReadOutcome } from "@/components/boks/reader-behavior";
import { loadStudyBoks, loadSupabaseReaderFeed, type StudyFragment, type StudyParticipant } from "@/components/boks/supabase-browser-data";
import type { StudyWords } from "@/components/boks/studies/study-copy";
import { localizeBoksMessage } from "@/lib/boks/errors";
import {
  BokChoiceForm,
  A2SessionSurveyForm,
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
import { planA1, planA2, planB1, planB2, planRg1, planRg2, type B2Plan, type StudyFormat } from "@/lib/boks/studies/plan";
import { startReadingMusic, stopReadingMusic } from "@/components/boks/reading-music";
import { interestScale, planA3Targets, rankA3, type A3Candidate, type A3Rating } from "@/lib/boks/studies/a3";
import { a1InstrumentVersion, a2InstrumentVersion, type StudyKey, type StudyStep } from "@/lib/boks/studies/protocol";
import type { GestureTrace } from "@/lib/boks/studies/gesture-trace";
import type { SessionMeasurement } from "@/lib/boks/studies/session";

/**
 * The eight protocols, each a short sequence of screens. A protocol knows
 * its steps and nothing about storage: it hands every answer to `run.record`,
 * which writes it - or, in a Studio preview, drops it.
 */

export type StudyRun<K extends StudyKey = StudyKey> = {
  key: K;
  words: StudyWords;
  preview: boolean;
  participant: { id: string; condition: string; seed: number };
  /** Steps already answered on an earlier visit; empty in a preview. */
  history: StudyParticipant["steps"];
  materials: StudyMaterials[K];
  record: (step: StudyStep, answers: Record<string, unknown>, extra?: {
    reelId?: string | null;
    fragmentId?: string | null;
    condition?: string | null;
    clientSeconds?: number | null;
  }) => Promise<void>;
  claimTrace: (reelId: string) => Promise<{ traceId: number; trace: GestureTrace } | null>;
  /** a3: counters and semantic vectors of the profile's boks and the targets. */
  a3Candidates: (ids: readonly string[]) => Promise<A3Candidate[]>;
  nextFragment: () => Promise<StudyFragment | null>;
  /** Marks the participant finished; the page then thanks them. */
  finish: () => void;
};

const agree = (words: StudyWords, key: string, label: string): ScaleQuestion => ({
  key, label, max: 7, low: words.scaleDisagree, high: words.scaleAgree,
});

/** The scale questions of each protocol, for the participant page and the Studio gallery alike. */
export const studyQuestions = {
  rg1: (words: StudyWords) => [agree(words, "moved", words.rg1Moved), agree(words, "thought", words.rg1Thought)],
  a1: (words: StudyWords) => [agree(words, "closure", words.a1Closure)],
  b1: (words: StudyWords): ScaleQuestion[] => [{ key: "immersion", label: words.b1Immersion, max: 7, low: words.scaleNotImmersed, high: words.scaleImmersed }],
  b2: (words: StudyWords): ScaleQuestion[] => [
    { key: "enjoyment", label: words.b2Enjoyment, max: 7, low: words.scaleNotAtAll, high: words.scaleVeryMuch },
    { key: "distraction", label: words.b2Distraction, max: 7, low: words.scaleNotAtAll, high: words.scaleVeryMuch },
  ],
  a3: (words: StudyWords): ScaleQuestion[] => [{ key: "interest", label: words.a3Interest, max: interestScale, low: words.scaleDull, high: words.scaleInteresting }],
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
      (failure: unknown) => { if (!cancelled) setError(localizeBoksMessage(failure instanceof Error ? failure.message : String(failure))); }
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
      setError(localizeBoksMessage(failure instanceof Error ? failure.message : String(failure)));
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
  if (!familiar || !target) return <Loading words={words} error={words.textMissing} />;

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
    return <Interstitial eyebrow={words.eyebrow} title={words.sessionTitle(minutes)} body={<><p>{sessionIntro(words, kind)}</p><p>{run.key === "a2" ? words.a2SessionRules(minutes) : words.sessionRules(minutes)}</p></>} action={words.start} onAction={() => setPhase("browse")} />;
  }
  if (phase === "browse" || !result) {
    const done = (measurement: SessionMeasurement, opened: Story[]) => { setResult({ measurement, opened }); setPhase("survey"); };
    return kind === "catalogue"
      ? <CatalogueBrowser words={words} stories={stories} minutes={minutes} onFinish={done} />
      : <FeedBrowser words={words} stories={stories} minutes={minutes} set={set} mode={kind} illustrated={run.key === "a2"} onFinish={done} />;
  }
  if (run.key === "a2") {
    const shown = (result.measurement.shown ?? []).flatMap((id) => {
      const story = stories.find((entry) => entry.id === id);
      return story ? [story] : [];
    });
    return <>
      <A2SessionSurveyForm words={words} shown={shown} busy={saving.busy} onSubmit={(survey) => saving.save(async () => {
        await run.record("session", { instrumentVersion: a2InstrumentVersion, index, measurement: result.measurement }, { condition: kind, clientSeconds: result.measurement.elapsedSeconds });
        await run.record("session_survey", { instrumentVersion: a2InstrumentVersion, index, survey }, { condition: kind });
      }, onSaved)} />
      <SaveError error={saving.error} />
    </>;
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

/** The participant's own served slate, for rg2's sessions and a3's profile. */
function useServedSlate(run: StudyRun, limit: number) {
  const [slate, setSlate] = useState<Story[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadSupabaseReaderFeed({
      limit,
      visitorId: getBrowserId("boks-reader"),
      sessionId: `study-${run.key}-${run.participant.id}`,
      readingLanguages: effectiveReadingLanguages(storedReadingLanguages()),
    }).then(
      (payload) => { if (!cancelled) setSlate(payload.stories.slice(0, limit)); },
      (failure: unknown) => { if (!cancelled) setError(localizeBoksMessage(failure instanceof Error ? failure.message : String(failure))); }
    );
    return () => { cancelled = true; };
  }, [run, limit]);
  return { slate, error };
}

/**
 * rg2: every participant has a feed session and a catalogue session, in the
 * order the condition names, with different texts - two halves of their own
 * served slate. The same survey follows both.
 */
function Rg2({ run }: { run: StudyRun<"rg2"> }) {
  const { words } = run;
  const { slate, error } = useServedSlate(run, run.materials.poolSize * 2);
  const [step, setStep] = useState<0 | "between" | 1>(0);
  const plan = useMemo(
    () => (slate ? planRg2(slate.map((story) => story.id), run.participant.condition, run.participant.seed, run.materials.poolSize) : null),
    [slate, run]
  );
  if (!slate || !plan) return <Loading words={words} error={error} />;
  if (step === "between") {
    return <Interstitial eyebrow={words.eyebrow} title={words.secondSessionTitle} body={<p>{words.secondSessionBody}</p>} action={words.continue} onAction={() => setStep(1)} />;
  }
  const byId = new Map(slate.map((story) => [story.id, story]));
  const session = plan.sessions[step];
  const stories = session.bokIds.map((id) => byId.get(id)).filter((story): story is Story => Boolean(story));
  return <Session key={step} run={run} index={step} kind={session.interface} stories={stories} minutes={run.materials.minutes}
    onSaved={() => (step === 0 ? setStep("between") : run.finish())} />;
}

function A2({ run }: { run: StudyRun<"a2"> }) {
  const { words } = run;
  const plan = useMemo(() => planA2(run.materials, run.participant.condition), [run]);
  const { stories, error } = useStories([...run.materials.setA, ...run.materials.setB]);
  const [step, setStep] = useState<"familiarity" | "between" | 0 | 1>("familiarity");
  const saving = useSaving();
  if (!stories) return <Loading words={words} error={error} />;
  if (step === "between") return <Interstitial title={words.secondSessionTitle} body={<p>{words.secondSessionBody}</p>}
    action={words.continue} onAction={() => setStep(1)} />;
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
    onSaved={() => (step === 0 ? setStep("between") : run.finish())} />;
}

// a1 ----------------------------------------------------------------------

function A1({ run }: { run: StudyRun<"a1"> }) {
  const { words } = run;
  const plan = useMemo(() => planA1(run.materials, run.participant.condition, run.participant.seed), [run]);
  const { stories, error } = useStories([...plan.reads.map((read) => read.bokId), ...plan.choices.map((choice) => choice.bokId)]);
  const [step, setStep] = useState<number | "closure" | "choose" | "chosen">(0);
  const [asking, setAsking] = useState(0);
  const [chosen, setChosen] = useState<Story | null>(null);
  const measures = useRef<Record<string, ReadingMeasure>>({});
  const saving = useSaving();
  if (!stories) return <Loading words={words} error={error} />;

  if (typeof step === "number") {
    const read = plan.reads[step];
    const story = stories.get(read.bokId);
    if (!story) return <Loading words={words} error={words.textMissing} />;
    return <StudyTextReader key={story.id} story={story} words={words} doneLabel={words.nextStep}
      onDone={(result) => {
        measures.current[story.id] = result;
        setStep(step + 1 < plan.reads.length ? step + 1 : "choose");
      }} />;
  }
  if (step === "closure") {
    const read = plan.reads[asking];
    const story = stories.get(read.bokId);
    return (
      <>
        <ScaleForm key={asking} words={words} eyebrow={words.a1Recall} title={story?.title} questions={studyQuestions.a1(words)} check={{ key: "knewBefore", label: words.knewBefore }} busy={saving.busy}
          onSubmit={(answers) => saving.save(
            () => run.record("after_reading", { instrumentVersion: a1InstrumentVersion, kind: read.kind, ...answers, ...measures.current[read.bokId] }, { reelId: read.bokId, condition: read.kind }),
            () => {
              if (asking + 1 < plan.reads.length) setAsking(asking + 1);
              else if (chosen) setStep("chosen");
              else run.finish();
            }
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
              () => run.record("choice", { instrumentVersion: a1InstrumentVersion, chosen: bokId, kind: choice?.kind ?? null, offered: plan.choices }, { reelId: bokId }),
              () => {
                setChosen(bokId ? stories.get(bokId) ?? null : null);
                setAsking(0);
                setStep("closure");
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

// a3 ----------------------------------------------------------------------

/** A text to read, then the interest question on leaving it. */
function InterestRead({ run, story, progress, onRated }: {
  run: StudyRun<"a3">;
  story: Story;
  progress: string;
  onRated: (interest: number, measure: ReadingMeasure) => Promise<void>;
}) {
  const { words } = run;
  const [measure, setMeasure] = useState<ReadingMeasure | null>(null);
  const saving = useSaving();
  if (!measure) {
    return <StudyTextReader key={story.id} story={story} words={words} progressLabel={progress} doneLabel={words.a3Next} onDone={setMeasure} />;
  }
  return (
    <>
      <ScaleForm words={words} eyebrow={progress} title={story.title} questions={studyQuestions.a3(words)} busy={saving.busy}
        onSubmit={(answers) => saving.save(() => onRated(Number(answers.interest), measure), () => undefined)} />
      <SaveError error={saving.error} />
    </>
  );
}

/**
 * a3: the ordinary feed with an interest question on leaving each text until
 * the profile has its five ratings; then the snapshot and both versions'
 * orders are recorded, and the ten targets follow in the seed's order. Every
 * answer is written as it is given, so a participant can leave and come back
 * to the same place.
 */
function A3({ run }: { run: StudyRun<"a3"> }) {
  const { words, materials } = run;
  const [ratings, setRatings] = useState<{ profile: A3Rating[]; test: A3Rating[] }>(() => ({
    profile: run.history.filter((step) => step.step === "interest" && step.answers?.phase === "profile" && step.reelId)
      .map((step) => ({ bokId: step.reelId!, interest: Number(step.answers?.interest) })),
    test: run.history.filter((step) => step.step === "interest" && step.answers?.phase === "test" && step.reelId)
      .map((step) => ({ bokId: step.reelId!, interest: Number(step.answers?.interest) })),
  }));
  const [targets, setTargets] = useState<string[] | null>(() => {
    const ranked = run.history.find((step) => step.step === "ranking")?.answers?.targets;
    return Array.isArray(ranked) ? ranked.filter((id): id is string => typeof id === "string") : null;
  });
  const [phase, setPhase] = useState<"intro" | "reading" | "ready">("intro");
  const [error, setError] = useState("");
  const fixing = useRef(false);
  const profileDone = ratings.profile.length >= materials.profileSize;
  const { slate, error: slateError } = useServedSlate(run, materials.feedPoolSize);
  const { stories: pool, error: poolError } = useStories(materials.targets);
  const total = materials.profileSize + materials.perParticipant;
  const testDone = targets !== null && targets.every((id) => ratings.test.some((entry) => entry.bokId === id));
  useEffect(() => {
    if (testDone) run.finish();
  }, [testDone, run]);

  // Five ratings in: fix the profile, snapshot the candidates, record both orders.
  useEffect(() => {
    if (!profileDone || targets || !pool || !slate || fixing.current) return;
    fixing.current = true;
    const known = new Map([...slate, ...pool.values()].map((story) => [story.id, story]));
    const profile = ratings.profile.slice(0, materials.profileSize);
    const chosen = planA3Targets(materials, run.participant.seed,
      profile.map((entry) => ({ bokId: entry.bokId, author: known.get(entry.bokId)?.authorName ?? "" })),
      (id) => pool.get(id)?.authorName ?? null);
    run.a3Candidates([...profile.map((entry) => entry.bokId), ...chosen])
      .then(async (candidates) => {
        const ranking = rankA3({ participantId: run.participant.id, profile, candidates, targets: chosen });
        await run.record("ranking", { ...ranking, targets: chosen, profile, profileSize: materials.profileSize });
        setTargets(chosen);
        setPhase("ready");
      })
      .catch((failure: unknown) => {
        fixing.current = false;
        setError(localizeBoksMessage(failure instanceof Error ? failure.message : String(failure)));
      });
  }, [profileDone, targets, pool, slate, ratings.profile, materials, run]);

  if (error || slateError || poolError) return <Loading words={words} error={error || slateError || poolError} />;
  if (phase === "intro") {
    return <Interstitial eyebrow={words.eyebrow} title={words.a3IntroTitle} body={<p>{words.a3IntroBody(total)}</p>}
      action={ratings.profile.length + ratings.test.length ? words.continue : words.start} onAction={() => setPhase("reading")} />;
  }
  if (!slate || !pool) return <Loading words={words} />;

  const rate = (bokId: string, testPhase: boolean, position: number) => async (interest: number, measure: ReadingMeasure) => {
    const story = testPhase ? pool.get(bokId) : slate.find((entry) => entry.id === bokId);
    await run.record("interest", {
      phase: testPhase ? "test" : "profile",
      position,
      interest,
      activeSeconds: measure.activeSeconds,
      progress: measure.progress,
      outcome: story ? inferReadOutcome(story, measure.activeSeconds, measure.progress, { scrollable: measure.scrollable }) : null,
    }, { reelId: bokId, condition: testPhase ? "test" : "profile", clientSeconds: measure.activeSeconds });
    setRatings((current) => ({
      ...current,
      [testPhase ? "test" : "profile"]: [...current[testPhase ? "test" : "profile"], { bokId, interest }],
    }));
  };

  if (!profileDone) {
    // The ordinary feed, in its own order, without the test pool and without what is already rated.
    const rated = new Set(ratings.profile.map((entry) => entry.bokId));
    const next = slate.find((story) => !rated.has(story.id) && !materials.targets.includes(story.id));
    if (!next) return <StudyMessage title={words.thanksTitle} body={<p>{words.a3FeedEmpty}</p>} />;
    const done = ratings.profile.length;
    return <InterestRead key={next.id} run={run} story={next} progress={words.a3Progress(done + 1, total)} onRated={rate(next.id, false, done)} />;
  }
  if (!targets) return <Loading words={words} />;
  if (phase === "ready") {
    return <Interstitial eyebrow={words.eyebrow} title={words.a3ProfileReadyTitle} body={<p>{words.a3ProfileReadyBody(targets.length)}</p>}
      action={words.continue} onAction={() => setPhase("reading")} />;
  }
  const answered = new Set(ratings.test.map((entry) => entry.bokId));
  const position = targets.findIndex((id) => !answered.has(id));
  if (position === -1) return <Loading words={words} />;
  const story = pool.get(targets[position]);
  if (!story) return <Loading words={words} error={words.textMissing} />;
  return <InterestRead key={story.id} run={run} story={story} progress={words.a3Progress(materials.profileSize + position + 1, total)}
    onRated={rate(story.id, true, position)} />;
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
      (failure: unknown) => { if (!cancelled) setError(localizeBoksMessage(failure instanceof Error ? failure.message : String(failure))); }
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
  if (!story) return <Loading words={run.words} error={run.words.textMissing} />;
  return <B1Piece key={story.id} run={run} story={story} mayReplay={!hadPassive}
    onDone={(role) => {
      if (role === "passive") setHadPassive(true);
      if (index + 1 < plan.pieces.length) setIndex(index + 1);
      else run.finish();
    }} />;
}

// b2 ----------------------------------------------------------------------

/**
 * One of b2's blocks: its intro, five minutes of plain texts in the feed with
 * the reading music on or off, then the two questions. The music starts from
 * the intro's button (a browser plays sound only after a gesture) and stops
 * when the block ends, without touching the reader's own music setting.
 */
function B2Block({ run, index, block, minutes, stories, onSaved }: {
  run: StudyRun<"b2">;
  index: number;
  block: B2Plan["blocks"][number];
  minutes: number;
  stories: Story[];
  onSaved: () => void;
}) {
  const { words } = run;
  const [phase, setPhase] = useState<"intro" | "read" | "ask">("intro");
  const [result, setResult] = useState<SessionMeasurement | null>(null);
  const saving = useSaving();
  useEffect(() => () => stopReadingMusic(false), []);
  const music = block.mode === "music";

  if (phase === "intro") {
    return <Interstitial eyebrow={words.eyebrow}
      title={music ? words.b2MusicTitle(minutes) : words.b2SilenceTitle(minutes)}
      body={<p>{music ? words.b2MusicBody : words.b2SilenceBody}</p>}
      action={words.start}
      onAction={() => {
        if (music) startReadingMusic(false);
        else stopReadingMusic(false);
        setPhase("read");
      }} />;
  }
  if (phase === "read" || !result) {
    return <FeedBrowser words={words} stories={stories} minutes={minutes} set={block.set} mode="inline"
      onFinish={(measurement) => { stopReadingMusic(false); setResult(measurement); setPhase("ask"); }} />;
  }
  return (
    <>
      <ScaleForm words={words} questions={studyQuestions.b2(words)} busy={saving.busy}
        onSubmit={(answers) => saving.save(async () => {
          await run.record("session", { index, mode: block.mode, measurement: result }, { condition: block.mode, clientSeconds: result.elapsedSeconds });
          await run.record("session_survey", { index, mode: block.mode, set: block.set, ...answers }, { condition: block.mode });
        }, onSaved)} />
      <SaveError error={saving.error} />
    </>
  );
}

/**
 * b2: everyone reads two comparable sets of plain texts, one block with the
 * quiet reading music and one in silence; the condition names the first
 * block's mode and set, and the second gets the other of both.
 */
function B2({ run }: { run: StudyRun<"b2"> }) {
  const { words } = run;
  const plan = useMemo(() => planB2(run.materials, run.participant.condition), [run]);
  const { stories, error } = useStories([...run.materials.setA, ...run.materials.setB]);
  const [step, setStep] = useState<"familiarity" | "headphones" | 0 | "pause" | 1>("familiarity");
  const saving = useSaving();
  if (!stories) return <Loading words={words} error={error} />;
  if (step === "familiarity") {
    const all = [...run.materials.setA, ...run.materials.setB].map((id) => stories.get(id)).filter((story): story is Story => Boolean(story));
    return (
      <>
        <CheckListForm words={words} title={words.familiarityTitle} body={words.familiarityBody} busy={saving.busy}
          options={all.map((story) => ({ id: story.id, label: story.title, hint: story.authorName }))}
          onSubmit={(known) => saving.save(() => run.record("familiarity", { known }), () => setStep("headphones"))} />
        <SaveError error={saving.error} />
      </>
    );
  }
  if (step === "headphones") {
    return <Interstitial eyebrow={words.eyebrow} title={words.b2HeadphonesTitle} body={<p>{words.b2HeadphonesBody}</p>} action={words.continue} onAction={() => setStep(0)} />;
  }
  if (step === "pause") {
    return <Interstitial eyebrow={words.eyebrow} title={words.b2PauseTitle} body={<p>{words.b2PauseBody}</p>} action={words.continue} onAction={() => setStep(1)} />;
  }
  const block = plan.blocks[step];
  const list = block.bokIds.map((id) => stories.get(id)).filter((story): story is Story => Boolean(story));
  return <B2Block key={step} run={run} index={step} block={block} minutes={plan.minutes} stories={list}
    onSaved={() => (step === 0 ? setStep("pause") : run.finish())} />;
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
    run.nextFragment().then(setFragment, (failure: unknown) => setError(localizeBoksMessage(failure instanceof Error ? failure.message : String(failure))));
  };
  useEffect(() => {
    let cancelled = false;
    run.nextFragment().then(
      (next) => { if (!cancelled) setFragment(next); },
      (failure: unknown) => { if (!cancelled) setError(localizeBoksMessage(failure instanceof Error ? failure.message : String(failure))); }
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
    case "a3": return <A3 run={run as StudyRun<"a3">} />;
    case "b1": return <B1 run={run as StudyRun<"b1">} />;
    case "b2": return <B2 run={run as StudyRun<"b2">} />;
    case "b3": return <B3 run={run as StudyRun<"b3">} />;
  }
}
