"use client";

import "@/app/author-desk.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  blankWork,
  canQueue,
  isStale,
  materialKinds,
  newId,
  pinsByPart,
  plan,
  plannedWeeks,
  readingLines,
  readingSeconds,
  resendCheck,
  revisionDays,
  stageOf,
  stages,
  textKey,
  withHistory,
  type Material,
  type MaterialKind,
  type OutcomeCategory,
  type Stage,
  type Work,
} from "@/lib/boks/author-desk/workflow";
import { saveTake, useDesk, useTakeUrls, type Desk } from "./store";
import { Teleprompter } from "./teleprompter";
import { StudioDesk } from "./studio";

/*
 * The workshop's words, in one place. Plain Russian, the same word for the
 * same thing everywhere: «текст», «запись», «серия», «очередь», «бок».
 */
const authorName = "Анна";
const stepNames: Record<Stage, string> = { text: "Текст", voice: "Голос", editors: "Серия" };
const categoryNames: Record<OutcomeCategory, string> = { voice: "Запись", text: "Текст", law: "Законодательство", other: "Другое" };
const kindNames: Record<MaterialKind, string> = { fact: "Факт", image: "Образ", phrase: "Слова и выражения", source: "Источник", note: "Мысль" };
const kindHints: Record<MaterialKind, string> = {
  fact: "Дата, деталь, цифра",
  image: "Предмет, звук, цвет",
  phrase: "Слово или выражение того времени",
  source: "Книга, архив, музей, человек",
  note: "Например: «в третьей части вернуться к этому»",
};

type Route = { work: null; studio?: boolean } | { work: string; step: Stage };

function readRoute(): Route {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const match = /^#w\/([^/]+)\/(\w+)$/.exec(hash);
  if (match) {
    // Older links named five rooms; the first two now live inside «Текст».
    const step = match[2] === "idea" || match[2] === "materials" ? "text" : match[2];
    if ((stages as readonly string[]).includes(step)) return { work: match[1], step: step as Stage };
  }
  if (hash === "#studio") return { work: null, studio: true };
  return { work: null };
}

function when(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 5) return `${days} дня назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

/** «на этой неделе», «на следующей неделе», «около 30 ноября». */
function weekLabel(date: Date | undefined) {
  if (!date) return "";
  const now = new Date();
  const thisWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const weeks = Math.round((date.getTime() - thisWeek.getTime()) / (7 * 86_400_000));
  if (weeks <= 0) return "на этой неделе";
  if (weeks === 1) return "на следующей неделе";
  const sameYear = date.getFullYear() === now.getFullYear();
  return `около ${date.toLocaleDateString("ru-RU", sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" })}`;
}

function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
}

function texts(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  const word = tens > 10 && tens < 20 ? "текстов" : ones === 1 ? "текст" : ones >= 2 && ones <= 4 ? "текста" : "текстов";
  return `${count} ${word}`;
}

function seriesWord(count: number) {
  const tens = count % 100;
  const ones = count % 10;
  return tens > 10 && tens < 20 ? "серий" : ones === 1 ? "серия" : ones >= 2 && ones <= 4 ? "серии" : "серий";
}

function ordinal(n: number) {
  const names = ["первой", "второй", "третьей", "четвёртой", "пятой", "шестой", "седьмой", "восьмой", "девятой", "десятой"];
  return names[n - 1] ?? `${n}-й`;
}

/** The line a card shows: the first one with words in it, not a chapter number. */
function firstLine(text: string) {
  return text.split("\n").map((line) => line.trim()).find((line) => line.length > 3 && !/^[IVXLC]+\.?$/.test(line)) ?? "";
}

/** The queue as it stands: what is being drawn now, the order, the planned weeks, this year's allowance. */
function useQueue(desk: Desk) {
  const works = desk.state?.works ?? [];
  const queue = desk.state?.queue ?? [];
  const year = new Date().getFullYear();
  const making = works.filter((work) => work.editors.step === "production" && !work.editors.revising);
  const revising = works.filter((work) => work.editors.step === "production" && work.editors.revising);
  const ready = works.filter((work) => work.editors.step === "approval");
  const usedByYear: Record<number, number> = { [year]: desk.state?.publishedEarlier ?? 0 };
  for (const work of works) {
    const step = work.editors.step;
    if (step === "published" && work.editors.publishedAt) {
      const at = new Date(work.editors.publishedAt).getFullYear();
      usedByYear[at] = (usedByYear[at] ?? 0) + 1;
    } else if (step === "production" || step === "approval") usedByYear[year] = (usedByYear[year] ?? 0) + 1;
  }
  const planned = plannedWeeks({ queue, busyThisWeek: making.length, today: new Date(), usedByYear });
  const byId = new Map(works.map((work) => [work.id, work]));
  return {
    making,
    revising,
    ready,
    queue: queue.map((id) => byId.get(id)).filter((work): work is Work => !!work),
    planned,
    used: usedByYear[year] ?? 0,
    year,
    planFor: (ids: string[]) => plannedWeeks({ queue: ids, busyThisWeek: making.length, today: new Date(), usedByYear }),
  };
}

/** One plain sentence: where this text is and what it waits for. */
function useStatus(work: Work, desk: Desk) {
  const { queue, planned } = useQueue(desk);
  const step = work.editors.step;
  if (!step && work.outcome?.kind === "declined") return "Редакция не сможет выпустить этот текст";
  if (!step && work.outcome?.kind === "changes") return "Редакция просит доработать";
  if (work.shelved && !step) return "Отложено. Вернётесь, когда захотите";
  if (step === "published") return `Опубликовано ${work.editors.publishedAt ? when(work.editors.publishedAt) : ""}`;
  if (step === "approval") return "Серия готова. Посмотрите и опубликуйте";
  if (step === "production") return work.editors.revising ? `Редакция исправляет серию, до ${revisionDays} дней` : "Редакция рисует серию, обычно неделю";
  if (step === "queued") {
    const place = queue.findIndex((item) => item.id === work.id) + 1;
    return `В очереди ${ordinal(place)}, ${weekLabel(planned.get(work.id))}`;
  }
  if (stageOf(work) === "voice") return work.chosenTake ? "Запись есть. Можно отдать редакции" : "Ждёт вашего голоса";
  return work.text.trim() ? "Черновик" : "Новый текст";
}

export function AuthorDesk() {
  const desk = useDesk();
  const [route, setRoute] = useState<Route>({ work: null });
  const [support, setSupport] = useState(false);
  const [preview, setPreview] = useState<Work | null>(null);
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    const sync = () => {
      setRoute(readRoute());
      // A link away closes whatever was open over the page.
      setPreview(null);
      setSupport(false);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  // Read after hydration: the server has no localStorage.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem(welcomeKey)) setWelcome(true);
      } catch {
        /* no storage: no welcome */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const go = (hash: string) => {
    window.location.hash = hash;
    window.scrollTo({ top: 0 });
  };

  if (!desk.state) return <main className="acab desk" />;
  const work = route.work ? desk.state.works.find((item) => item.id === route.work) : null;
  const studio = !route.work && "studio" in route && route.studio;
  const unread = desk.state.works.filter((item) => item.editors.notes.at(-1)?.from === "editors" && item.editors.step !== "published").length;

  return (
    <main className={`acab desk ${studio ? "is-studio" : ""}`}>
      <div className="desk-role" role="group" aria-label="Демо: чей взгляд">
        <span>Демо</span>
        <a href="#" className={studio ? "" : "on"} onClick={(event) => (event.preventDefault(), go(""))}>
          Автор
        </a>
        <a href="#studio" className={studio ? "on" : ""}>
          Редакция
        </a>
      </div>
      <header className="desk-top">
        <a href="#" className="desk-brand" onClick={(event) => (event.preventDefault(), go(""))}>
          boks <span>{studio ? "Редакция" : "Мастерская"}</span>
        </a>
        <nav className="desk-top-links" hidden={!!studio}>
          <a href="/author#my-page">Моя страница</a>
          <button type="button" onClick={() => setSupport(true)}>
            Написать редакции{unread ? <b className="desk-badge">{unread}</b> : null}
          </button>
        </nav>
      </header>
      {work && route.work ? (
        <WorkScreen key={work.id} work={work} step={(route as { step: Stage }).step} go={go} desk={desk} onPreview={setPreview} />
      ) : studio ? (
        <StudioView desk={desk} />
      ) : (
        <Home desk={desk} go={go} onPreview={setPreview} onHelp={() => setWelcome(true)} />
      )}
      {support ? <SupportSheet onClose={() => setSupport(false)} /> : null}
      {welcome && !studio ? (
        <Welcome
          onClose={() => {
            setWelcome(false);
            try {
              window.localStorage.setItem(welcomeKey, "1");
            } catch {
              /* fine */
            }
          }}
        />
      ) : null}
      {preview ? (
        <SeriesPreview
          work={preview}
          onClose={() => setPreview(null)}
          onPublish={() => {
            desk.approve(preview.id);
            setPreview(null);
          }}
          onFix={() => {
            const id = preview.id;
            setPreview(null);
            go(`w/${id}/editors`);
            window.setTimeout(() => document.getElementById("desk-ask-fix")?.click(), 120);
          }}
        />
      ) : null}
    </main>
  );
}

function StudioView({ desk }: { desk: Desk }) {
  const queue = useQueue(desk);
  return <StudioDesk desk={desk} helpers={{ ...queue, weekLabel, when, duration }} />;
}

/* ------------------------------------------------------------------ */
/* Home                                                               */
/* ------------------------------------------------------------------ */

function Home({ desk, go, onPreview, onHelp }: { desk: Desk; go: (hash: string) => void; onPreview: (work: Work) => void; onHelp: () => void }) {
  const works = desk.state!.works;
  const { ready } = useQueue(desk);
  const [adding, setAdding] = useState(false);
  const [row, setRow] = useState<Work[] | null>(null);
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const active = works.filter((work) => !work.shelved || work.editors.step);
  const shelved = works.filter((work) => work.shelved && !work.editors.step).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const answered = active.filter((work) => work.outcome && !work.editors.step);
  const needVoice = active.filter((work) => stageOf(work) === "voice" && !work.chosenTake && !work.outcome);
  const recorded = active.filter((work) => stageOf(work) === "voice" && work.chosenTake && !work.outcome);
  const drafts = active.filter((work) => stageOf(work) === "text").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shelve = (work: Work) => desk.update(work.id, (current) => withHistory({ ...current, shelved: true }, "author", "Отложил на потом"));
  const published = works.filter((work) => work.editors.step === "published").sort((a, b) => (b.editors.publishedAt ?? "").localeCompare(a.editors.publishedAt ?? ""));
  const replies = works.filter((work) => work.editors.notes.at(-1)?.from === "editors" && work.editors.step !== "published" && work.editors.step !== "approval" && !work.outcome);
  const hasWaiting = ready.length || needVoice.length || recorded.length || replies.length || answered.length;

  const startDraft = () => {
    const work = blankWork("");
    desk.add(work);
    go(`w/${work.id}/text`);
  };

  return (
    <div className="desk-home">
      {adding ? (
        <AddTextSheet
          onClose={() => setAdding(false)}
          onCreate={(work, later) => {
            desk.add(later ? { ...work, shelved: true } : work);
            setAdding(false);
            if (!later) go(`w/${work.id}/voice`);
          }}
        />
      ) : null}
      {row ? <RecordRow works={row} desk={desk} onClose={() => setRow(null)} /> : null}

      <section className="desk-hero">
        <h1>
          {greeting}, {authorName}
        </h1>
        <div className="desk-hero-actions">
          <button type="button" className="desk-btn desk-btn-red" onClick={() => setAdding(true)}>
            Добавить текст
          </button>
          <button type="button" className="desk-quiet" onClick={startDraft}>
            или начать черновик
          </button>
        </div>
      </section>

      {hasWaiting ? (
        <section className="desk-section">
          <h2 className="desk-h2">Ждёт вас</h2>
          <div className="desk-waiting">
            {ready.map((work) => (
              <article key={work.id} className="desk-ready">
                <div className="desk-ready-cover" aria-hidden>
                  <span>{work.title}</span>
                </div>
                <div className="desk-ready-body">
                  <p className="desk-ready-kicker">Серия готова</p>
                  <h3>{work.title}</h3>
                  <p>Редакция нарисовала серию с вашим голосом. Посмотрите и опубликуйте, когда захотите.</p>
                  <button type="button" className="desk-btn desk-btn-red" onClick={() => onPreview(work)}>
                    Посмотреть
                  </button>
                </div>
              </article>
            ))}

            {answered.map((work) => (
              <a key={work.id} href={`#w/${work.id}/editors`} className={`desk-answer ${work.outcome!.kind === "declined" ? "is-declined" : ""}`}>
                <span className="desk-answer-kicker">
                  {work.outcome!.kind === "changes" ? "Редакция просит доработать" : "Редакция не сможет выпустить"} · {categoryNames[work.outcome!.category]}
                </span>
                <b>{work.title}</b>
                <span className="desk-answer-reason">«{work.outcome!.reason}»</span>
                <span className="desk-nudge-go">{work.outcome!.kind === "changes" ? "Доработать" : "Подробнее"}</span>
              </a>
            ))}

            {needVoice.length ? (
              <article className="desk-card-voice">
                <div className="desk-card-voice-head">
                  <div>
                    <h3>Прочитайте вслух {texts(needVoice.length)}</h3>
                    <p>Без вашего голоса бок не выходит. Читайте по одному или все подряд.</p>
                  </div>
                  {needVoice.length > 1 ? (
                    <button type="button" className="desk-btn desk-btn-red" onClick={() => setRow(needVoice)}>
                      Прочитать все подряд
                    </button>
                  ) : null}
                </div>
                <ul className="desk-voice-list">
                  {needVoice.map((work) => (
                    <li key={work.id}>
                      <a href={`#w/${work.id}/voice`}>
                        <span className="desk-voice-title">{work.title || "Без названия"}</span>
                        <span className="desk-voice-meta">
                          {work.importedFrom ? `со ${work.importedFrom === "Стихи.ру" ? "Стихов.ру" : "Прозы.ру"} · ` : ""}
                          {Math.max(1, Math.round(readingSeconds(work.text, work.form) / 60))} мин
                        </span>
                        <span className="desk-voice-go">Прочитать</span>
                      </a>
                      <button type="button" className="desk-later" onClick={() => shelve(work)} title="Убрать в «Отложено»: текст останется, но не будет ждать голоса">
                        Позже
                      </button>
                    </li>
                  ))}
                </ul>
              </article>
            ) : null}

            {recorded.map((work) => (
              <a key={work.id} href={`#w/${work.id}/voice`} className="desk-nudge">
                <span>
                  <b>«{work.title}»</b> записан. Отдать редакции?
                </span>
                <span className="desk-nudge-go">Открыть</span>
              </a>
            ))}
            {replies.map((work) => (
              <a key={work.id} href={`#w/${work.id}/editors`} className="desk-nudge">
                <span>
                  Редакция ответила про <b>«{work.title}»</b>
                </span>
                <span className="desk-nudge-go">Прочитать</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <QueueBlock desk={desk} onHelp={onHelp} />

      {drafts.length ? (
        <section className="desk-section">
          <h2 className="desk-h2">Черновики</h2>
          <div className="desk-shelf">
            {drafts.map((work) => (
              <a key={work.id} href={`#w/${work.id}/text`} className="desk-book">
                <span className="desk-book-title">{work.title || "Без названия"}</span>
                <span className="desk-book-line">{firstLine(work.text) || work.idea.notes.at(-1)?.text || "Пока пусто"}</span>
                <span className="desk-book-meta">{when(work.updatedAt)}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {shelved.length ? (
        <section className="desk-section">
          <div className="desk-h2-row">
            <h2 className="desk-h2">Отложено</h2>
            <span className="desk-h2-note">Тексты на потом. Они ничего не ждут, вернитесь к ним, когда захотите.</span>
          </div>
          <div className="desk-shelf">
            {shelved.map((work) => (
              <a key={work.id} href={`#w/${work.id}/${stageOf(work)}`} className="desk-book is-shelved">
                <span className="desk-book-title">{work.title || "Без названия"}</span>
                <span className="desk-book-line">{firstLine(work.text) || work.idea.notes.at(-1)?.text || "Пока пусто"}</span>
                <span className="desk-book-meta">{work.takes.length ? "есть запись · " : ""}{when(work.updatedAt)}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {published.length ? (
        <section className="desk-section">
          <h2 className="desk-h2">Опубликовано</h2>
          <div className="desk-shelf">
            {published.map((work) => (
              <a key={work.id} href={`#w/${work.id}/editors`} className="desk-book is-out">
                <span className="desk-book-cover" aria-hidden />
                <span className="desk-book-title">{work.title}</span>
                <span className="desk-book-meta">{work.editors.publishedAt ? when(work.editors.publishedAt) : ""}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="desk-footer">
        <button type="button" onClick={onHelp}>
          Как это устроено
        </button>
        <button type="button" onClick={() => window.confirm("Вернуть демо-тексты? Ваши изменения в прототипе пропадут.") && desk.reset()}>
          Вернуть демо (прототип)
        </button>
      </footer>
    </div>
  );
}

/* The queue ---------------------------------------------------------- */

function QueueBlock({ desk, onHelp }: { desk: Desk; onHelp: () => void }) {
  const { making, revising, queue, planned, used } = useQueue(desk);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const left = Math.max(0, plan.perYear - used);
  if (!making.length && !revising.length && !queue.length) return null;

  return (
    <section className="desk-section" id="queue">
      <div className="desk-h2-row">
        <h2 className="desk-h2">Очередь</h2>
        <span className="desk-h2-note">
          Редакция рисует по одной серии в неделю, в вашем порядке.{" "}
          <button type="button" onClick={onHelp}>
            Подробнее
          </button>
        </span>
      </div>
      <ol className="desk-queue">
        {making.map((work) => (
          <li key={work.id} className="desk-q is-now">
            <span className="desk-q-n" aria-hidden>
              <i className="desk-pulse" />
            </span>
            <a href={`#w/${work.id}/editors`} className="desk-q-title">
              {work.title}
            </a>
            <span className="desk-q-when">Сейчас рисуем</span>
            <span className="desk-q-moves" />
          </li>
        ))}
        {revising.map((work) => (
          <li key={work.id} className="desk-q is-now">
            <span className="desk-q-n" aria-hidden>
              ✎
            </span>
            <a href={`#w/${work.id}/editors`} className="desk-q-title">
              {work.title}
            </a>
            <span className="desk-q-when">Исправляем, до {revisionDays} дней</span>
            <span className="desk-q-moves" />
          </li>
        ))}
        {queue.map((work, index) => {
          const fixed = !!work.editors.fixed;
          return (
            <li
              key={work.id}
              className={`desk-q ${fixed ? "is-fixed" : ""} ${dragging === work.id ? "is-dragging" : ""} ${over === index && dragging !== work.id ? "is-over" : ""}`}
              draggable={!fixed}
              onDragStart={() => setDragging(work.id)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging) desk.move(dragging, index);
                setDragging(null);
                setOver(null);
              }}
            >
              <span className="desk-q-n">{index + 1}</span>
              <a href={`#w/${work.id}/editors`} className="desk-q-title">
                {work.title}
              </a>
              <span className="desk-q-when">
                {fixed ? (
                  <>
                    Уже рисуем заранее <Hint text="Редакция начала эту серию раньше срока, поэтому её место не двигается. Остальные тексты переставляйте как хотите." />
                  </>
                ) : (
                  weekLabel(planned.get(work.id))
                )}
              </span>
              {fixed ? (
                <span className="desk-q-moves" />
              ) : (
                <span className="desk-q-moves">
                  <button type="button" aria-label="Раньше" title="Раньше" disabled={index === 0} onClick={() => desk.shift(work.id, -1)}>
                    ↑
                  </button>
                  <button type="button" aria-label="Позже" title="Позже" disabled={index === queue.length - 1} onClick={() => desk.shift(work.id, 1)}>
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="desk-queue-foot">
        В этом году ещё {left} {seriesWord(left)}.
      </p>
      <p className="desk-demo">
        Прототип:{" "}
        <button type="button" onClick={desk.passWeek}>
          прошла неделя
        </button>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One text                                                           */
/* ------------------------------------------------------------------ */

type Update = (change: (work: Work) => Work) => void;

function WorkScreen({ work, step, go, desk, onPreview }: { work: Work; step: Stage; go: (hash: string) => void; desk: Desk; onPreview: (work: Work) => void }) {
  const reached = stages.indexOf(stageOf(work));
  const update: Update = (change) => desk.update(work.id, change);
  const status = useStatus(work, desk);
  const out = work.editors.step === "published";
  return (
    <div className="desk-work">
      <a href="#" className="desk-back" onClick={(event) => (event.preventDefault(), go(""))}>
        ← Мастерская
      </a>
      <input
        className="desk-title"
        value={work.title}
        placeholder="Название"
        aria-label="Название"
        onChange={(event) => update((current) => ({ ...current, title: event.target.value }))}
      />
      <div className="desk-status-row">
        <p className="desk-status">{status}</p>
        {work.editors.step ? null : work.shelved ? (
          <button type="button" className="desk-btn desk-btn-ink" onClick={() => update((current) => withHistory({ ...current, shelved: false }, "author", "Вернул в работу"))}>
            Вернуть в работу
          </button>
        ) : (
          <button
            type="button"
            className="desk-quiet"
            title="Текст останется у вас и не будет ждать голоса"
            onClick={() => {
              update((current) => withHistory({ ...current, shelved: true }, "author", "Отложил на потом"));
              go("");
            }}
          >
            Отложить на потом
          </button>
        )}
      </div>

      <nav className="desk-steps" aria-label="Шаги">
        {stages.map((name, index) => (
          <a
            key={name}
            href={`#w/${work.id}/${name}`}
            className={`${name === step ? "is-on" : ""} ${index < reached || out ? "is-done" : ""}`}
            aria-current={name === step ? "step" : undefined}
          >
            <span className="desk-step-n">{index < reached || out ? "✓" : index + 1}</span>
            {stepNames[name]}
          </a>
        ))}
      </nav>

      {step === "text" ? <TextStep work={work} update={update} go={go} /> : null}
      {step === "voice" ? <VoiceStep work={work} update={update} desk={desk} go={go} /> : null}
      {step === "editors" ? <SeriesStep work={work} desk={desk} go={go} onPreview={onPreview} /> : null}
    </div>
  );
}

/* 1. Text ------------------------------------------------------------ */

function TextStep({ work, update, go }: { work: Work; update: Update; go: (hash: string) => void }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const locked = work.editors.step && work.editors.step !== "queued";
  const seconds = readingSeconds(work.text, work.form);
  const words = work.text.trim() ? work.text.trim().split(/\s+/).length : 0;
  const pins = pinsByPart(work.materials);
  const planItems = work.idea.concept?.plan ?? [];
  const hasNotes = Boolean(work.idea.concept || work.idea.notes.length || work.materials.length);

  return (
    <div className={`desk-write ${hasNotes ? "has-notes" : ""}`}>
      <section className="desk-paper">
        <div className="desk-paper-top">
          <div className="desk-switch" role="group" aria-label="Стихи или проза">
            {(["poem", "prose"] as const).map((form) => (
              <button key={form} type="button" disabled={!!locked} className={work.form === form ? "is-on" : ""} onClick={() => update((current) => ({ ...current, form }))}>
                {form === "poem" ? "Стихи" : "Проза"}
              </button>
            ))}
          </div>
          <button type="button" className="desk-quiet" onClick={() => setNotesOpen(true)}>
            {hasNotes ? "Заметки" : "Добавить заметки"}
          </button>
        </div>
        {locked ? <p className="desk-calm">Редакция уже рисует серию по этому тексту, поэтому он закреплён.</p> : null}
        <textarea
          className={`desk-editor is-${work.form}`}
          value={work.text}
          readOnly={!!locked}
          placeholder={work.form === "poem" ? "Строка за строкой. Пустая строка разделяет строфы." : "Начните с того, что видите."}
          aria-label="Текст"
          onChange={(event) => update((current) => ({ ...current, text: event.target.value }))}
          spellCheck
        />
        <div className="desk-paper-foot">
          <span>
            {words} слов · около {Math.max(1, Math.round(seconds / 60))} мин вслух
            {seconds > 15 * 60 ? <b className="desk-warn"> · длиннее 15 минут, сократите</b> : null}
          </span>
          <button type="button" className="desk-btn desk-btn-red" disabled={work.text.trim().length < 120 || seconds > 15 * 60} onClick={() => go(`w/${work.id}/voice`)}>
            Дальше: прочитать вслух
          </button>
        </div>
        {work.text.trim().length < 120 ? <p className="desk-calm">Чтобы перейти к голосу, нужен текст хотя бы в несколько строк.</p> : null}
      </section>

      {hasNotes ? (
        <aside className="desk-margin">
          {work.idea.concept?.about ? <p className="desk-margin-about">{work.idea.concept.about}</p> : null}
          {planItems.length ? <PlanList work={work} update={update} compact /> : null}
          {[...pins].map(([part, items]) => (
            <div key={part} className="desk-pin">
              <b>{part}</b>
              {items.map((item) => (
                <p key={item.id}>{item.text}</p>
              ))}
            </div>
          ))}
          <button type="button" className="desk-quiet" onClick={() => setNotesOpen(true)}>
            Все заметки
          </button>
        </aside>
      ) : null}

      {notesOpen ? <NotesSheet work={work} update={update} onClose={() => setNotesOpen(false)} /> : null}
    </div>
  );
}

function PlanList({ work, update, compact }: { work: Work; update: Update; compact?: boolean }) {
  const [draft, setDraft] = useState("");
  const items = work.idea.concept?.plan ?? [];
  const setPlan = (next: typeof items) =>
    update((current) => ({ ...current, idea: { ...current.idea, concept: { about: "", approach: "", form: "", ...current.idea.concept, plan: next } } }));
  return (
    <div className="desk-plan">
      <span className="desk-label">Что должно быть в тексте</span>
      <ul>
        {items.map((point) => (
          <li key={point.id} className={point.done ? "is-done" : ""}>
            <button
              type="button"
              className="desk-check"
              aria-pressed={point.done}
              aria-label={point.done ? "Отметить как ненаписанное" : "Отметить как написанное"}
              onClick={() => setPlan(items.map((item) => (item.id === point.id ? { ...item, done: !item.done } : item)))}
            >
              {point.done ? "✓" : ""}
            </button>
            <span>{point.text}</span>
            {compact ? null : (
              <button type="button" className="desk-x" aria-label="Убрать" onClick={() => setPlan(items.filter((item) => item.id !== point.id))}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {compact ? null : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            setPlan([...items, { id: newId("p"), text: draft.trim(), done: false }]);
            setDraft("");
          }}
        >
          <input value={draft} placeholder="Сцена, мотив, мысль. Enter, чтобы добавить" onChange={(event) => setDraft(event.target.value)} />
        </form>
      )}
    </div>
  );
}

/** Everything around the text in one side panel: what it is about, what it must hold, thoughts, materials. */
function NotesSheet({ work, update, onClose }: { work: Work; update: Update; onClose: () => void }) {
  useEscape(onClose);
  const [thought, setThought] = useState("");
  const [kind, setKind] = useState<MaterialKind>("fact");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [pinTo, setPinTo] = useState("");
  const parts = useMemo(() => {
    const names = new Set<string>();
    for (const point of work.idea.concept?.plan ?? []) names.add(point.text);
    for (const item of work.materials) if (item.pinTo) names.add(item.pinTo);
    return [...names];
  }, [work]);
  const about = work.idea.concept?.about ?? "";
  const setAbout = (value: string) =>
    update((current) => ({ ...current, idea: { ...current.idea, concept: { approach: "", form: "", plan: [], ...current.idea.concept, about: value } } }));
  const addMaterial = () => {
    if (!text.trim()) return;
    update((current) => ({
      ...current,
      materials: [...current.materials, { id: newId("m"), kind, text: text.trim(), source: source.trim() || undefined, pinTo: pinTo.trim() || undefined }],
    }));
    setText("");
    setSource("");
  };
  const change = (id: string, patch: Partial<Material>) =>
    update((current) => ({ ...current, materials: current.materials.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));

  return (
    <div className="desk-sheet-back" onClick={onClose}>
      <aside className="desk-sheet desk-notes" role="dialog" aria-label="Заметки" onClick={(event) => event.stopPropagation()}>
        <div className="desk-sheet-head">
          <h3>Заметки</h3>
          <button type="button" className="desk-x" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <p className="desk-calm">Всё здесь видите только вы. Заполнять не обязательно.</p>

        <label className="desk-field">
          <span className="desk-label">О чём текст</span>
          <textarea rows={2} value={about} placeholder="Одной-двумя фразами, для себя" onChange={(event) => setAbout(event.target.value)} />
        </label>

        <PlanList work={work} update={update} />

        <div className="desk-field">
          <span className="desk-label">Мысли</span>
          <form
            className="desk-inline"
            onSubmit={(event) => {
              event.preventDefault();
              if (!thought.trim()) return;
              update((current) => ({ ...current, idea: { ...current.idea, notes: [...current.idea.notes, { text: thought.trim(), at: new Date().toISOString() }] } }));
              setThought("");
            }}
          >
            <input value={thought} placeholder="Запишите, пока не забыли" aria-label="Мысль" onChange={(event) => setThought(event.target.value)} />
            <button type="submit" className="desk-btn desk-btn-ink" disabled={!thought.trim()}>
              Записать
            </button>
          </form>
          <ul className="desk-thoughts">
            {[...work.idea.notes].reverse().map((entry, index) => (
              <li key={entry.at + index}>
                <p>{entry.text}</p>
                <small>{when(entry.at)}</small>
              </li>
            ))}
          </ul>
        </div>

        <div className="desk-field">
          <span className="desk-label">Материалы</span>
          <div className="desk-chips" role="group" aria-label="Что это">
            {materialKinds.map((item) => (
              <button key={item} type="button" className={kind === item ? "is-on" : ""} onClick={() => setKind(item)}>
                {kindNames[item]}
              </button>
            ))}
          </div>
          <textarea rows={2} value={text} placeholder={kindHints[kind]} aria-label="Материал" onChange={(event) => setText(event.target.value)} />
          <div className="desk-inline">
            <input value={source} placeholder="Откуда (по желанию)" aria-label="Откуда" onChange={(event) => setSource(event.target.value)} />
            <input list="desk-parts" value={pinTo} placeholder="К какой части текста" aria-label="К какой части текста" onChange={(event) => setPinTo(event.target.value)} />
            <datalist id="desk-parts">
              {parts.map((part) => (
                <option key={part} value={part} />
              ))}
            </datalist>
          </div>
          <button type="button" className="desk-btn desk-btn-ink" disabled={!text.trim()} onClick={addMaterial}>
            Сохранить материал
          </button>
          <ul className="desk-materials">
            {work.materials.map((item) => (
              <li key={item.id}>
                <span className="desk-kind">{kindNames[item.kind]}</span>
                <p>{item.text}</p>
                {item.source ? <small>{item.source}</small> : null}
                <div className="desk-material-foot">
                  <select value={item.pinTo ?? ""} onChange={(event) => change(item.id, { pinTo: event.target.value || undefined })} aria-label="К какой части текста">
                    <option value="">не привязано</option>
                    {parts.map((part) => (
                      <option key={part} value={part}>
                        к части: {part}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="desk-x" aria-label="Удалить" onClick={() => update((current) => ({ ...current, materials: current.materials.filter((m) => m.id !== item.id) }))}>
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/* 2. Voice ----------------------------------------------------------- */

function VoiceStep({ work, update, desk, go }: { work: Work; update: Update; desk: Desk; go: (hash: string) => void }) {
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState(false);
  const urls = useTakeUrls(work);
  const seconds = readingSeconds(work.text, work.form);
  const locked = work.editors.step && work.editors.step !== "queued";
  const { queue, planFor } = useQueue(desk);
  const landing = planFor([...queue.map((item) => item.id).filter((id) => id !== work.id), work.id]).get(work.id);
  const chosen = work.takes.find((take) => take.id === work.chosenTake);
  const chosenStale = chosen ? isStale(chosen, work.text) : false;

  const attach = (file: File) => {
    const audio = new Audio(URL.createObjectURL(file));
    audio.onloadedmetadata = () => void storeTake(desk, work.id, file, Math.round(audio.duration || 0), "file", file.name);
    audio.onerror = () => void storeTake(desk, work.id, file, 0, "file", file.name);
  };

  if (work.text.trim().length < 120) {
    return (
      <div className="desk-empty">
        <h3>Сначала текст</h3>
        <p>Голос записывается к готовому тексту: суфлёр покажет его строка за строкой.</p>
        <a className="desk-btn desk-btn-ink" href={`#w/${work.id}/text`}>
          К тексту
        </a>
      </div>
    );
  }

  return (
    <div className="desk-voice">
      <section className="desk-voice-main">
        {locked ? (
          <p className="desk-calm">Серия уже у редакции, запись закреплена. Если что-то не так, напишите на шаге «Серия».</p>
        ) : (
          <>
            <h2 className="desk-h2">{work.takes.length ? "Ваши записи" : "Прочитайте вслух"}</h2>
            <p className="desk-lead">Можно записать здесь или загрузить готовую запись. Пробовать можно сколько угодно раз.</p>
            <div className="desk-ways">
              <button type="button" className="desk-way is-main" onClick={() => setRecording(true)}>
                <span className="desk-way-icon" aria-hidden>
                  <i />
                </span>
                <b>{work.takes.length ? "Записать ещё раз" : "Записать с суфлёром"}</b>
                <small>Текст сам идёт по экрану в темпе чтения. Около {Math.max(1, Math.round(seconds / 60))} мин.</small>
              </button>
              <label className="desk-way">
                <span className="desk-way-icon" aria-hidden>
                  ↑
                </span>
                <b>Загрузить готовую запись</b>
                <small>Например, из студии. Файлы mp3, m4a, wav, до 15 минут.</small>
                <input
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) attach(file);
                    // The same file chosen again still counts as a new recording.
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </>
        )}

        {work.takes.length ? (
          <ul className="desk-takes">
            {work.takes.map((take, index) => {
              const on = work.chosenTake === take.id;
              return (
                <li key={take.id} className={`desk-take ${on ? "is-on" : ""}`}>
                  <Player url={urls[take.id]} seconds={take.seconds} />
                  <div className="desk-take-info">
                    <b>Запись {index + 1}</b>
                    <small>
                      {take.source === "file" ? "загружена" : "суфлёр"} · {when(take.at)}
                    </small>
                    {isStale(take, work.text) ? <small className="desk-stale">записана до правки текста</small> : null}
                  </div>
                  {on ? (
                    <span className="desk-take-chosen">Пойдёт в серию</span>
                  ) : locked ? (
                    <span />
                  ) : (
                    <button type="button" className="desk-quiet" onClick={() => update((current) => ({ ...current, chosenTake: take.id }))}>
                      Выбрать
                    </button>
                  )}
                  {locked ? null : (
                    <button
                      type="button"
                      className="desk-x"
                      aria-label={`Удалить запись ${index + 1}`}
                      onClick={() =>
                        update((current) => {
                          const takes = current.takes.filter((item) => item.id !== take.id);
                          return { ...current, takes, chosenTake: current.chosenTake === take.id ? takes.at(-1)?.id ?? null : current.chosenTake };
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {chosenStale && !work.editors.step ? (
          <div className="desk-next is-warn">
            <div>
              <b>Текст изменился после записи</b>
              <p>Запишите ещё раз, чтобы голос совпадал со словами на странице.</p>
            </div>
          </div>
        ) : work.outcome?.kind === "changes" && !resendCheck(work).ok ? (
          <div className="desk-next is-warn">
            <div>
              <b>Редакция просит доработать</b>
              <p>{work.outcome.category === "text" ? "Исправьте текст, затем запишите его заново." : "Запишите текст заново или загрузите новую запись, и можно будет отправить снова."}</p>
            </div>
          </div>
        ) : work.outcome && !resendCheck(work).ok ? null : work.chosenTake && !work.editors.step ? (
          <div className="desk-next">
            <div>
              <b>{work.outcome ? "Готово. Отправить снова?" : "Всё готово. Отдать редакции?"}</b>
              <p>
                Будет {ordinal(queue.length + 1)} в очереди, {weekLabel(landing)}. Порядок можно менять.
              </p>
            </div>
            <button
              type="button"
              className="desk-btn desk-btn-red"
              onClick={() => {
                desk.enqueue(work.id);
                go(`w/${work.id}/editors`);
              }}
            >
              Отдать в работу
            </button>
          </div>
        ) : null}
      </section>

      <aside className="desk-voice-text">
        <div className="desk-voice-text-head">
          <span className="desk-label">Текст</span>
          {locked ? null : (
            <button type="button" className="desk-quiet" onClick={() => setEditing(!editing)}>
              {editing ? "Готово" : "Исправить текст"}
            </button>
          )}
        </div>
        {editing ? (
          <textarea className={`desk-voice-edit is-${work.form}`} value={work.text} autoFocus aria-label="Текст" onChange={(event) => update((current) => ({ ...current, text: event.target.value }))} />
        ) : (
          <div className={`desk-voice-preview is-${work.form}`}>{work.text}</div>
        )}
      </aside>

      {recording ? (
        <Teleprompter
          text={work.text}
          title={work.title}
          estimatedSeconds={seconds}
          onCancel={() => setRecording(false)}
          onDone={(blob, takeSeconds) => {
            setRecording(false);
            void storeTake(desk, work.id, blob, takeSeconds, "teleprompter");
          }}
        />
      ) : null}
    </div>
  );
}

/** A quiet player: play or pause, where it is, how long. The browser's own controls are too loud here. */
function Player({ url, seconds }: { url?: string; seconds: number }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const total = seconds || 1;
  return (
    <div className="desk-player">
      <button
        type="button"
        className="desk-play"
        aria-label={playing ? "Пауза" : "Слушать"}
        disabled={!url}
        title={url ? undefined : "Демо-запись без звука"}
        onClick={() => {
          const element = audio.current;
          if (!element) return;
          if (element.paused) void element.play();
          else element.pause();
        }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span
        className="desk-track"
        onClick={(event) => {
          const element = audio.current;
          if (!element) return;
          const box = event.currentTarget.getBoundingClientRect();
          element.currentTime = ((event.clientX - box.left) / box.width) * (element.duration || total);
        }}
      >
        <i style={{ width: `${Math.min(100, (time / total) * 100)}%` }} />
      </span>
      <span className="desk-time">{duration(playing || time ? time : seconds)}</span>
      {url ? (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        />
      ) : null}
    </div>
  );
}

/* 3. Series ---------------------------------------------------------- */

function SeriesStep({ work, desk, go, onPreview }: { work: Work; desk: Desk; go: (hash: string) => void; onPreview: (work: Work) => void }) {
  const [message, setMessage] = useState("");
  const [fixing, setFixing] = useState(false);
  const check = canQueue(work);
  const step = work.editors.step;
  const { queue, planned } = useQueue(desk);
  const position = queue.findIndex((item) => item.id === work.id);
  const toQueue = () => {
    go("");
    window.setTimeout(() => document.getElementById("queue")?.scrollIntoView({ behavior: "smooth" }), 60);
  };
  const askFix = () => {
    setFixing(true);
    window.setTimeout(() => document.getElementById("desk-write")?.focus(), 30);
  };

  let main: ReactNode;
  const outcome = !step ? work.outcome : undefined;
  const resend = resendCheck(work);
  if (outcome?.kind === "changes") {
    main = (
      <div className="desk-state is-answer">
        <span className="desk-state-big">✎</span>
        <div>
          <p className="desk-answer-kicker">Редакция просит доработать · {categoryNames[outcome.category]}</p>
          <blockquote className="desk-reason">{outcome.reason}</blockquote>
          <p>
            {outcome.category === "voice"
              ? "Запишите текст ещё раз и отправьте снова: он встанет в очередь."
              : outcome.category === "text"
                ? "Исправьте текст, запишите его заново и отправьте снова."
                : "Исправьте, что просит редакция, и отправьте снова. Если что-то непонятно, спросите в переписке справа."}
          </p>
          <div className="desk-state-actions">
            {outcome.category === "text" ? (
              <a className="desk-btn desk-btn-ink" href={`#w/${work.id}/text`}>
                Исправить текст
              </a>
            ) : (
              <a className="desk-btn desk-btn-ink" href={`#w/${work.id}/voice`}>
                Записать заново
              </a>
            )}
            <button type="button" className="desk-btn desk-btn-red" disabled={!resend.ok} onClick={() => desk.enqueue(work.id)}>
              Отправить снова
            </button>
          </div>
          {!resend.ok ? (
            <p className="desk-calm">
              {resend.reason === "new-take"
                ? "Сначала запишите текст заново или загрузите новую запись."
                : resend.reason === "edit-text"
                  ? "Сначала исправьте текст, затем запишите его заново."
                  : "Текст изменился: запишите его заново, и можно будет отправить."}
            </p>
          ) : null}
        </div>
      </div>
    );
  } else if (outcome?.kind === "declined") {
    main = (
      <div className="desk-state is-answer is-declined">
        <span className="desk-state-big">·</span>
        <div>
          <p className="desk-answer-kicker">Редакция не сможет выпустить этот текст · {categoryNames[outcome.category]}</p>
          <blockquote className="desk-reason">{outcome.reason}</blockquote>
          <p>Текст остаётся у вас, мы ничего не удаляем. Если не согласны или хотите уточнить, напишите редакции в переписке справа.</p>
        </div>
      </div>
    );
  } else if (!step) {
    const missing = check.ok ? [] : check.missing;
    main = (
      <div className="desk-empty is-left">
        <h3>Серию рисует редакция</h3>
        <p>Как только у текста будет ваш голос, отдайте его редакции. Рисунки и сборку серии делаем мы.</p>
        {missing.includes("voice") || missing.includes("stale") ? (
          <a className="desk-btn desk-btn-red" href={`#w/${work.id}/voice`}>
            Прочитать вслух
          </a>
        ) : missing.includes("text") ? (
          <a className="desk-btn desk-btn-ink" href={`#w/${work.id}/text`}>
            К тексту
          </a>
        ) : (
          <button type="button" className="desk-btn desk-btn-red" onClick={() => desk.enqueue(work.id)}>
            Отдать в работу
          </button>
        )}
      </div>
    );
  } else if (step === "queued") {
    main = (
      <div className="desk-state">
        <span className="desk-state-big">{position + 1}</span>
        <div>
          <h3>В очереди {ordinal(position + 1)}</h3>
          <p>
            Редакция начнёт {weekLabel(planned.get(work.id))}. {work.editors.fixed ? "Это место редакция уже закрепила." : "Порядок можно менять в любой момент."}
          </p>
          <div className="desk-state-actions">
            {work.editors.fixed ? null : (
              <>
                <button type="button" className="desk-btn desk-btn-ink" onClick={toQueue}>
                  Поменять порядок
                </button>
                <button type="button" className="desk-quiet" onClick={() => desk.dequeue(work.id)}>
                  Убрать из очереди
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  } else if (step === "production") {
    main = (
      <div className="desk-state">
        <span className="desk-state-big">
          <i className="desk-pulse" />
        </span>
        <div>
          <h3>{work.editors.revising ? "Редакция исправляет серию" : "Редакция рисует серию"}</h3>
          <p>{work.editors.revising ? `Обычно до ${revisionDays} дней. Когда закончим, серия появится в «Ждёт вас».` : "Обычно неделю. Когда серия будет готова, она появится в «Ждёт вас»."}</p>
        </div>
      </div>
    );
  } else if (step === "approval") {
    main = (
      <div className="desk-state is-ready">
        <div className="desk-ready-cover is-small" aria-hidden>
          <span>{work.title}</span>
        </div>
        <div>
          <h3>Серия готова</h3>
          <p>Посмотрите её целиком. Если всё хорошо, опубликуйте. Если нет, напишите, что исправить.</p>
          <div className="desk-state-actions">
            <button type="button" className="desk-btn desk-btn-red" onClick={() => onPreview(work)}>
              Посмотреть
            </button>
            <button type="button" id="desk-ask-fix" className="desk-quiet" onClick={askFix}>
              Попросить исправить
            </button>
          </div>
        </div>
      </div>
    );
  } else {
    main = (
      <div className="desk-state">
        <span className="desk-state-big">✓</span>
        <div>
          <h3>Опубликовано</h3>
          <p>
            {work.editors.publishedAt ? `${when(work.editors.publishedAt)}. ` : ""}Серия на вашей странице и в ленте. <a href="/series">Открыть полку серий</a>
          </p>
        </div>
      </div>
    );
  }

  const asking = fixing && step === "approval";
  return (
    <div className="desk-series">
      <section className="desk-series-main">
        {main}
        <History work={work} />
      </section>
      <aside className="desk-thread" aria-label="Переписка с редакцией">
        <h3 className="desk-thread-title">Переписка с редакцией</h3>
        <div className="desk-thread-list">
          {work.editors.notes.length === 0 ? <p className="desk-calm">Здесь можно задать вопрос редакции про этот текст.</p> : null}
          {work.editors.notes.map((item, index) => (
            <div key={index} className={`desk-msg ${item.from === "author" ? "is-me" : ""}`}>
              <small>
                {item.from === "author" ? "Вы" : "Редакция"} · {when(item.at)}
              </small>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
        <form
          className={`desk-compose ${asking ? "is-fix" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            if (asking) {
              desk.requestFix(work.id, message.trim());
              setFixing(false);
            } else desk.say(work.id, "author", message.trim());
            setMessage("");
          }}
        >
          {asking ? <p className="desk-compose-hint">Опишите, что исправить: строку, место в записи или рисунок словами. Редакция исправит за неделю.</p> : null}
          <textarea id="desk-write" rows={3} value={message} placeholder={asking ? "Что исправить" : "Написать редакции"} aria-label={asking ? "Что исправить" : "Написать редакции"} onChange={(event) => setMessage(event.target.value)} />
          <div className="desk-compose-row">
            {asking ? (
              <button type="button" className="desk-quiet" onClick={() => setFixing(false)}>
                Отмена
              </button>
            ) : (
              <span />
            )}
            <button type="submit" className="desk-btn desk-btn-ink" disabled={!message.trim()}>
              {asking ? "Попросить исправить" : "Отправить"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function History({ work }: { work: Work }) {
  const entries = work.history ?? [];
  if (!entries.length) return null;
  return (
    <details className="desk-history">
      <summary>История</summary>
      <ol>
        {[...entries].reverse().map((entry, index) => (
          <li key={index}>
            <span>{entry.who === "author" ? "Вы" : "Редакция"}</span> {entry.what.replace("Записал дубль с суфлёром", "Записал с суфлёром")}
            <small>{when(entry.at)}</small>
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ------------------------------------------------------------------ */
/* Shared                                                             */
/* ------------------------------------------------------------------ */

const welcomeKey = "boks-desk-welcome-v2";

/** Keeps a recording and makes it the chosen one when the current choice is missing or reads an older text. */
async function storeTake(desk: Desk, workId: string, blob: Blob, seconds: number, source: "teleprompter" | "file", name?: string) {
  const id = newId("t");
  await saveTake(id, blob);
  desk.update(workId, (current) => {
    const chosen = current.takes.find((take) => take.id === current.chosenTake);
    const take = { id, seconds, at: new Date().toISOString(), source, name, textKey: textKey(current.text) };
    return withHistory(
      // After the editors returned the piece, the new recording is the one they are waiting for.
      { ...current, takes: [...current.takes, take], chosenTake: !chosen || isStale(chosen, current.text) || current.outcome?.kind === "changes" ? id : current.chosenTake },
      "author",
      source === "file" ? "Загрузил готовую запись" : "Записал с суфлёром"
    );
  });
}

/** Escape closes whatever sheet is open. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** A small «?» that explains one thing, on hover, focus or tap. */
function Hint({ text }: { text: string }) {
  return (
    <span className="desk-hint">
      <button type="button" aria-label={text} onClick={(event) => event.currentTarget.focus()}>
        ?
      </button>
      <span role="tooltip" className="desk-hint-pop">
        {text}
      </span>
    </span>
  );
}

function Welcome({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  return (
    <div className="desk-sheet-back is-center" onClick={onClose}>
      <div className="desk-welcome" role="dialog" aria-label="Как устроена мастерская" onClick={(event) => event.stopPropagation()}>
        <h2>Мастерская boks</h2>
        <p className="desk-lead">Здесь ваши тексты становятся сериями Boks Series: ваш голос, рисунки редакции и строки в такт чтению.</p>
        <ol>
          <li>
            <b>Текст</b>
            <span>Добавьте готовый текст или пишите здесь. Заметки к тексту по желанию.</span>
          </li>
          <li>
            <b>Голос</b>
            <span>Прочитайте с суфлёром или загрузите готовую запись. Без голоса бок не выходит. Рисунки делает редакция, от вас нужен только голос.</span>
          </li>
          <li>
            <b>Серия</b>
            <span>
              Редакция рисует серии в вашем порядке, по одной в неделю, до {plan.perYear} в год. Готовую серию вы смотрите и публикуете сами. Если что-то нужно доработать
              или текст не может выйти, редакция всегда объяснит почему.
            </span>
          </li>
        </ol>
        <button type="button" className="desk-btn desk-btn-red desk-wide" onClick={onClose}>
          Понятно
        </button>
      </div>
    </div>
  );
}

/** Most authors arrive with finished texts: paste one and go straight to the voice. */
function AddTextSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (work: Work, later?: boolean) => void }) {
  useEscape(onClose);
  const [title, setTitle] = useState("");
  const [form, setForm] = useState<Work["form"]>("poem");
  const [text, setText] = useState("");
  const seconds = readingSeconds(text, form);
  const reason = !text.trim() ? "" : text.trim().length < 120 ? "Нужен текст хотя бы в несколько строк." : seconds > 15 * 60 ? "Длиннее 15 минут чтения: бок столько не вмещает." : "";
  return (
    <div className="desk-sheet-back" onClick={onClose}>
      <div className="desk-sheet" role="dialog" aria-label="Добавить текст" onClick={(event) => event.stopPropagation()}>
        <div className="desk-sheet-head">
          <h3>Добавить текст</h3>
          <button type="button" className="desk-x" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <input className="desk-sheet-title" value={title} placeholder="Название" aria-label="Название" onChange={(event) => setTitle(event.target.value)} />
        <div className="desk-switch" role="group" aria-label="Стихи или проза">
          {(["poem", "prose"] as const).map((item) => (
            <button key={item} type="button" className={form === item ? "is-on" : ""} onClick={() => setForm(item)}>
              {item === "poem" ? "Стихи" : "Проза"}
            </button>
          ))}
        </div>
        <textarea className="desk-paste" rows={12} value={text} aria-label="Текст" placeholder="Вставьте текст целиком. В стихах строка на строку, пустая строка между строфами." onChange={(event) => setText(event.target.value)} />
        <p className="desk-calm">{reason || (text.trim() ? `Около ${Math.max(1, Math.round(seconds / 60))} мин чтения вслух.` : "До 15 минут чтения вслух.")}</p>
        <button
          type="button"
          className="desk-btn desk-btn-red"
          disabled={!!reason || !text.trim()}
          onClick={() => {
            const work = blankWork(title.trim());
            work.form = form;
            work.text = text.trim();
            onCreate(work);
          }}
        >
          Дальше: прочитать вслух
        </button>
        <button
          type="button"
          className="desk-quiet desk-center"
          disabled={!text.trim()}
          onClick={() => {
            const work = blankWork(title.trim());
            work.form = form;
            work.text = text.trim();
            onCreate(work, true);
          }}
        >
          Сохранить на потом
        </button>
        <p className="desk-calm">Голос можно записать здесь с суфлёром или загрузить готовую запись, например из студии.</p>
      </div>
    </div>
  );
}

/**
 * Reading one text after another without leaving the teleprompter: the
 * microphone is checked once; between texts, go on, read again or stop.
 */
function RecordRow({ works, desk, onClose }: { works: Work[]; desk: Desk; onClose: () => void }) {
  const [list] = useState(works);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"recording" | "between" | "done">("recording");
  const [recorded, setRecorded] = useState<Record<string, number>>({});
  const work = list[index];
  const next = list[index + 1];
  const done = list.filter((item) => recorded[item.id] !== undefined);

  if (phase === "recording" && work) {
    return (
      <Teleprompter
        key={`${work.id}-${recorded[work.id] ?? "new"}`}
        text={work.text}
        title={`${work.title} · ${index + 1} из ${list.length}`}
        estimatedSeconds={readingSeconds(work.text, work.form)}
        lead={index === 0 ? undefined : `Следующий текст: «${work.title}».`}
        onCancel={() => setPhase("between")}
        onDone={(blob, seconds) => {
          void storeTake(desk, work.id, blob, seconds, "teleprompter");
          setRecorded((current) => ({ ...current, [work.id]: seconds }));
          setPhase("between");
        }}
      />
    );
  }

  return createPortal(
    <div className="desk-prompter desk-row" role="dialog" aria-label="Чтение подряд">
      <header className="desk-prompter-top">
        <span className="desk-prompter-title">Чтение подряд</span>
        <span className="desk-prompter-count-line">
          {done.length} из {list.length}
        </span>
        <button type="button" className="desk-prompter-close" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <div className="desk-prompter-check">
        {phase === "between" && work ? (
          <>
            <p className="desk-prompter-lead">{recorded[work.id] !== undefined ? `«${work.title}» записан, ${duration(recorded[work.id])}.` : `«${work.title}» пропущен.`}</p>
            <div className="desk-row-actions">
              {next ? (
                <button
                  type="button"
                  className="desk-btn desk-btn-red"
                  onClick={() => {
                    setIndex(index + 1);
                    setPhase("recording");
                  }}
                >
                  Дальше: «{next.title}»
                </button>
              ) : (
                <button type="button" className="desk-btn desk-btn-red" onClick={() => setPhase("done")}>
                  Это был последний
                </button>
              )}
              <button type="button" className="desk-row-secondary" onClick={() => setPhase("recording")}>
                Записать ещё раз
              </button>
              <button type="button" className="desk-row-secondary" onClick={() => setPhase("done")}>
                Закончить
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="desk-prompter-lead">{done.length ? `Записано: ${texts(done.length)}.` : "Ничего не записано."}</p>
            {done.length ? <p className="desk-prompter-hint">Отдать их редакции? Порядок потом можно поменять.</p> : null}
            <div className="desk-row-actions">
              {done.length ? (
                <button
                  type="button"
                  className="desk-btn desk-btn-red"
                  onClick={() => {
                    done.forEach((item) => desk.enqueue(item.id));
                    onClose();
                  }}
                >
                  Отдать в работу
                </button>
              ) : null}
              <button type="button" className="desk-row-secondary" onClick={onClose}>
                {done.length ? "Пока нет" : "Закрыть"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

/** The finished Series as a reader will see it: the editors' picture (a stand-in here), the author's voice, the lines in time. */
function SeriesPreview({ work, onClose, onPublish, onFix }: { work: Work; onClose: () => void; onPublish: () => void; onFix: () => void }) {
  const urls = useTakeUrls(work);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lines = useMemo(() => readingLines(work.text).filter(Boolean), [work.text]);
  const take = work.takes.find((item) => item.id === work.chosenTake);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = take?.seconds || readingSeconds(work.text, work.form);

  useEffect(() => {
    if (!playing || (take && urls[take.id])) return;
    // A demo recording has no sound: the clock runs so the lines still move.
    const timer = window.setInterval(() => setTime((value) => (value + 0.25 >= total ? (setPlaying(false), total) : value + 0.25)), 250);
    return () => window.clearInterval(timer);
  }, [playing, take, urls, total]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = () => {
    const audio = audioRef.current;
    if (audio) {
      if (audio.paused) void audio.play();
      else audio.pause();
      return;
    }
    if (time >= total) setTime(0);
    setPlaying((value) => !value);
  };
  const line = Math.min(lines.length - 1, Math.floor((time / total) * lines.length));

  return createPortal(
    <div className="desk-preview-back" onClick={onClose}>
      <div className="desk-preview" role="dialog" aria-label={`Серия «${work.title}»`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="desk-preview-x" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <div className="desk-phone">
          <div className="desk-phone-art" />
          <div className="desk-phone-lines">
            {lines.slice(Math.max(0, line - 1), line + 2).map((text, index) => (
              <p key={`${line}-${index}`} className={Math.max(0, line - 1) + index === line ? "is-now" : ""}>
                {text}
              </p>
            ))}
          </div>
          <div className="desk-phone-bar">
            <button type="button" onClick={toggle} aria-label={playing ? "Пауза" : "Слушать"}>
              {playing ? "❚❚" : "▶"}
            </button>
            <span className="desk-phone-progress">
              <i style={{ width: `${(time / total) * 100}%` }} />
            </span>
            <span>{duration(time)}</span>
          </div>
          {take && urls[take.id] ? (
            <audio ref={audioRef} src={urls[take.id]} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} />
          ) : null}
        </div>
        <div className="desk-preview-side">
          <h2>{work.title}</h2>
          <p>Ваш голос, рисунки редакции, строки в такт чтению. В прототипе вместо рисунков заглушка.</p>
          <button type="button" className="desk-btn desk-btn-red desk-wide" onClick={onPublish}>
            Опубликовать
          </button>
          <p className="desk-preview-note">Серия сразу появится на вашей странице и в ленте.</p>
          <button type="button" className="desk-quiet is-light" onClick={onFix}>
            Попросить исправить
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SupportSheet({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [kind, setKind] = useState("Вопрос");
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div className="desk-sheet-back" onClick={onClose}>
      <div className="desk-sheet" role="dialog" aria-label="Написать редакции" onClick={(event) => event.stopPropagation()}>
        <div className="desk-sheet-head">
          <h3>Написать редакции</h3>
          <button type="button" className="desk-x" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <p className="desk-calm">Вопросы, неполадки, предложения. Отвечаем в течение дня. Про конкретный текст удобнее писать на его шаге «Серия».</p>
        <div className="desk-msg">
          <small>Редакция · вчера</small>
          <p>Добро пожаловать! Мы перенесли ваши тексты со Стихов.ру и Прозы.ру. Прочитайте их вслух, и мы нарисуем серии.</p>
        </div>
        {sent.map((item, index) => (
          <div key={index} className="desk-msg is-me">
            <p>{item}</p>
          </div>
        ))}
        <div className="desk-chips">
          {["Вопрос", "Что-то не работает", "Предложение"].map((item) => (
            <button key={item} type="button" className={kind === item ? "is-on" : ""} onClick={() => setKind(item)}>
              {item}
            </button>
          ))}
        </div>
        <form
          className="desk-compose"
          onSubmit={(event) => {
            event.preventDefault();
            if (!text.trim()) return;
            setSent([...sent, `${kind}: ${text.trim()}`]);
            setText("");
          }}
        >
          <textarea rows={3} value={text} aria-label="Сообщение" onChange={(event) => setText(event.target.value)} placeholder="Напишите, мы ответим здесь же" />
          <div className="desk-compose-row">
            <span />
            <button type="submit" className="desk-btn desk-btn-ink" disabled={!text.trim()}>
              Отправить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
