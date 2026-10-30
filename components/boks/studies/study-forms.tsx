"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { BoksLogo } from "@/components/boks/reader/boks-logo";
import { getBokArtwork } from "@/components/boks/reader/bok-artwork";
import { bokCoverStyle } from "@/components/boks/reader/bok-cover-palette";
import type { Story } from "@/components/boks/client-types";
import type { StudyWords } from "@/components/boks/studies/study-copy";

/**
 * The forms a study participant sees, without data access: each takes what to
 * show and calls back with the answer. The participant page and the Studio
 * gallery render the same components, so what is shown in a presentation is
 * exactly what participants get.
 *
 * They follow the v44 account pages: paper, an eyebrow over a serif display
 * heading, ink buttons with the one asymmetric corner, and boks shown as their
 * own covers.
 */

export function StudyFrame({ words, children, preview = false }: {
  words: StudyWords;
  children: ReactNode;
  preview?: boolean;
}) {
  return (
    <main className="study">
      <header className="study__header">
        <span />
        <BoksLogo seasonal={false} />
        <span />
      </header>
      {preview && <p className="study__preview" role="note">{words.previewBadge}</p>}
      <div className="study__body">{children}</div>
    </main>
  );
}

/** One screen: an eyebrow, a display heading, then whatever it holds. */
export function StudyScreen({ eyebrow, title, lead, children, centered = false }: {
  eyebrow?: string;
  title?: string;
  lead?: ReactNode;
  children?: ReactNode;
  centered?: boolean;
}) {
  return (
    <section className={`study-screen${centered ? " study-screen--centered" : ""}`}>
      {eyebrow && <p className="study-eyebrow">{eyebrow}</p>}
      {title && <h1 className="study-display">{title}</h1>}
      {lead && <div className="study-lead">{lead}</div>}
      {children}
    </section>
  );
}

export function StudyMessage({ title, body, action, eyebrow }: { title: string; body?: ReactNode; action?: ReactNode; eyebrow?: string }) {
  return (
    <StudyScreen eyebrow={eyebrow} title={title} lead={body} centered>
      {action && <div className="study-actions">{action}</div>}
    </StudyScreen>
  );
}

export function StudyIntro({ words, minutes, what, busy, onStart }: {
  words: StudyWords;
  minutes: number;
  /** What this study will ask, in one or two sentences. */
  what: string;
  busy?: boolean;
  onStart: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  return (
    <StudyScreen eyebrow={words.eyebrow} title={words.introTitle} lead={<p>{words.introBody}</p>}>
      <ul className="study-facts">
        <li>{what}</li>
        <li>{words.introDuration(minutes)}</li>
        <li>{words.introAnonymous}</li>
      </ul>
      <label className="study-check">
        <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
        <span>{words.introAgree}</span>
      </label>
      <button type="button" className="study-button" disabled={!agreed || busy} onClick={onStart}>
        {busy ? words.sending : words.start}
      </button>
    </StudyScreen>
  );
}

export type ScaleQuestion = {
  key: string;
  label: string;
  max: 5 | 7;
  low: string;
  high: string;
};

/** One agreement or intensity scale, every point a labelled button. */
export function ScaleField({ question, value, onChange }: {
  question: ScaleQuestion;
  value: number | null;
  onChange: (value: number) => void;
}) {
  const points = Array.from({ length: question.max }, (_, index) => index + 1);
  return (
    <fieldset className="study-question">
      <legend>{question.label}</legend>
      <div className="study-scale" style={{ gridTemplateColumns: `repeat(${question.max}, minmax(0, 1fr))` }}>
        {points.map((point) => (
          <button
            key={point}
            type="button"
            className="study-choice"
            aria-pressed={value === point}
            aria-label={`${point} / ${question.max}`}
            onClick={() => onChange(point)}
          >
            {point}
          </button>
        ))}
      </div>
      <div className="study-scale__anchors" aria-hidden="true"><span>{question.low}</span><span>{question.high}</span></div>
    </fieldset>
  );
}

export type ChoiceAnswer = "yes" | "no" | "unsure" | "part";

/** A few labelled options in one row: yes / no / not sure. */
export function OptionField<T extends string = ChoiceAnswer>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="study-question">
      <legend>{label}</legend>
      <div className="study-options">
        {options.map((option) => (
          <button key={option.value} type="button" className="study-choice" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Scale questions asked together after a text. The button stays off until
 * every scale has an answer: a skipped scale would be a missing value in the
 * one number the hypothesis is about.
 */
export function ScaleForm({ words, eyebrow, title, questions, check, busy, onSubmit }: {
  words: StudyWords;
  eyebrow?: string;
  title?: string;
  questions: ScaleQuestion[];
  /** An optional tick box under the scales, such as «I had read it before». */
  check?: { key: string; label: string };
  busy?: boolean;
  onSubmit: (answers: Record<string, number | boolean>) => void;
}) {
  const [values, setValues] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState(false);
  const complete = questions.every((question) => values[question.key] !== undefined);
  return (
    <StudyScreen eyebrow={eyebrow ?? words.eyebrow} title={title}>
      {questions.map((question) => (
        <ScaleField key={question.key} question={question} value={values[question.key] ?? null}
          onChange={(value) => setValues((current) => ({ ...current, [question.key]: value }))} />
      ))}
      {check && (
        <label className="study-check">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>{check.label}</span>
        </label>
      )}
      <button type="button" className="study-button" disabled={!complete || busy}
        onClick={() => onSubmit(check ? { ...values, [check.key]: checked } : values)}>
        {busy ? words.sending : words.next}
      </button>
    </StudyScreen>
  );
}

/** Tick what applies; nothing ticked is an answer too. */
export function CheckListForm({ words, title, body, options, busy, onSubmit }: {
  words: StudyWords;
  title: string;
  body?: string;
  options: { id: string; label: string; hint?: string }[];
  busy?: boolean;
  onSubmit: (selected: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <StudyScreen eyebrow={words.eyebrow} title={title} lead={body && <p>{body}</p>}>
      <div className="study-rows">
        {options.map((option) => {
          const on = selected.includes(option.id);
          return (
            <button key={option.id} type="button" className="study-row" aria-pressed={on}
              onClick={() => setSelected((current) => (on ? current.filter((id) => id !== option.id) : [...current, option.id]))}>
              <span><strong>{option.label}</strong>{option.hint && <small>{option.hint}</small>}</span>
              <span className="study-row__tick" aria-hidden="true">{on && <Check />}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="study-button" disabled={busy} onClick={() => onSubmit(selected)}>
        {busy ? words.sending : words.next}
      </button>
    </StudyScreen>
  );
}

/** A bok's own cover colours, or its Series artwork. */
export function coverStyle(story: Story): CSSProperties {
  return bokCoverStyle(story.id) as CSSProperties;
}

/** A small cover: the artwork, or the initial on the bok's palette - as «Up next» shows it. */
function CoverTile({ story }: { story: Story }) {
  const artwork = getBokArtwork(story);
  return artwork
    ? <img className="study-tile" src={artwork} alt="" width="64" height="64" loading="lazy" />
    : <span className="study-tile study-tile--type" style={coverStyle(story)} aria-hidden="true">{story.title.charAt(0)}</span>;
}

/** A bok to choose: cover, title, byline, the cover summary; never its kind or format. */
export function BokCard({ story, words, onOpen }: { story: Story; words: StudyWords; onOpen?: () => void }) {
  const body = (
    <>
      <CoverTile story={story} />
      <span className="study-bok__copy">
        <strong>{story.title}</strong>
        <span>{story.authorName} · {words.minutesShort(Math.max(1, story.minutes))}</span>
        {story.summary && <small>{story.summary}</small>}
      </span>
      {onOpen && <span className="study-bok__arrow" aria-hidden="true"><ArrowRight /></span>}
    </>
  );
  return onOpen
    ? <button type="button" className="study-bok" onClick={onOpen} aria-label={`${words.open}: ${story.title}`}>{body}</button>
    : <div className="study-bok">{body}</div>;
}

/** A bok as the feed shows it: its cover, with Read. */
/** The start of the text, for the card; the stylesheet clamps it to three lines. */
function openingLines(body: string) {
  return body.trim().slice(0, 220);
}

export function BokCover({ story, words, onOpen }: { story: Story; words: StudyWords; onOpen: () => void }) {
  const artwork = getBokArtwork(story);
  return (
    <article className={`study-cover${artwork ? " study-cover--art" : ""}`} style={coverStyle(story)}>
      {artwork ? <img className="study-cover__art" src={artwork} alt="" /> : <span className="study-cover__letter" aria-hidden="true">{story.title.charAt(0)}</span>}
      <div className="study-cover__heading">
        <h2>{story.title}</h2>
        <p className="study-cover__byline">{story.authorName}</p>
        <p className="study-cover__byline">{words.minutesShort(story.minutes)}</p>
        <p className="study-cover__summary">{openingLines(story.body)}</p>
      </div>
      <button type="button" className="study-cover__read" onClick={onOpen}>
        {words.open} <ArrowRight aria-hidden="true" />
      </button>
    </article>
  );
}

/** A free choice among texts, or none. */
export function BokChoiceForm({ words, title, body, boks, nothingLabel, busy, onChoose }: {
  words: StudyWords;
  title: string;
  body?: string;
  boks: Story[];
  nothingLabel: string;
  busy?: boolean;
  onChoose: (bokId: string | null) => void;
}) {
  return (
    <StudyScreen eyebrow={words.eyebrow} title={title} lead={body && <p>{body}</p>}>
      <div className="study-boks">
        {boks.map((story) => <BokCard key={story.id} story={story} words={words} onOpen={busy ? undefined : () => onChoose(story.id)} />)}
      </div>
      <button type="button" className="study-button study-button--outline" disabled={busy} onClick={() => onChoose(null)}>
        {nothingLabel}
      </button>
    </StudyScreen>
  );
}

export type SessionSurveyAnswer = {
  perBok: Record<string, { readBefore: "yes" | "no"; finished: "yes" | "part" | "no" }>;
  satisfaction: number | null;
  sessionSatisfaction: number | null;
  moved: number | null;
};

/**
 * After ten minutes: each text opened, how the choice felt, whether the
 * reading moved them, and - always, even with nothing opened - how satisfied
 * they are with the session as a whole, the same question after every session.
 */
export function SessionSurveyForm({ words, opened, askChoice = false, busy, onSubmit }: {
  words: StudyWords;
  opened: Story[];
  /** a2: which text was chosen, or nothing, and how easy the choice was. */
  askChoice?: boolean;
  busy?: boolean;
  onSubmit: (answer: SessionSurveyAnswer) => void;
}) {
  const [perBok, setPerBok] = useState<SessionSurveyAnswer["perBok"]>({});
  const [satisfaction, setSatisfaction] = useState<number | null>(null);
  const [sessionSatisfaction, setSessionSatisfaction] = useState<number | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [easyChoice, setEasyChoice] = useState<number | null>(null);
  const yesNo = [{ value: "yes" as const, label: words.yes }, { value: "no" as const, label: words.no }];
  const finished = [
    { value: "yes" as const, label: words.yes },
    { value: "part" as const, label: words.partly },
    { value: "no" as const, label: words.no },
  ];
  const complete = opened.every((story) => perBok[story.id]?.readBefore && perBok[story.id]?.finished) &&
    (opened.length === 0 || (satisfaction !== null && moved !== null)) && sessionSatisfaction !== null &&
    (!askChoice || (chosen !== null && easyChoice !== null));
  const set = (id: string, patch: Partial<SessionSurveyAnswer["perBok"][string]>) =>
    setPerBok((current) => ({ ...current, [id]: { ...current[id], ...patch } as SessionSurveyAnswer["perBok"][string] }));
  return (
    <StudyScreen eyebrow={words.eyebrow} title={words.surveyTitle} lead={opened.length === 0 && <p>{words.surveyNothingOpened}</p>}>
      {askChoice && (
        <>
          <OptionField label={words.a2Chosen} value={chosen} onChange={setChosen}
            options={[...opened.map((story) => ({ value: story.id, label: story.title })), { value: "nothing", label: words.a2ChoseNothing }]} />
          <ScaleField
            question={{ key: "easyChoice", label: words.a2Easy, max: 7, low: words.scaleDisagree, high: words.scaleAgree }}
            value={easyChoice}
            onChange={setEasyChoice}
          />
        </>
      )}
      {opened.map((story) => (
        <div key={story.id} className="study-survey__bok">
          <BokCard story={story} words={words} />
          <OptionField label={words.surveyReadBefore} options={yesNo} value={perBok[story.id]?.readBefore ?? null}
            onChange={(value) => set(story.id, { readBefore: value as "yes" | "no" })} />
          <OptionField label={words.surveyFinished} options={finished} value={perBok[story.id]?.finished ?? null}
            onChange={(value) => set(story.id, { finished: value as "yes" | "part" | "no" })} />
        </div>
      ))}
      {opened.length > 0 && (
        <ScaleField
          question={{ key: "satisfaction", label: words.surveySatisfaction, max: 5, low: words.scaleUnhappy, high: words.scaleHappy }}
          value={satisfaction}
          onChange={setSatisfaction}
        />
      )}
      {opened.length > 0 && (
        <ScaleField
          question={{ key: "moved", label: words.surveyMoved, max: 7, low: words.scaleDisagree, high: words.scaleAgree }}
          value={moved}
          onChange={setMoved}
        />
      )}
      <ScaleField
        question={{ key: "sessionSatisfaction", label: words.surveySessionSatisfaction, max: 7, low: words.scaleSessionUnhappy, high: words.scaleSessionHappy }}
        value={sessionSatisfaction}
        onChange={setSessionSatisfaction}
      />
      <button type="button" className="study-button" disabled={!complete || busy}
        onClick={() => onSubmit({
          perBok,
          satisfaction: opened.length ? satisfaction : null,
          sessionSatisfaction,
          moved: opened.length ? moved : null,
          ...(askChoice ? { chosen: chosen === "nothing" ? null : chosen, easyChoice } : {}),
        })}>
        {busy ? words.sending : words.send}
      </button>
    </StudyScreen>
  );
}

/** Study b3: two questions under a fragment. «Not sure» is not a yes. */
export function FragmentRatingForm({ words, busy, onSubmit }: {
  words: StudyWords;
  busy?: boolean;
  onSubmit: (answer: { standalone: ChoiceAnswer; complete: ChoiceAnswer }) => void;
}) {
  const [standalone, setStandalone] = useState<ChoiceAnswer | null>(null);
  const [complete, setComplete] = useState<ChoiceAnswer | null>(null);
  const options = [
    { value: "yes" as const, label: words.yes },
    { value: "no" as const, label: words.no },
    { value: "unsure" as const, label: words.unsure },
  ];
  return (
    <div className="study-rating">
      <OptionField label={words.b3Standalone} options={options} value={standalone} onChange={setStandalone} />
      <OptionField label={words.b3Complete} options={options} value={complete} onChange={setComplete} />
      <button type="button" className="study-button" disabled={!standalone || !complete || busy}
        onClick={() => standalone && complete && onSubmit({ standalone, complete })}>
        {busy ? words.sending : words.send}
      </button>
    </div>
  );
}
