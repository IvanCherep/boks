"use client";

import { useState } from "react";
import { canQueue, outcomeCategories, plan, readingSeconds, revisionDays, stageOf, type Outcome, type OutcomeCategory, type Work } from "@/lib/boks/author-desk/workflow";
import { useTakeUrls, type Desk } from "./store";

/**
 * The editors' side of one author's desk (prototype, `/author/desk#studio`).
 *
 * Everything the author does on the way to a Series is visible here: the
 * queue in the author's order with the planned weeks, what is being made,
 * corrections, what waits for the author, what is out, and each work's
 * history and thread. The author's sandbox (thoughts, materials, drafts) is
 * theirs: Studio sees only how many works are in it.
 */
export function StudioDesk({ desk, helpers }: { desk: Desk; helpers: StudioHelpers }) {
  const { making, revising, ready, queue, planned, used, year, weekLabel, when, duration } = helpers;
  const works = desk.state!.works;
  const [open, setOpen] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [deciding, setDeciding] = useState<{ id: string; kind: Outcome["kind"] } | null>(null);
  const [category, setCategory] = useState<OutcomeCategory>("voice");
  const [reason, setReason] = useState("");
  const answered = works.filter((work) => work.outcome && !work.editors.step);
  const decideButtons = (work: Work) => (
    <>
      <button type="button" onClick={() => setDeciding({ id: work.id, kind: "changes" })}>
        На доработку
      </button>
      <button type="button" onClick={() => setDeciding({ id: work.id, kind: "declined" })}>
        Отказать
      </button>
    </>
  );
  const selected = open ? works.find((work) => work.id === open) ?? null : null;
  const noVoice = works.filter((work) => stageOf(work) === "voice" && !work.chosenTake);
  const recorded = works.filter((work) => stageOf(work) === "voice" && canQueue(work).ok);
  const sandbox = works.filter((work) => ["idea", "materials", "text"].includes(stageOf(work)));
  const published = works.filter((work) => work.editors.step === "published").sort((a, b) => (b.editors.publishedAt ?? "").localeCompare(a.editors.publishedAt ?? ""));
  const take = (work: Work) => work.takes.find((item) => item.id === work.chosenTake);

  const card = (work: Work, extra?: React.ReactNode, actions?: React.ReactNode) => (
    <article key={work.id} className={`desk-st-card ${open === work.id ? "is-open" : ""}`}>
      <button type="button" className="desk-st-title serif" onClick={() => setOpen(work.id)}>
        {work.title || "Без названия"}
      </button>
      <span className="desk-st-meta">
        {work.form === "poem" ? "стихи" : "проза"} · голос {duration(take(work)?.seconds ?? 0)}
        {take(work)?.source === "file" ? " · своя запись" : take(work) ? " · суфлёр" : ""}
        {work.editors.notes.some((item) => item.from === "author") ? " · есть пожелание" : ""}
      </span>
      {extra}
      {actions ? <div className="desk-st-actions">{actions}</div> : null}
    </article>
  );

  return (
    <div className="desk-studio">
      <section className="desk-st-head">
        <div>
          <p className="eyebrow">Редакция · автор</p>
          <h1>Анна Тестова</h1>
          <p className="muted">@anna_testova · стандартный тариф · с площадок перенесено 7 текстов</p>
        </div>
        <div className="desk-st-stats">
          <span>
            <b className="serif">
              {used}
              <small>/{plan.perYear}</small>
            </b>
            серий в {year}
          </span>
          <span>
            <b className="serif">{queue.length}</b>в очереди
          </span>
          <span>
            <b className="serif">{noVoice.length}</b>без голоса
          </span>
          <span>
            <b className="serif">{sandbox.length}</b>в мастерской
          </span>
        </div>
      </section>

      <p className="desk-st-rules">
        Одна серия в неделю, {plan.perYear} в год. Автор двигает свободные места, редакция двигает любые и закрепляет. Иллюстрации и сборку делает только
        редакция. Правки до {revisionDays} дней, очередь их не ждёт. Песочница автора (мысли, материалы, черновики) редакции не видна.
      </p>

      <div className="desk-st-board">
        <section className="desk-st-col">
          <h2>
            Очередь автора <small>{queue.length}</small>
          </h2>
          {queue.map((work, index) =>
            card(
              work,
              <span className={`desk-st-week ${work.editors.fixed ? "is-fixed" : ""}`}>
                {work.editors.fixed ? "🔒 " : ""}
                {weekLabel(planned.get(work.id))}
                {planned.get(work.id) && planned.get(work.id)!.getFullYear() > year ? ` · в счёт ${planned.get(work.id)!.getFullYear()}` : ""}
              </span>,
              <>
                <button type="button" aria-label="Раньше" disabled={index === 0} onClick={() => desk.editorsShift(work.id, -1)}>
                  ↑
                </button>
                <button type="button" aria-label="Позже" disabled={index === queue.length - 1} onClick={() => desk.editorsShift(work.id, 1)}>
                  ↓
                </button>
                <button type="button" onClick={() => desk.toggleFixed(work.id)}>
                  {work.editors.fixed ? "Открепить" : "Закрепить"}
                </button>
                <button type="button" className="primary" disabled={making.length > 0} title={making.length ? "На этой неделе серия уже в работе" : undefined} onClick={() => desk.take(work.id)}>
                  Взять в работу
                </button>
                {decideButtons(work)}
              </>
            )
          )}
          {!queue.length ? <p className="desk-st-empty">Очередь пуста.</p> : null}
          {queue.length && making.length ? <p className="desk-st-note">На этой неделе серия уже в работе: следующую можно взять, когда передадите текущую автору.</p> : null}
          {recorded.length ? <p className="desk-st-note">Записаны, но автор ещё не поставил в очередь: {recorded.map((work) => work.title).join(", ")}.</p> : null}
          {noVoice.length ? <p className="desk-st-note">Ждут голоса автора: {noVoice.map((work) => work.title).join(", ")}.</p> : null}
        </section>

        <section className="desk-st-col">
          <h2>
            В работе <small>{making.length + revising.length}</small>
          </h2>
          {making.map((work) =>
            card(
              work,
              <span className="desk-st-week">эта неделя · иллюстрации и сборка</span>,
              <>
                <button type="button" className="primary" onClick={() => desk.handOver(work.id)}>
                  Серия готова, передать автору
                </button>
                {decideButtons(work)}
              </>
            )
          )}
          {revising.map((work) =>
            card(
              work,
              <span className="desk-st-quote">
                Правки: «{[...work.editors.notes].reverse().find((item) => item.from === "author")?.text}»
                <small>до {revisionDays} дней, попросили {when(work.updatedAt)}</small>
              </span>,
              <button type="button" className="primary" onClick={() => desk.handOver(work.id)}>
                Правки внесены, передать автору
              </button>
            )
          )}
          {!making.length && !revising.length ? <p className="desk-st-empty">На этой неделе свободно: возьмите верхнюю работу из очереди.</p> : null}
        </section>

        <section className="desk-st-col">
          <h2>
            У автора <small>{ready.length}</small>
          </h2>
          {ready.map((work) =>
            card(
              work,
              <span className="desk-st-week">ждёт публикации · передали {when(work.updatedAt)}</span>,
              <button type="button" onClick={() => desk.say(work.id, "editors", "Напоминаем: серия готова и ждёт вашей публикации.")}>
                Напомнить
              </button>
            )
          )}
          {answered.map((work) =>
            card(
              work,
              <span className="desk-st-quote">
                {work.outcome!.kind === "changes" ? "На доработке" : "Отказано"} · {categoryLabels[work.outcome!.category]}: «{work.outcome!.reason}»
              </span>
            )
          )}
          {!ready.length && !answered.length ? <p className="desk-st-empty">Ничего не ждёт автора.</p> : null}
        </section>

        <section className="desk-st-col">
          <h2>
            Опубликовано <small>{published.length}</small>
          </h2>
          {published.map((work) => card(work, <span className="desk-st-week">{work.editors.publishedAt ? when(work.editors.publishedAt) : ""}</span>))}
        </section>
      </div>

      {selected ? (
        <div className="desk-sheet-back" onClick={() => setOpen(null)}>
          <div className="desk-sheet desk-st-sheet" role="dialog" aria-label={selected.title} onClick={(event) => event.stopPropagation()}>
            <div className="row between">
              <h3>{selected.title || "Без названия"}</h3>
              <button type="button" className="desk-x" onClick={() => setOpen(null)} aria-label="Закрыть">
                ×
              </button>
            </div>
            <p className="muted">
              {selected.form === "poem" ? "Стихи" : "Проза"} · около {Math.max(1, Math.round(readingSeconds(selected.text, selected.form) / 60))} мин · голос{" "}
              {take(selected) ? `${duration(take(selected)!.seconds)}, ${take(selected)!.source === "file" ? `своя запись ${take(selected)!.name ?? ""}` : "суфлёр"}` : "не записан"}
              {selected.importedFrom ? ` · с площадки ${selected.importedFrom}` : ""}
            </p>
            <TakePlayer work={selected} />
            <div className="desk-st-text">{selected.text}</div>
            <p className="desk-field-label">Переписка с автором</p>
            <div className="desk-thread-list">
              {selected.editors.notes.length === 0 ? <p className="muted">Пока ничего.</p> : null}
              {selected.editors.notes.map((item, index) => (
                <div key={index} className={`desk-turn ${item.from === "author" ? "author" : "editors"}`}>
                  <small>
                    {item.from === "author" ? "Автор" : "Редакция"} · {when(item.at)}
                  </small>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
            <form
              className="desk-chat-input"
              onSubmit={(event) => {
                event.preventDefault();
                if (!reply.trim()) return;
                desk.say(selected.id, "editors", reply.trim());
                setReply("");
              }}
            >
              <textarea rows={2} value={reply} placeholder="Ответ автору" onChange={(event) => setReply(event.target.value)} />
              <button type="submit" className="desk-btn desk-btn-ink" disabled={!reply.trim()}>
                Ответить
              </button>
            </form>
            {selected.history?.length ? (
              <>
                <p className="desk-field-label">История</p>
                <ol className="desk-st-history">
                  {[...selected.history].reverse().map((entry, index) => (
                    <li key={index} className={entry.who}>
                      <span>{entry.who === "author" ? "Автор" : "Редакция"}</span> {entry.what} <small>{when(entry.at)}</small>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {deciding ? (
        <div className="desk-sheet-back" onClick={() => setDeciding(null)}>
          <div className="desk-sheet desk-st-decide" role="dialog" aria-label={deciding.kind === "changes" ? "Вернуть на доработку" : "Отказать"} onClick={(event) => event.stopPropagation()}>
            <div className="desk-sheet-head">
              <h3>{deciding.kind === "changes" ? "Вернуть на доработку" : "Отказать"}</h3>
              <button type="button" className="desk-x" onClick={() => setDeciding(null)} aria-label="Закрыть">
                ×
              </button>
            </div>
            <p className="desk-calm">
              «{works.find((work) => work.id === deciding.id)?.title}». Автор прочитает причину дословно, напишите её спокойно и конкретно
              {deciding.kind === "changes" ? ": что именно исправить." : "."}
            </p>
            <span className="desk-label">Причина</span>
            <div className="desk-chips">
              {outcomeCategories.map((item) => (
                <button key={item} type="button" className={category === item ? "is-on" : ""} onClick={() => setCategory(item)}>
                  {categoryLabels[item]}
                </button>
              ))}
            </div>
            <textarea
              rows={5}
              value={reason}
              aria-label="Объяснение для автора"
              placeholder={deciding.kind === "changes" ? "Например: на 1:20 сильный шум улицы, запишите, пожалуйста, в тихой комнате." : "Например: текст содержит призывы, которые запрещает закон о…"}
              onChange={(event) => setReason(event.target.value)}
            />
            <button
              type="button"
              className={`desk-btn ${deciding.kind === "changes" ? "desk-btn-ink" : "desk-btn-red"}`}
              disabled={reason.trim().length < 10}
              onClick={() => {
                desk.decide(deciding.id, deciding.kind, category, reason.trim());
                setDeciding(null);
                setReason("");
              }}
            >
              {deciding.kind === "changes" ? "Вернуть автору" : "Отказать с этой причиной"}
            </button>
            {reason.trim().length < 10 ? <p className="desk-calm">Без понятной причины вернуть или отказать нельзя.</p> : null}
          </div>
        </div>
      ) : null}

      <footer className="desk-st-demo">
        <span>Демо:</span>
        <button type="button" onClick={desk.passWeek}>
          прошла неделя →
        </button>
        <a href="#">к столу автора</a>
      </footer>
    </div>
  );
}

/** The chosen take, for the editors to hear before they start. */
function TakePlayer({ work }: { work: Work }) {
  const urls = useTakeUrls(work);
  const url = work.chosenTake ? urls[work.chosenTake] : undefined;
  if (!work.chosenTake) return <p className="desk-st-note">Голос ещё не записан.</p>;
  return url ? <audio className="desk-st-audio" controls src={url} preload="none" /> : <p className="desk-st-note">Запись из демо, без звука.</p>;
}

const categoryLabels: Record<OutcomeCategory, string> = { voice: "Запись", text: "Текст", law: "Законодательство", other: "Другое" };

export type StudioHelpers = {
  making: Work[];
  revising: Work[];
  ready: Work[];
  queue: Work[];
  planned: Map<string, Date>;
  used: number;
  year: number;
  weekLabel: (date: Date | undefined) => string;
  when: (iso: string) => string;
  duration: (seconds: number) => string;
};
