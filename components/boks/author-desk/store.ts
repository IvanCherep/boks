"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { moveInQueue, shiftInQueue, textKey, type Work } from "@/lib/boks/author-desk/workflow";
import { queueFromServer, workFromServer, type ServerReady, type ServerWorkshop } from "@/lib/boks/author-desk/from-server";
import { loadWorkshop, saveMeta, setQueueOrder } from "@/lib/boks/author-desk/server";
import { deleteOwnDraft, newBokId, saveOwnBok } from "@/components/boks/author-cabinet/composer-data";
import { chooseTake, deleteTake, loadTakes, takeUrl, uploadTake, withdrawMySentBok } from "@/components/boks/author-cabinet/voice-data";
import { publishMyAuthorSpace, requestSpaceChanges, sendMyMessage } from "@/components/boks/author-spaces/data";
import { currentBoksTermsVersion } from "@/components/boks/user-auth-panel";
import { voiceFingerprint, voiceLimits, type VoiceTakes } from "@/lib/boks/author/voice/rules";
import { readableBoksError } from "@/lib/boks/errors";
import { supabase } from "@/lib/boks/supabase-client";
import { maxBokCharacters } from "@/lib/boks/contracts";

/**
 * The Workshop's state, on the server (`docs/workshop-server.md`): the
 * author's pieces come from `get_my_workshop()` and every change goes back
 * through the cabinet's own calls. The page answers at once; writes follow in
 * the background, text a moment after typing stops. A failed write says so in
 * Russian and the page reloads what the server has.
 */

export type DeskState = {
  works: Work[];
  queue: string[];
  publishedEarlier: number;
  plan: ServerWorkshop["plan"];
  author: ServerWorkshop["author"];
  ready: ServerReady[];
  /** Per piece: the Series' token and the work to publish, from the editors. */
  series: Record<string, { workId: string | null; revision: number | null; seriesPiece: string | null }>;
};

export type DeskStatus = "loading" | "ready" | "signed-out" | "not-author" | "error";

const textDelay = 700;
const metaDelay = 600;

function toState(data: ServerWorkshop): DeskState {
  const works = data.pieces.map(workFromServer);
  const series: DeskState["series"] = {};
  for (const piece of data.pieces) {
    if (piece.series) series[piece.id] = { workId: piece.series.workId, revision: piece.series.revision, seriesPiece: piece.series.seriesPiece ?? null };
  }
  return {
    works,
    queue: queueFromServer(data.pieces),
    publishedEarlier: 0,
    plan: data.plan,
    author: data.author,
    ready: data.ready ?? [],
    series,
  };
}

/** What the server's refusal means for the page. */
function classify(error: unknown): DeskStatus {
  const value = error as { message?: string; closed?: boolean; original?: { message?: string } } | null;
  const text = `${value?.message ?? ""} ${value?.original?.message ?? ""}`;
  // Signed out comes first: the database refuses a guest with the same errcode as a reader.
  if (/Sign in|Нужно войти|войдите/i.test(text)) return "signed-out";
  if (value?.closed || /Workshop is open|авторам/i.test(text)) return "not-author";
  return "error";
}

function notesOf(work: Work) {
  return {
    about: work.idea.concept?.about ?? "",
    plan: work.idea.concept?.plan ?? [],
    thoughts: work.idea.notes,
    materials: work.materials,
  };
}

export function useDesk() {
  const [state, setState] = useState<DeskState | null>(null);
  const [status, setStatus] = useState<DeskStatus>("loading");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  /** Counts loads from the server, for whatever should follow them. */
  const [loads, setLoads] = useState(0);
  const stateRef = useRef<DeskState | null>(null);
  const busyRef = useRef<Record<string, boolean>>({});
  const timers = useRef<Record<string, number>>({});
  const pendingText = useRef<Record<string, () => Promise<void>>>({});

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fail = useCallback((error: unknown, fallback = "Не получилось сохранить. Проверьте интернет и попробуйте ещё раз.") => {
    setProblem(error ? readableBoksError(error, fallback, "ru") : fallback);
  }, []);

  const refresh = useCallback(async () => {
    try {
      if (!stateRef.current && supabase) {
        const { data: session } = await supabase.auth.getSession();
        if (!session.session || session.session.user.is_anonymous) {
          setStatus("signed-out");
          return;
        }
      }
      const data = await loadWorkshop();
      const next = toState(data);
      // Words typed while the answer was on its way stay as typed.
      const typing = Object.keys(pendingText.current);
      if (typing.length && stateRef.current) {
        const mine = new Map(stateRef.current.works.map((work) => [work.id, work]));
        next.works = next.works.map((work) => {
          const local = typing.includes(work.id) ? mine.get(work.id) : undefined;
          return local ? { ...work, title: local.title, text: local.text } : work;
        });
      }
      stateRef.current = next;
      setState(next);
      setLoads((count) => count + 1);
      setStatus("ready");
    } catch (error) {
      const kind = classify(error);
      setStatus(kind);
      if (kind === "error") fail(error, "Не получилось загрузить мастерскую. Обновите страницу.");
    }
  }, [fail]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Coming back to the tab brings what the editors did meanwhile.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible" && !Object.keys(pendingText.current).length) void refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    // And while the page stays open: the editors' answers arrive without a reload.
    const timer = window.setInterval(() => {
      const idle = !Object.keys(pendingText.current).length && !Object.keys(pendingMeta).length && !Object.values(busyRef.current).some(Boolean);
      if (document.visibilityState === "visible" && idle) void refresh();
    }, 45_000);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(timer);
    };
  }, [refresh]);

  // Nothing typed is lost when the tab closes mid-save.
  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (Object.keys(pendingText.current).length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const local = useCallback((id: string, change: (work: Work) => Work) => {
    setState((current) => current && { ...current, works: current.works.map((work) => (work.id === id ? { ...change(work), updatedAt: new Date().toISOString() } : work)) });
  }, []);

  const mark = (id: string, on: boolean) => {
    busyRef.current = { ...busyRef.current, [id]: on };
    setBusy(busyRef.current);
  };

  /** Saves title and text now, if a save is waiting. */
  const flush = useCallback(async (id: string) => {
    window.clearTimeout(timers.current[`text:${id}`]);
    const save = pendingText.current[id];
    if (save) await save();
  }, []);

  /**
   * One change to a piece, as the page makes it: the page shows it at once;
   * title and text go to `save_my_bok` a moment later, the form, notes and
   * shelving to `save_my_workshop_meta`.
   */
  const update = useCallback(
    (id: string, change: (work: Work) => Work) => {
      const before = stateRef.current?.works.find((work) => work.id === id);
      if (!before) return;
      const after = change(before);
      local(id, () => after);
      if (stateRef.current) stateRef.current = { ...stateRef.current, works: stateRef.current.works.map((work) => (work.id === id ? after : work)) };

      if (after.title !== before.title || after.text !== before.text) {
        window.clearTimeout(timers.current[`text:${id}`]);
        const save = async () => {
          delete pendingText.current[id];
          const latest = stateRef.current?.works.find((work) => work.id === id) ?? after;
          if (latest.text.trim().length > maxBokCharacters) {
            setProblem(`Текст длиннее, чем помещается в бок (${maxBokCharacters.toLocaleString("ru-RU")} знаков). Сократите его, и он сохранится.`);
            return;
          }
          if (!latest.text.trim()) return;
          try {
            await saveOwnBok({ bokId: id, title: latest.title.trim(), text: latest.text, publish: false, cover: null });
            setProblem("");
          } catch (error) {
            fail(error);
          }
        };
        pendingText.current[id] = save;
        timers.current[`text:${id}`] = window.setTimeout(() => void save(), textDelay);
      }

      const meta: Record<string, unknown> = {};
      if (after.form !== before.form) meta.form = after.form;
      if (Boolean(after.shelved) !== Boolean(before.shelved)) meta.shelved = Boolean(after.shelved);
      if (JSON.stringify(notesOf(after)) !== JSON.stringify(notesOf(before))) meta.notes = notesOf(after);
      if (Object.keys(meta).length) {
        const key = `meta:${id}`;
        window.clearTimeout(timers.current[key]);
        const waiting = (pendingMeta[id] = { ...(pendingMeta[id] ?? {}), ...meta });
        timers.current[key] = window.setTimeout(async () => {
          const patch = pendingMeta[id] ?? waiting;
          delete pendingMeta[id];
          try {
            await saveMeta(id, patch);
          } catch (error) {
            fail(error);
            void refresh();
          }
        }, "shelved" in meta ? 0 : metaDelay);
      }
    },
    [fail, local, refresh]
  );

  /** A new piece: saved as a draft at once, so it exists on the server before anything else. */
  const add = useCallback(
    async (work: Work) => {
      const id = newBokId();
      const created = { ...work, id };
      setState((current) => current && { ...current, works: [created, ...current.works] });
      if (stateRef.current) stateRef.current = { ...stateRef.current, works: [created, ...stateRef.current.works] };
      if (!work.text.trim()) return created;
      try {
        await saveOwnBok({ bokId: id, title: work.title.trim(), text: work.text, publish: false, cover: null });
        const meta: Record<string, unknown> = {};
        if (work.form !== "poem") meta.form = work.form;
        if (work.shelved) meta.shelved = true;
        if (Object.keys(meta).length) await saveMeta(id, meta);
      } catch (error) {
        fail(error, "Не получилось сохранить текст. Проверьте интернет и попробуйте ещё раз.");
        setState((current) => current && { ...current, works: current.works.filter((item) => item.id !== id) });
        throw error;
      }
      return created;
    },
    [fail]
  );

  /** «Отдать в работу»: the latest text is saved, then the piece goes to the editors with its voice. */
  const enqueue = useCallback(
    async (id: string) => {
      const work = stateRef.current?.works.find((item) => item.id === id);
      if (!work || busyRef.current[id]) return;
      mark(id, true);
      try {
        await flush(id);
        await saveOwnBok({ bokId: id, title: work.title.trim(), text: work.text, publish: true, cover: null, coverByTeam: true });
        await refresh();
      } catch (error) {
        fail(error, "Не получилось отправить в редакцию. Попробуйте ещё раз.");
        await refresh();
      } finally {
        mark(id, false);
      }
    },
    [fail, flush, refresh]
  );

  /** «Отозвать»: back to the drafts while the editors have not taken it. */
  const dequeue = useCallback(
    async (id: string) => {
      if (busyRef.current[id]) return;
      mark(id, true);
      try {
        await withdrawMySentBok(id);
      } catch (error) {
        fail(error, "Не получилось отозвать. Возможно, редакция уже взяла текст в работу.");
      } finally {
        mark(id, false);
        await refresh();
      }
    },
    [fail, refresh]
  );

  const reorder = useCallback(
    async (next: string[]) => {
      const current = stateRef.current;
      if (!current || next.join() === current.queue.join()) return;
      setState({ ...current, queue: next });
      try {
        await setQueueOrder(next);
      } catch (error) {
        fail(error, "Не получилось сохранить порядок. Попробуйте ещё раз.");
        await refresh();
      }
    },
    [fail, refresh]
  );
  const move = useCallback((id: string, index: number) => void reorder(moveInQueue(stateRef.current?.queue ?? [], id, index)), [reorder]);
  const shift = useCallback((id: string, step: -1 | 1) => void reorder(shiftInQueue(stateRef.current?.queue ?? [], id, step)), [reorder]);

  /** «Опубликовать» the Series the editors sent. */
  const approve = useCallback(
    async (id: string) => {
      const current = stateRef.current;
      const link = current?.series[id];
      if (!current || !link?.workId || !link.revision) {
        setProblem("Серия ещё не готова к публикации. Обновите страницу.");
        return;
      }
      if (busyRef.current[id]) return;
      mark(id, true);
      try {
        await publishMyAuthorSpace({
          items: [{ workId: link.workId, revision: link.revision }],
          publishPage: current.author.pageStatus !== "published",
          termsVersion: currentBoksTermsVersion,
          requestId: crypto.randomUUID(),
        });
      } catch (error) {
        fail(error, "Не получилось опубликовать. Попробуйте ещё раз.");
      } finally {
        mark(id, false);
        await refresh();
      }
    },
    [fail, refresh]
  );

  /** «Попросить исправить» a Series the editors sent. */
  const requestFix = useCallback(
    async (id: string, note: string) => {
      const link = stateRef.current?.series[id];
      if (!link?.workId || busyRef.current[id]) return;
      mark(id, true);
      try {
        await requestSpaceChanges(link.workId, note);
      } catch (error) {
        fail(error, "Не получилось отправить просьбу. Попробуйте ещё раз.");
      } finally {
        mark(id, false);
        await refresh();
      }
    },
    [fail, refresh]
  );

  /** A note to the editors about one text, through the page's conversation. */
  const say = useCallback(
    async (id: string, _from: "author" | "editors", text: string) => {
      const work = stateRef.current?.works.find((item) => item.id === id);
      const link = stateRef.current?.series[id];
      local(id, (current) => ({ ...current, editors: { ...current.editors, notes: [...current.editors.notes, { from: "author", text, at: new Date().toISOString() }] } }));
      try {
        await sendMyMessage(link?.workId ? text : `«${work?.title || "Без названия"}»: ${text}`, link?.workId ?? null);
      } catch (error) {
        fail(error, "Сообщение не ушло. Попробуйте ещё раз.");
      }
    },
    [fail, local]
  );

  const removeDraft = useCallback(
    async (id: string) => {
      try {
        await deleteOwnDraft(id);
      } catch (error) {
        fail(error, "Не получилось удалить черновик.");
      } finally {
        await refresh();
      }
    },
    [fail, refresh]
  );

  /** After a recording is added, chosen or deleted: the list's view of the chosen one follows. */
  const voiceChanged = useCallback(
    async (id: string, takes: VoiceTakes) => {
      const work = stateRef.current?.works.find((item) => item.id === id);
      if (!work) return;
      const fingerprint = await voiceFingerprint(work.text);
      local(id, (current) => ({
        ...current,
        chosenTake: takes.chosen,
        takes: takes.takes.map((take) => ({
          id: take.file,
          seconds: Math.round(take.durationMs / 1000),
          at: take.createdAt,
          source: take.source === "upload" ? "file" : "teleprompter",
          name: take.name ?? undefined,
          textKey: take.fingerprint === fingerprint ? textKey(current.text) : `older:${take.fingerprint}`,
        })),
      }));
    },
    [local]
  );

  return {
    state,
    loads,
    status,
    problem,
    clearProblem: () => setProblem(""),
    busy,
    refresh,
    update,
    add,
    enqueue,
    dequeue,
    move,
    shift,
    approve,
    requestFix,
    say,
    removeDraft,
    flush,
    voiceChanged,
    fail,
  };
}

/** Meta changes waiting to be sent, merged per piece across quick edits. */
const pendingMeta: Record<string, Record<string, unknown>> = {};

export type Desk = ReturnType<typeof useDesk>;

/* Recordings ------------------------------------------------------------ */

export const audioTypes = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav|wave|ogg|webm)$/;

/** What is wrong with a file before it is sent, in the author's words; null when it is fine. */
export function fileProblem(file: File) {
  if (!audioTypes.test(file.type) && !/\.(mp3|m4a|aac|wav|ogg|oga|webm)$/i.test(file.name)) return "Это не аудиофайл. Подойдут mp3, m4a, wav, ogg или webm.";
  if (file.size > voiceLimits.takeBytes) return `Файл больше ${Math.round(voiceLimits.takeBytes / 1024 / 1024)} МБ. Сохраните запись в mp3 или m4a: так она станет меньше.`;
  if (file.size < 1024) return "Файл пустой или повреждён.";
  return null;
}

export function durationProblem(ms: number) {
  if (ms && ms > voiceLimits.takeMs) return "Запись длиннее 15 минут: бок столько не вмещает.";
  if (ms && ms < voiceLimits.minTakeMs) return "Запись слишком короткая.";
  return null;
}

/** A piece's recordings, with addresses to play them, loaded when the Голос step opens. */
export function useTakes(desk: Desk, work: Work) {
  const [takes, setTakes] = useState<VoiceTakes | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const made = useRef<string[]>([]);
  const { voiceChanged, fail, flush } = desk;

  const apply = useCallback(
    async (next: VoiceTakes) => {
      setTakes(next);
      await voiceChanged(work.id, next);
    },
    [voiceChanged, work.id]
  );

  useEffect(() => {
    let alive = true;
    const created = made.current;
    loadTakes(work.id)
      .then(async (loaded) => {
        if (!alive) return;
        await apply(loaded);
        const pairs = await Promise.all(loaded.takes.map(async (take) => [take.file, await takeUrl(work.id, take.file).catch(() => "")] as const));
        if (!alive) return;
        const next: Record<string, string> = {};
        for (const [file, url] of pairs) {
          if (!url) continue;
          next[file] = url;
          created.push(url);
        }
        setUrls(next);
      })
      .catch(() => {
        if (alive) setTakes({ ownerId: "", takes: [], chosen: null, uploads: 0 });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [apply, work.id]);

  const latestText = () => desk.state?.works.find((item) => item.id === work.id)?.text ?? work.text;

  const add = async (blob: Blob, seconds: number, source: "teleprompter" | "upload", name?: string) => {
    if ((takes?.takes.length ?? 0) >= voiceLimits.takes) {
      fail(null, `Можно хранить до ${voiceLimits.takes} записей. Удалите лишнюю и запишите снова.`);
      return;
    }
    setUploading(name ?? "запись");
    try {
      await flush(work.id);
      const fingerprint = await voiceFingerprint(latestText());
      const before = new Set(takes?.takes.map((take) => take.file));
      let next = await uploadTake(work.id, blob, { durationMs: seconds * 1000, source, name: name ?? null, fingerprint });
      const added = [...next.takes].filter((take) => !before.has(take.file)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      // The recording just made is the one meant for the Series; an older one can still be chosen.
      if (added && next.chosen !== added.file) next = await chooseTake(work.id, added.file);
      await apply(next);
      if (added) {
        const url = URL.createObjectURL(blob);
        made.current.push(url);
        setUrls((current) => ({ ...current, [added.file]: url }));
      }
    } catch (error) {
      fail(error, "Запись не загрузилась. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setUploading(null);
    }
  };

  const choose = async (file: string) => {
    try {
      await apply(await chooseTake(work.id, file));
    } catch (error) {
      fail(error);
    }
  };

  const remove = async (file: string) => {
    try {
      const fingerprint = await voiceFingerprint(latestText());
      await apply(await deleteTake(work.id, file, fingerprint));
    } catch (error) {
      fail(error, "Не получилось удалить запись.");
    }
  };

  return { takes, urls, loading, uploading, add, choose, remove };
}
