"use client";

import { useEffect, useState, type ReactNode } from "react";
import "@/app/study.css";
import { studyCopy, studyMinutes, type StudyWords } from "@/components/boks/studies/study-copy";
import {
  BokChoiceForm,
  A2EaseForm,
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
import type { Story } from "@/components/boks/client-types";
import { loadStudyBoks } from "@/components/boks/supabase-browser-data";
import { galleryA2Ids, galleryBokIds, galleryChoiceFragmentSourceId, galleryChoiceWholeId, galleryExcerpt, galleryFragmentSourceId, galleryProfileIds, galleryWholeId } from "@/components/boks/studies/study-gallery-examples";
import { StudyA3Demo } from "@/components/boks/admin/study-a3-demo";

/**
 * Every screen a participant meets, study by study, each in a phone-sized
 * frame. Andrey's examples read a bounded list of published catalogue works
 * with their own artwork. Rendering and local interactions never save answers.
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
  a1After: "Only after the choice: closure of each earlier text, 1-7",
  a1Choice: "Free choice: one new whole work and one excerpt, with neutral format labels, or neither",
  a1Whole: "1. Read a complete work",
  a1Fragment: "2. Read an excerpt from a longer work (order counterbalanced)",
  a2Known: "Before reading: which texts are already known",
  a2Inline: "Feed of full texts",
  a2Cards: "Card with a separate reading screen",
  a2After: "After each session: identify the chosen work or explicitly choose none",
  a2Ease: "Then ease, 1-7; choice satisfaction and completion are secondary",
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
  galleryIntro: "Participant screens, using the same components as the study links. A1, A2 and A3 use published Boks texts and illustrations. You can try the controls; answers are not saved. Series playback is available in a study's Preview.",
  exampleNote: "Catalogue examples illustrate the procedure. A1's excerpts retain the source text verbatim; the team must approve the final matched pairs before starting the study.",
  a1Method: "Two texts → free choice of the next read → closure questions. Formats are named neutrally; no preferred answer is suggested. Primary: share choosing whole minus share choosing excerpt, including refusals; target +15 pp.",
  a2Method: "Cards → reading screen versus full text in the feed. Each participant tries both for ten minutes with different, comparable sets; order and set assignment are counterbalanced. Primary: a text chosen AND ease rated 6 or 7; cards minus full texts, target +10 pp.",
  loadFailed: "Could not load the catalogue examples. Reload the page to try again.",
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
    a1After: "Только после выбора: завершённость каждого из первых двух текстов, 1-7",
    a1Choice: "Свободный выбор: целое произведение и отрывок с нейтральными метками формата, или ничего",
    a1Whole: "1. Чтение целого произведения",
    a1Fragment: "2. Чтение фрагмента более длинного текста (порядок чередуется)",
    a2Known: "Перед чтением: какие тексты уже знакомы",
    a2Inline: "Лента полных текстов",
    a2Cards: "Карточка с отдельным экраном чтения",
    a2After: "После каждой сессии: выбранное произведение или явный отказ",
    a2Ease: "Затем лёгкость, 1-7; удовлетворённость выбором и дочитывание - дополнительно",
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
    galleryIntro: "Экраны участника на тех же компонентах, что и исследование по ссылке. В А1, А2 и А3 использованы опубликованные тексты и иллюстрации Boks. Кнопки можно попробовать, ответы не сохраняются. Плеер Series доступен в предпросмотре исследования.",
    exampleNote: "Примеры из каталога показывают процедуру. В А1 исходный текст фрагментов сохранён дословно; окончательные сопоставимые пары команда утверждает перед запуском исследования.",
    a1Method: "Два текста → свободный выбор следующего чтения → вопросы о завершённости. Форматы обозначаем нейтрально, ожидаемый ответ не подсказываем. Основная метрика: доля выбравших целое минус доля выбравших фрагмент, с учётом отказов; цель +15 п.п.",
    a2Method: "Карточка → экран чтения против полного текста в ленте. Каждый участник пробует оба режима по десять минут с разными сопоставимыми наборами; порядок и наборы чередуем. Основная метрика: текст выбран И лёгкость оценена на 6 или 7; карточки минус полные тексты, цель +10 п.п.",
    loadFailed: "Не удалось загрузить примеры из каталога. Обновите страницу, чтобы повторить.",
    language: "Язык",
    study: "Исследование",
    all: "Все",
  },
});

type GalleryWords = (typeof galleryWords)["en"];

function Phone({ caption, words, children, id }: { caption: string; words: StudyWords; children: ReactNode; id?: string }) {
  return (
    <figure className="study-gallery__item">
      <div className="study-gallery__phone" data-study-screen={id}>
        <StudyFrame words={words}>{children}</StudyFrame>
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function galleryScreens(key: StudyKey, words: StudyWords, t: GalleryWords = galleryWords.en, catalogue: Map<string, Story> | null = null): { id?: string; caption: string; body: ReactNode }[] {
  const [first, , third] = sampleStories;
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
    case "a1": {
      if (!catalogue) return [];
      const whole = catalogue.get(galleryWholeId)!;
      const fragment = galleryExcerpt(catalogue.get(galleryFragmentSourceId)!, whole.wordCount ?? 553);
      const choiceWhole = catalogue.get(galleryChoiceWholeId)!;
      const choiceFragment = galleryExcerpt(catalogue.get(galleryChoiceFragmentSourceId)!, choiceWhole.wordCount ?? 669);
      return [
        intro,
        { id: "a1-whole", caption: t.a1Whole, body: <StudyTextReader story={whole} words={words} progressLabel={words.a1WholeLabel} doneLabel={words.nextStep} onDone={noop} /> },
        { id: "a1-fragment", caption: t.a1Fragment, body: <StudyTextReader story={fragment} words={words} progressLabel={words.a1FragmentLabel} doneLabel={words.nextStep} onDone={noop} /> },
        { id: "a1-choice", caption: t.a1Choice, body: <BokChoiceForm words={words} title={words.a1ChooseTitle} body={words.a1ChooseBody} boks={[choiceWhole, choiceFragment]} opening
          formatLabels={{ [choiceWhole.id]: words.a1WholeLabel, [choiceFragment.id]: words.a1FragmentLabel }} nothingLabel={words.chooseNothing} onChoose={noop} /> },
        { id: "a1-closure", caption: t.a1After, body: <ScaleForm words={words} eyebrow={words.a1Recall} title={whole.title} questions={studyQuestions.a1(words)} check={{ key: "knewBefore", label: words.knewBefore }} onSubmit={noop} /> },
      ];
    }
    case "a2": {
      if (!catalogue) return [];
      const a2Stories = galleryA2Ids.map((id) => catalogue.get(id)!);
      return [
        intro,
        { caption: t.a2Known, body: <CheckListForm words={words} title={words.familiarityTitle} body={words.familiarityBody} options={a2Stories.map((story) => ({ id: story.id, label: story.title, hint: story.authorName }))} onSubmit={noop} /> },
        { id: "a2-cards", caption: t.a2Cards, body: <FeedBrowser words={words} stories={a2Stories} minutes={10} mode="cards" illustrated staticPreview onFinish={noop} /> },
        { id: "a2-inline", caption: t.a2Inline, body: <FeedBrowser words={words} stories={a2Stories} minutes={10} mode="inline" illustrated staticPreview onFinish={noop} /> },
        { id: "a2-choice", caption: t.a2After, body: <BokChoiceForm words={words} title={words.a2ChoiceTitle} body={words.a2ChoiceBody} boks={a2Stories} nothingLabel={words.a2Nothing} onChoose={noop} /> },
        { id: "a2-ease", caption: t.a2Ease, body: <A2EaseForm words={words} chosen={a2Stories[0]} onSubmit={noop} /> },
      ];
    }
    case "a3": {
      if (!catalogue) return [];
      const profileStory = catalogue.get(galleryProfileIds[0])!;
      return [
        intro,
        { caption: t.a3Intro, body: <Interstitial eyebrow={words.eyebrow} title={words.a3IntroTitle} body={<p>{words.a3IntroBody(15)}</p>} action={words.start} onAction={noop} /> },
        { id: "a3-text", caption: t.a3Text, body: <StudyTextReader story={profileStory} words={words} feed progressLabel={words.a3Progress(2, 15)} doneLabel={words.a3Next} onDone={noop} /> },
        { id: "a3-rating", caption: t.a3Rate, body: <ScaleForm words={words} eyebrow={words.a3Progress(2, 15)} title={profileStory.title} questions={studyQuestions.a3(words)} onSubmit={noop} /> },
        { caption: t.a3Profile, body: <Interstitial eyebrow={words.eyebrow} title={words.a3ProfileReadyTitle} body={<p>{words.a3ProfileReadyBody(10)}</p>} action={words.continue} onAction={noop} /> },
      ];
    }
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
  const [catalogue, setCatalogue] = useState<Map<string, Story> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadStudyBoks(galleryBokIds).then((stories) => {
      if (cancelled) return;
      if (stories.length !== galleryBokIds.length) { setLoadFailed(true); return; }
      setCatalogue(new Map(stories.map((story) => [story.id, story])));
    }, () => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, []);
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
          {(key === "a1" || key === "a2") && <p className="study-gallery__method">{key === "a1" ? t.a1Method : t.a2Method}</p>}
          {(["a1", "a2", "a3"] as StudyKey[]).includes(key) && !catalogue && <p role={loadFailed ? "alert" : "status"}>{loadFailed ? t.loadFailed : words.loading}</p>}
          <div className="study-gallery__row">
            {galleryScreens(key, words, t, catalogue).map((screen) => (
              <Phone key={screen.caption} id={screen.id} caption={screen.caption} words={words}>{screen.body}</Phone>
            ))}
          </div>
          {key === "a1" && catalogue && <p className="study-gallery__intro">{t.exampleNote}</p>}
          {key === "a3" && catalogue && <StudyA3Demo stories={catalogue} language={language} />}
        </div>
      ))}
    </section>
  );
}
