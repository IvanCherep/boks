"use client";

import { useCallback, useEffect, useState } from "react";
import { blankWork, moveInQueue, resendCheck, shiftInQueue, textKey, withHistory, type Outcome, type Work } from "@/lib/boks/author-desk/workflow";

/**
 * The prototype keeps the desk in this browser: works and the release queue
 * in localStorage, recorded takes in IndexedDB. The real desk would keep them
 * in Supabase and the Series drafts store, as the cabinet and the recorder do.
 */

const key = "boks-desk-prototype-v5";

export type DeskState = {
  works: Work[];
  queue: string[];
  /** Boks Series of this author published this year before these works (the demo's history). */
  publishedEarlier: number;
};

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString();

const september = `Сентябрь стоит, как гость у двери,
не зная, можно ли войти.
Ещё тепло, но ты не верь:
ему уже пора в пути.

И яблоко в траве лежит,
как будто кто-то уронил
и не вернулся. И дрожит
над ним последний мотылёк без сил.`;

function seed(): DeskState {
  const borodino = blankWork("Бородино");
  borodino.form = "poem";
  borodino.createdAt = day(6);
  borodino.updatedAt = day(0);
  borodino.idea.notes = [
    { text: "Хочу писать про Бородино. Боюсь, что зашквар: всё уже сказано, и Лермонтов, и Толстой. Но событие достойное.", at: day(6) },
    { text: "Через глаза молодого драгуна. Не панорама, а то, что он видит в строю. Батальные сцены без пафоса.", at: day(5) },
  ];
  borodino.idea.concept = {
    about: "Бородино не как парад славы, а как один день людей, которые не знают, что войдут в историю.",
    approach: "Взгляд молодого драгуна изнутри строя, крупные детали вместо панорамы, сухая интонация без пафоса.",
    form: "Поэма в нескольких главах, около 10 минут чтения вслух.",
    plan: [
      { id: "p1", text: "Утро перед боем, туман над Колочей", done: true },
      { id: "p2", text: "Атака на флеши", done: false },
      { id: "p3", text: "Драгун и его значки", done: false },
      { id: "p4", text: "Сцена матери с молодым офицером", done: false },
      { id: "p5", text: "Вечер после боя: тишина", done: false },
    ],
  };
  borodino.materials = [
    { id: "m1", kind: "fact", text: "Утром 26 августа (7 сентября) 1812 года над полем стоял туман; бой начался около шести утра.", source: "Михайловский-Данилевский", pinTo: "Утро перед боем, туман над Колочей" },
    { id: "m2", kind: "image", text: "Ржаное поле, ещё не убранное: бой идёт по хлебу.", source: "был на поле в августе", pinTo: "Атака на флеши" },
    { id: "m3", kind: "phrase", text: "«Картечь хлестнула», «фрунт», «ушёл на ретираду».", source: "солдатские записки" },
    { id: "m4", kind: "note", text: "В вечерней главе вернуть мотив ржи: та же рожь, но уже примятая.", pinTo: "Вечер после боя: тишина" },
    { id: "m5", kind: "source", text: "Бородинский музей-заповедник: письма офицеров к матерям. Спросить в фондах про 1812-1813.", pinTo: "Сцена матери с молодым офицером" },
  ];
  borodino.text = `I

Туман над Колочей лежал,
как будто поле не проснулось.
Драгун коня не понукал:
коню ли знать, куда всё гнулось.`;

  const father = blankWork("Про отца, без названия");
  father.createdAt = day(1);
  father.updatedAt = day(1);
  father.idea.notes = [{ text: "Думаю написать про отца и его гараж. Пока не понимаю, рассказ это или стихи.", at: day(1) }];

  const voiced = (work: Work, seconds: number) => {
    work.takes = [{ id: `t-${work.id}`, seconds, at: day(2), source: "teleprompter" }];
    work.chosenTake = work.takes[0].id;
    return work;
  };

  const sept = voiced(blankWork("Сентябрь стоит"), 41);
  sept.form = "poem";
  sept.createdAt = day(3);
  sept.updatedAt = day(1);
  sept.text = september;
  sept.editors = { step: "queued", notes: [] };

  const letter = voiced(blankWork("Письмо брату"), 184);
  letter.createdAt = day(9);
  letter.updatedAt = day(2);
  letter.text = "Здравствуй, Миша. Пишу тебе с дачи, где всё так же, как при отце: скрипит калитка, и никто её не смазывает, потому что этот скрип и есть дача. ".repeat(4);
  letter.editors = {
    step: "approval",
    notes: [
      { from: "author", text: "В середине я сбился на слове «калитка», можно ли взять этот кусок из второго дубля?", at: day(2) },
      { from: "editors", text: "Да, склеили из второго. Серия готова: посмотрите и публикуйте, когда захотите.", at: day(1) },
    ],
  };

  const imported = ["Ноябрьская", "Зимний сад", "Девочка и маяк", "Электричка до Голицына", "Колыбельная для взрослого", "Восемь писем", "Дом на Песочной"].map((title, index) => {
    const work = blankWork(title);
    work.importedFrom = index % 2 ? "Стихи.ру" : "Проза.ру";
    work.form = index % 2 ? "poem" : "prose";
    work.createdAt = day(20 + index);
    work.updatedAt = day(20 + index);
    work.text = `${title}. `.repeat(3) + "Текст перенесён редакцией с прежней площадки и ждёт голоса автора. ".repeat(3);
    return work;
  });
  // Imported works already read aloud: one being made this week, one published
  // last week, and one the editors made in advance and fixed in the queue.
  voiced(imported[0], 95).editors = { step: "production", notes: [] };
  voiced(imported[1], 120).editors = { step: "published", notes: [], publishedAt: day(4) };
  imported[0].updatedAt = day(2);
  const lullaby = voiced(imported[4], 140);
  lullaby.editors = { step: "queued", notes: [{ from: "editors", text: "Эту серию мы собрали заранее, к Новому году. Её место в очереди закреплено.", at: day(3) }], fixed: true };
  // One text the author put aside for later.
  imported[6].shelved = true;
  const letters = voiced(imported[5], 88);
  letters.editors = { step: "queued", notes: [] };

  const h = (who: "author" | "editors", what: string, offset: number) => ({ who, what, at: day(offset) });
  letter.history = [h("author", "Записал голос", 9), h("author", "Поставил в очередь", 9), h("editors", "Взяла в работу", 6), h("editors", "Собрала серию, передала автору", 1)];
  imported[0].history = [h("editors", "Перенесла с площадки Проза.ру", 25), h("author", "Записал голос", 3), h("author", "Поставил в очередь", 3), h("editors", "Взяла в работу", 2)];
  imported[1].history = [h("editors", "Перенесла с площадки Стихи.ру", 26), h("author", "Записал голос", 12), h("editors", "Взяла в работу", 10), h("editors", "Собрала серию, передала автору", 5), h("author", "Опубликовал серию", 4)];
  lullaby.history = [h("author", "Поставил в очередь", 8), h("editors", "Закрепила место в очереди", 3)];
  sept.history = [h("author", "Записал голос", 2), h("author", "Поставил в очередь", 2)];
  letters.history = [h("author", "Поставил в очередь", 1)];

  return {
    works: [borodino, father, sept, letter, ...imported],
    queue: [sept.id, lullaby.id, letters.id],
    publishedEarlier: 37,
  };
}

function load(): DeskState {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as DeskState;
  } catch {
    /* private window: start from the demo */
  }
  return seed();
}

/* Pure steps the hook applies. */
const now = () => new Date().toISOString();
const touch = (work: Work): Work => ({ ...work, updatedAt: now() });
const note = (work: Work, from: "author" | "editors", text: string): Work => ({
  ...work,
  editors: { ...work.editors, notes: [...work.editors.notes, { from, text, at: now() }] },
});
const fixedOf = (current: DeskState) => new Set(current.works.filter((work) => work.editors.fixed).map((work) => work.id));
/** Changes one work, stamping the time. */
const change = (current: DeskState, id: string, fn: (work: Work) => Work): DeskState => ({
  ...current,
  works: current.works.map((work) => (work.id === id ? touch(fn(work)) : work)),
});

const reorder = (current: DeskState, id: string, queue: string[], who: "author" | "editors") => {
  if (queue.join() === current.queue.join()) return current;
  const place = queue.indexOf(id) + 1;
  return { ...change(current, id, (work) => withHistory(work, who, `Переставил на ${place}-е место`)), queue };
};

export function useDesk() {
  const [state, setState] = useState<DeskState | null>(null);
  // Read after hydration: the server has no localStorage.
  useEffect(() => {
    const timer = window.setTimeout(() => setState(load()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!state) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage full or blocked: the session still works */
    }
  }, [state]);

  const update = useCallback((id: string, fn: (work: Work) => Work) => setState((current) => current && change(current, id, fn)), []);
  const add = useCallback((work: Work) => setState((current) => current && { ...current, works: [work, ...current.works] }), []);
  const reset = useCallback(() => setState(seed()), []);

  /* The author's side ------------------------------------------------ */

  /** Puts a voiced work at the end of the queue, with an optional note to the editors. */
  const enqueue = useCallback((id: string, text?: string) => {
    setState((current) => {
      if (!current || current.queue.includes(id)) return current;
      const target = current.works.find((work) => work.id === id);
      if (target?.outcome && !resendCheck(target).ok) return current;
      const next = change(current, id, (work) => {
        const queued = withHistory(
          { ...work, shelved: false, outcome: undefined, editors: { ...work.editors, step: "queued", revising: false } },
          "author",
          work.outcome ? "Отправил снова после доработки" : "Поставил в очередь"
        );
        return text ? note(queued, "author", text) : queued;
      });
      return { ...next, queue: [...current.queue, id] };
    });
  }, []);
  const dequeue = useCallback((id: string) => {
    setState((current) => {
      if (!current || current.works.find((work) => work.id === id)?.editors.fixed) return current;
      const next = change(current, id, (work) => withHistory({ ...work, editors: { ...work.editors, step: null } }, "author", "Убрал из очереди"));
      return { ...next, queue: current.queue.filter((item) => item !== id) };
    });
  }, []);
  const move = useCallback((id: string, index: number) => {
    setState((current) => current && reorder(current, id, moveInQueue(current.queue, id, index, fixedOf(current)), "author"));
  }, []);
  const shift = useCallback((id: string, step: -1 | 1) => {
    setState((current) => current && reorder(current, id, shiftInQueue(current.queue, id, step, fixedOf(current)), "author"));
  }, []);
  /** The author asks for corrections to a finished Series: back to the editors for up to a week. */
  const requestFix = useCallback((id: string, text: string) => {
    update(id, (work) =>
      withHistory(note({ ...work, editors: { ...work.editors, step: "production", revising: true } }, "author", text), "author", "Попросил правки")
    );
  }, [update]);
  const approve = useCallback((id: string) => {
    update(id, (work) => withHistory({ ...work, editors: { ...work.editors, step: "published", publishedAt: now() } }, "author", "Опубликовал серию"));
  }, [update]);
  const say = useCallback((id: string, from: "author" | "editors", text: string) => update(id, (work) => note(work, from, text)), [update]);

  /* The editors' side ------------------------------------------------ */

  /** Fix a place in the queue (a Series made in advance), or free it. */
  const toggleFixed = useCallback((id: string) => {
    update(id, (work) => withHistory({ ...work, editors: { ...work.editors, fixed: !work.editors.fixed } }, "editors", work.editors.fixed ? "Открепила место" : "Закрепила место в очереди"));
  }, [update]);
  /** The editors may reorder freely, fixed places included. */
  const editorsShift = useCallback((id: string, step: -1 | 1) => {
    setState((current) => current && reorder(current, id, shiftInQueue(current.queue, id, step), "editors"));
  }, []);
  /** Take a work into this week's production, whatever its place. */
  const take = useCallback((id: string) => {
    setState((current) => {
      if (!current) return current;
      const next = change(current, id, (work) => withHistory({ ...work, editors: { ...work.editors, step: "production", fixed: false, revising: false } }, "editors", "Взяла в работу"));
      return { ...next, queue: current.queue.filter((item) => item !== id) };
    });
  }, []);
  /** Hand a checked Series (or one with corrections done) to the author. */
  const handOver = useCallback((id: string) => {
    update(id, (work) => {
      const text = work.editors.revising ? "Правки внесли. Посмотрите серию ещё раз." : "Серия готова. Посмотрите её целиком и опубликуйте или напишите, что поправить.";
      return withHistory(note({ ...work, editors: { ...work.editors, step: "approval", revising: false } }, "editors", text), "editors", work.editors.revising ? "Внесла правки, передала автору" : "Собрала серию, передала автору");
    });
  }, [update]);

  /**
   * The editors cannot take it as it is: back to the author for changes, or a
   * refusal. The reason goes to the conversation and the history; the piece
   * leaves the queue and is not counted against the year.
   */
  const decide = useCallback((id: string, kind: Outcome["kind"], category: Outcome["category"], reason: string) => {
    setState((current) => {
      if (!current) return current;
      const at = now();
      const next = change(current, id, (work) =>
        withHistory(
          note({ ...work, outcome: { kind, category, reason, at, textKey: textKey(work.text) }, editors: { ...work.editors, step: null, fixed: false, revising: false } }, "editors", reason),
          "editors",
          kind === "changes" ? "Вернула на доработку" : "Отказала"
        )
      );
      return { ...next, queue: current.queue.filter((item) => item !== id) };
    });
  }, []);

  /** Demo of a week on the editors' side: what is being made goes to the author, a free week takes the top of the queue. */
  const passWeek = useCallback(() => {
    setState((current) => {
      if (!current) return current;
      let next = current;
      for (const work of current.works.filter((item) => item.editors.step === "production")) {
        next = change(next, work.id, (item) => {
          const text = item.editors.revising ? "Правки внесли. Посмотрите серию ещё раз." : "Серия готова. Посмотрите её целиком и опубликуйте или напишите, что поправить.";
          return withHistory(note({ ...item, editors: { ...item.editors, step: "approval", revising: false } }, "editors", text), "editors", item.editors.revising ? "Внесла правки, передала автору" : "Собрала серию, передала автору");
        });
      }
      const [top, ...rest] = next.queue;
      if (!top) return next;
      next = change(next, top, (item) => withHistory({ ...item, editors: { ...item.editors, step: "production", fixed: false } }, "editors", "Взяла в работу"));
      return { ...next, queue: rest };
    });
  }, []);

  return { state, update, add, reset, enqueue, dequeue, move, shift, requestFix, approve, say, toggleFixed, editorsShift, take, handOver, passWeek, decide };
}

export type Desk = ReturnType<typeof useDesk>;

/* Takes: audio blobs by take id. */

function openTakes(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("boks-desk-takes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("takes");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTake(id: string, blob: Blob) {
  try {
    const db = await openTakes();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("takes", "readwrite");
      tx.objectStore("takes").put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* kept for this tab only */
  }
}

export async function readTake(id: string): Promise<Blob | null> {
  try {
    const db = await openTakes();
    return await new Promise((resolve) => {
      const request = db.transaction("takes").objectStore("takes").get(id);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Playable addresses of a work's recorded takes, freed when the work changes. */
export function useTakeUrls(work: Work) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void Promise.all(work.takes.map(async (take) => [take.id, await readTake(take.id)] as const)).then((pairs) => {
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const [id, blob] of pairs) {
        if (!blob) continue;
        next[id] = URL.createObjectURL(blob);
        made.push(next[id]);
      }
      setUrls(next);
    });
    return () => {
      alive = false;
      made.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [work.takes]);
  return urls;
}
