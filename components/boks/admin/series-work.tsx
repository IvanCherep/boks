"use client";

import { useCallback, useEffect, useState } from "react";
import { Clapperboard, RefreshCw, RotateCcw, Send } from "lucide-react";
import "@/app/author-composer.css";
import { Button } from "@/components/ui/button";
import { useMessages, useUiLanguage } from "@/components/boks/ui-language";
import { AuthorVoicePanel } from "@/components/boks/admin/author-voice";
import { TeamCoverPanel } from "@/components/boks/admin/team-cover";
import { EditorDecisionDialog } from "@/components/boks/admin/editor-decision";
import { createSeriesDraftFromBok, loadSeriesDraft } from "@/components/boks/admin/series-recorder/api";
import { loadStudioSeriesWork, studioSendSeries, type StudioSeriesWork } from "@/components/boks/author-cabinet/voice-data";
import { readableBoksError } from "@/lib/boks/errors";
import { defineMessages } from "@/lib/i18n/messages";
import { supabase } from "@/lib/boks/supabase-client";
import { maxMusicCredit, musicCreditNames } from "@/lib/boks/music-credit";

/**
 * Studio → «Boks Series в работе» (`docs/author-publishing.md`, "The editors
 * make the Boks Series"): every voiced piece the editors accepted into work,
 * with the author's reading, the cover, the recorder draft made from the
 * author's take, the finished Series' link-only token and «Отправить автору»,
 * which puts the Series on the author's page as ready for them to publish.
 */

const words = defineMessages({
  lead: "Pieces accepted into work. Make the Series from the author's reading, add the cover and send it to the author: they publish it from My page.",
  empty: "Nothing in work. Accept a voiced piece in Moderation and it appears here.",
  refresh: "Refresh",
  states: { accepted: "In work", sent: "Sent to the author", published: "Published by the author" } as Record<string, string>,
  build: "Make the Boks Series",
  openDraft: "Open the recorder draft",
  draftState: (state: string) => `Recorder draft: ${state}`,
  draftStates: { draft: "not built yet", queued: "in the queue", processing: "building", ready: "built", failed: "did not build" } as Record<string, string>,
  token: "The Series' link-only token",
  tokenHint: "Filled from the recorder's kept build; paste one for a piece made by hand (docs/link-only-pieces.md).",
  coverMissing: "Add the cover first: the bok goes out with it.",
  coverReady: "The cover is set.",
  send: "Send to the author",
  resend: "Send again",
  sentAt: (when: string) => `Sent ${when}. The author publishes it from My page.`,
  publishedAt: (when: string) => `Published by the author ${when}.`,
  returnWithReason: "Return to the author with a reason",
  failed: "Could not do that. Try again.",
  sentDone: "Sent. The author sees «Series ready» on My page.",
}, { ru: {
  lead: "Боки, принятые в работу. Соберите серию из записи автора, добавьте обложку и отправьте автору: он опубликует её со своей страницы.",
  empty: "В работе ничего нет. Примите бок с голосом в «Модерации», и он появится здесь.",
  refresh: "Обновить",
  states: { accepted: "В работе", sent: "Отправлено автору", published: "Опубликовано автором" },
  build: "Собрать Boks Series",
  openDraft: "Открыть черновик в записи",
  draftState: (state: string) => `Черновик в записи: ${state}`,
  draftStates: { draft: "ещё не собран", queued: "в очереди", processing: "собирается", ready: "собран", failed: "не собрался" },
  token: "Ссылка-токен готовой серии",
  tokenHint: "Подставляется из оставленной сборки; для бока, сделанного вручную, вставьте свой (docs/link-only-pieces.md).",
  coverMissing: "Сначала обложка: бок выходит с ней.",
  coverReady: "Обложка есть.",
  send: "Отправить автору",
  resend: "Отправить снова",
  sentAt: (when: string) => `Отправлено ${when}. Автор опубликует со своей страницы.`,
  publishedAt: (when: string) => `Автор опубликовал ${when}.`,
  returnWithReason: "Вернуть автору с причиной",
  failed: "Не получилось. Попробуйте ещё раз.",
  sentDone: "Отправлено. Автор видит «Серия готова» на своей странице.",
} });

export function SeriesWorkPanel({ openRecorder }: { openRecorder: (draftId: string) => void }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [items, setItems] = useState<StudioSeriesWork[] | null>(null);
  const [problem, setProblem] = useState("");
  const load = useCallback(() => loadStudioSeriesWork().then((rows) => { setItems(rows); setProblem(""); }, (error) => setProblem(readableBoksError(error, t.failed, language))), [t.failed, language]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="studio-series-work">
      <header className="studio-series-work__head">
        <p>{t.lead}</p>
        <Button variant="ghost" onClick={() => void load()}><RefreshCw /> {t.refresh}</Button>
      </header>
      {problem && <p role="alert">{problem}</p>}
      {items?.length === 0 && <p className="studio-series-work__empty">{t.empty}</p>}
      <ul>
        {items?.map((item) => <WorkCard key={item.bokId} item={item} onChanged={load} openRecorder={openRecorder} />)}
      </ul>
    </section>
  );
}

function WorkCard({ item, onChanged, openRecorder }: { item: StudioSeriesWork; onChanged: () => void; openRecorder: (draftId: string) => void }) {
  const t = useMessages(words);
  const language = useUiLanguage();
  const [token, setToken] = useState(item.seriesPiece ?? "");
  const [draftState, setDraftState] = useState<string | null>(null);
  const [hasCover, setHasCover] = useState(item.hasCover);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [returning, setReturning] = useState(false);
  const open = item.state !== "published";
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(language, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "");

  // The linked recorder draft: how far it is, and the token of its kept build.
  useEffect(() => {
    if (!item.draftId) return;
    let live = true;
    loadSeriesDraft(item.draftId).then((draft) => {
      if (!live) return;
      setDraftState(draft.status.state);
      if (draft.status.state === "ready" && draft.token) setToken((typed) => typed || draft.token!);
    }, () => undefined);
    return () => { live = false; };
  }, [item.draftId]);

  async function act(run: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setNote("");
    try {
      await run();
      if (done) setNote(done);
      onChanged();
    } catch (error) {
      setNote(readableBoksError(error, t.failed, language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="studio-series-work__card">
      <div className="studio-series-work__title">
        <h3>{item.title}</h3>
        <span className={`studio-series-work__state is-${item.state}`}>{t.states[item.state]}</span>
      </div>
      <p className="studio-series-work__who">{item.authorHandle ? `@${item.authorHandle} · ` : ""}{item.byline}</p>
      <AuthorVoicePanel bokId={item.bokId} expected />
      <StudioMusicCredit bokId={item.bokId} />
      {open && <TeamCoverPanel bokId={item.bokId} title={item.title} text={item.text} forSeries onCover={() => setHasCover(true)} />}
      {open && (
        <div className="studio-series-work__series">
          {item.draftId && <p>{t.draftState(t.draftStates[draftState ?? "draft"] ?? draftState ?? "")}</p>}
          <Button variant="outline" disabled={busy} onClick={() => void act(async () => openRecorder((await createSeriesDraftFromBok(item.bokId)).id))}>
            <Clapperboard /> {item.draftId ? t.openDraft : t.build}
          </Button>
          <label className="studio-field">{t.token}
            <input value={token} onChange={(event) => setToken(event.target.value.trim())} placeholder="AbCdEfGhIjKlMnOpQrStUv" spellCheck={false} autoCapitalize="none" />
          </label>
          <small>{t.tokenHint}</small>
          <small className={hasCover ? "is-ok" : "is-warn"}>{hasCover ? t.coverReady : t.coverMissing}</small>
          <div className="studio-series-work__actions">
            <Button disabled={busy || !hasCover || token.length < 22} onClick={() => void act(() => studioSendSeries(item.bokId, token), t.sentDone)}>
              <Send /> {item.state === "sent" ? t.resend : t.send}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setReturning(true)}><RotateCcw /> {t.returnWithReason}</Button>
          </div>
        </div>
      )}
      {item.state === "sent" && <p className="studio-series-work__note">{t.sentAt(when(item.sentAt))}</p>}
      {item.state === "published" && <p className="studio-series-work__note">{t.publishedAt(when(item.publishedAt))}</p>}
      {note && <p className="studio-series-work__note" role="status">{note}</p>}
      <EditorDecisionDialog bokId={item.bokId} title={item.title} decision={returning ? "changes" : null}
        onClose={() => setReturning(false)} onDone={() => { setReturning(false); onChanged(); }} />
    </li>
  );
}

/**
 * «Музыка» as readers will see it under the byline. The author usually fills
 * it in the Workshop; the editors fill or correct it here.
 */
function StudioMusicCredit({ bokId }: { bokId: string }) {
  const language = useUiLanguage();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let live = true;
    supabase?.rpc("get_my_bok_music", { p_bok_id: bokId }).then(({ data }) => {
      if (!live) return;
      const music = typeof data === "string" ? data : "";
      setValue(music);
      setSaved(music);
    }, () => undefined);
    return () => { live = false; };
  }, [bokId]);
  const names = musicCreditNames(value);
  return (
    <div className="studio-series-work__series">
      <label className="studio-field">Музыка (необязательно)
        <input value={value} maxLength={maxMusicCredit} disabled={saved === null} placeholder="Л. Булдыгин, В. Рвачев" onChange={(event) => { setValue(event.target.value); setNote(""); }} />
      </label>
      <small>{names ? `Под именем автора: «Музыка: ${names}»` : "Пусто: строки про музыку не будет."}</small>
      <div className="studio-series-work__actions">
        <Button variant="outline" disabled={saved === null || value.trim() === saved} onClick={() => {
          supabase?.rpc("studio_set_bok_music", { p_bok_id: bokId, p_music: value }).then(({ data, error }) => {
            if (error) { setNote(readableBoksError(error, "Не получилось сохранить.", language)); return; }
            const music = String((data as { musicBy?: string } | null)?.musicBy ?? "");
            setValue(music); setSaved(music); setNote("Сохранено.");
          }, (error) => setNote(readableBoksError(error, "Не получилось сохранить.", language)));
        }}>Сохранить музыку</Button>
      </div>
      {note && <small role="status">{note}</small>}
    </div>
  );
}
