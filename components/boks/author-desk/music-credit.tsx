"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/boks/supabase-client";
import { readableBoksError } from "@/lib/boks/errors";
import { maxMusicCredit, musicCreditNames } from "@/lib/boks/music-credit";

type Saving = "idle" | "saving" | "saved" | "failed";

/**
 * «Музыка»: who made the music in the piece's Series, optional
 * (`20261125200000_boks_music_credits.sql`). Readers see it under the
 * author's name on the feed's cover and on the Series ending. Saved on its
 * own, as the author leaves the field, so it never holds up the text, the
 * queue or publishing, and can be added after the Series is out.
 */
export function MusicCreditField({ bokId, compact = false }: { bokId: string; compact?: boolean }) {
  const [value, setValue] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const loaded = loadedFor === bokId;
  const [saving, setSaving] = useState<Saving>("idle");
  const [problem, setProblem] = useState("");
  const saved = useRef("");

  useEffect(() => {
    let active = true;
    if (!supabase) return;
    supabase.rpc("get_my_bok_music", { p_bok_id: bokId }).then(({ data }) => {
      if (!active) return;
      const music = typeof data === "string" ? data : "";
      saved.current = music;
      setValue(music);
      setLoadedFor(bokId);
    }, () => { if (active) setLoadedFor(bokId); });
    return () => { active = false; };
  }, [bokId]);

  const save = async () => {
    const music = value.replace(/\s+/g, " ").trim();
    if (!supabase || music === saved.current) return;
    setSaving("saving");
    setProblem("");
    const { error } = await supabase.rpc("set_my_bok_music", { p_bok_id: bokId, p_music: music });
    if (error) {
      setSaving("failed");
      setProblem(readableBoksError(error, "Не получилось сохранить. Попробуйте ещё раз.", "ru"));
      return;
    }
    saved.current = music;
    setValue(music);
    setSaving("saved");
  };

  const names = musicCreditNames(value);
  return (
    <label className={`desk-music${compact ? " is-compact" : ""}`}>
      <span className="desk-music-head">
        <b>Музыка</b>
        <small>необязательно</small>
        {saving === "saving" ? <small className="desk-music-state">Сохраняем…</small> : saving === "saved" ? <small className="desk-music-state">Сохранено</small> : null}
      </span>
      <input
        value={value}
        disabled={!loaded}
        maxLength={maxMusicCredit}
        placeholder="Например: Л. Булдыгин, В. Рвачев"
        aria-describedby={`desk-music-note-${bokId}`}
        onChange={(event) => {
          setValue(event.target.value);
          if (saving !== "saving") setSaving("idle");
        }}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <small id={`desk-music-note-${bokId}`} className="desk-music-note">
        {problem
          ? problem
          : names
            ? `Читатели увидят под вашим именем: «Музыка: ${names}».`
            : "Если в серии звучит музыка, напишите её авторов: одного или нескольких, как хотите их назвать. Строка появится под вашим именем."}
      </small>
    </label>
  );
}
