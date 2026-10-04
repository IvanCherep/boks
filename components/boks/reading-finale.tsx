"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Heart, Lightbulb, MessageCircle, RotateCcw, Share2, Smile } from "lucide-react";
import { aftertasteTags, type AftertasteTag } from "@/lib/boks/contracts";

/**
 * How every boks series piece ends, whatever format it was read in.
 *
 * Two screens, always in this order: the aftertaste - what stayed - and then
 * where to go from here. A poem and a story are told very differently, but the
 * moment after the last word is the same moment, and a reader who has seen it
 * once should know where everything is the next time. A format draws the
 * reading; it never draws its own ending. A new format renders this and owes
 * it nothing but a way to start again.
 *
 * The words are English whatever the piece is in: the interface speaks one
 * language, the pieces keep their own.
 *
 * What the buttons do is the feed's business, not the format's: the feed
 * builds one `FinaleActions` and hands the same object to every format, so a
 * like or a share from the end of a poem is exactly the like or share from the
 * end of a story.
 */
export type FinaleActions = {
  liked: boolean;
  onLike: () => void;
  onShare: () => void;
  onNext: () => void;
  /** Called with whatever was picked. Never called with nothing. */
  onAftertaste: (tags: AftertasteTag[]) => void;
  /**
   * The reading got to its end - the series shelf marks the piece heard. Called
   * each time the finale appears, so it has to be safe to repeat.
   */
  onReached?: () => void;
};

/**
 * The four words, and the icon each wears.
 *
 * None of them is "good" or "bad" on purpose. A reader who wants to think
 * about a piece has not enjoyed it less than one who smiled, and a rating
 * would flatten exactly the difference worth keeping.
 */
const aftertasteIcons: Record<AftertasteTag, typeof Smile> = {
  smiled: Smile,
  moved: Heart,
  surprised: Lightbulb,
  pondering: MessageCircle,
};

const words = {
  ended: "Where next?",
  aftertasteEyebrow: "Aftertaste",
  aftertasteTitle: "What stayed with you?",
  aftertaste: {
    smiled: "Made me smile",
    moved: "Moved me",
    surprised: "Surprised me",
    pondering: "Want to think",
  },
  onward: "Onward",
  skip: "Skip",
  again: "Listen again",
  like: "Like",
  liked: "Liked",
  next: "Choose the next one",
  share: "Share",
};

/**
 * The ending itself. Mount it when the reading is over and unmount it when the
 * reader starts again; it keeps nothing between two endings.
 *
 * Without `actions` - the admin sandbox, where a piece has no boks yet - it
 * still asks and still offers another listen, and leaves out what would need a
 * boks to act on.
 */
export function ReadingFinale({
  actions,
  onAgain,
}: {
  actions?: FinaleActions;
  onAgain: () => void;
}) {
  const [step, setStep] = useState<"aftertaste" | "menu">("aftertaste");
  // Once per mount: the finale is mounted when a reading ends and unmounted
  // when it starts again, so a mount is an ending.
  const reached = useRef(actions?.onReached);
  useEffect(() => {
    reached.current?.();
  }, []);
  const [picked, setPicked] = useState<AftertasteTag[]>([]);

  if (step === "aftertaste") {
    return (
      <div className="finale finale--aftertaste">
        <span className="finale__eyebrow">{words.aftertasteEyebrow}</span>
        <h2 className="finale__title">{words.aftertasteTitle}</h2>

        {/*
          Several may be picked and none is a complete answer, so these are
          not radio buttons and there is no "submit". Moving on is the only
          required act, which is why the button says "onward" rather than
          "done": nothing here is owed.
        */}
        <div className="finale__grid">
          {aftertasteTags.map((tag) => {
            const Icon = aftertasteIcons[tag];
            const on = picked.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={`finale__chip ${on ? "is-on" : ""}`}
                aria-pressed={on}
                onClick={() =>
                  setPicked((current) =>
                    current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
                  )
                }
              >
                <Icon className="size-4" fill={on && tag === "moved" ? "currentColor" : "none"} />
                {words.aftertaste[tag]}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className={picked.length > 0 ? "finale__primary" : "finale__secondary"}
          onClick={() => {
            // An empty answer is allowed but not worth a row: how many
            // declined is already the difference between this and the
            // finishes the feed counts anyway.
            if (picked.length > 0) actions?.onAftertaste(picked);
            setStep("menu");
          }}
        >
          {picked.length > 0 ? words.onward : words.skip}
          <ArrowRight className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="finale">
      <h2 className="finale__title">{words.ended}</h2>
      <div className="finale__actions">
        {/*
          Sending it on is the first thing offered here, and the only one
          wearing the accent.

          This is the one moment the reader has just been moved by something
          and has not yet moved on - the piece is over, the picture is still
          up, and there is nothing else asking for attention. Anywhere else in
          the app a share button competes with reading; here it competes with
          nothing.
        */}
        {actions && (
          <button type="button" className="finale__primary" onClick={actions.onShare}>
            <Share2 className="size-4" />
            {words.share}
          </button>
        )}
        <div className="finale__row">
          <button type="button" className="finale__secondary" onClick={onAgain}>
            <RotateCcw className="size-4" />
            {words.again}
          </button>
          {/*
            A like, the same `likeStory` the feed's heart calls, labelled the
            way the feed labels it. One heart, filled when it is on.
          */}
          {actions && (
            <button type="button" className="finale__secondary" onClick={actions.onLike}>
              <Heart className="size-4" fill={actions.liked ? "currentColor" : "none"} />
              {actions.liked ? words.liked : words.like}
            </button>
          )}
        </div>
        {actions && (
          <button type="button" className="finale__secondary" onClick={actions.onNext}>
            <ArrowRight className="size-4" />
            {words.next}
          </button>
        )}
      </div>
    </div>
  );
}
