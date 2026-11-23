# The author's desk (concept and local prototype)

Status 2026-11-21: a prototype at `/author/desk`, local only. Nothing here is
in production, and the page keeps everything in the visitor's browser.

## Why

boks wants to be for authors what a firm's back office is for lawyers: the
one place a writing person works in and never has to leave. They think,
gather, write and keep drafts here, talk to the editors here, and every work
that leaves the desk becomes a Boks Series with the author's own voice.

Rules from the owners (2026-11-21):

- **Every bok goes out with the author's voice.** A work reaches the editors
  only with a chosen reading.
- **Pictures are ours.** The author cannot upload or choose an image. The
  editors draw every picture so the library looks like one book. The author
  can describe in words what is wrong.
- **No AI in the desk**, neither ours nor the author's, for now. The desk keeps
  things in order; it does not write, suggest or check.
- **The standard plan: at most one Boks Series a week and 30 a year (50 until 2026-11-23) per
  author.** The editors make them fully themselves; the author sets the
  order of the free places, and the editors can fix places (a Series made in
  advance) that the author cannot move.
- **Corrections take up to a week.** They do not hold the queue.
- **The first three rooms are a sandbox, not a gate.** Many authors arrive
  with finished texts and go straight to the voice.
- **The author publishes.** A finished Series comes back to the author, who
  watches it whole and publishes it when they want.

The desk is for paying authors and for authors brought in by a campaign.
When the team brings an author, it moves their old works in from other
platforms as drafts without a voice; the desk asks for a reading of each.

## Three steps, the same everywhere

**Текст → Голос → Серия.** The welcome, every text's screen and the home all
use the same three steps. The words are the same everywhere too: «текст»,
«запись», «серия», «очередь», «бок» (an outside review of every screen,
2026-11-22, replaced «дубль», «Ваш стол», «Перенесено редакцией», «тариф»).

1. **Текст**: paste a finished text («Добавить текст») or start a draft.
   Notes are optional and live in one side panel, «Заметки»: what the text is
   about, what it must hold (ticked by hand), thoughts, and materials pinned
   to a part of the text. The pinned ones show in the margin while writing.
2. **Голос**: two equal ways, «Записать с суфлёром» or «Загрузить готовую
   запись». Each recording has a quiet player; one is marked «Пойдёт в серию».
   «Исправить текст» works from here; a recording made before a change is
   marked and the queue waits for a new one. The teleprompter lights one short
   line at a time, has «Пауза», «Скорость», «Начать заново» and «Готово».
3. **Серия**: the place in the queue, the editors' work, the ready Series
   («Посмотреть», then «Опубликовать» or «Попросить исправить»), and one
   conversation with the editors about this text.

The home, top to bottom: a greeting with one main button «Добавить текст»
(«или начать черновик» beside it); **Ждёт вас**, only when something does (a
ready Series, texts to read aloud with «Прочитать все подряд», a recorded text
not yet given, an editors' reply); **Очередь**; **Черновики**; **Отложено**;
**Опубликовано**.

**Отложено.** An author can keep texts without recording them: «Сохранить на
потом» when adding, «Отложить на потом» on a text, «Позже» in the reading
list. Such texts wait for nothing and leave «Ждёт вас»; «Вернуть в работу»
brings them back.

## When the editors cannot take a piece

A text or a recording may not pass the editors: the law, the recording
(noise, mistakes, not the author's voice), the text itself, or another reason.
The editors never drop a piece silently. In Studio, on a queued or a
production piece: **На доработку** or **Отказать**, each with a category
(«Запись», «Текст», «Законодательство», «Другое») and a written reason, which
the author reads word for word; there is no way to send either without one.

- **На доработку**: the piece leaves the queue (not counted against the year)
  and comes back to the author. «Ждёт вас» shows «Редакция просит доработать»
  with the reason; the Серия step quotes the editors and offers the right
  action («Записать заново» or «Исправить текст»), then «Отправить снова».
- **Отказать**: «Редакция не сможет выпустить этот текст» with the reason. The
  text stays with the author; it cannot be sent again as is, and the
  conversation on the same screen is the way to ask or disagree.

Both are in the text's history and the editors' Studio view.

## The queue

The desk's home shows the queue as its own block, under any finished Series:

- **The allowance**: "20 из 30 серий в 2026 году · осталось 10", and the plan's
  rule under it.
- **This week**: the work the editors are making. It cannot be moved.
- **Corrections**: a Series back with the editors for up to a week; the queue
  does not wait for it.
- **The queue**: every other voiced work, each with its planned week
  (`plannedWeeks`: one a week from the first free week; a year that has used
  its 30 is skipped, and the work is marked "в счёт 2027 года").
- **Fixed places** (lock, gold): the editors fixed them, say because the
  Series is already made in advance. The author cannot drag, shift or remove
  them; dragging and ↑ ↓ move the free works around them (`moveInQueue`,
  `shiftInQueue`).
- **Recorded but not queued**: one press adds them at the end.

Each Monday the editors take the top work. A finished Series waiting for the
author does not hold the queue: the next week's work starts anyway. The
editors fix and free places from Studio; the prototype has "вид редакции" to
show it.

**Why the author publishes.** It keeps the author in charge of their own page
and gives them a moment worth coming back for. The editors have already
checked the Series before handing it over, so the author's step is "yes, now"
or "please fix this", never quality control. "Отправить на правки" sends it
back for up to seven days, then it returns to the author. Something to decide later: if a
ready Series sits unpublished for, say, two weeks, remind the author, or
publish it on a date they chose.

## Voice: two equal ways, never a picture

The voice room offers two cards side by side: **Записать с суфлёром** and
**Прикрепить свою запись** (mp3, m4a, wav, ogg, up to 15 minutes; a studio
recording is welcome). There is no picture input anywhere on the desk, and the
page says why: illustrations and the Series assembly are the team's.

The live Series recorder follows the same rule (branch `author-no-pictures`,
`docs/series-recorder.md` there): an author has Text, Recording and «Редакция»;
the server refuses pictures and builds from a non-admin.

## Transparency for the editors

`/author/desk#studio` is the editors' view of one author (the demo bar at the
top switches between the two views):
- the author, the plan, "20/30 серий", how many works are queued, without a
  voice, and in the sandbox (a count only: thoughts, materials and drafts are
  the author's own);
- the rules in one paragraph;
- four columns: the author's queue (planned week, lock, ↑ ↓ for any place,
  fix/free, take into work), in work (hand to the author; corrections with
  the author's words and how long ago), with the author (waiting since,
  remind), published;
- a work opens with its chosen take to listen to, the text, the thread with a
  reply box, and its history.

Every step on either side is written to the work's history (`withHistory`):
recorded or attached, queued, moved, taken out, fixed, taken into work, handed
over, corrections asked and done, published. The author sees the same list
under the release room's «История».

## The prototype

- Page: `app/author/desk/page.tsx`, UI `components/boks/author-desk/`,
  styles `app/author-desk.css` (the cabinet's tokens).
- Data: localStorage (works, queue) and IndexedDB (recorded takes), seeded
  with a demo desk: Бородино in the writing room, a finished Series to
  publish, one being made this week, one queued, five imported works without
  a voice, one published. "Вернуть демо-стол" resets it.
- "Демо: прошла неделя" plays the editors' side: the Series in production
  (or in corrections) becomes ready, the top of the queue goes into
  production. "вид редакции" fixes and frees places.
- The demo author has published 37 Series this year before these works.
- The finished Series preview plays the author's own take with the lines in
  time; the picture is a stand-in.
- Teleprompter: `teleprompter.tsx`, the Series recorder's approach in small.

Run it: `BOKS_PLATFORM=node npx vinext dev --port 5196`, then open
`/author/desk`.

## To make it real

- Works, materials, queue and threads in Supabase with RLS by owner; takes go
  to the Series drafts store; the editors' states are set from Studio.
- Studio: each author's queue top as the week's job, fixing places, the
  thread, corrections, "hand to the author" when the Series is checked.
- The plan (per week, per year) per author or tariff in the database, the
  allowance enforced there, not only shown.
- Remove "Upload your own" cover and cover drawing from My page.
- Interface strings into `defineMessages` with English.
