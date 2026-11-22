"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/app/author-composer.css";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { titleFromText } from "@/lib/boks/bok-title";
import { maxBokCharacters } from "@/lib/boks/contracts";
import { defineMessages, plural } from "@/lib/i18n/messages";
import { ownCoverPath } from "@/lib/boks/own-cover";
import { Icon, Topbar } from "./ui";
import { deleteOwnDraft, loadOwnDraft, loadPublishing, newBokId, saveOwnBok, type SavedBok } from "./composer-data";
import { VoiceBlock, voiceWords } from "./voice-block";
import { DecisionNote } from "./decision-note";
import { loadMyDecisions, loadMySeriesWork } from "./voice-data";
import type { EditorDecision } from "@/lib/boks/author/editor-decisions";
import { voiceText } from "@/lib/boks/author/voice/rules";

/**
 * A new bok, from the author's own page (`docs/author-publishing.md`): paste
 * the text, take the title from its first line or type one, read it aloud
 * (the teleprompter, or a recording of one's own) and send it to the
 * editors, who make its cover. No piece goes to them without the author's
 * voice (`VoiceBlock`); a draft waits on the page, in its order.
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
    seriesTitle: "Boks Series",
    seriesNote: "The best works, chosen by the editors and by readers, get their own Boks Series episode: illustrations, sound, the author's voice.",
    publish: "Publish",
    publishing: "Publishing…",
    saveDraft: "Save as draft",
    saving: "Saving…",
    savedDraft: "Saved as a draft. It waits on your page; only you see it.",
    saveChanges: "Save changes",
    savedChanges: "Changes saved.",
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
    teamCoverOn: "The editors make the cover",
    coverByEditorsNote: "Covers are made only by the boks editors: they draw one from your text, and the bok goes out once it has its cover.",
    coverChange: "The cover is the editors'. To change it, write to them in Requests and ideas.",
    sendToEditors: "Send to the editors",
    teamCoverHint: "We draw it from your text and publish the bok as soon as it is ready.",
    teamDoneTitle: "Sent to the editors",
    teamDoneBody: "The editors will read the text and listen to your recording. Until they take it into work, you can change it or take it back on My page.",
    waitingNote: "The bok is with the editors. Until they take it into work, you can change it here or take it back on My page.",
    lockedTitle: "With the editors",
    lockedNote: "The editors are making its Boks Series. We will bring it back to you when it is done.",
  },
  {
    ru: {
      newTitle: "Новый бок",
      notVerified: "Публикация с «Моей страницы» открыта верифицированным авторам. Отправьте текст на проверку: редакция читает каждый.",
      toReview: "Отправить текст на проверку",
      editTitle: "Редактирование",
      draftTitle: "Черновик",
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
      seriesTitle: "Boks Series",
      seriesNote: "Лучшие произведения по мнению редакции и читателей будут удостоены собственного выпуска Boks Series: иллюстрации, звук, голос автора.",
      publish: "Опубликовать",
      publishing: "Публикуем…",
      saveDraft: "Сохранить черновик",
      saving: "Сохраняем…",
      savedDraft: "Черновик сохранён. Он ждёт на вашей странице; видите его только вы.",
      saveChanges: "Сохранить изменения",
      savedChanges: "Изменения сохранены.",
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
      teamCoverOn: "Обложку делает редакция",
      coverByEditorsNote: "Обложки делает только редакция boks: мы нарисуем её по вашему тексту, и бок выйдет, как только она будет готова.",
      coverChange: "Обложка от редакции. Чтобы поменять её, напишите в «Запросы и идеи».",
      sendToEditors: "Отправить в редакцию",
      teamCoverHint: "Нарисуем её по вашему тексту и опубликуем бок, как только она будет готова.",
      teamDoneTitle: "Отправлено редакции",
      teamDoneBody: "Редакция прочитает текст и послушает запись. Пока бок не взят в работу, его можно изменить или отозвать на «Моей странице».",
      waitingNote: "Бок у редакции. Пока он не взят в работу, его можно изменить здесь или отозвать на «Моей странице».",
      lockedTitle: "В работе у редакции",
      lockedNote: "Редакция готовит Boks Series. Вернём её вам, когда закончим.",
    },
  }
);

type Words = (typeof words)["en"];

/** Which piece the composer opens: set by My page before it goes here; null is a new one. `voice`: open at the Voice block. */
let opening: string | null = null;
let openingAt: "voice" | null = null;
export function openInComposer(bokId: string | null, at: "voice" | null = null) {
  opening = bokId;
  openingAt = at;
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

export function Composer({ go, toast }: { go: (view: "my-page") => void; toast: (message: string) => void }) {
  const w = useMessages(words);
  const v = useMessages(voiceWords);
  const language = useUiLanguage();
  /** The piece being edited, fixed for this composer's life; null for a new one. */
  const [editingId] = useState(opening);
  const [openAt] = useState(openingAt);
  const [bokId] = useState(() => {
    if (editingId) return editingId;
    const local = typeof window === "undefined" ? null : readLocal();
    return local?.bokId ?? newBokId();
  });
  const [loaded, setLoaded] = useState(!editingId);
  const [status, setStatus] = useState<string>("new");
  const [title, setTitle] = useState(() => (!editingId && typeof window !== "undefined" ? readLocal()?.title ?? "" : ""));
  const [text, setText] = useState(() => (!editingId && typeof window !== "undefined" ? readLocal()?.text ?? "" : ""));
  /** The picture the editors gave the piece, once they have. */
  const [savedCover, setSavedCover] = useState<string | null>(null);
  const [direct, setDirect] = useState(true);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState<"" | "publish" | "draft" | "delete">("");
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState<SavedBok | null>(null);
  /** The text as last saved, to tell a change of words in a piece already with the editors. */
  const [savedText, setSavedText] = useState("");
  const [voiceReady, setVoiceReady] = useState(false);
  /** The editors' answer on this piece, when they returned or refused it. */
  const [decision, setDecision] = useState<EditorDecision | null>(null);
  /** The editors took it into work for its Boks Series: read-only until they bring it back. */
  const [locked, setLocked] = useState(false);
  const onVoiceReady = useCallback((ready: boolean) => setVoiceReady(ready), []);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    opening = null;
    openingAt = null;
    let live = true;
    void loadPublishing(bokId).then((answer) => {
      if (!live) return;
      setDirect(answer.direct);
      setChecked(true);
    }).catch(() => undefined);
    if (editingId) {
      void loadMyDecisions().then((all) => { if (live) setDecision(all.find((entry) => entry.bokId === editingId) ?? null); }).catch(() => undefined);
      void loadMySeriesWork().then((all) => { if (live) setLocked(all.some((entry) => entry.bokId === editingId && (entry.state === "accepted" || entry.state === "sent"))); }).catch(() => undefined);
      void loadOwnDraft(bokId).then((draft) => {
        if (!live) return;
        setTitle(draft.title === titleFromText(draft.text) ? "" : draft.title);
        setText(draft.text);
        setSavedText(draft.text);
        setStatus(draft.status);
        if (draft.cover) setSavedCover(`data:${draft.cover.webp.startsWith("/9j/") ? "image/jpeg" : "image/webp"};base64,${draft.cover.webp}`);
        setLoaded(true);
      }).catch((error) => {
        if (live) setProblem(readableBoksError(error, w.loading, language));
      });
    }
    return () => { live = false; };
  }, [bokId, editingId, w.loading, language]);

  // My page's «Record» opens the piece at its Voice block.
  useEffect(() => {
    if (loaded && openAt === "voice") window.setTimeout(() => document.getElementById("acomp-voice")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }, [loaded, openAt]);

  // A new piece's text is kept on this device until it is saved.
  useEffect(() => {
    if (editingId || done) return;
    const timer = window.setTimeout(() => writeLocal(text.trim() || title.trim() ? { bokId, title, text, at: Date.now() } : null), 300);
    return () => window.clearTimeout(timer);
  }, [bokId, editingId, title, text, done]);

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
  const hasCover = Boolean(savedCover);
  const isNew = status === "new" || status === "draft" || status === "pending_review";
  // Covers are the editors' (`20261122100000_boks_covers_by_editors.sql`): a piece without one goes to them.
  const byTeam = !hasCover;
  // The author's voice (owner, 2026-11-22): a piece goes to the editors only
  // with a chosen take of the text as it is; one already with them needs a
  // new take when its words change. Published pieces are edited as before.
  const voiced = isNew;
  // Refused by the editors: the text stays readable here, and nothing sends it again.
  const refused = (status === "rejected" && decision?.decision === "refused") || (status === "pending_review" && locked);
  const notBefore = decision?.decision === "changes" && decision.kind === "recording" ? decision.decidedAt : null;
  const wordsChanged = status === "pending_review" && voiceText(savedText) !== voiceText(trimmed);
  const voiceBlocker = voiced && !voiceReady && trimmed && (byTeam || wordsChanged) ? v.missing : "";
  const publishBlocker = !trimmed ? w.needTextToPublish : tooLong ? w.tooLong(maxBokCharacters) : voiceBlocker;

  async function save(publish: boolean) {
    if (publish && publishBlocker) { setProblem(publishBlocker); return; }
    if (!trimmed) { setProblem(w.needTextToPublish); return; }
    setBusy(publish ? "publish" : "draft");
    setProblem("");
    try {
      const saved = await saveOwnBok({ bokId, title: title.trim(), text: trimmed, publish, cover: null, coverByTeam: publish && byTeam });
      writeLocal(null);
      setStatus(saved.status);
      setSavedText(trimmed);
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

  const header = <Topbar title={!editingId ? w.newTitle : status === "draft" ? w.draftTitle : w.editTitle} backLabel={w.back} languageLabel={w.language} onBack={() => go("my-page")} />;

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
    const image = savedCover ?? (done.status === "published" ? ownCoverPath(done.id, done.coverVersion, "webp") : null);
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
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && direct && !busy && !refused && status !== "pending_review") {
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
            {decision && (status === "draft" || status === "rejected") && <DecisionNote decision={decision} />}
            {status === "pending_review" && locked && <div className="acomp-decision is-refused" role="status"><strong className="acomp-decision__title">{w.lockedTitle}</strong><small>{w.lockedNote}</small></div>}
            <label className="acomp-title">
              <span className="acomp-label">{w.titleLabel} <em>{w.titleOptional}</em></span>
              <input
                className="serif"
                value={title}
                maxLength={120}
                readOnly={refused}
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
                autoFocus={!editingId}
                spellCheck
                readOnly={refused}
                placeholder={w.textPlaceholder}
                onChange={(event) => { setText(event.target.value); setProblem(""); }}
              />
            </label>
            <small className={`acomp-hint${tooLong ? " is-warn" : ""}`}>
              {tooLong ? w.tooLong(maxBokCharacters) : characters > 0 ? w.length(characters, minutesOf(characters)) : ""}
            </small>
            {status === "withdrawn" && <p className="notice">{w.hiddenNote}</p>}
            {status === "pending_review" && !locked && <p className="notice">{w.waitingNote}</p>}
          </section>

          {voiced && !refused && <VoiceBlock bokId={bokId} title={shownTitle} text={trimmed} notBefore={notBefore} onReady={onVoiceReady} />}

          <aside className="acomp-side">
            <CoverPanel w={w} title={shownTitle} image={savedCover} />
            <small className="acomp-hint">{hasCover ? w.coverChange : w.coverByEditorsNote}</small>

            <div className="acomp-series">
              <span className="acomp-series__mark" aria-hidden="true">★</span>
              <div>
                <strong>{w.seriesTitle}</strong>
                <p>{w.seriesNote}</p>
              </div>
            </div>
          </aside>

          {!refused && <footer className="acomp-bar">
            {problem && <p className="acomp-problem" role="alert">{problem}</p>}
            {!problem && direct && publishBlocker && trimmed && <p className={`acomp-hint acomp-blocker${voiceBlocker ? " is-voice" : ""}`}>{publishBlocker}</p>}
            <div className="acomp-bar__buttons">
              {status === "draft" && (
                <button type="button" className="btn btn-quiet acomp-delete" disabled={Boolean(busy)} onClick={() => void remove()}>{w.deleteDraft}</button>
              )}
              {isNew ? (
                <>
                  <button type="button" className="btn btn-secondary" disabled={Boolean(busy) || !trimmed || (status === "pending_review" && Boolean(voiceBlocker))} onClick={() => void save(false)}>
                    {busy === "draft" ? w.saving : status === "pending_review" ? w.saveChanges : w.saveDraft}
                  </button>
                  {/* Already with the editors: changes are saved, nothing is sent or published again from here. */}
                  {status !== "pending_review" && <button type="button" className="btn btn-red acomp-publish" disabled={Boolean(busy) || Boolean(publishBlocker)} onClick={() => void save(true)}>
                    {busy === "publish" ? w.publishing : byTeam ? w.sendToEditors : w.publish} <Icon name="arrow" />
                  </button>}
                </>
              ) : (
                <button type="button" className="btn btn-red acomp-publish" disabled={Boolean(busy) || !trimmed || tooLong} onClick={() => void save(status === "published")}>
                  {busy ? w.saving : w.saveChanges}
                </button>
              )}
            </div>
          </footer>}
          <small className="acomp-rights">{w.rights} <a href="/terms#author-content" target="_blank" rel="noreferrer">{w.terms}</a>{isNew ? <span className="acomp-keys"> · {w.keepHint}</span> : null}</small>
        </div>
      )}
    </main>
  );
}

/** The cover as the reader will see it: the editors' picture, or a frame saying they will make it. */
function CoverPanel({ w, title, image }: { w: Words; title: string; image: string | null }) {
  return (
    <div className="acomp-cover">
      <span className="acomp-label">{w.coverLabel}</span>
      <div className={`acomp-frame${image ? " has-image" : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="" />}
        <span className="acomp-frame__shade" aria-hidden="true" />
        <span className="acomp-frame__title serif">{title || "…"}</span>
        {!image && <span className="acomp-frame__empty"><span className="acomp-frame__mark" aria-hidden="true">b.</span>{w.teamCoverOn}<small>{w.teamCoverHint}</small></span>}
      </div>
    </div>
  );
}
