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
import { studyDescription, studyKeys, type StudyKey } from "@/lib/boks/studies/protocol";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { defineMessages } from "@/lib/i18n/messages";

/**
 * Every screen a participant meets, study by study, each in a phone-sized
 * frame: the real components with sample texts, so a screenshot for the
 * presentation is exactly what a participant will see. Nothing here talks to
 * the database; buttons do nothing.
 */

const noop = () => undefined;

const galleryWords = defineMessages({
  intro: "Consent and start (every study)",
  rg1Familiar: "Both formats are introduced first, on a different piece",
  rg1Text: "Text condition: the same piece as plain text (Series condition: the product's player, without its ending)",
  rg1After: "After reading: two scales, 1–7",
  rg2Before: "Before each session",
  rg2Feed: "Feed session: the personal feed, one bok a screen",
  rg2Catalogue: "Catalogue session: other texts of the same feed, with search and filters",
  rg2After: "After each session: the texts, the choice, «тронуло» 1–7 and session satisfaction 1–7",
  rg2Between: "Between the two sessions; the order is assigned at random",
  a1Read: "A whole work or a fragment, read in turn",
  a1After: "After each text",
  a1Choice: "The free choice: two of each kind, unlabelled, or none",
  a2Known: "Before the timer: which texts are already known",
  a2Inline: "Text in the feed",
  a2Cards: "Card with a separate reading screen",
  a2After: "After each session",
  a3Intro: "The ordinary feed with one question",
  a3Text: "A text from the participant's own feed",
  a3Rate: "On leaving every text: interest, 1–5",
  a3Profile: "Five rated: the profile is fixed; ten new texts by other authors follow in random order",
  b1Active: "With actions: the participant works the scenes",
  b1Passive: "Automatic: a recorded session's effects and pauses replayed at the same moments",
  b1After: "After each piece: one immersion scale, 1–7",
  b2Headphones: "Before the blocks: the same headphones and volume for both",
  b2Music: "Block with music: started by the button, the volume is fixed",
  b2Read: "Five minutes of plain texts, no narration",
  b2After: "After each block: enjoyment and distraction, 1–7",
  b2Pause: "A short pause, then the other mode with the other set",
  b3Fragment: "A fragment and the two questions; the cutting method is never shown",
  b3Between: "Between fragments",
  galleryIntro: "Every screen a participant sees, with sample public-domain texts. The participant pages render these same components, so a screenshot here is what the study will show. Series pieces play in the product's own player and are not framed here; open a study's preview for them.",
  language: "Language",
  study: "Study",
  all: "All",
}, {
  ru: {
    intro: "Согласие и старт (во всех исследованиях)",
    rg1Familiar: "Сначала оба формата показывают на другом произведении",
    rg1Text: "Условие «текст»: то же произведение простым текстом (условие «серия»: плеер продукта без концовки)",
    rg1After: "После чтения: две шкалы, 1–7",
    rg2Before: "Перед каждой сессией",
    rg2Feed: "Сессия в ленте: персональная лента, один бок на экран",
    rg2Catalogue: "Сессия в каталоге: другие тексты той же ленты, с поиском и фильтрами",
    rg2After: "После каждой сессии: тексты, выбор, «тронуло» 1–7 и удовлетворённость сессией 1–7",
    rg2Between: "Между двумя сессиями; порядок назначается случайно",
    a1Read: "Целое произведение или фрагмент, по очереди",
    a1After: "После каждого текста",
    a1Choice: "Свободный выбор: по два каждого вида, без пометок, или ничего",
    a2Known: "До таймера: какие тексты уже знакомы",
    a2Inline: "Текст в ленте",
    a2Cards: "Карточка с отдельным экраном чтения",
    a2After: "После каждой сессии",
    a3Intro: "Обычная лента с одним вопросом",
    a3Text: "Текст из собственной ленты участника",
    a3Rate: "При выходе из каждого текста: интерес, 1–5",
    a3Profile: "Пять оценено: профиль зафиксирован; дальше десять новых текстов других авторов в случайном порядке",
    b1Active: "С действиями: участник сам управляет сценами",
    b1Passive: "Автоматически: эффекты и паузы записанного сеанса в те же моменты",
    b1After: "После каждого произведения: одна шкала погружения, 1–7",
    b2Headphones: "Перед блоками: одни и те же наушники и громкость",
    b2Music: "Блок с музыкой: включается кнопкой, громкость задана заранее",
    b2Read: "Пять минут обычных текстов без озвучки",
    b2After: "После каждого блока: удовольствие и отвлечение, 1–7",
    b2Pause: "Короткая пауза, затем другой режим с другим набором",
    b3Fragment: "Фрагмент и два вопроса; способ нарезки никогда не показывается",
    b3Between: "Между фрагментами",
    galleryIntro: "Все экраны, которые видит участник, на примерах общественного достояния. Страницы участника рисуют эти же компоненты, так что скриншот отсюда и есть то, что покажет исследование. Произведения серии играют в собственном плеере продукта и здесь не показаны; для них откройте предпросмотр исследования.",
    language: "Язык",
    study: "Исследование",
    all: "Все",
  },
});

type GalleryWords = (typeof galleryWords)["en"];

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

export function galleryScreens(key: StudyKey, words: StudyWords, t: GalleryWords = galleryWords.en): { caption: string; body: ReactNode }[] {
  const [first, second, third, fourth] = sampleStories;
  const intro = { caption: t.intro, body: <StudyIntro words={words} minutes={studyMinutes[key]} what={words.introWhat[key]} onStart={noop} /> };
  switch (key) {
    case "rg1":
      return [
        intro,
        { caption: t.rg1Familiar, body: <Interstitial eyebrow={words.eyebrow} title={words.familiarizationTitle} body={<p>{words.familiarizationBody}</p>} action={words.start} onAction={noop} /> },
        { caption: t.rg1Text, body: <StudyTextReader story={first} words={words} onDone={noop} /> },
        { caption: t.rg1After, body: <ScaleForm words={words} questions={studyQuestions.rg1(words)} check={{ key: "knewBefore", label: words.knewBefore }} onSubmit={noop} /> },
      ];
    case "rg2":
      return [
        intro,
        { caption: t.rg2Before, body: <Interstitial eyebrow={words.eyebrow} title={words.sessionTitle(10)} body={<><p>{words.sessionIntroFeed}</p><p>{words.sessionRules(10)}</p></>} action={words.start} onAction={noop} /> },
        { caption: t.rg2Feed, body: <FeedBrowser words={words} stories={sampleStories} minutes={10} mode="feed" onFinish={noop} /> },
        { caption: t.rg2Catalogue, body: <CatalogueBrowser words={words} stories={sampleStories} minutes={10} onFinish={noop} /> },
        { caption: t.rg2After, body: <SessionSurveyForm words={words} opened={[first, third]} onSubmit={noop} /> },
        { caption: t.rg2Between, body: <Interstitial eyebrow={words.eyebrow} title={words.secondSessionTitle} body={<p>{words.secondSessionBody}</p>} action={words.continue} onAction={noop} /> },
      ];
    case "a1":
      return [
        intro,
        { caption: t.a1Read, body: <StudyTextReader story={fourth} words={words} note={words.readThisText} onDone={noop} /> },
        { caption: t.a1Choice, body: <BokChoiceForm words={words} title={words.a1ChooseTitle} body={words.a1ChooseBody} boks={[second, fourth]} nothingLabel={words.chooseNothing} onChoose={noop} /> },
        { caption: t.a1After, body: <ScaleForm words={words} questions={studyQuestions.a1(words)} check={{ key: "knewBefore", label: words.knewBefore }} onSubmit={noop} /> },
      ];
    case "a2":
      return [
        intro,
        { caption: t.a2Known, body: <CheckListForm words={words} title={words.familiarityTitle} body={words.familiarityBody} options={sampleStories.map((story) => ({ id: story.id, label: story.title, hint: story.authorName }))} onSubmit={noop} /> },
        { caption: t.a2Inline, body: <FeedBrowser words={words} stories={sampleStories} minutes={10} mode="inline" onFinish={noop} /> },
        { caption: t.a2Cards, body: <FeedBrowser words={words} stories={sampleStories} minutes={10} mode="cards" onFinish={noop} /> },
        { caption: t.a2After, body: <SessionSurveyForm words={words} opened={[second]} askChoice onSubmit={noop} /> },
      ];
    case "a3":
      return [
        intro,
        { caption: t.a3Intro, body: <Interstitial eyebrow={words.eyebrow} title={words.a3IntroTitle} body={<p>{words.a3IntroBody(15)}</p>} action={words.start} onAction={noop} /> },
        { caption: t.a3Text, body: <StudyTextReader story={second} words={words} note={words.a3Progress(2, 15)} doneLabel={words.a3Next} onDone={noop} /> },
        { caption: t.a3Rate, body: <ScaleForm words={words} eyebrow={words.a3Progress(2, 15)} title={second.title} questions={studyQuestions.a3(words)} onSubmit={noop} /> },
        { caption: t.a3Profile, body: <Interstitial eyebrow={words.eyebrow} title={words.a3ProfileReadyTitle} body={<p>{words.a3ProfileReadyBody(10)}</p>} action={words.continue} onAction={noop} /> },
      ];
    case "b1":
      return [
        intro,
        { caption: t.b1Active, body: <Interstitial eyebrow={words.eyebrow} title="Spirits of the Dead" body={<p>{words.activeNote}</p>} action={words.start} onAction={noop} /> },
        { caption: t.b1Passive, body: <Interstitial eyebrow={words.eyebrow} title="Spirits of the Dead" body={<p>{words.passiveNote}</p>} action={words.start} onAction={noop} /> },
        { caption: t.b1After, body: <ScaleForm words={words} questions={studyQuestions.b1(words)} onSubmit={noop} /> },
      ];
    case "b2":
      return [
        intro,
        { caption: t.b2Headphones, body: <Interstitial eyebrow={words.eyebrow} title={words.b2HeadphonesTitle} body={<p>{words.b2HeadphonesBody}</p>} action={words.continue} onAction={noop} /> },
        { caption: t.b2Music, body: <Interstitial eyebrow={words.eyebrow} title={words.b2MusicTitle(5)} body={<p>{words.b2MusicBody}</p>} action={words.start} onAction={noop} /> },
        { caption: t.b2Read, body: <FeedBrowser words={words} stories={sampleStories} minutes={5} mode="inline" onFinish={noop} /> },
        { caption: t.b2After, body: <ScaleForm words={words} questions={studyQuestions.b2(words)} onSubmit={noop} /> },
        { caption: t.b2Pause, body: <Interstitial eyebrow={words.eyebrow} title={words.b2PauseTitle} body={<p>{words.b2PauseBody}</p>} action={words.continue} onAction={noop} /> },
      ];
    case "b3":
      return [
        intro,
        { caption: t.b3Fragment, body: <FragmentScreen fragment={sampleFragments[1]} words={words} busy={false} onRate={noop} /> },
        { caption: t.b3Between, body: <StudyMessage title={words.b3Count(3)} action={<div className="study-actions"><button type="button" className="study-button">{words.b3More}</button><button type="button" className="study-button study-button--plain">{words.b3Enough}</button></div>} /> },
      ];
  }
}

export function StudyFormGallery() {
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const [only, setOnly] = useState<StudyKey | "all">("all");
  const words = studyCopy[language];
  const t = useMessages(galleryWords);
  const uiLanguage = useUiLanguage();
  return (
    <section className="study-gallery">
      <p className="study-gallery__intro">{t.galleryIntro}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="admin-segmented" aria-label={t.language}>
          {(["ru", "en"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>
              {value === "ru" ? "Русский" : "English"}
            </button>
          ))}
        </div>
        <div className="admin-segmented" aria-label={t.study}>
          {(["all", ...studyKeys] as const).map((value) => (
            <button key={value} type="button" aria-pressed={only === value} onClick={() => setOnly(value)}>
              {value === "all" ? t.all : studyDescription(value).label}
            </button>
          ))}
        </div>
      </div>
      {studyKeys.filter((key) => only === "all" || only === key).map((key) => (
        <div key={`${key}-${language}`} className="study-gallery__study">
          <h2>{studyDescription(key, uiLanguage).label} · {studyDescription(key, uiLanguage).title}</h2>
          <div className="study-gallery__row">
            {galleryScreens(key, words, t).map((screen) => (
              <Phone key={screen.caption} caption={screen.caption} words={words}>{screen.body}</Phone>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
