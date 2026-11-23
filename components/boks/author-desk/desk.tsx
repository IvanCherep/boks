"use client";

import "@/app/author-desk.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  blankWork,
  canQueue,
  isStale,
  textMinimum,
  materialKinds,
  newId,
  pinsByPart,
  plan,
  plannedWeeks,
  readingSeconds,
  resendCheck,
  revisionDays,
  stageOf,
  stages,
  withHistory,
  type Material,
  type MaterialKind,
  type OutcomeCategory,
  type Stage,
  type Work,
} from "@/lib/boks/author-desk/workflow";
import { maxBokCharacters } from "@/lib/boks/contracts";
import { durationProblem, fileProblem, useDesk, useTakes, type Desk, type DeskStatus } from "./store";
import { Teleprompter } from "./teleprompter";
import { ShareBlock, shareMarker, useShareLinks } from "./share-links";
import { chooseTake, uploadTake } from "@/components/boks/author-cabinet/voice-data";
import { loadMyAuthorSpace, markMyMessagesSeen, sendMyMessage, type SpaceMessage } from "@/components/boks/author-spaces/data";
import { voiceFingerprint } from "@/lib/boks/author/voice/rules";

/*
 * The workshop's words, in one place. Plain Russian, the same word for the
 * same thing everywhere: «текст», «запись», «серия», «очередь», «бок».
 */
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
  const used = desk.state?.plan.usedThisYear ?? 0;
  const usedByYear: Record<number, number> = { [year]: used };
  const perYear = desk.state?.plan.perYear ?? plan.perYear;
  const planned = plannedWeeks({ queue, busyThisWeek: making.length, today: new Date(), usedByYear, perYear });
  const byId = new Map(works.map((work) => [work.id, work]));
  return {
    making,
    revising,
    ready,
    queue: queue.map((id) => byId.get(id)).filter((work): work is Work => !!work),
    planned,
    used,
    perYear,
    year,
    planFor: (ids: string[]) => plannedWeeks({ queue: ids, busyThisWeek: making.length, today: new Date(), usedByYear, perYear }),
  };
}

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
  if (stageOf(work) === "voice") {
    const chosen = work.takes.find((take) => take.id === work.chosenTake);
    if (chosen && isStale(chosen, work.text)) return "Текст изменился после записи. Запишите заново";
    return chosen ? "Запись есть. Можно отдать редакции" : "Ждёт вашего голоса";
  }
  return work.text.trim() ? "Черновик" : "Новый текст";
}

export function AuthorDesk() {
  const desk = useDesk();
  const [route, setRoute] = useState<Route>({ work: null });
  const [support, setSupport] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [unread, setUnread] = useState(0);
  // The editors' unread messages, checked with each load of the Workshop.
  const loads = desk.loads;
  useEffect(() => {
    if (!loads || support) return;
    let alive = true;
    loadMyAuthorSpace()
      .then((page) => {
        if (alive) setUnread(page.unread ?? 0);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [loads, support]);
  useEffect(() => {
    const sync = () => {
      setRoute(readRoute());
      // A link away closes whatever was open over the page.
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

  if (desk.status !== "ready" || !desk.state) return <DeskGate status={desk.status} problem={desk.problem} onRetry={() => void desk.refresh()} />;
  const work = route.work ? desk.state.works.find((item) => item.id === route.work) : null;

  return (
    <main className="acab desk">
      <header className="desk-top">
        <a href="#" className="desk-brand" onClick={(event) => (event.preventDefault(), go(""))}>
          boks <span>Мастерская</span>
        </a>
        <nav className="desk-top-links">
          <a href="/author#my-page">Моя страница</a>
          <button type="button" onClick={() => setSupport(true)}>
            Написать редакции{unread ? <b className="desk-badge">{unread}</b> : null}
          </button>
        </nav>
      </header>
      {desk.problem ? (
        <div className="desk-problem" role="alert">
          <span>{desk.problem}</span>
          <button type="button" className="desk-x" aria-label="Закрыть" onClick={desk.clearProblem}>
            ×
          </button>
        </div>
      ) : null}
      {route.work && !work ? (
        <div className="desk-work">
          <div className="desk-empty">
            <h3>Такого текста нет</h3>
            <p>Возможно, он удалён или ссылка устарела.</p>
            <a className="desk-btn desk-btn-ink" href="#" onClick={(event) => (event.preventDefault(), go(""))}>
              В мастерскую
            </a>
          </div>
        </div>
      ) : work && route.work ? (
        <WorkScreen key={work.id} work={work} step={(route as { step: Stage }).step} go={go} desk={desk} />
      ) : (
        <Home desk={desk} go={go} onHelp={() => setWelcome(true)} />
      )}
      {support ? (
        <SupportSheet
          desk={desk}
          onClose={() => {
            setSupport(false);
            setUnread(0);
          }}
        />
      ) : null}
      {welcome ? (
        <Welcome
          perYear={desk.state.plan.perYear}
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
    </main>
  );
}

/** Before the Workshop can open: loading, signed out, not one of the invited authors, or a failure. */
function DeskGate({ status, problem, onRetry }: { status: DeskStatus; problem: string; onRetry: () => void }) {
  return (
    <main className="acab desk">
      <header className="desk-top">
        <a href="/author" className="desk-brand">
          boks <span>Мастерская</span>
        </a>
      </header>
      <div className="desk-home">
        {status === "loading" ? (
          <div className="desk-loading" aria-busy="true" aria-label="Загружаем мастерскую">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <div className="desk-empty">
            {status === "signed-out" ? (
              <>
                <h3>Войдите, чтобы открыть мастерскую</h3>
                <p>Мастерская открывается из кабинета автора.</p>
                <a className="desk-btn desk-btn-red" href="/author">
                  Войти
                </a>
              </>
            ) : status === "not-author" ? (
              <>
                <h3>Мастерская открыта авторам boks</h3>
                <p>Её получают авторы, которых пригласила редакция. Если вас пригласили, войдите той почтой, на которую пришло приглашение.</p>
                <a className="desk-btn desk-btn-ink" href="/author">
                  В кабинет
                </a>
              </>
            ) : (
              <>
                <h3>Не получилось открыть мастерскую</h3>
                <p>{problem || "Проверьте интернет и попробуйте ещё раз."}</p>
                <button type="button" className="desk-btn desk-btn-red" onClick={onRetry}>
                  Попробовать ещё раз
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                               */
/* ------------------------------------------------------------------ */

function Home({ desk, go, onHelp }: { desk: Desk; go: (hash: string) => void; onHelp: () => void }) {
  const works = desk.state!.works;
  const { ready } = useQueue(desk);
  const [adding, setAdding] = useState(false);
  const [row, setRow] = useState<Work[] | null>(null);
  // «Новый бок» on My page lands here with the sheet open.
  useEffect(() => {
    if (window.location.hash !== "#add") return;
    const timer = window.setTimeout(() => {
      setAdding(true);
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const hour = new Date().getHours();
  const greeting = hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const active = works.filter((work) => !work.shelved || work.editors.step);
  const shelved = works.filter((work) => work.shelved && !work.editors.step).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // A refusal asks nothing of the author: it waits a week in «Ждёт вас», then rests with the drafts.
  const [weekAgo] = useState(() => new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());
  const oldRefusal = (work: Work) => work.outcome?.kind === "declined" && (work.outcome.at ?? "") < weekAgo;
  const answered = active.filter((work) => work.outcome && !work.editors.step && !oldRefusal(work));
  const needVoice = active.filter((work) => stageOf(work) === "voice" && !work.chosenTake && !work.outcome);
  const recorded = active.filter((work) => stageOf(work) === "voice" && work.chosenTake && !work.outcome);
  const drafts = active.filter((work) => (stageOf(work) === "text" && !(work.outcome && !oldRefusal(work))) || oldRefusal(work)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shelve = (work: Work) => desk.update(work.id, (current) => ({ ...current, shelved: true }));
  const authorName = (desk.state!.author.name ?? "").trim().split(/\s+/)[0] || "";
  const teamReady = desk.state!.ready;
  const published = works.filter((work) => work.editors.step === "published").sort((a, b) => (b.editors.publishedAt ?? "").localeCompare(a.editors.publishedAt ?? ""));
  const shares = useShareLinks(published.length > 0);
  const replies = works.filter((work) => work.editors.notes.at(-1)?.from === "editors" && work.editors.step !== "published" && work.editors.step !== "approval" && !work.outcome);
  const hasWaiting = ready.length || needVoice.length || recorded.length || replies.length || answered.length || teamReady.length;

  const startDraft = async () => {
    try {
      const created = await desk.add(blankWork(""));
      go(`w/${created.id}/text`);
    } catch {
      /* said in the strip */
    }
  };

  return (
    <div className="desk-home">
      {adding ? (
        <AddTextSheet
          onClose={() => setAdding(false)}
          onCreate={async (work, later) => {
            try {
              const created = await desk.add(later ? { ...work, shelved: true } : work);
              setAdding(false);
              if (!later) go(`w/${created.id}/voice`);
            } catch {
              // The sheet stays open with the text; the strip above says what went wrong.
            }
          }}
        />
      ) : null}
      {row ? <RecordRow works={row} desk={desk} onClose={() => setRow(null)} /> : null}

      <section className="desk-hero">
        <h1>
          {greeting}
          {authorName ? `, ${authorName}` : ""}
        </h1>
        <div className="desk-hero-actions">
          <button type="button" className="desk-btn desk-btn-red" onClick={() => setAdding(true)}>
            Добавить текст
          </button>
          <button type="button" className="desk-quiet" onClick={() => void startDraft()}>
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
                  <a className="desk-btn desk-btn-red" href={`#w/${work.id}/editors`}>
                    Посмотреть
                  </a>
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

            {teamReady.map((item) => (
              <a key={item.workId} href="/author#my-page" className="desk-nudge">
                <span>
                  Редакция подготовила <b>«{item.title}»</b> для вашей страницы
                </span>
                <span className="desk-nudge-go">Посмотреть</span>
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
                <span className="desk-book-meta">
                  {work.outcome?.kind === "declined" ? "Редакция не взяла · " : ""}
                  {when(work.updatedAt)}
                </span>
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
                {shareMarker(shares.series?.find((item) => item.bokId === work.id)) ? (
                  <span className="desk-book-meta desk-share-mark">{shareMarker(shares.series?.find((item) => item.bokId === work.id))}</span>
                ) : null}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="desk-footer">
        <button type="button" onClick={onHelp}>
          Как это устроено
        </button>

      </footer>
    </div>
  );
}

/* The queue ---------------------------------------------------------- */

function QueueBlock({ desk, onHelp }: { desk: Desk; onHelp: () => void }) {
  const { making, revising, queue, planned, used, perYear } = useQueue(desk);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const left = Math.max(0, perYear - used);
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
            <a href={`#w/${work.id}/editors`} className="desk-q-title" title={work.title}>
              {work.title || "Без названия"}
            </a>
            <span className="desk-q-when">Редакция работает</span>
            <span className="desk-q-moves" />
          </li>
        ))}
        {revising.map((work) => (
          <li key={work.id} className="desk-q is-now">
            <span className="desk-q-n" aria-hidden>
              ✎
            </span>
            <a href={`#w/${work.id}/editors`} className="desk-q-title" title={work.title}>
              {work.title || "Без названия"}
            </a>
            <span className="desk-q-when">Исправляем по вашей просьбе</span>
            <span className="desk-q-moves" />
          </li>
        ))}
        {queue.map((work, index) => (
          <li
            key={work.id}
            className={`desk-q ${dragging === work.id ? "is-dragging" : ""} ${over === index && dragging !== work.id ? "is-over" : ""}`}
            draggable
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
            <a href={`#w/${work.id}/editors`} className="desk-q-title" title={work.title}>
              {work.title || "Без названия"}
            </a>
            <span className="desk-q-when">{weekLabel(planned.get(work.id))}</span>
            <span className="desk-q-moves">
              <button type="button" aria-label="Раньше" title="Раньше" disabled={index === 0} onClick={() => desk.shift(work.id, -1)}>
                ↑
              </button>
              <button type="button" aria-label="Позже" title="Позже" disabled={index === queue.length - 1} onClick={() => desk.shift(work.id, 1)}>
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <p className="desk-queue-foot">
        В этом году ещё {left} {seriesWord(left)}.{" "}
        <Hint text="Сроки примерные: редакция берёт тексты по порядку, но иногда работа над серией занимает больше недели." />
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One text                                                           */
/* ------------------------------------------------------------------ */

type Update = (change: (work: Work) => Work) => void;

function WorkScreen({ work, step, go, desk }: { work: Work; step: Stage; go: (hash: string) => void; desk: Desk }) {
  const reached = stages.indexOf(stageOf(work));
  const update: Update = (change) => desk.update(work.id, change);
  const status = useStatus(work, desk);
  const out = work.editors.step === "published";
  return (
    <div className="desk-work">
      <a href="#" className="desk-back" onClick={(event) => (event.preventDefault(), go(""))}>
        ← Мастерская
      </a>
      <TitleField
        value={work.title}
        // With the editors or published, the title is fixed like the text: saving it would take the bok back to drafts.
        readOnly={Boolean(work.editors.step && work.editors.step !== "queued")}
        onChange={(title) => update((current) => ({ ...current, title }))}
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
        {!work.editors.step && !work.outcome ? (
          <button
            type="button"
            className="desk-quiet"
            onClick={() => {
              if (!window.confirm(`Удалить черновик «${work.title || "Без названия"}»? Текст и записи удалятся, вернуть их будет нельзя.`)) return;
              go("");
              void desk.removeDraft(work.id);
            }}
          >
            Удалить
          </button>
        ) : null}
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
      {step === "editors" ? <SeriesStep work={work} desk={desk} go={go} /> : null}
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
          <button type="button" className="desk-btn desk-btn-red" disabled={work.text.trim().length < textMinimum || seconds > 15 * 60} onClick={() => go(`w/${work.id}/voice`)}>
            Дальше: прочитать вслух
          </button>
        </div>
        
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
  const [fileNote, setFileNote] = useState("");
  const voice = useTakes(desk, work);
  const seconds = readingSeconds(work.text, work.form);
  const locked = work.editors.step && work.editors.step !== "queued";
  const sent = work.editors.step === "queued";
  const { queue, planFor } = useQueue(desk);
  const landing = planFor([...queue.map((item) => item.id).filter((id) => id !== work.id), work.id]).get(work.id);
  const chosen = work.takes.find((take) => take.id === work.chosenTake);
  const chosenStale = chosen ? isStale(chosen, work.text) : false;
  const busy = Boolean(desk.busy[work.id]);
  const takes = voice.takes?.takes ?? [];

  const attach = (file: File) => {
    const problem = fileProblem(file);
    if (problem) {
      setFileNote(problem);
      return;
    }
    setFileNote("");
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      const late = durationProblem(ms);
      if (late) return setFileNote(late);
      void voice.add(file, Math.round(ms / 1000), "upload", file.name);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      setFileNote("Браузер не смог прочитать этот файл. Сохраните запись в mp3 или m4a и загрузите снова.");
    };
    audio.src = url;
  };

  if (work.text.trim().length < textMinimum) {
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
            <h2 className="desk-h2">{takes.length ? "Ваши записи" : "Прочитайте вслух"}</h2>
            <p className="desk-lead">
              {sent
                ? "Текст уже у редакции. Новая запись заменит отправленную, пока редакция не взяла текст в работу."
                : "Можно записать здесь или загрузить готовую запись. Пробовать можно сколько угодно раз."}
            </p>
            <div className="desk-ways">
              <button type="button" className="desk-way is-main" disabled={!!voice.uploading} onClick={() => setRecording(true)}>
                <span className="desk-way-icon" aria-hidden>
                  <i />
                </span>
                <b>{takes.length ? "Записать ещё раз" : "Записать с суфлёром"}</b>
                <small>Текст сам идёт по экрану в темпе чтения. Около {Math.max(1, Math.round(seconds / 60))} мин.</small>
              </button>
              <label className={`desk-way ${voice.uploading ? "is-off" : ""}`}>
                <span className="desk-way-icon" aria-hidden>
                  ↑
                </span>
                <b>Загрузить готовую запись</b>
                <small>Например, из студии. Файлы mp3, m4a, wav, до 15 минут и 25 МБ.</small>
                <input
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg,.webm"
                  hidden
                  disabled={!!voice.uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) attach(file);
                    // The same file chosen again still counts as a new recording.
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            {fileNote ? (
              <p className="desk-file-note" role="alert">
                {fileNote}
              </p>
            ) : null}
          </>
        )}

        {voice.uploading ? (
          <p className="desk-uploading" role="status">
            <i className="desk-pulse" /> Загружаем запись… Не закрывайте страницу.
          </p>
        ) : null}
        {voice.loading ? <p className="desk-calm">Загружаем ваши записи…</p> : null}

        {takes.length ? (
          <ul className="desk-takes">
            {takes.map((take, index) => {
              const on = voice.takes?.chosen === take.file;
              const stale = work.takes.find((item) => item.id === take.file);
              return (
                <li key={take.file} className={`desk-take ${on ? "is-on" : ""}`}>
                  <Player url={voice.urls[take.file]} seconds={Math.round(take.durationMs / 1000)} />
                  <div className="desk-take-info">
                    <b>Запись {index + 1}</b>
                    <small title={take.name ?? undefined}>
                      {take.source === "upload" ? take.name || "загружена" : "суфлёр"} · {when(take.createdAt)}
                    </small>
                    {stale && isStale(stale, work.text) ? <small className="desk-stale">записана до правки текста</small> : null}
                  </div>
                  {on ? (
                    <span className="desk-take-chosen">Пойдёт в серию</span>
                  ) : locked ? (
                    <span />
                  ) : (
                    <button type="button" className="desk-quiet" onClick={() => void voice.choose(take.file)}>
                      Выбрать
                    </button>
                  )}
                  {locked ? null : (
                    <button
                      type="button"
                      className="desk-x"
                      aria-label={`Удалить запись ${index + 1}`}
                      onClick={() => window.confirm(`Удалить запись ${index + 1}?`) && void voice.remove(take.file)}
                    >
                      ×
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {chosenStale && !locked ? (
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
              disabled={busy || !!voice.uploading}
              onClick={async () => {
                await desk.enqueue(work.id);
                go(`w/${work.id}/editors`);
              }}
            >
              {busy ? "Отправляем…" : "Отдать в работу"}
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
            const late = durationProblem(takeSeconds * 1000);
            if (late) return setFileNote(late);
            void voice.add(blob, takeSeconds, "teleprompter");
          }}
        />
      ) : null}
    </div>
  );
}

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

function SeriesStep({ work, desk, go }: { work: Work; desk: Desk; go: (hash: string) => void }) {
  const busy = Boolean(desk.busy[work.id]);
  const seriesPiece = desk.state?.series[work.id]?.seriesPiece ?? null;
  const pageOpen = desk.state?.author.pageStatus === "published";
  const [message, setMessage] = useState("");
  const [fixing, setFixing] = useState(false);
  const check = canQueue(work);
  const step = work.editors.step;
  const shares = useShareLinks(step === "published");
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
            <button type="button" className="desk-btn desk-btn-red" disabled={!resend.ok || busy} onClick={() => void desk.enqueue(work.id)}>
              {busy ? "Отправляем…" : "Отправить снова"}
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
          <button type="button" className="desk-btn desk-btn-red" disabled={busy} onClick={() => void desk.enqueue(work.id)}>
            {busy ? "Отправляем…" : "Отдать в работу"}
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
            Редакция начнёт {weekLabel(planned.get(work.id))}. Пока она не взяла текст в работу, порядок можно менять, а текст можно отозвать.
          </p>
          <div className="desk-state-actions">
            <button type="button" className="desk-btn desk-btn-ink" onClick={toQueue}>
              Поменять порядок
            </button>
            <button
              type="button"
              className="desk-quiet"
              disabled={busy}
              onClick={() => window.confirm("Отозвать из редакции? Текст и запись останутся у вас, в черновиках.") && void desk.dequeue(work.id)}
            >
              {busy ? "Отзываем…" : "Отозвать"}
            </button>
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
          <h3>{work.editors.revising ? "Редакция исправляет серию" : "В работе у редакции"}</h3>
          <p>
            {work.editors.revising
              ? `Обычно до ${revisionDays} дней. Когда закончим, серия появится в «Ждёт вас».`
              : "Редакция готовит Boks Series: рисунки, сборку, строки в такт вашему голосу. Вернём её вам, когда закончим. Пока текст и запись закреплены."}
          </p>
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
            {seriesPiece ? (
              <a className="desk-btn desk-btn-ink" href={`/l/${seriesPiece}`} target="_blank" rel="noreferrer">
                Посмотреть серию
              </a>
            ) : null}
            <button
              type="button"
              className="desk-btn desk-btn-red"
              disabled={busy}
              onClick={() =>
                window.confirm(pageOpen ? "Опубликовать серию? Она появится на вашей странице и в ленте." : "Опубликовать серию? Ваша страница откроется читателям вместе с ней.") &&
                void desk.approve(work.id)
              }
            >
              {busy ? "Публикуем…" : "Опубликовать"}
            </button>
            <button type="button" id="desk-ask-fix" className="desk-quiet" onClick={askFix}>
              Попросить исправить
            </button>
          </div>
          {!pageOpen ? <p className="desk-calm">Ваша страница пока закрыта: она откроется читателям вместе с первой серией.</p> : null}
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
          <ShareBlock bokId={work.id} shares={shares} />
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
              void desk.requestFix(work.id, message.trim());
              setFixing(false);
            } else void desk.say(work.id, "author", message.trim());
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

async function storeTake(desk: Desk, work: Work, blob: Blob, seconds: number) {
  // Reading in a row has no Голос step open: the recording goes straight up.
  try {
    await desk.flush(work.id);
    const fingerprint = await voiceFingerprint(desk.state?.works.find((item) => item.id === work.id)?.text ?? work.text);
    const before = new Set(work.takes.map((take) => take.id));
    let takes = await uploadTake(work.id, blob, { durationMs: seconds * 1000, source: "teleprompter", name: null, fingerprint });
    const added = [...takes.takes].filter((take) => !before.has(take.file)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (added && takes.chosen !== added.file) takes = await chooseTake(work.id, added.file);
    await desk.voiceChanged(work.id, takes);
  } catch (error) {
    desk.fail(error, `«${work.title || "Без названия"}»: запись не загрузилась. Запишите этот текст ещё раз.`);
    throw error;
  }
}

/** The title: one line to type, wrapping when it is long; Enter leaves it, no line breaks. */
function TitleField({ value, onChange, readOnly }: { value: string; onChange: (value: string) => void; readOnly?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = ref.current;
    if (!field) return;
    const fit = () => {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="desk-title"
      rows={1}
      readOnly={readOnly}
      value={value}
      placeholder="Название"
      maxLength={120}
      aria-label="Название"
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onChange={(event) => onChange(event.target.value.replace(/\s*\n+\s*/g, " "))}
    />
  );
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

function Welcome({ onClose, perYear }: { onClose: () => void; perYear: number }) {
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
              Редакция рисует серии в вашем порядке, не чаще одной в неделю, до {perYear} в год. Готовую серию вы смотрите и публикуете сами. Если что-то нужно доработать
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
function AddTextSheet({ onClose, onCreate }: { onClose: () => void; onCreate: (work: Work, later?: boolean) => Promise<void> }) {
  useEscape(onClose);
  const [title, setTitle] = useState("");
  const [form, setForm] = useState<Work["form"]>("poem");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const seconds = readingSeconds(text, form);
  const create = async (later: boolean) => {
    if (saving) return;
    const work = blankWork(title.trim());
    work.form = form;
    work.text = text.trim();
    setSaving(true);
    try {
      await onCreate(work, later);
    } finally {
      setSaving(false);
    }
  };
  const reason = !text.trim()
    ? ""
    : text.trim().length > maxBokCharacters
      ? `Текст длиннее ${maxBokCharacters.toLocaleString("ru-RU")} знаков: бок столько не вмещает.`
      : seconds > 15 * 60 ? "Длиннее 15 минут чтения: бок столько не вмещает." : "";
  return (
    <div className="desk-sheet-back" onClick={onClose}>
      <div className="desk-sheet" role="dialog" aria-label="Добавить текст" onClick={(event) => event.stopPropagation()}>
        <div className="desk-sheet-head">
          <h3>Добавить текст</h3>
          <button type="button" className="desk-x" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <input className="desk-sheet-title" value={title} placeholder="Название" maxLength={120} aria-label="Название" onChange={(event) => setTitle(event.target.value)} />
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
          disabled={!!reason || !text.trim() || saving}
          onClick={() => void create(false)}
        >
          {saving ? "Сохраняем…" : "Дальше: прочитать вслух"}
        </button>
        <button
          type="button"
          className="desk-quiet desk-center"
          disabled={!text.trim() || saving || text.trim().length > maxBokCharacters}
          onClick={() => void create(true)}
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
          void storeTake(desk, work, blob, seconds).catch(() =>
            setRecorded((current) => {
              const next = { ...current };
              delete next[work.id];
              return next;
            })
          );
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

function SupportSheet({ desk, onClose }: { desk: Desk; onClose: () => void }) {
  useEscape(onClose);
  const [kind, setKind] = useState("Вопрос");
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<SpaceMessage[] | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let alive = true;
    loadMyAuthorSpace()
      .then((page) => {
        if (!alive) return;
        setMessages(page.messages ?? []);
        if (page.unread) void markMyMessagesSeen().catch(() => undefined);
      })
      .catch(() => {
        if (alive) setMessages([]);
      });
    return () => {
      alive = false;
    };
  }, []);
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const page = await sendMyMessage(`${kind}: ${body}`);
      setMessages(page.messages ?? []);
      setText("");
    } catch (error) {
      desk.fail(error, "Сообщение не ушло. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };
  const shown = [...(messages ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-40);
  return (
    <div className="desk-sheet-back" onClick={onClose}>
      <div className="desk-sheet" role="dialog" aria-label="Написать редакции" onClick={(event) => event.stopPropagation()}>
        <div className="desk-sheet-head">
          <h3>Написать редакции</h3>
          <button type="button" className="desk-x" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </div>
        <p className="desk-calm">Вопросы, неполадки, предложения. Отвечаем в течение дня, ответ появится здесь же.</p>
        {messages === null ? <p className="desk-calm">Загружаем переписку…</p> : null}
        {messages?.length === 0 ? <p className="desk-calm">Пока сообщений нет.</p> : null}
        <div className="desk-thread-list">
          {shown.map((item) => (
            <div key={item.id} className={`desk-msg ${item.fromAuthor ? "is-me" : ""}`}>
              <small>
                {item.fromAuthor ? "Вы" : "Редакция"} · {when(item.createdAt)}
                {item.workTitle ? ` · «${item.workTitle}»` : ""}
              </small>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
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
            void send();
          }}
        >
          <textarea rows={3} value={text} maxLength={4000} aria-label="Сообщение" onChange={(event) => setText(event.target.value)} placeholder="Напишите, мы ответим здесь же" />
          <div className="desk-compose-row">
            <span className="desk-calm">{text.length > 3500 ? `${text.length} из 4000` : ""}</span>
            <button type="submit" className="desk-btn desk-btn-ink" disabled={!text.trim() || sending}>
              {sending ? "Отправляем…" : "Отправить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
