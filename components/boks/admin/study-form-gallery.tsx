"use client";

import { useState, type ReactNode } from "react";
import "@/app/study.css";
import { studyCopy, studyMinutes, type StudyWords } from "@/components/boks/studies/study-copy";
import {
  BokChoiceForm,
  CheckListForm,
  ScaleForm,
  SessionSurveyForm,
  StudyFrame,
  StudyIntro,
  StudyMessage,
} from "@/components/boks/studies/study-forms";
import { FragmentScreen, Interstitial, studyQuestions } from "@/components/boks/studies/study-protocols";
import { CatalogueBrowser, FeedBrowser, StudyTextReader } from "@/components/boks/studies/study-reader";
import { sampleFragments, sampleStories } from "@/components/boks/studies/study-samples";
import { studyDescriptions, studyKeys, type StudyKey } from "@/lib/boks/studies/protocol";

/**
 * Every screen a participant meets, study by study, each in a phone-sized
 * frame: the real components with sample texts, so a screenshot for the
 * presentation is exactly what a participant will see. Nothing here talks to
 * the database; buttons do nothing.
 */

const noop = () => undefined;

function Phone({ caption, words, children }: { caption: string; words: StudyWords; children: ReactNode }) {
  return (
    <figure className="study-gallery__item">
      <div className="study-gallery__phone">
        <StudyFrame words={words}>{children}</StudyFrame>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function galleryScreens(key: StudyKey, words: StudyWords): { caption: string; body: ReactNode }[] {
  const [first, second, third, fourth] = sampleStories;
  const intro = { caption: "Consent and start (every study)", body: <StudyIntro words={words} minutes={studyMinutes[key]} what={words.introWhat[key]} onStart={noop} /> };
  switch (key) {
    case "rg1":
      return [
        intro,
        { caption: "Both formats are introduced first, on a different piece", body: <Interstitial eyebrow={words.eyebrow} title={words.familiarizationTitle} body={<p>{words.familiarizationBody}</p>} action={words.start} onAction={noop} /> },
        { caption: "Text condition: the same piece as plain text (Series condition: the product's player, without its ending)", body: <StudyTextReader story={first} words={words} onDone={noop} /> },
        { caption: "After reading: two scales, 1–7", body: <ScaleForm words={words} questions={studyQuestions.rg1(words)} check={{ key: "knewBefore", label: words.knewBefore }} onSubmit={noop} /> },
      ];
    case "rg2":
      return [
        intro,
        { caption: "Before each session", body: <Interstitial eyebrow={words.eyebrow} title={words.sessionTitle(10)} body={<><p>{words.sessionIntroFeed}</p><p>{words.sessionRules(10)}</p></>} action={words.start} onAction={noop} /> },
        { caption: "Feed session: the personal feed, one bok a screen", body: <FeedBrowser words={words} stories={sampleStories} minutes={10} mode="feed" onFinish={noop} /> },
        { caption: "Catalogue session: other texts of the same feed, with search and filters", body: <CatalogueBrowser words={words} stories={sampleStories} minutes={10} onFinish={noop} /> },
        { caption: "After each session: the texts, the choice, «тронуло» 1–7 and session satisfaction 1–7", body: <SessionSurveyForm words={words} opened={[first, third]} onSubmit={noop} /> },
        { caption: "Between the two sessions; the order is assigned at random", body: <Interstitial eyebrow={words.eyebrow} title={words.secondSessionTitle} body={<p>{words.secondSessionBody}</p>} action={words.continue} onAction={noop} /> },
      ];
    case "a1":
      return [
        intro,
        { caption: "A whole work or a fragment, read in turn", body: <StudyTextReader story={fourth} words={words} note={words.readThisText} onDone={noop} /> },
        { caption: "After each text", body: <ScaleForm words={words} questions={studyQuestions.a1(words)} check={{ key: "knewBefore", label: words.knewBefore }} onSubmit={noop} /> },
        { caption: "The free choice: two of each kind, unlabelled, or none", body: <BokChoiceForm words={words} title={words.a1ChooseTitle} body={words.a1ChooseBody} boks={[second, fourth, first, third]} nothingLabel={words.chooseNothing} onChoose={noop} /> },
      ];
    case "a2":
      return [
        intro,
        { caption: "Before the timer: which texts are already known", body: <CheckListForm words={words} title={words.familiarityTitle} body={words.familiarityBody} options={sampleStories.map((story) => ({ id: story.id, label: story.title, hint: story.authorName }))} onSubmit={noop} /> },
        { caption: "Text in the feed", body: <FeedBrowser words={words} stories={sampleStories} minutes={10} mode="inline" onFinish={noop} /> },
        { caption: "Card with a separate reading screen", body: <FeedBrowser words={words} stories={sampleStories} minutes={10} mode="cards" onFinish={noop} /> },
        { caption: "After each session", body: <SessionSurveyForm words={words} opened={[second]} onSubmit={noop} /> },
      ];
    case "a3":
      return [
        intro,
        { caption: "The ordinary feed with one question", body: <Interstitial eyebrow={words.eyebrow} title={words.a3IntroTitle} body={<p>{words.a3IntroBody(15)}</p>} action={words.start} onAction={noop} /> },
        { caption: "A text from the participant's own feed", body: <StudyTextReader story={second} words={words} note={words.a3Progress(2, 15)} doneLabel={words.a3Next} onDone={noop} /> },
        { caption: "On leaving every text: interest, 1–5", body: <ScaleForm words={words} eyebrow={words.a3Progress(2, 15)} title={second.title} questions={studyQuestions.a3(words)} onSubmit={noop} /> },
        { caption: "Five rated: the profile is fixed; ten new texts by other authors follow in random order", body: <Interstitial eyebrow={words.eyebrow} title={words.a3ProfileReadyTitle} body={<p>{words.a3ProfileReadyBody(10)}</p>} action={words.continue} onAction={noop} /> },
      ];
    case "b1":
      return [
        intro,
        { caption: "Active role: the participant works the scenes", body: <Interstitial eyebrow={words.eyebrow} title="Spirits of the Dead" body={<p>{words.activeNote}</p>} action={words.start} onAction={noop} /> },
        { caption: "Passive role: the same events replayed at the same moments", body: <Interstitial eyebrow={words.eyebrow} title="Spirits of the Dead" body={<p>{words.passiveNote}</p>} action={words.start} onAction={noop} /> },
        { caption: "After each piece: two intensity scales, 1–7", body: <ScaleForm words={words} questions={studyQuestions.b1(words)} onSubmit={noop} /> },
      ];
    case "b2":
      return [
        intro,
        { caption: "Screening: only a piece by an author the participant does not know is used", body: <CheckListForm words={words} title={words.b2ScreenTitle} body={words.b2ScreenBody} options={["Эдгар Аллан По", "Эмили Дикинсон", "Томас Гарди", "Роберт Бёрнс"].map((author) => ({ id: author, label: author }))} onSubmit={noop} /> },
        { caption: "After meeting the author (Series or plain text): the same showcase for both conditions", body: <BokChoiceForm words={words} title={words.b2ShowcaseTitle} body={words.b2ShowcaseBody} boks={[third, first, second]} nothingLabel={words.b2Leave} onChoose={noop} /> },
      ];
    case "b3":
      return [
        intro,
        { caption: "A fragment and the two questions; the cutting method is never shown", body: <FragmentScreen fragment={sampleFragments[1]} words={words} busy={false} onRate={noop} /> },
        { caption: "Between fragments", body: <StudyMessage title={words.b3Count(3)} action={<div className="study-actions"><button type="button" className="study-button">{words.b3More}</button><button type="button" className="study-button study-button--plain">{words.b3Enough}</button></div>} /> },
      ];
  }
}

export function StudyFormGallery() {
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const [only, setOnly] = useState<StudyKey | "all">("all");
  const words = studyCopy[language];
  return (
    <section className="study-gallery">
      <p className="study-gallery__intro">
        Every screen a participant sees, with sample public-domain texts. The participant pages render these same
        components, so a screenshot here is what the study will show. Series pieces play in the product&apos;s own
        player and are not framed here; open a study&apos;s preview for them.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="admin-segmented" aria-label="Language">
          {(["ru", "en"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>
              {value === "ru" ? "Русский" : "English"}
            </button>
          ))}
        </div>
        <div className="admin-segmented" aria-label="Study">
          {(["all", ...studyKeys] as const).map((value) => (
            <button key={value} type="button" aria-pressed={only === value} onClick={() => setOnly(value)}>
              {value === "all" ? "All" : studyDescriptions[value].label}
            </button>
          ))}
        </div>
      </div>
      {studyKeys.filter((key) => only === "all" || only === key).map((key) => (
        <div key={`${key}-${language}`} className="study-gallery__study">
          <h2>{studyDescriptions[key].label} · {studyDescriptions[key].title}</h2>
          <div className="study-gallery__row">
            {galleryScreens(key, words).map((screen) => (
              <Phone key={screen.caption} caption={screen.caption} words={words}>{screen.body}</Phone>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
