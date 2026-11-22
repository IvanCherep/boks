# From today's author cabinet to the Workshop

Status 2026-11-22: a plan. The Workshop (`/author/desk`, `docs/author-desk.md`)
is a prototype that keeps everything in the browser; today's cabinet
(`/author`) is live. This is how the two become one place without an author
losing a text, a recording, a follower or a habit.

## The end state

- **Мастерская** is where an author works: texts, notes, voice, the queue, the
  editors' answers. Three steps everywhere: Текст → Голос → Серия.
- **Моя страница** is the shop window readers see: photo, name, address, the
  order of works, the preview. It stays as it is.
- **Studio** prepares Series, answers, fixes queue places.
- One source of truth: the Workshop reads and writes the same rows the cabinet
  uses today. Nothing is copied, so there is nothing to migrate by hand.

## What is live, by kind of account

Every author on boks today is one the team made a page for and invited by
email, or opened a page for on an existing account (owner, 2026-11-22). So
the Workshop reaches all current authors at once; "ordinary authors" below
are a future case, not a live one.

| Account | `/author` today | Where it goes |
|---|---|---|
| Guest, or an account with nothing published | The page for authors and an application (`docs/author-applications.md`) | Unchanged. An accepted application leads into the Workshop. |
| Ordinary author (not verified) | «Мои тексты»: write or upload, review, stats, withdraw | None today. Decide before opening sign-ups to authors. |
| Verified author (page made or invited by the team) | «Моя страница»: works the team prepared, order, preview, publish chosen; «Новый бок» composer; «Просьбы и предложения»; own Boks Series (hidden since 2026-11-22) | The Workshop, plus «Моя страница» as the window. |
| Studio | Moderation, Authors, Series recorder | Moderation keeps working; a Workshop queue view joins it. |

The branch `editors-covers` (not yet released) already moves the verified
author's composer to the Workshop's rules: every new bok goes to the editors
with the author's voice (`bok_voices`), covers and Series are the editors',
and the editors answer with a reason (`bok_editor_decisions`).

## Every live piece, mapped

| Live today | In the Workshop |
|---|---|
| `reels` row, `draft` | **Черновики** (Текст), or **Прочитайте вслух** when the text is long enough and has no voice |
| `draft` with `shelved_at` (new) | **Отложено** |
| `pending_review` + `cover_requested`, with a voice | **Очередь**, in the order sent (first sent, first) |
| The same, taken by Studio this week | **Сейчас рисуем** |
| `bok_editor_decisions` kind changes | **Ждёт вас**: «Редакция просит доработать» |
| `bok_editor_decisions` kind refused | **Ждёт вас**: «Редакция не сможет выпустить» |
| `author_space_works` `ready` (a Series the team prepared) | **Ждёт вас**: «Серия готова», the author publishes |
| `author_space_works` `preparing` | **Очередь**, «Сейчас рисуем» or fixed by Studio |
| `published` | **Опубликовано**, with the stats the cabinet shows today |
| `bok_voices` takes | The **Голос** step's recordings |
| `author_space_messages` | One conversation: per text on **Серия**, general under «Написать редакции» |
| Series recorder drafts (authors) | Untouched, hidden; Studio can finish them |

## Data to add

All forward migrations, RLS by owner, RPCs over table grants (ADR 0011).

1. **Queue**: `bok_queue (bok_id pk, author_id, position, fixed boolean, queued_at)`;
   RPCs `enqueue_my_bok`, `move_my_bok` (refuses fixed places), `dequeue_my_bok`,
   Studio `studio_fix_place`, `studio_take_bok`, `studio_hand_over`. Sending to
   the editors (`save_my_bok` with the editors) becomes "join the queue".
2. **Plan**: `author_plans (author_id, per_year default 50, per_week default 1)`;
   the year's count comes from what Studio took, not from a counter.
3. **Notes**: `bok_notes (bok_id pk, author_id, about, plan jsonb, thoughts jsonb, materials jsonb)`,
   only the author reads them; Studio sees none of it.
4. **Shelving**: `reels.shelved_at timestamptz`, the author's own flag.
5. **Studio's steps**: `bok_series_state (bok_id, state: drawing | revising | ready, at)`
   or reuse `author_space_works` where the piece belongs to a page.

Voices, decisions, covers and the review statuses already exist on the branch.

## Steps, each shippable on its own

**0. Release `editors-covers`.** The cabinet follows the new rules today.
Authors notice: no instant publishing, no own covers or Series, a voice to send.
*Before*: tell the verified authors (a message to them needs the owner's yes).

**1. The Workshop reads the server (behind a flag, verified authors only).**
`/author/desk` shows the author's real texts in the Workshop's sections,
mapped as above; actions still open today's composer. Nothing new is written.
*Exit*: three real authors see exactly their texts, nothing missing.

**2. The Workshop writes.** «Добавить текст», notes, «Отложить», the Голос step
on `bok_voices`, «Отдать в работу» into `bok_queue`, the Серия step with the
conversation and decisions. Studio gets the queue view (the prototype's
`#studio`) next to Moderation. «Новый бок» on «Моя страница» opens the
Workshop's «Добавить текст»; «Моя страница» gets the «Мастерская» card; the
Workshop's header links to «Моя страница». Pieces already waiting for a cover
join the queue in the order they were sent.
*Exit*: one author goes from text to a published Series through the Workshop
and Studio, on production, with the team watching.

**3. The Workshop is home.** `/author` opens the Workshop for verified
authors (the first visit shows «Три шага»); «Моя страница» stays one tap
away. The old composer goes. «Прочитать все подряд» and imports from other
platforms (texts as drafts, «со Стихов.ру») arrive here.
*Exit*: a week without an author asking where something went.

**4. Authors who come on their own** (none today), by the decision below,
before sign-ups for authors open.

Rollback at every step is the flag: the cabinet keeps working on the same rows.

## Links between the two, at each step

| From | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| «Моя страница» | (nothing new) | card «Мастерская»; «Новый бок» → Workshop «Добавить текст» | the Workshop is `/author`; «Моя страница» from its header |
| Workshop header | «Моя страница», «Написать редакции» | same | same |
| A text in the Workshop | «Открыть в кабинете» | its own three steps | same |
| Old links `/author#my-page-new`, `#series` | as today | → Workshop «Добавить текст» / My page | same |
| You → Settings «Кабинет автора» | as today | as today | → Workshop |

## Open questions for the owners

1. **Authors who come on their own, later** (no plan, not invited): every bok goes out with a
   Series, and Series are the editors' paid work. Options: (a) they keep the
   review flow but must add a voice and wait for the editors' choice;
   (b) the Workshop for writing and keeping texts, sending opens with a plan;
   (c) no change until campaigns bring them in.
2. **Order of pieces already waiting** when the queue starts: by date sent, or
   let each author order them on first visit.
3. **Telling authors**: a short note before step 0 and at step 3 (needs a yes;
   it messages people).
4. **Names**: «Написать редакции» everywhere (the cabinet says «Просьбы и
   предложения» today).
