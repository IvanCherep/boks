"use client";

import { useCallback, useEffect, useState } from "react";
import { Minus, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { readableBoksError } from "@/lib/boks/errors";
import { defineMessages } from "@/lib/i18n/messages";
import { listSeriesCredits, setSeriesCredits, type SeriesCreditRow } from "@/components/boks/supabase-browser-data";

const words = defineMessages(
  {
    title: "Boks Series",
    lead: "How many Series each author may make with the recorder in their cabinet. A new recording spends one; one recording can never cost more than 8 pictures and 6 builds.",
    refresh: "Refresh",
    failed: "Could not load the authors.",
    none: "No authors yet.",
    granted: "Granted",
    used: "made",
    left: (n: number) => `${n} left`,
    published: (n: number) => `${n} published`,
    holder: "Boks Series",
    save: "Save",
    saved: "Saved",
    grantTitle: "Grant to another account",
    grantHandle: "@name",
    grantCount: "Series in all",
    grant: "Grant",
    noGrant: "no grant",
  },
  {
    ru: {
      title: "Boks Series",
      lead: "Сколько Series каждый автор может сделать рекордером в своём кабинете. Новая запись тратит одну; одна запись никогда не стоит больше 8 картинок и 6 сборок.",
      refresh: "Обновить",
      failed: "Не удалось загрузить авторов.",
      none: "Авторов пока нет.",
      granted: "Выдано",
      used: "сделано",
      left: (n: number) => `осталось ${n}`,
      published: (n: number) => `опубликовано ${n}`,
      holder: "Boks Series",
      save: "Сохранить",
      saved: "Сохранено",
      grantTitle: "Выдать другому аккаунту",
      grantHandle: "@ник",
      grantCount: "Всего Series",
      grant: "Выдать",
      noGrant: "не выдано",
    },
  },
);

/** Studio → Authors: Boks Series granted to authors (`docs/series-recorder.md`). */
export function SeriesCredits() {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [rows, setRows] = useState<SeriesCreditRow[] | null>(null);
  const [error, setError] = useState("");
  const [handle, setHandle] = useState("");
  const [count, setCount] = useState(5);

  const load = useCallback(() => listSeriesCredits().then((next) => {
    setRows(next);
    setError("");
  }, () => setError(t.failed)), [t.failed]);
  useEffect(() => void load(), [load]);

  const save = (who: string, granted: number) =>
    setSeriesCredits(who, granted).then(load, (e) => setError(readableBoksError(e, t.failed, language)));

  return <section className="series-credits">
    <header>
      <div>
        <h2>{t.title}</h2>
        <p>{t.lead}</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />{t.refresh}</Button>
    </header>
    {error && <p className="series-credits__error" role="alert">{error}</p>}
    {rows?.length === 0 && <p className="series-credits__muted">{t.none}</p>}
    <ul>
      {rows?.map((row) => <CreditRow key={row.userId} row={row} onSave={(granted) => save(row.handle, granted)} />)}
    </ul>
    <form className="series-credits__grant" onSubmit={(event) => {
      event.preventDefault();
      if (handle.trim()) void save(handle.trim(), count).then(() => setHandle(""));
    }}>
      <strong>{t.grantTitle}</strong>
      <input value={handle} onChange={(event) => setHandle(event.target.value)} placeholder={t.grantHandle} aria-label={t.grantHandle} />
      <input type="number" min={0} max={200} value={count} onChange={(event) => setCount(Number(event.target.value))} aria-label={t.grantCount} />
      <Button type="submit" size="sm" disabled={!handle.trim()}>{t.grant}</Button>
    </form>
  </section>;
}

function CreditRow({ row, onSave }: { row: SeriesCreditRow; onSave: (granted: number) => Promise<unknown> }) {
  const t = useMessages(words);
  const [granted, setGranted] = useState(row.granted);
  const [busy, setBusy] = useState(false);
  const changed = granted !== row.granted;
  return <li className={row.granted > 0 ? "is-holder" : ""}>
    <span className="series-credits__who">
      <strong>@{row.handle}</strong>
      <small>{t.published(row.published)}</small>
    </span>
    <span className="series-credits__status">
      {row.granted > 0
        ? <><em>{t.holder}</em> {row.used} {t.used} · {t.left(row.granted - row.used)}</>
        : <span className="series-credits__muted">{t.noGrant}</span>}
    </span>
    <span className="series-credits__edit" aria-label={t.granted}>
      <button type="button" onClick={() => setGranted((n) => Math.max(row.used, n - 1))} disabled={granted <= row.used} aria-label="−"><Minus aria-hidden="true" /></button>
      <b>{granted}</b>
      <button type="button" onClick={() => setGranted((n) => Math.min(200, n + 1))} aria-label="+"><Plus aria-hidden="true" /></button>
    </span>
    <Button size="sm" variant={changed ? "default" : "ghost"} disabled={!changed || busy} onClick={() => {
      setBusy(true);
      void onSave(granted).finally(() => setBusy(false));
    }}>{changed ? t.save : t.saved}</Button>
  </li>;
}
