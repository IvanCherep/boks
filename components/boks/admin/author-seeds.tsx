"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currentAccessToken } from "@/components/boks/supabase-browser-data";
import { supabase } from "@/lib/boks/supabase-client";
import { readableBoksError } from "@/lib/boks/errors";
import { voiceLimits } from "@/lib/boks/author/voice/rules";

/*
 * «Тексты для кабинета» (`docs/author-agreements.md`, "The way in"): the works
 * an author sent in reply to the letter, put on the page by the team. They
 * wait here and become the author's drafts in the Workshop when the
 * invitation is accepted, or at once when the page has its author already.
 * A recording the author sent goes with its text: the author will see it as
 * their own upload and can keep it or record again with the teleprompter.
 * The team works in Russian, so this panel is Russian only.
 */

export type SpaceSeed = {
  id: string;
  spaceId: string;
  title: string;
  text: string;
  form: "poem" | "prose";
  voice: { file: string; durationMs: number; name: string | null } | null;
  voiceCurrent: boolean;
  position: number;
  createdAt: string;
  handedAt: string | null;
  bokStatus: string | null;
  bokVoice: boolean;
};

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const result = await supabase.rpc(name, args);
  if (result.error) throw result.error;
  return result.data as T;
}

const loadSeeds = (spaceId: string) => call<SpaceSeed[]>("studio_space_seeds", { p_space_id: spaceId });
const saveSeed = (spaceId: string, seed: { id?: string | null; title: string; text: string; form: string }) =>
  call<SpaceSeed>("studio_save_space_seed", { p_space_id: spaceId, p_seed_id: seed.id ?? null, p_title: seed.title, p_text: seed.text, p_form: seed.form });
const removeSeed = (seedId: string) => call<null>("studio_remove_space_seed", { p_seed_id: seedId });

async function uploadSeedVoice(seedId: string, file: File, durationMs: number) {
  const token = await currentAccessToken();
  if (!token) throw new Error("Войдите снова.");
  const query = new URLSearchParams({ durationMs: String(Math.round(durationMs)), name: file.name.slice(0, 200) });
  const response = await fetch(`/api/admin/author-seeds/${seedId}/voice?${query}`, {
    method: "PUT",
    body: file,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || "audio/mpeg" },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; seed?: SpaceSeed };
  if (!response.ok || !payload.seed) throw new Error(payload.error ?? `Не получилось (${response.status}).`);
  return payload.seed;
}

/** The length of a file the browser can play, in ms; 0 when it cannot tell. */
function fileDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(media.duration) ? media.duration * 1000 : 0);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Браузер не смог прочитать файл. Сохраните запись в mp3 или m4a."));
    };
    media.src = url;
  });
}

const minutes = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const firstLine = (text: string) => text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";

function seedState(seed: SpaceSeed) {
  if (!seed.handedAt) return "ждёт приглашения";
  switch (seed.bokStatus) {
    case "draft":
      return seed.bokVoice ? "у автора · с записью" : "у автора · ждёт записи";
    case "pending_review":
      return "автор отдал в работу";
    case "published":
      return "опубликовано";
    case null:
      return "автор удалил";
    default:
      return `у автора · ${seed.bokStatus}`;
  }
}

export function SpaceSeedsPanel({ spaceId, owned }: { spaceId: string; owned: boolean }) {
  const [seeds, setSeeds] = useState<SpaceSeed[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [form, setForm] = useState<"poem" | "prose">("poem");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    loadSeeds(spaceId).then(setSeeds, (error) => setNote(readableBoksError(error, "Не удалось загрузить тексты.", "ru")));
  }, [spaceId]);
  useEffect(load, [load]);

  function reset() {
    setEditing(null);
    setTitle("");
    setText("");
    setForm("poem");
  }

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setNote("");
    try {
      await action();
      setNote(done);
      load();
    } catch (error) {
      setNote(readableBoksError(error, "Не получилось.", "ru"));
    } finally {
      setBusy(false);
    }
  }

  async function attach(file: File | undefined) {
    const seedId = fileFor.current;
    fileFor.current = null;
    if (!file || !seedId) return;
    if (file.size > voiceLimits.takeBytes) {
      setNote(`Файл больше ${Math.round(voiceLimits.takeBytes / 1024 / 1024)} МБ. Сохраните звук в mp3 или m4a (из видео тоже) и приложите снова.`);
      return;
    }
    await run(async () => {
      const ms = await fileDuration(file);
      if (ms > voiceLimits.takeMs) throw new Error("Запись длиннее 15 минут.");
      if (ms && ms < voiceLimits.minTakeMs) throw new Error("Запись слишком короткая.");
      await uploadSeedVoice(seedId, file, ms || voiceLimits.minTakeMs);
    }, "Запись приложена.");
  }

  const waiting = seeds?.filter((seed) => !seed.handedAt).length ?? 0;
  const voiced = seeds?.filter((seed) => seed.voice && seed.voiceCurrent).length ?? 0;

  return (
    <section className="asp-card aag-studio aseed">
      <header className="asp-card__head"><h2>Тексты для кабинета</h2></header>
      <p className="aag-small">
        Тексты, которые автор прислал в ответ на письмо, и записи их чтения, если есть. {owned
          ? "У страницы есть автор: новый текст сразу появится у него в мастерской черновиком."
          : "Они появятся у автора в мастерской черновиками, как только он примет приглашение."} Записи нет — автор прочитает с суфлёром.
      </p>
      {seeds && seeds.length > 0 && (
        <>
          <p className="aag-small">Всего {seeds.length}, с записью {voiced}{waiting ? `, ждут приглашения ${waiting}` : ""}.</p>
          <ol className="aseed-list">
            {seeds.map((seed) => (
              <li key={seed.id} className="aseed-item">
                <div className="aseed-item__what">
                  <strong>{seed.title || `«${firstLine(seed.text).slice(0, 60)}»`}</strong>
                  <small>
                    {seed.form === "prose" ? "проза" : "стихи"} · {seed.text.length} зн. · {seedState(seed)}
                    {seed.voice ? ` · запись ${minutes(seed.voice.durationMs)}${seed.voiceCurrent ? "" : " (текст менялся после неё)"}` : " · без записи"}
                  </small>
                </div>
                <div className="asp-buttons">
                  {(!seed.handedAt || seed.bokStatus === "draft") && (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => { fileFor.current = seed.id; fileInput.current?.click(); }}>
                      {seed.voice ? "Заменить запись" : "Приложить запись"}
                    </Button>
                  )}
                  {!seed.handedAt && (
                    <>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => { setEditing(seed.id); setTitle(seed.title); setText(seed.text); setForm(seed.form); }}>Править</Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => removeSeed(seed.id), "Текст убран.")}>Убрать</Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept="audio/*,video/mp4,video/webm,.mp3,.m4a,.wav,.ogg,.webm,.mp4"
        onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ""; }}
      />
      <div className="aseed-form">
        <h3>{editing ? "Правка текста" : "Добавить текст"}</h3>
        <label className="aag-field">Название (если есть)
          <Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Без названия — назовём по первой строке" />
        </label>
        <label className="aag-field">Текст
          <textarea className="aseed-text" value={text} maxLength={20000} rows={8} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="asp-segmented" role="group" aria-label="Форма">
          <button type="button" aria-pressed={form === "poem"} onClick={() => setForm("poem")}>Стихи</button>
          <button type="button" aria-pressed={form === "prose"} onClick={() => setForm("prose")}>Проза</button>
        </div>
        <div className="asp-buttons">
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void run(async () => { await saveSeed(spaceId, { id: editing, title, text, form }); reset(); }, editing ? "Текст сохранён." : "Текст добавлен.")}>
            {editing ? "Сохранить" : "Добавить текст"}
          </Button>
          {editing && <Button variant="outline" size="sm" disabled={busy} onClick={reset}>Отмена</Button>}
        </div>
      </div>
      {note && <p className="aag-small" role="status">{note}</p>}
    </section>
  );
}
