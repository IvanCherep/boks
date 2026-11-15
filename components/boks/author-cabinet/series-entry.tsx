"use client";
/* eslint-disable @next/next/no-img-element -- the series' own picture, as everywhere else in boks */

import "@/app/series-recorder.css";
import { useMessages } from "@/components/boks/ui-language";
import { defineMessages, plural } from "@/lib/i18n/messages";
import type { SeriesAccess } from "@/components/boks/supabase-browser-data";

const words = defineMessages(
  {
    kicker: "Only on boks",
    title: "Boks Series with a teleprompter",
    lead: "Read a poem in your own voice - boks matches every word to the recording, draws the pictures and puts the issue on your page in about a minute.",
    left: (left: number, granted: number) => `${left} of ${granted} left`,
    studio: "Studio: no limit",
    none: "All used. Write to us and we will add more.",
    record: "Record a Series",
    open: "Open my recordings",
  },
  {
    ru: {
      kicker: "Только в boks",
      title: "Boks Series с суфлёром",
      lead: "Прочитайте стихотворение своим голосом — boks сверит каждое слово с записью, нарисует иллюстрации и поставит выпуск на вашу страницу примерно за минуту.",
      left: (left: number, granted: number) => `Осталось ${left} из ${granted} ${plural("ru", granted, { one: "выпуска", few: "выпусков", many: "выпусков", other: "выпусков" })}`,
      studio: "Studio: без ограничений",
      none: "Все использованы. Напишите нам, и мы добавим.",
      record: "Записать Series",
      open: "Мои записи",
    },
  },
);

/**
 * The way into the recorder from the cabinet (`/author#series`): a small
 * stage - a phone behind the boks curtain with a line lit - the allowance as
 * marks, and one action. Shown only to an account the team granted Boks
 * Series (`docs/series-recorder.md`).
 */
export function SeriesEntry({ access, onOpen }: { access: SeriesAccess; onOpen: () => void }) {
  const t = useMessages(words);
  const spent = !access.admin && access.left < 1;
  return <section className="sre" aria-label={t.title}>
    <div className="sre__text">
      <p className="sre__kicker">{t.kicker}</p>
      <h2>{t.title}<i>.</i></h2>
      <p className="sre__lead">{t.lead}</p>
      <div className="sre__allowance">
        {!access.admin && <span className="sre__marks" aria-hidden="true">
          {Array.from({ length: Math.min(access.granted, 20) }, (_, index) => <i key={index} className={index < access.used ? "is-used" : ""} />)}
        </span>}
        <small>{access.admin ? t.studio : spent ? t.none : t.left(access.left, access.granted)}</small>
      </div>
      <button type="button" className="sre__go" onClick={onOpen}>
        <span className="sre__dot" aria-hidden="true"><i /></span>
        {spent ? t.open : t.record}
      </button>
    </div>
    <button type="button" className="sre__phone" onClick={onOpen} aria-hidden="true" tabIndex={-1}>
      <img src="/series/prokhorov-azbuka-very.webp" alt="" />
      <span className="sre__veil" />
      <span className="sre__curtain sre__curtain--left" />
      <span className="sre__curtain sre__curtain--right" />
      <span className="sre__verse"><span>Люблю грозу в начале мая,</span><b>когда весенний, первый гром</b></span>
    </button>
  </section>;
}
