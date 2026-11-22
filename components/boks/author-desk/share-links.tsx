"use client";

import { useCallback, useEffect, useState } from "react";
import { ShareLinkPair } from "@/components/boks/share/share-link-pair";
import { bokShareUrl } from "@/lib/boks/share-link";
import { loadShareLinks, shareLinkDays, submitShareLink, WorkshopError, type ShareLinkSeries } from "@/lib/boks/author-desk/server";

/*
 * «Поделились выпуском?» (`docs/workshop-server.md`, "Links to the author's
 * posts"). The author contract asks the author to post a link to each
 * published Series in an open social account within 30 days and to send the
 * team the link to that post through the cabinet: this is that channel.
 */

export function useShareLinks(enabled = true) {
  const [series, setSeries] = useState<ShareLinkSeries[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    // A closed Workshop or a failed load simply shows nothing here.
    loadShareLinks().then((next) => live && setSeries(next), () => live && setSeries([]));
    return () => {
      live = false;
    };
  }, [enabled]);
  const submit = useCallback(async (bokId: string, url: string) => {
    setSeries(await submitShareLink(bokId, url));
  }, []);
  return { series, submit };
}

export function shareDeadline(publishedAt: string | null | undefined) {
  if (!publishedAt) return null;
  return new Date(new Date(publishedAt).getTime() + shareLinkDays * 86_400_000);
}

function day(date: Date, month: "long" | "2-digit" = "long") {
  return date.toLocaleDateString("ru-RU", month === "long" ? { day: "numeric", month: "long" } : { day: "2-digit", month: "2-digit" });
}

/** The quiet line under a published Series on the desk home. */
export function shareMarker(entry: ShareLinkSeries | undefined) {
  if (!entry) return null;
  if (entry.links.length) return "ссылка на пост у редакции ✓";
  const deadline = shareDeadline(entry.publishedAt);
  if (!deadline) return null;
  return deadline.getTime() >= Date.now() ? `ждём ссылку на пост до ${day(deadline, "2-digit")}` : "ждём ссылку на пост";
}

export function ShareBlock({ bokId, shares }: { bokId: string; shares: ReturnType<typeof useShareLinks> }) {
  const entry = shares.series?.find((item) => item.bokId === bokId);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  if (!entry) return null;

  const deadline = shareDeadline(entry.publishedAt);
  const seriesUrl = bokShareUrl({ id: entry.bokId, slug: entry.slug }, typeof window === "undefined" ? "https://tryboks.com" : window.location.origin);

  async function send() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    setSent(false);
    try {
      await shares.submit(bokId, url.trim());
      setUrl("");
      setSent(true);
    } catch (error) {
      setProblem(error instanceof WorkshopError ? error.message : "Не получилось. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="desk-share">
      <h3>Поделились выпуском?</h3>
      <p className="desk-calm">
        Расскажите о серии в своём открытом аккаунте в соцсети и пришлите нам ссылку на пост
        {deadline ? <> до <b>{day(deadline)}</b></> : null}. Так редакция видит, что условие тарифа выполнено.
      </p>
      <span className="desk-label">Ссылка на серию для вашего поста</span>
      <ShareLinkPair url={seriesUrl} language="ru" />
      <form
        className="desk-share-form"
        // The browser's own url check refuses «vk.com/wall…» without https://; the server adds it.
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="desk-label" htmlFor={`share-${bokId}`}>
          Ссылка на ваш пост
        </label>
        <div className="desk-inline">
          <input
            id={`share-${bokId}`}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://t.me/ваш_канал/123"
            value={url}
            maxLength={500}
            onChange={(event) => {
              setUrl(event.target.value);
              setProblem(null);
              setSent(false);
            }}
          />
          <button type="submit" className="desk-btn desk-btn-ink" disabled={busy || !url.trim()}>
            {busy ? "Отправляем…" : "Отправить в редакцию"}
          </button>
        </div>
        {problem ? <p className="desk-warn">{problem}</p> : null}
        {sent ? <p className="desk-calm">Готово, ссылка у редакции.</p> : null}
        <p className="desk-calm">Подойдёт пост в открытом аккаунте, который виден всем без подписки. Закрытые группы, личные сообщения и «истории» не засчитываются.</p>
      </form>
      {entry.links.length ? (
        <ul className="desk-share-sent">
          {entry.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} target="_blank" rel="noreferrer noopener">
                {link.url}
              </a>
              <small>отправлено {day(new Date(link.at))}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
