"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "@/app/author-composer.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { titleFromText } from "@/lib/boks/bok-title";
import { maxBokCharacters } from "@/lib/boks/contracts";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { CoverImageError, prepareCover, type PreparedCover } from "@/lib/boks/author/covers/cover-image";
import { ownCoverPath } from "@/lib/boks/own-cover";
import { Icon, Topbar } from "./ui";
import {
  deleteOwnDraft,
  drawingState,
  loadOwnDraft,
  loadPublishing,
  newBokId,
  saveOwnBok,
  startDrawing,
  type CoverDrawings,
  type SavedBok,
} from "./composer-data";

/**
 * A new bok, from the author's own page (`docs/author-publishing.md`): paste
 * the text, take the title from its first line or type one, give it a
 * picture - two drawn for it, or one's own - and publish. Authors with an
 * open page publish straight away; a draft waits on the page, in its order.
 *
 * Everything typed is kept on this device until it is saved, so a closed tab
 * loses nothing.
 */

const words = defineMessages(
  {
    newTitle: "New bok",
    notVerified: "Publishing from My page is open to verified authors. Send your text for review: the editors read every one.",
    toReview: "Send a text for review",
    editTitle: "Edit",
    draftTitle: "Draft",
    drawnBefore: "Both pictures for this piece are drawn already. Upload your own to replace the cover.",
    back: "Back",
    language: "Language",
    loading: "Loading…",
    textLabel: "Text",
    textPlaceholder: "Paste or type the text. A line break is a line break; an empty line starts a new stanza or paragraph.",
    titleLabel: "Title",
    titleOptional: "optional",
    titlePlaceholder: "From the first line",
    titleWillBe: (title: string) => `Without a title it will be «${title}».`,
    length: (characters: number, minutes: number) => `${characters.toLocaleString("en")} characters · about ${minutes} min`,
    tooLong: (limit: number) => `Longer than a 15-minute bok (${limit.toLocaleString("en")} characters). Split it into parts.`,
    coverLabel: "Cover",
    coverRequired: "A bok goes out with a picture.",
    draw: "Draw two",
    drawHint: "Drawn from your text in the boks style. Two per piece.",
    drawing: "Drawing… usually under a minute",
    drawn: "Both are drawn. Pick one, or upload your own.",
    drawLeftToday: (n: number) => `${n} left today`,
    drawFailed: "The pictures could not be drawn right now. Upload your own, or try again later.",
    drawRefused: "The picture service would not draw this text. Upload your own picture.",
    needText: "Paste the text first: the picture is drawn from it.",
    upload: "Upload your own",
    replace: "Replace",
    uploadHint: "Any photo or picture; it is cut to a phone screen around the middle.",
    tooLarge: "That file is over 25 MB.",
    unreadable: "That file is not a picture this browser can open. Try JPEG or PNG.",
    choose: "Use this one",
    chosen: "On the cover",
    dropHere: "Drop a picture here",
    seriesTitle: "Boks Series",
    seriesNote: "The best works, chosen by the editors and by readers, get their own Boks Series episode: illustrations, sound, the author's voice.",
    publish: "Publish",
    publishing: "Publishing…",
    saveDraft: "Save as draft",
    saving: "Saving…",
    savedDraft: "Saved as a draft. It waits on your page; only you see it.",
    saveChanges: "Save changes",
    savedChanges: "Changes saved.",
    needCover: "Add a cover to publish: draw one or upload your own.",
    needTextToPublish: "Paste the text to publish.",
    rights: "By publishing you confirm the text is yours to publish. You keep the rights; boks gets a non-exclusive licence to show and recommend it.",
    terms: "Terms",
    deleteDraft: "Delete draft",
    confirmDelete: "Delete this draft for good?",
    deleted: "Draft deleted.",
    keepHint: "⌘ Enter publishes",
    doneTitle: "Published",
    doneBody: "Readers see it on your page and in the feed now.",
    doneVideo: "The moving preview for links (Telegram) is made in the background, usually within half an hour. Until then a link shows the still card.",
    openBok: "Open the bok",
    toPage: "My page",
    another: "Another bok",
    hiddenNote: "This piece is hidden from the site. Saving keeps it hidden; put it back from My page.",
    headingAsk: (line: string) => `Is «${line}» the title? Take it out of the text`,
    teamCover: "Let the editors choose the cover",
    teamCoverOn: "The editors will choose the cover",
    teamCoverHint: "We find or draw a picture for it ourselves and publish the bok once it has one.",
    teamCoverUndo: "I'll add my own",
    sendToTeam: "Send to the editors",
    teamDoneTitle: "Sent to the editors",
    teamDoneBody: "The bok goes out as soon as the editors choose its cover. It waits on My page meanwhile; you can still change it or add your own picture.",
    waitingNote: "The editors are choosing the cover. Add your own here to publish it now.",
  },
  {
    ru: {
      newTitle: "Новый бок",
      notVerified: "Публикация с «Моей страницы» открыта верифицированным авторам. Отправьте текст на проверку: редакция читает каждый.",
      toReview: "Отправить текст на проверку",
      editTitle: "Редактирование",
      draftTitle: "Черновик",
      drawnBefore: "Оба варианта для этого бока уже нарисованы. Чтобы заменить обложку, загрузите свою.",
      back: "Назад",
      language: "Язык",
      loading: "Загружаем…",
      textLabel: "Текст",
      textPlaceholder: "Вставьте или напишите текст. Перенос строки остаётся переносом, пустая строка начинает новую строфу или абзац.",
      titleLabel: "Название",
      titleOptional: "необязательно",
      titlePlaceholder: "Возьмём из первой строки",
      titleWillBe: (title: string) => `Без названия бок будет называться «${title}».`,
      length: (characters: number, minutes: number) => `${characters.toLocaleString("ru")} ${plural("ru", characters, { one: "знак", few: "знака", many: "знаков", other: "знака" })} · около ${minutes} мин`,
      tooLong: (limit: number) => `Длиннее 15-минутного бока (${limit.toLocaleString("ru")} знаков). Разделите на части.`,
      coverLabel: "Обложка",
      coverRequired: "Бок выходит с картинкой.",
      draw: "Нарисовать два варианта",
      drawHint: "Нарисуем по вашему тексту в стиле boks. Два варианта на произведение.",
      drawing: "Рисуем… обычно меньше минуты",
      drawn: "Оба варианта готовы. Выберите один или загрузите свою.",
      drawLeftToday: (n: number) => `сегодня ещё ${n}`,
      drawFailed: "Сейчас не получилось нарисовать. Загрузите свою картинку или попробуйте позже.",
      drawRefused: "Сервис картинок не стал рисовать по этому тексту. Загрузите свою картинку.",
      needText: "Сначала вставьте текст: картинку рисуем по нему.",
      upload: "Загрузить свою",
      replace: "Заменить",
      uploadHint: "Любое фото или картинка; обрежем под экран телефона по центру.",
      tooLarge: "Файл больше 25 МБ.",
      unreadable: "Этот файл браузер не открывает как картинку. Попробуйте JPEG или PNG.",
      choose: "Взять эту",
      chosen: "На обложке",
      dropHere: "Отпустите картинку здесь",
      seriesTitle: "Boks Series",
      seriesNote: "Лучшие произведения по мнению редакции и читателей будут удостоены собственного выпуска Boks Series: иллюстрации, звук, голос автора.",
      publish: "Опубликовать",
      publishing: "Публикуем…",
      saveDraft: "Сохранить черновик",
      saving: "Сохраняем…",
      savedDraft: "Черновик сохранён. Он ждёт на вашей странице; видите его только вы.",
      saveChanges: "Сохранить изменения",
      savedChanges: "Изменения сохранены.",
      needCover: "Чтобы опубликовать, добавьте обложку: нарисуйте или загрузите свою.",
      needTextToPublish: "Вставьте текст, чтобы опубликовать.",
      rights: "Публикуя, вы подтверждаете, что вправе публиковать этот текст. Права остаются у вас; boks получает неисключительную лицензию показывать и рекомендовать его.",
      terms: "Условия",
      deleteDraft: "Удалить черновик",
      confirmDelete: "Удалить этот черновик насовсем?",
      deleted: "Черновик удалён.",
      keepHint: "⌘ Enter — опубликовать",
      doneTitle: "Опубликовано",
      doneBody: "Читатели уже видят его на вашей странице и в ленте.",
      doneVideo: "Видео-превью для ссылок (Telegram) собирается фоновым процессом, обычно до получаса. До этого ссылка покажет статичную карточку.",
      openBok: "Открыть бок",
      toPage: "Моя страница",
      another: "Ещё один бок",
      hiddenNote: "Этот бок скрыт с сайта. После сохранения он останется скрытым; вернуть его можно на «Моей странице».",
      headingAsk: (line: string) => `«${line}» — это название? Убрать из текста`,
      teamCover: "Пусть обложку подберёт редакция",
      teamCoverOn: "Обложку подберёт редакция",
      teamCoverHint: "Мы сами найдём или нарисуем картинку и опубликуем бок, как только она будет готова.",
      teamCoverUndo: "Добавлю свою",
      sendToTeam: "Отправить редакции",
      teamDoneTitle: "Отправлено редакции",
      teamDoneBody: "Бок выйдет, как только редакция подберёт для него обложку. Пока он ждёт на «Моей странице»: его можно изменить или добавить свою картинку.",
      waitingNote: "Редакция подбирает обложку. Если добавите свою, бок выйдет сразу.",
    },
  }
);

type Words = (typeof words)["en"];

/** Which piece the composer opens: set by My page before it goes here; null is a new one. */
let opening: string | null = null;
export function openInComposer(bokId: string | null) {
  opening = bokId;
}

const localKey = "boks-composer";
type LocalDraft = { bokId: string; title: string; text: string; at: number };

function readLocal(): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(localKey);
    const value = raw ? (JSON.parse(raw) as LocalDraft) : null;
    return value && typeof value.bokId === "string" && typeof value.text === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeLocal(value: LocalDraft | null) {
  try {
    if (value) window.localStorage.setItem(localKey, JSON.stringify(value));
    else window.localStorage.removeItem(localKey);
  } catch {
    // Private mode: the text holds while the tab is open.
  }
}

/**
 * A pasted text often starts with its own title: a short first line, then an
 * empty line, then the text. Offered to the author as the title, never taken
 * without asking.
 */
export function headingLine(text: string): { line: string; rest: string } | null {
  const match = /^\s*([^\n]{1,80})\n[ \t]*\n+([\s\S]*\S[\s\S]*)$/.exec(text);
  if (!match) return null;
  const line = match[1].trim();
  if (!line || /[,;:\-–—]$/.test(line) || /^[*\s.·•]+$/.test(line)) return null;
  return { line, rest: match[2].replace(/^\s*\n/, "") };
}

/** Reading minutes as the feed counts them: about 1 300 characters a minute, at least one. */
function minutesOf(characters: number) {
  return Math.max(1, Math.round(characters / 1300));
}

type Picture = { url: string; cover: PreparedCover | null };
type Drawing = { state: "idle" } | { state: "working" } | { state: "done"; pictures: Picture[] } | { state: "failed"; message: string };

export function Composer({ go, toast }: { go: (view: "my-page") => void; toast: (message: string) => void }) {
  const w = useMessages(words);
  const language = useUiLanguage();
  const editing = useRef(opening);
  const [bokId] = useState(() => {
    if (editing.current) return editing.current;
    const local = typeof window === "undefined" ? null : readLocal();
    return local?.bokId ?? newBokId();
  });
  const [loaded, setLoaded] = useState(!editing.current);
  const [status, setStatus] = useState<string>("new");
  const [title, setTitle] = useState(() => (!editing.current && typeof window !== "undefined" ? readLocal()?.title ?? "" : ""));
  const [text, setText] = useState(() => (!editing.current && typeof window !== "undefined" ? readLocal()?.text ?? "" : ""));
  const [cover, setCover] = useState<PreparedCover | null>(null);
  /** The picture the piece already has in the database, shown until replaced. */
  const [savedCover, setSavedCover] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<CoverDrawings | null>(null);
  const [direct, setDirect] = useState(true);
  const [checked, setChecked] = useState(false);
  const [drawing, setDrawing] = useState<Drawing>({ state: "idle" });
  const [busy, setBusy] = useState<"" | "publish" | "draft" | "delete">("");
  const [problem, setProblem] = useState("");
  const [coverProblem, setCoverProblem] = useState("");
  const [dropping, setDropping] = useState(false);
  const [done, setDone] = useState<SavedBok | null>(null);
  /** The author asked the team to choose the picture. */
  const [teamCover, setTeamCover] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    opening = null;
    let live = true;
    void loadPublishing(bokId).then((answer) => {
      if (!live) return;
      setDirect(answer.direct);
      setChecked(true);
      setDrawings(answer.drawings);
    }).catch(() => undefined);
    if (editing.current) {
      void loadOwnDraft(bokId).then((draft) => {
        if (!live) return;
        setTitle(draft.title === titleFromText(draft.text) ? "" : draft.title);
        setText(draft.text);
        setStatus(draft.status);
        setTeamCover(draft.status === "pending_review" && draft.coverRequested && !draft.cover);
        setDrawings(draft.drawings);
        if (draft.cover) setSavedCover(`data:${draft.cover.webp.startsWith("/9j/") ? "image/jpeg" : "image/webp"};base64,${draft.cover.webp}`);
        setLoaded(true);
      }).catch((error) => {
        if (live) setProblem(readableBoksError(error, w.loading, language));
      });
    }
    return () => { live = false; };
  }, [bokId, w.loading, language]);

  // A new piece's text is kept on this device until it is saved.
  useEffect(() => {
    if (editing.current || done) return;
    const timer = window.setTimeout(() => writeLocal(text.trim() || title.trim() ? { bokId, title, text, at: Date.now() } : null), 300);
    return () => window.clearTimeout(timer);
  }, [bokId, title, text, done]);

  // The text field grows with the text, so the page scrolls and not a box inside it.
  useEffect(() => {
    const area = textArea.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.max(area.scrollHeight, 320)}px`;
  }, [text, loaded]);

  const trimmed = text.trim();
  const derived = useMemo(() => titleFromText(trimmed), [trimmed]);
  const shownTitle = title.trim() || derived;
  const heading = title.trim() ? null : headingLine(text);
  const characters = trimmed.length;
  const tooLong = characters > maxBokCharacters;
  const coverShown = cover?.preview ?? savedCover;
  const hasCover = Boolean(coverShown);
  const drawnForPiece = drawings?.piece ?? 0;
  const perPiece = drawings?.perPiece ?? 2;
  const leftToday = drawings ? Math.max(0, drawings.perDay - drawings.today) : null;
  const canDraw = direct && drawnForPiece < perPiece && (leftToday === null || leftToday >= perPiece) && drawing.state !== "working";
  const isNew = status === "new" || status === "draft" || status === "pending_review";
  const byTeam = teamCover && !hasCover;
  const publishBlocker = !trimmed ? w.needTextToPublish : !hasCover && !byTeam ? w.needCover : tooLong ? w.tooLong(maxBokCharacters) : "";

  async function takeFile(file: File | null | undefined) {
    if (!file) return;
    setCoverProblem("");
    try {
      setCover(await prepareCover(file, "upload"));
      setTeamCover(false);
    } catch (error) {
      setCoverProblem(error instanceof CoverImageError && error.code === "too_large" ? w.tooLarge : w.unreadable);
    }
  }

  async function draw() {
    if (!trimmed) { setCoverProblem(w.needText); return; }
    setCoverProblem("");
    setDrawing({ state: "working" });
    try {
      const started = await startDrawing(bokId, title.trim(), trimmed);
      setDrawings(started.drawings);
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt < 10 ? 1500 : 3000));
        const state = await drawingState(started.jobId);
        if (state.state === "done") {
          const pictures: Picture[] = state.pictures.map((url) => ({ url, cover: null }));
          setDrawing({ state: "done", pictures });
          // The first goes on the cover at once if there is none; the author can switch.
          if (!cover && !savedCover && pictures[0]) void choose(pictures[0], pictures);
          return;
        }
        if (state.state === "failed") {
          setDrawing({ state: "failed", message: state.errorCode === "refused" ? w.drawRefused : w.drawFailed });
          return;
        }
        if (state.state === "missing") break;
      }
      setDrawing({ state: "failed", message: w.drawFailed });
    } catch (error) {
      setDrawing({ state: "failed", message: readableBoksError(error, w.drawFailed, language) });
    }
  }

  async function choose(picture: Picture, list?: Picture[]) {
    try {
      const prepared = picture.cover ?? await prepareCover(await (await fetch(picture.url, { cache: "force-cache" })).blob(), "generated");
      setCover(prepared);
      setTeamCover(false);
      setDrawing((current) => current.state === "done" || list
        ? { state: "done", pictures: (list ?? (current.state === "done" ? current.pictures : [])).map((entry) => (entry.url === picture.url ? { ...entry, cover: prepared } : entry)) }
        : current);
    } catch {
      setCoverProblem(w.unreadable);
    }
  }

  async function save(publish: boolean) {
    if (publish && publishBlocker) { setProblem(publishBlocker); return; }
    if (!trimmed) { setProblem(w.needTextToPublish); return; }
    setBusy(publish ? "publish" : "draft");
    setProblem("");
    try {
      const saved = await saveOwnBok({ bokId, title: title.trim(), text: trimmed, publish, cover, coverByTeam: publish && byTeam });
      writeLocal(null);
      setStatus(saved.status);
      if (isNew && publish && (saved.status === "published" || saved.status === "pending_review")) {
        setDone(saved);
      } else {
        toast(saved.status === "draft" ? w.savedDraft : w.savedChanges);
        go("my-page");
      }
    } catch (error) {
      setProblem(readableBoksError(error, w.loading, language));
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    if (!window.confirm(w.confirmDelete)) return;
    setBusy("delete");
    try {
      await deleteOwnDraft(bokId);
      writeLocal(null);
      toast(w.deleted);
      go("my-page");
    } catch (error) {
      setProblem(readableBoksError(error, w.loading, language));
    } finally {
      setBusy("");
    }
  }

  const header = <Topbar title={!editing.current ? w.newTitle : status === "draft" ? w.draftTitle : w.editTitle} backLabel={w.back} languageLabel={w.language} onBack={() => go("my-page")} />;

  if (checked && !direct) {
    return (
      <main className="page detail-page amp acomp">
        {header}
        <section className="acomp-done">
          <div className="acomp-done__body">
            <p>{w.notVerified}</p>
            <div className="sheet-buttons acomp-done__buttons">
              <a className="btn btn-red" href="/author#write">{w.toReview} <Icon name="arrow" /></a>
              <button type="button" className="btn btn-secondary" onClick={() => go("my-page")}>{w.toPage}</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (done) {
    const image = cover?.preview ?? savedCover ?? (done.status === "published" ? ownCoverPath(done.id, done.coverVersion, "webp") : null);
    const waiting = done.status === "pending_review";
    return (
      <main className="page detail-page amp acomp">
        {header}
        <section className="acomp-done">
          <div className="acomp-done__cover">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {image && <img src={image} alt="" />}
            <span className="acomp-frame__title serif">{done.title}</span>
          </div>
          <div className="acomp-done__body">
            <h1>{waiting ? w.teamDoneTitle : w.doneTitle}<span className="dot">.</span></h1>
            <p>{waiting ? w.teamDoneBody : w.doneBody}</p>
            {!waiting && <p className="acomp-video"><span aria-hidden="true">◷</span> {w.doneVideo}</p>}
            <div className="sheet-buttons acomp-done__buttons">
              {!waiting && <a className="btn btn-red" href={`/b/${done.id}`}>{w.openBok} <Icon name="arrow" /></a>}
              <button type="button" className="btn btn-secondary" onClick={() => go("my-page")}>{w.toPage}</button>
              <button type="button" className="btn btn-secondary" onClick={() => { openInComposer(null); window.location.reload(); }}>{w.another}</button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main
      className="page detail-page amp acomp"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && direct && !busy) {
          event.preventDefault();
          void save(true);
        }
      }}
    >
      {header}
      {!loaded ? (
        <p className="desk-note" role="status">{problem || w.loading}</p>
      ) : (
        <div className="acomp-layout">
          <section className="acomp-writing">
            <label className="acomp-title">
              <span className="acomp-label">{w.titleLabel} <em>{w.titleOptional}</em></span>
              <input
                className="serif"
                value={title}
                maxLength={120}
                placeholder={derived || w.titlePlaceholder}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            {heading ? (
              <button type="button" className="acomp-heading" onClick={() => { setTitle(heading.line); setText(heading.rest); }}>{w.headingAsk(heading.line)}</button>
            ) : !title.trim() && derived ? <small className="acomp-hint">{w.titleWillBe(derived)}</small> : null}
            <label className="acomp-text">
              <span className="acomp-label">{w.textLabel}</span>
              <textarea
                ref={textArea}
                value={text}
                autoFocus={!editing.current}
                spellCheck
                placeholder={w.textPlaceholder}
                onChange={(event) => { setText(event.target.value); setProblem(""); }}
              />
            </label>
            <small className={`acomp-hint${tooLong ? " is-warn" : ""}`}>
              {tooLong ? w.tooLong(maxBokCharacters) : characters > 0 ? w.length(characters, minutesOf(characters)) : ""}
            </small>
            {status === "withdrawn" && <p className="notice">{w.hiddenNote}</p>}
            {status === "pending_review" && !hasCover && <p className="notice">{w.waitingNote}</p>}
          </section>

          <aside className="acomp-side">
            <CoverPanel
              w={w}
              title={shownTitle}
              byTeam={byTeam}
              image={coverShown}
              dropping={dropping}
              setDropping={setDropping}
              onFile={(file) => void takeFile(file)}
              onPick={() => fileInput.current?.click()}
            />
            <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { void takeFile(event.target.files?.[0]); event.target.value = ""; }} />
            <div className="acomp-cover-actions">
              {direct && (
                <button type="button" className="btn acomp-draw" disabled={!canDraw} onClick={() => void draw()}>
                  <span aria-hidden="true">✦</span> {drawing.state === "working" ? w.drawing : w.draw}
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => fileInput.current?.click()}>{hasCover ? w.replace : w.upload}</button>
            </div>
            <small className="acomp-hint">
              {drawnForPiece >= perPiece ? (drawing.state === "done" ? w.drawn : w.drawnBefore) : w.drawHint}
              {leftToday !== null && drawnForPiece < perPiece ? ` · ${w.drawLeftToday(Math.floor(leftToday / perPiece))}` : ""}
            </small>
            {drawing.state === "working" && (
              <div className="acomp-variants" aria-busy="true">
                <span className="acomp-variant is-loading" />
                <span className="acomp-variant is-loading" />
              </div>
            )}
            {drawing.state === "done" && (
              <div className="acomp-variants">
                {drawing.pictures.map((picture) => {
                  const on = Boolean(cover && picture.cover && cover.preview === picture.cover.preview);
                  return (
                    <button key={picture.url} type="button" className={`acomp-variant${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => void choose(picture)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={picture.url} alt="" />
                      <span>{on ? w.chosen : w.choose}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {!hasCover && (
              byTeam
                ? <button type="button" className="acomp-team is-on" aria-pressed="true" onClick={() => setTeamCover(false)}><span aria-hidden="true">✓</span> {w.teamCoverOn} · <u>{w.teamCoverUndo}</u></button>
                : <button type="button" className="acomp-team" aria-pressed="false" onClick={() => { setTeamCover(true); setCoverProblem(""); setProblem(""); }}>{w.teamCover}</button>
            )}
            {drawing.state === "failed" && <p className="acomp-problem" role="alert">{drawing.message}</p>}
            {coverProblem && <p className="acomp-problem" role="alert">{coverProblem}</p>}

            <div className="acomp-series">
              <span className="acomp-series__mark" aria-hidden="true">★</span>
              <div>
                <strong>{w.seriesTitle}</strong>
                <p>{w.seriesNote}</p>
              </div>
            </div>
          </aside>

          <footer className="acomp-bar">
            {problem && <p className="acomp-problem" role="alert">{problem}</p>}
            {!problem && direct && publishBlocker && trimmed && <p className="acomp-hint acomp-blocker">{publishBlocker}</p>}
            <div className="acomp-bar__buttons">
              {status === "draft" && (
                <button type="button" className="btn btn-quiet acomp-delete" disabled={Boolean(busy)} onClick={() => void remove()}>{w.deleteDraft}</button>
              )}
              {isNew ? (
                <>
                  <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !trimmed} onClick={() => void save(false)}>
                    {busy === "draft" ? w.saving : status === "pending_review" ? w.saveChanges : w.saveDraft}
                  </button>
                  <button type="button" className="btn btn-red acomp-publish" disabled={Boolean(busy) || Boolean(publishBlocker)} onClick={() => void save(true)}>
                    {busy === "publish" ? w.publishing : byTeam ? w.sendToTeam : w.publish} <Icon name="arrow" />
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-red acomp-publish" disabled={Boolean(busy) || !trimmed || tooLong} onClick={() => void save(status === "published")}>
                  {busy ? w.saving : w.saveChanges}
                </button>
              )}
            </div>
          </footer>
          <small className="acomp-rights">{w.rights} <a href="/terms#author-content" target="_blank" rel="noreferrer">{w.terms}</a>{isNew ? <span className="acomp-keys"> · {w.keepHint}</span> : null}</small>
        </div>
      )}
    </main>
  );
}

function CoverPanel({ w, title, byTeam, image, dropping, setDropping, onFile, onPick }: {
  w: Words;
  title: string;
  byTeam: boolean;
  image: string | null;
  dropping: boolean;
  setDropping: (value: boolean) => void;
  onFile: (file: File | undefined) => void;
  onPick: () => void;
}) {
  return (
    <div className="acomp-cover">
      <span className="acomp-label">{w.coverLabel}</span>
      <button
        type="button"
        className={`acomp-frame${image ? " has-image" : ""}${dropping ? " is-dropping" : ""}`}
        onClick={onPick}
        onDragOver={(event) => { event.preventDefault(); setDropping(true); }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => { event.preventDefault(); setDropping(false); onFile(event.dataTransfer.files?.[0]); }}
        aria-label={image ? w.replace : w.upload}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="" />}
        <span className="acomp-frame__shade" aria-hidden="true" />
        <span className="acomp-frame__title serif">{title || "…"}</span>
        {!image && (byTeam
          ? <span className="acomp-frame__empty"><span className="acomp-frame__mark" aria-hidden="true">b.</span>{w.teamCoverOn}<small>{w.teamCoverHint}</small></span>
          : <span className="acomp-frame__empty">{dropping ? w.dropHere : w.coverRequired}<small>{w.uploadHint}</small></span>)}
      </button>
    </div>
  );
}
