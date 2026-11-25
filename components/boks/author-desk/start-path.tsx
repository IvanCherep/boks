"use client";

import { useState } from "react";
import { canQueue, type Work } from "@/lib/boks/author-desk/workflow";
import { daysToPay, ruDate, type AuthorAgreement } from "@/lib/boks/author/agreement";
import type { Desk } from "./store";

/*
 * «Как откроется ваша страница»: while the page is still closed, the way from
 * the first texts to the open page, one line a step, the current one marked
 * (the letter to new authors, "Как вы появитесь на платформе"). A paid author
 * has the payment among the steps; our authors do not.
 */

type Step = { key: string; title: string; status: string; short?: string; done: boolean; action?: { label: string; run: () => void } };

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const textsWord = (n: number) => `${n} ${plural(n, "текст", "текста", "текстов")}`;
const seriesWord = (n: number) => `${n} ${plural(n, "серия", "серии", "серий")}`;
/** «делает 1 серию / 3 серии / 5 серий». */
/** «с 1 серией / с 3 сериями». */
const withSeries = (n: number) => `${n} ${plural(n, "серией", "сериями", "сериями")}`;
const seriesAcc = (n: number) => `${n} ${plural(n, "серию", "серии", "серий")}`;

const voiced = (work: Work) => {
  const check = canQueue(work);
  return check.ok || !check.missing.some((m) => m === "voice" || m === "stale");
};

export function StartPath({ desk, agreement, onPay }: { desk: Desk; agreement: AuthorAgreement | null; onPay: () => void }) {
  const state = desk.state;
  if (!state || state.author.pageStatus === "published") return null;
  const paid = state.author.billing === "paid";
  const works = state.works.filter((work) => !work.shelved || work.editors.step);
  const withEditors = works.filter((work) => work.editors.step && work.editors.step !== "published");
  // A piece the editors declined is not waiting to be given: it never holds the way back.
  const atHome = works.filter((work) => !work.editors.step && work.text.trim() && work.outcome?.kind !== "declined");
  const recorded = atHome.filter(voiced);
  const sendable = atHome.filter((work) => canQueue(work).ok);
  const inWork = works.filter((work) => work.editors.step === "production");
  const ready = works.filter((work) => work.editors.step === "approval");
  const all = withEditors.length + atHome.length;
  const payState = agreement?.payState ?? null;
  const unpaid = paid && (payState === "awaiting" || payState === "reported");

  const steps: Step[] = [
    {
      key: "texts",
      title: "Тексты",
      done: all > 0,
      short: all > 0 ? textsWord(all) : undefined,
      status: all > 0 ? `В кабинете ${textsWord(all)}. Можно добавить ещё.` : "Добавьте тексты, с которых хотите начать.",
    },
    {
      key: "voice",
      title: "Голос",
      done: all > 0 && atHome.length === recorded.length,
      short: all > 0 ? `записано ${recorded.length + withEditors.length} из ${all}` : undefined,
      action: atHome.find((work) => !voiced(work))
        ? { label: "Прочитать", run: () => window.location.assign(`#w/${atHome.find((work) => !voiced(work))!.id}/voice`) }
        : undefined,
      status: !all
        ? "Каждый текст выходит в вашем чтении: с суфлёром или готовой записью."
        : atHome.length === recorded.length
          ? "Все тексты записаны."
          : recorded.length + withEditors.length === 0
            ? `Прочитайте ${all > 1 ? "тексты" : "текст"} с суфлёром или загрузите готовую запись: ${all > 1 ? "каждый выходит" : "он выйдет"} в вашем чтении.`
            : `Записано ${recorded.length + withEditors.length} из ${all}. Остальные прочитайте с суфлёром или загрузите запись.`,
    },
    {
      key: "send",
      title: "Отдать редакции",
      done: withEditors.length > 0 && sendable.length === 0,
      short: withEditors.length ? `отдано ${withEditors.length}` : paid ? "до 5 текстов для начала" : undefined,
      action: sendable.length
        ? {
            label: sendable.length > 1 ? `Отдать все записанные (${sendable.length})` : "Отдать редакции",
            run: () => void (async () => { for (const work of sendable) await desk.enqueue(work.id); })(),
          }
        : undefined,
      status: withEditors.length
        ? `Отдано ${textsWord(withEditors.length)}.${sendable.length ? ` Ещё ${sendable.length} ${plural(sendable.length, "записан, но не отдан", "записаны, но не отданы", "записаны, но не отданы")}.` : ""}`
        : paid
          ? "Для начала отдайте до 5 текстов: из них редакция сделает первые серии."
          : "Отдайте тексты, с которых хотите начать: редакция сделает из них серии.",
    },
  ];
  if (paid) {
    steps.push({
      key: "pay",
      title: "Оплата",
      done: !unpaid,
      short: payState === "reported" ? "проверяем поступление" : payState === "awaiting" ? `до ${ruDate(agreement?.payDue)}` : "получена",
      status:
        payState === "reported"
          ? "Вы сообщили об оплате. Проверяем поступление, обычно один-два рабочих дня."
          : payState === "awaiting"
            ? `До ${ruDate(agreement?.payDue)}${daysToPay(agreement?.payDue ?? null) !== null ? ` (осталось ${daysToPay(agreement?.payDue ?? null)} дн.)` : ""}. Редакция начнёт серии после оплаты.`
            : "Оплата получена.",
      action: payState === "awaiting" ? { label: "Оплатить", run: onPay } : undefined,
    });
  }
  steps.push({
    key: "series",
    title: "Серии",
    done: ready.length > 0 && inWork.length === 0,
    short: inWork.length || ready.length ? [inWork.length ? `в работе ${inWork.length}` : "", ready.length ? `готово ${ready.length}` : ""].filter(Boolean).join(", ") : unpaid ? "после оплаты" : undefined,
    status: unpaid
      ? "Редакция начнёт после оплаты."
      : inWork.length || ready.length
        ? `${inWork.length ? `Редакция делает ${seriesAcc(inWork.length)}` : "Все серии сделаны"}${ready.length ? `, готово ${ready.length}` : ""}. Каждую вы увидите первыми и при необходимости попросите исправить.`
        : "Редакция сделает серии из отданных текстов и пришлёт вам посмотреть.",
  });
  steps.push({
    key: "open",
    title: "Страница открывается",
    done: false,
    status:
      ready.length && !inWork.length
        ? ready.length > 1
          ? `Готово ${seriesWord(ready.length)}. Посмотрите их и откройте страницу: выйдут те, что вы отметите.`
          : "Готова 1 серия: откройте страницу, и она выйдет вместе с ней."
        : "Одной кнопкой, вместе с готовыми сериями: вы сами отметите, какие выйдут. До этого страницу видите только вы и редакция.",
  });

  const current = steps.findIndex((step) => !step.done);
  return (
    <section className="desk-section desk-start" aria-label="Как откроется ваша страница">
      <h2 className="desk-h2">Как откроется ваша страница</h2>
      <ol className="desk-start-steps">
        {steps.map((step, index) => (
          <li key={step.key} className={step.done ? "is-done" : index === current ? "is-now" : ""}>
            <span className="desk-start-mark" aria-hidden>{step.done ? "✓" : index + 1}</span>
            <div>
              <b>
                {step.title}
                {index !== current && step.short ? <em> · {step.short}</em> : null}
              </b>
              {index === current ? <span>{step.status}</span> : null}
              {step.key === "open" && ready.length && !inWork.length ? <OpenPage desk={desk} ready={ready} /> : null}
              {step.action && (index === current || step.key === "pay" || step.key === "send") ? (
                <button type="button" className={`desk-btn ${index === current || step.key === "open" ? "desk-btn-red" : "desk-btn-ink"}`} onClick={step.action.run}>
                  {step.action.label}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * «Открыть страницу с N сериями» with a choice: every ready Series is ticked,
 * the author unticks any they do not want out yet. Those stay ready in the
 * Workshop: published later one by one, or sent back with «Попросить исправить».
 */
export function OpenPage({ desk, ready }: { desk: Desk; ready: Work[] }) {
  const [choosing, setChoosing] = useState(false);
  const [off, setOff] = useState<Set<string>>(() => new Set());
  const chosen = ready.filter((work) => !off.has(work.id));
  const open = (works: Work[]) => {
    const n = works.length;
    if (!n) return;
    if (window.confirm(`Открыть страницу читателям? ${n > 1 ? `${seriesWord(n)} выйдут` : "Серия выйдет"} вместе с ней и появятся в ленте.`)) void desk.approveAll(works.map((work) => work.id));
  };
  if (ready.length < 2) {
    return (
      <button type="button" className="desk-btn desk-btn-red" onClick={() => open(ready)}>
        Открыть страницу
      </button>
    );
  }
  if (!choosing) {
    return (
      <button type="button" className="desk-btn desk-btn-red" onClick={() => setChoosing(true)}>
        Открыть страницу с {withSeries(ready.length)}
      </button>
    );
  }
  return (
    <div className="desk-open-choose">
      <p>Какие серии выйдут вместе со страницей? Остальные останутся у вас: опубликуете позже или попросите исправить.</p>
      <ul>
        {ready.map((work) => {
          const piece = desk.state?.series[work.id]?.seriesPiece ?? null;
          return (
            <li key={work.id}>
              <label>
                <input
                  type="checkbox"
                  checked={!off.has(work.id)}
                  onChange={(event) =>
                    setOff((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.delete(work.id);
                      else next.add(work.id);
                      return next;
                    })
                  }
                />
                <span>{work.title || "Без названия"}</span>
              </label>
              {piece ? (
                <a href={`/l/${piece}`} target="_blank" rel="noreferrer">
                  Посмотреть
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="desk-open-choose-actions">
        <button type="button" className="desk-btn desk-btn-red" disabled={!chosen.length} onClick={() => open(chosen)}>
          {chosen.length ? `Открыть страницу с ${withSeries(chosen.length)}` : "Отметьте хотя бы одну"}
        </button>
        <button type="button" className="desk-quiet" onClick={() => setChoosing(false)}>
          Отмена
        </button>
      </div>
    </div>
  );
}
