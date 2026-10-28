"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BoksOverview } from "@/components/boks/client-types";
import { loadBoksOverview } from "@/components/boks/supabase-browser-data";
import { MetricBars, type MetricBarRow } from "@/components/boks/admin/metric-bars";
import type { AdminTab } from "@/components/boks/admin-dashboard";
import { MetricNote } from "@/components/boks/admin/metric-note";
import { currentUiLanguage, useMessages } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";

const ruBoks = (n: number) => plural("ru", n, { one: "бок", few: "бока", many: "боков", other: "бока" });

const words = defineMessages(
  {
    loading: "Loading...",
    missingFunction: "This Supabase project does not have the overview function yet. Apply supabase/migrations/20260912190000_boks_overview_metrics.sql.",
    couldNotLoad: "Could not load the overview.",
    bucket: (bucket: string) => `${bucket} boks`,
    pulseLabel: (days: number) => `Reading in the last ${days} days`,
    lastDays: (days: number) => `Last ${days} days`,
    min: "min",
    perReader: "of foreground reading per reader",
    activeReaders: (n: number) => `${n} active readers`,
    returned: (returning: number, previous: number) => `${returning} of ${previous} returned`,
    period: "Overview period",
    days: (n: number) => `${n} days`,
    guests: "Guests",
    growth: "Growth",
    studioWork: "Studio work",
    needsReview: "Needs review",
    reviewQueue: "Review queue",
    waiting: (pending: number, hours: number) => `${pending} boks waiting · median review ${hours} h`,
    rights: "Rights & reports",
    rightsHint: "Reader reports and rights to confirm",
    sections: "Sections",
    editorial: "Editorial",
    editorialHint: "Content, catalogue and publication",
    people: "People",
    peopleHint: "Accounts and reader feedback",
    lab: "Research lab",
    labHint: "Experiments and reading formats",
    details: "Reading & measurement details",
    refresh: "Refresh measurements",
    comeBack: "Do readers come back?",
    comeBackLead: "The number that decides whether this survives. Everything else is diagnosis.",
    returningFrom: (days: number) => `Returning from the previous ${days} days`,
    ofTotal: (part: number, whole: number) => `${part} of ${whole}`,
    activeReadersLabel: "Active readers",
    newCount: (n: number) => `${n} new`,
    sessionsPerReader: "Sessions per reader",
    sessions: (n: number) => `${n} sessions`,
    minutesPerReader: "Minutes per reader",
    minutesTotal: (n: number) => `${n} minutes read in total`,
    returningLabel: "Returning readers",
    returningIs: "The share of last period's readers who read again in this one.",
    returningHow: "A reader counts as active in a period if they produced at least one reading event in it. Returning is the intersection of the two periods, over the size of the earlier one. Both periods are the length selected above.",
    returningNot: "Not retention of everyone who ever signed up, and not comparable across window lengths - a 30-day window returns a higher share than a 7-day one by construction, because it gives people longer to come back.",
    timeTitle: "Reading time, decomposed",
    timeLead: "Minutes alone would reward long boks and slow readers, so they are never shown alone. A rise here should come with more sessions or more boks finished, not just longer ones.",
    minutesPerSession: "Minutes per session",
    boksFinished: "Boks finished",
    started: (n: number) => `${n} started`,
    minutesPerBok: "Active minutes per boks finished",
    allReading: "all reading, finished or not",
    finishedAfterStart: "Finished after starting",
    timeLabel: "Reading time",
    timeIs: "How much actual reading happened, split so no single number can be gamed.",
    timeHow: "Only seconds a boks was on screen and in the foreground are counted: the clock stops on a locked phone or a hidden tab, each gap is capped at 120 seconds, and the total per boks is rolled up with a maximum rather than a sum so a repeated heartbeat cannot inflate it. Finished means the reader reached 85% of the text and spent at least 40% of the time the word count implies at 238 words a minute, or stayed 70% of that time without reaching the end; a piece that fits on one screen is finished on 40% of the time alone. “Active minutes per boks finished” divides all reading time - skipped and unfinished reads included - by the boks finished: it is what one finish costs in attention, not how long a finished boks takes.",
    timeNot: "Not time-on-site and not a rate to maximise. Minutes rise if boks get longer or readers get slower, which is why they are never shown without sessions and boks finished beside them.",
    moreThanOne: "Do they read more than one?",
    moreThanOneLead: "Readers grouped by how many boks they opened. An average would hide a split between one-and-done and regulars, and that split is the product question.",
    distributionCaption: (days: number) => `Readers by boks opened, last ${days} days.`,
    noReads: "No reads in this window yet.",
    enough: "Is there enough to read?",
    enoughLead: "A feed starves before it mis-ranks. When readers have seen most of the catalog there is nothing left to recommend them, whichever algorithm is running.",
    published: "Published boks",
    addedRecently: (n: number) => `${n} added in 30 days`,
    pastHalf: "Readers past half the catalog",
    medianSeen: (share: number) => `median reader has seen ${share}%`,
    submitted: "Submitted",
    approvedRefused: (approved: number, refused: number) => `${approved} approved, ${refused} refused`,
    waitingForReview: "Waiting for review",
    medianReview: (hours: number) => `median review ${hours}h`,
    activeAuthors: (n: number) => `${n} author${n === 1 ? "" : "s"} submitted in the last 30 days.`,
    headroomLabel: "Catalogue headroom",
    headroomIs: "Whether there is still material left for the feed to recommend.",
    headroomHow: "A reader has “seen” a boks once it was served to them, counted from impression events. The median share is over readers active in the window, and the headroom count is readers past half the published catalogue.",
    headroomNot: "Not a measure of how good the catalogue is. A reader can exhaust it while enjoying none of it - that question lives in Content and in the experiment.",
    trusted: "Can these numbers be trusted?",
    trustedLead: "Measured rather than assumed. This console was confidently wrong for weeks because nothing checked whether its inputs made sense.",
    withOutcome: "Reads with a recorded outcome",
    noOutcome: "Sessions ending with no outcome",
    ofSessions: (n: number) => `of ${n} sessions`,
    noAlgorithm: "Events with no algorithm",
    cannotCompare: "cannot be compared",
    noTime: "Outcomes with no reading time",
    clockNever: "clock never started",
  },
  {
    ru: {
      loading: "Загрузка...",
      missingFunction: "В этом проекте Supabase ещё нет функции обзора. Примените supabase/migrations/20260912190000_boks_overview_metrics.sql.",
      couldNotLoad: "Не удалось загрузить обзор.",
      // Buckets are "1", "2-4", "5-9", "10+": the count that ends the range picks the word.
      bucket: (bucket: string) => `${bucket} ${ruBoks(Number(bucket.match(/\d+$/)?.[0] ?? bucket.replace(/\D/g, "")))}`,
      pulseLabel: (days: number) => `Чтение за последние ${days} ${plural("ru", days, { one: "день", few: "дня", many: "дней", other: "дня" })}`,
      lastDays: (days: number) => `Последние ${days} ${plural("ru", days, { one: "день", few: "дня", many: "дней", other: "дня" })}`,
      min: "мин",
      perReader: "чтения на экране в среднем на читателя",
      activeReaders: (n: number) => `${n} ${plural("ru", n, { one: "активный читатель", few: "активных читателя", many: "активных читателей", other: "активного читателя" })}`,
      returned: (returning: number, previous: number) => `вернулись ${returning} из ${previous}`,
      period: "Период обзора",
      days: (n: number) => `${n} ${plural("ru", n, { one: "день", few: "дня", many: "дней", other: "дня" })}`,
      guests: "Гости",
      growth: "Рост",
      studioWork: "Работа студии",
      needsReview: "Ждёт проверки",
      reviewQueue: "Очередь проверки",
      waiting: (pending: number, hours: number) => `ждут: ${pending} · медиана проверки ${hours} ч`,
      rights: "Права и жалобы",
      rightsHint: "Жалобы читателей и права на подтверждение",
      sections: "Разделы",
      editorial: "Редакция",
      editorialHint: "Контент, каталог и публикация",
      people: "Люди",
      peopleHint: "Аккаунты и отзывы читателей",
      lab: "Исследования",
      labHint: "Эксперименты и форматы чтения",
      details: "Чтение и детали измерений",
      refresh: "Обновить измерения",
      comeBack: "Возвращаются ли читатели?",
      comeBackLead: "Это число решает, выживет ли продукт. Всё остальное лишь диагностика.",
      returningFrom: (days: number) => `Вернулись из предыдущих ${days} ${plural("ru", days, { one: "дня", few: "дней", many: "дней", other: "дня" })}`,
      ofTotal: (part: number, whole: number) => `${part} из ${whole}`,
      activeReadersLabel: "Активные читатели",
      newCount: (n: number) => `${n} ${plural("ru", n, { one: "новый", few: "новых", many: "новых", other: "нового" })}`,
      sessionsPerReader: "Сессий на читателя",
      sessions: (n: number) => `${n} ${plural("ru", n, { one: "сессия", few: "сессии", many: "сессий", other: "сессии" })}`,
      minutesPerReader: "Минут на читателя",
      minutesTotal: (n: number) => `всего прочитано ${n} ${plural("ru", n, { one: "минута", few: "минуты", many: "минут", other: "минуты" })}`,
      returningLabel: "Вернувшиеся читатели",
      returningIs: "Доля читателей прошлого периода, которые снова читали в этом.",
      returningHow: "Читатель активен в периоде, если оставил в нём хотя бы одно событие чтения. Вернувшиеся: пересечение двух периодов, делённое на размер более раннего. Оба периода той длины, что выбрана выше.",
      returningNot: "Это не удержание всех, кто когда-либо зарегистрировался, и его нельзя сравнивать между окнами разной длины: 30-дневное окно по построению даёт долю выше 7-дневного, потому что у людей больше времени вернуться.",
      timeTitle: "Время чтения по частям",
      timeLead: "Одни минуты поощряли бы длинные боки и медленных читателей, поэтому они никогда не показываются отдельно. Рост здесь должен сопровождаться ростом сессий или дочитанных боков, а не только их длины.",
      minutesPerSession: "Минут за сессию",
      boksFinished: "Дочитано боков",
      started: (n: number) => `начато: ${n}`,
      minutesPerBok: "Активных минут на дочитанный бок",
      allReading: "всё чтение, дочитанное и нет",
      finishedAfterStart: "Дочитано из начатых",
      timeLabel: "Время чтения",
      timeIs: "Сколько на самом деле читали, разложено так, чтобы ни одно число нельзя было накрутить.",
      timeHow: "Считаются только секунды, когда бок был на экране и вкладка активна: на заблокированном телефоне или в скрытой вкладке часы стоят, каждый промежуток ограничен 120 секундами, а итог по боку берётся максимумом, а не суммой, чтобы повторный пульс его не раздувал. Дочитан значит, что читатель дошёл до 85% текста и провёл не меньше 40% времени, которое следует из числа слов при 238 словах в минуту, или пробыл 70% этого времени, не дойдя до конца; текст, который помещается на один экран, считается дочитанным по одному правилу 40% времени. «Активных минут на дочитанный бок» делит всё время чтения, включая пропущенные и недочитанные, на число дочитанных боков: это цена одного дочитывания во внимании, а не длительность чтения одного бока.",
      timeNot: "Это не время на сайте и не показатель, который надо максимизировать. Минуты растут, если боки длиннее или читатели медленнее, поэтому их всегда показывают рядом с сессиями и дочитанными боками.",
      moreThanOne: "Читают ли больше одного?",
      moreThanOneLead: "Читатели, сгруппированные по числу открытых боков. Среднее скрыло бы разделение на «прочитал один и ушёл» и постоянных, а это разделение и есть продуктовый вопрос.",
      distributionCaption: (days: number) => `Читатели по числу открытых боков, последние ${days} ${plural("ru", days, { one: "день", few: "дня", many: "дней", other: "дня" })}.`,
      noReads: "В этом окне прочтений пока нет.",
      enough: "Хватает ли что читать?",
      enoughLead: "Лента сначала голодает, а уже потом плохо ранжирует. Когда читатели видели большую часть каталога, рекомендовать им нечего, какой бы алгоритм ни работал.",
      published: "Опубликовано боков",
      addedRecently: (n: number) => `${n} добавлено за 30 дней`,
      pastHalf: "Читателей прошли половину каталога",
      medianSeen: (share: number) => `медианный читатель видел ${share}%`,
      submitted: "Прислано",
      approvedRefused: (approved: number, refused: number) => `одобрено: ${approved}, отклонено: ${refused}`,
      waitingForReview: "Ждут проверки",
      medianReview: (hours: number) => `медиана проверки ${hours} ч`,
      activeAuthors: (n: number) => `${n} ${plural("ru", n, { one: "автор прислал", few: "автора прислали", many: "авторов прислали", other: "автора прислали" })} тексты за последние 30 дней.`,
      headroomLabel: "Запас каталога",
      headroomIs: "Остался ли материал, который лента может рекомендовать.",
      headroomHow: "Читатель «видел» бок, как только тот был ему показан, по событиям показа. Медианная доля считается по читателям, активным в окне, а запас: число читателей, прошедших половину опубликованного каталога.",
      headroomNot: "Это не мера качества каталога. Читатель может исчерпать его, не получив удовольствия ни от одного бока: этот вопрос решается в «Контенте» и в эксперименте.",
      trusted: "Можно ли верить этим числам?",
      trustedLead: "Измерено, а не предположено. Эта консоль неделями уверенно ошибалась, потому что никто не проверял, есть ли смысл в её входных данных.",
      withOutcome: "Прочтения с записанным исходом",
      noOutcome: "Сессии без исхода",
      ofSessions: (n: number) => `из ${n} ${plural("ru", n, { one: "сессии", few: "сессий", many: "сессий", other: "сессии" })}`,
      noAlgorithm: "События без алгоритма",
      cannotCompare: "сравнить нельзя",
      noTime: "Исходы без времени чтения",
      clockNever: "часы так и не запустились",
    },
  }
);

/**
 * The weekly page.
 *
 * Only numbers that change a decision. No composite scores, no rate whose
 * denominator is a guess, and no algorithm comparison - that lives in
 * Experiments, and at a small catalog it has nothing to say.
 */
export function AdminOverview({ onNavigate }: { onNavigate: (tab: AdminTab) => void }) {
  const t = useMessages(words);
  const [overview, setOverview] = useState<BoksOverview | null>(null);
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState(() => words[currentUiLanguage()].loading);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (nextDays: number) => {
    setBusy(true);
    try {
      const payload = await loadBoksOverview(nextDays);
      setOverview(payload);
      setStatus(payload ? "" : words[currentUiLanguage()].missingFunction);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : words[currentUiLanguage()].couldNotLoad);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh(days).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [days, refresh]);

  const readers = overview?.readers;
  const reading = overview?.reading;
  const supply = overview?.supply;
  const catalog = overview?.catalog;
  const quality = overview?.dataQuality;

  const minutes = Math.round((reading?.activeSeconds ?? 0) / 60);
  const minutesPerReader = readers?.active ? Math.round(minutes / readers.active) : 0;
  const minutesPerSession = reading?.sessions ? Math.round(minutes / reading.sessions) : 0;
  const sessionsPerReader = readers?.active ? round1((reading?.sessions ?? 0) / readers.active) : 0;
  const minutesPerBok = reading?.boksCompleted ? round1(minutes / reading.boksCompleted) : 0;
  const returningRate = readers?.previousActive
    ? Math.round((readers.returning / readers.previousActive) * 100)
    : 0;
  const outcomeRate = quality?.reads ? Math.round((quality.readsWithOutcome / quality.reads) * 100) : 0;

  const distribution: MetricBarRow[] = (overview?.readsPerReader ?? []).map((row) => ({
    id: row.bucket,
    label: t.bucket(row.bucket),
    value: row.readers,
    unit: "",
  }));

  return (
    <div className="studio-overview">
      {status && <p className="panel p-4 text-sm text-[var(--muted-foreground)]">{status}</p>}

      {overview && (
        <>
          <section className="studio-pulse" aria-label={t.pulseLabel(days)}>
            <span className="studio-eyebrow">{t.lastDays(days)}</span>
            <strong>{minutesPerReader} <i>{t.min}</i></strong>
            <p>{t.perReader}</p>
            <div><span>{t.activeReaders(readers?.active ?? 0)}</span><span>{t.returned(readers?.returning ?? 0, readers?.previousActive ?? 0)}</span></div>
          </section>
          <div className="studio-overview-shortcuts">
            <select aria-label={t.period} className="field-control" value={days} onChange={(event) => setDays(Number(event.target.value))}>
              <option value={7}>{t.days(7)}</option><option value={14}>{t.days(14)}</option><option value={30}>{t.days(30)}</option>
            </select>
            <Button variant="outline" onClick={() => onNavigate("guests")}>{t.guests}</Button>
            <Button variant="outline" onClick={() => onNavigate("growth")}>{t.growth}</Button>
          </div>
          <section className="studio-overview-links" aria-label={t.studioWork}>
            <h2>{t.needsReview}</h2>
            <button type="button" onClick={() => onNavigate("moderation")}><span><strong>{t.reviewQueue}</strong><small>{t.waiting(supply?.pending ?? 0, supply?.medianReviewHours ?? 0)}</small></span><ArrowRight /></button>
            <button type="button" onClick={() => onNavigate("rights")}><span><strong>{t.rights}</strong><small>{t.rightsHint}</small></span><ArrowRight /></button>
            <h2>{t.sections}</h2>
            <button type="button" onClick={() => onNavigate("content")}><span><strong>{t.editorial}</strong><small>{t.editorialHint}</small></span><ArrowRight /></button>
            <button type="button" onClick={() => onNavigate("people")}><span><strong>{t.people}</strong><small>{t.peopleHint}</small></span><ArrowRight /></button>
            <button type="button" onClick={() => onNavigate("experiments")}><span><strong>{t.lab}</strong><small>{t.labHint}</small></span><ArrowRight /></button>
          </section>
          <details className="studio-details">
            <summary>{t.details} <span aria-hidden="true">+</span></summary>
            <div className="studio-details-body">
            <Button variant="outline" onClick={() => refresh(days)} disabled={busy}><RefreshCw className="size-4" /> {t.refresh}</Button>
          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">{t.comeBack}</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t.comeBackLead}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <BigNumber label={t.returningFrom(days)} value={`${returningRate}%`} note={t.ofTotal(readers?.returning ?? 0, readers?.previousActive ?? 0)} />
              <BigNumber label={t.activeReadersLabel} value={String(readers?.active ?? 0)} note={t.newCount(readers?.new ?? 0)} />
              <BigNumber label={t.sessionsPerReader} value={String(sessionsPerReader)} note={t.sessions(reading?.sessions ?? 0)} />
              <BigNumber label={t.minutesPerReader} value={String(minutesPerReader)} note={t.minutesTotal(minutes)} />
            </div>
            <MetricNote
              label={t.returningLabel}
              is={t.returningIs}
              how={t.returningHow}
              not={t.returningNot}
            />
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">{t.timeTitle}</h3>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t.timeLead}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <BigNumber label={t.minutesPerSession} value={String(minutesPerSession)} note="" />
              <BigNumber label={t.boksFinished} value={String(reading?.boksCompleted ?? 0)} note={t.started(reading?.boksStarted ?? 0)} />
              <BigNumber label={t.minutesPerBok} value={String(minutesPerBok)} note={t.allReading} />
              <BigNumber label={t.finishedAfterStart} value={`${reading?.boksStarted ? Math.round(((reading.boksCompleted ?? 0) / reading.boksStarted) * 100) : 0}%`} note="" />
            </div>
            <MetricNote
              label={t.timeLabel}
              is={t.timeIs}
              how={t.timeHow}
              not={t.timeNot}
            />
          </section>

          <section className="panel p-5">
            <h3 className="text-lg font-semibold tracking-normal">{t.moreThanOne}</h3>
            <p className="mt-1 mb-4 text-sm text-[var(--muted-foreground)]">
              {t.moreThanOneLead}
            </p>
            {distribution.length ? (
              <MetricBars
                rows={distribution}
                highlightBest={false}
                caption={t.distributionCaption(days)}
              />
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">{t.noReads}</p>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="panel p-5">
              <h3 className="text-lg font-semibold tracking-normal">{t.enough}</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t.enoughLead}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <BigNumber label={t.published} value={String(catalog?.published ?? 0)} note={t.addedRecently(catalog?.publishedRecently ?? 0)} />
                <BigNumber label={t.pastHalf} value={String(catalog?.readersPastHalf ?? 0)} note={t.medianSeen(catalog?.medianSeenShare ?? 0)} />
                <BigNumber label={t.submitted} value={String(supply?.submitted ?? 0)} note={t.approvedRefused(supply?.approved ?? 0, supply?.refused ?? 0)} />
                <BigNumber label={t.waitingForReview} value={String(supply?.pending ?? 0)} note={t.medianReview(supply?.medianReviewHours ?? 0)} />
              </div>
              <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                {t.activeAuthors(supply?.activeAuthors ?? 0)}
              </p>
              <MetricNote
                label={t.headroomLabel}
                is={t.headroomIs}
                how={t.headroomHow}
                not={t.headroomNot}
              />
            </section>

            <section className="panel p-5">
              <h3 className="text-lg font-semibold tracking-normal">{t.trusted}</h3>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t.trustedLead}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <BigNumber label={t.withOutcome} value={`${outcomeRate}%`} note={t.ofTotal(quality?.readsWithOutcome ?? 0, quality?.reads ?? 0)} />
                <BigNumber label={t.noOutcome} value={String(quality?.sessionsWithoutOutcome ?? 0)} note={t.ofSessions(quality?.sessions ?? 0)} />
                <BigNumber label={t.noAlgorithm} value={String(quality?.unattributedEvents ?? 0)} note={t.cannotCompare} />
                <BigNumber label={t.noTime} value={String(quality?.outcomesWithoutTime ?? 0)} note={t.clockNever} />
              </div>
            </section>
          </div>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function BigNumber({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-tile">
      <p>{label}</p>
      <strong>{value}</strong>
      {note && <small className="mt-1 block text-xs text-[var(--muted-foreground)]">{note}</small>}
    </div>
  );
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
