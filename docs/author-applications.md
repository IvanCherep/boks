# The page for authors and applications

`/author` is the author cabinet only for an account that has one: something
published under its name, an author page it holds (`author_spaces`), an
invitation from the team, or Studio. Everyone else - a guest, a reader with
nothing published - sees the page for authors
(`components/boks/author-landing/`): what boks offers, the recording
cabinet, and a form to apply. Whether an account has a cabinet is
`get_my_author_access()`; if that call fails the cabinet is shown, as before
the page existed.

## What it offers

The offers follow the author contract (v7, 2026-11-22); the page gets them from
`scripts/author-landing/terms.mjs`, which must run after every import.

| Offer (form value → `offer`) | Price | |
|---|---|---|
| Совместный запуск (`launch` → `launch`) | free | everything in «Кабинет автора»; a link to every published Series in the author's social media, and the posts about boks reach 30 000 views in total within the first 3 months; open to authors with 500 followers or more, each application considered individually |
| Кабинет автора (`author` → `page`), in the middle | 30 000 ₽ a year | page and cabinet, 5 starting Boks Series guaranteed, then more as the editors can (at most one a week, up to 30 a year in all) in the author's voice, pictures and sound by the editors, the author publishes; condition: a link to every published Series in the author's social media |
| Кабинет автора без продвижения (`nopromo` → `page_no_promotion`) | 500 000 ₽ a year | the same without the condition; no card of its own: a «?» on the condition of «Кабинет автора» explains why we ask authors to share and offers this plan (`scripts/author-landing/why-share.js`, `.css`); its radio in the form is hidden until chosen there |

`series` (five Series for 10 000 ₽) is no longer offered; old applications keep it.

## The page

Since 2026-11-18 the page is the designers' own build (version 22 of
`boks-author-landing`, commit 5c89c84): a static page in
`public/author-landing/` that `/author` shows in a frame over the whole
screen (`components/boks/author-landing/author-landing.tsx`). Its styles
reset the whole document, so it does not share one with the app. It reads:
the invitation and the collage of classics with Прохоров; what boks is
(text, design, Boks Series, read or listen); «полет сквозь сны» in a gold
frame as a published example; the author's path in five steps; what the
author gets, with what is coming marked "Soon"; selection; the three offers;
the application. Every format opens only after the application is approved.
Promises on the page must stay true: anything not yet live carries "Soon".

A new version from the designers comes as a zip: unzip it and run
`node scripts/author-landing/import.mjs <folder>`. The import copies only
what the page uses and then:
- keeps a living author's files out of this public repository: Прохоров's
  portrait and the whole «полет сквозь сны» (text, recording, pictures) are
  read from his link-only folders on the server (`docs/link-only-pieces.md`);
  locally they are blank, which is expected;
- turns links to tryboks.com into paths and opens them outside the frame;
- adds `scripts/author-landing/bridge.js`: the application goes through
  this app (`submit_author_application`, as a guest or with the session), a
  draft waits in the tab until it is sent, a guest gets "Sign in" (an invited
  author signs in here and the cabinet opens), a signed-in applicant sees the
  status of the last application, the page's language switch sets the app's;
- makes it fast: one minified script and one stylesheet, pictures no wider
  than they are shown (760 px, WebP), every picture lazy (SVG ones too, through
  the bridge), the opening collage never loads on a phone, the poem's manifest
  is asked for in `<head>` and only its frame is filled in when it arrives;
- prerenders the Russian page into `index.html` and writes
  `landing-version.ts`, which goes into the frame's address so no cached copy
  outlives a release.

The frame starts with /author's own HTML, before the app's scripts
(`early-frame.ts`): unless the browser keeps a signed-in session (every
guest has an anonymous one, which does not count) or an invitation link,
an inline script creates it at once; the app adopts it, or drops it when
the account turns out to have a cabinet. Measured 2026-11-18 on a phone
profile with a 1.6 Mbit/s, 150 ms connection and brotli: first paint 1.3 s,
288 KB before scrolling (the designers' hosted copy: 2.5 s, 2.4 MB).

The question to the team and the letter to readers are not in this version
(removed at the designers' request on 18 November).

## Applications

`submit_author_application` (`20261117150000_boks_author_applications.sql`,
open to guests since `20261118150000_boks_author_applications_guests.sql`):
a name, at least one link, a way to reach them, the offer (`launch`, `page`,
`page_no_promotion` or `unsure`; old rows may say `series`), optionally the audience and a few words. Nobody has to
sign in: a guest's application has no account (`user_id` null) and carries the
device id (`visitor_id`, the reader's `boks-reader` id); the team answers
through the contact left in the form. Three a day per account or per device,
and at most sixty guest applications an hour in total. The draft waits in this
tab's storage until it is sent. A signed-in applicant later sees that the
application is in and what became of it.

The team works them in Studio → Authors → «Заявки» (admins only), below.

## Working an application

Studio → Authors → «Заявки» is a small CRM (`components/boks/admin/author-applications.tsx`,
order and waits in `lib/boks/author/applications.ts`, migration
`20261125090000_boks_application_crm.sql`). Each application has:

- **a stage** (`author_applications.stage`), moved by hand as the conversation goes:

  | Stage | Russian | Whose move | Too long after |
  |---|---|---|---|
  | `new` | Новая | ours | 2 days since it came |
  | `written` | Написали, ждём | the author's | 5 days: write again or close |
  | `replied` | Ответили нам | ours | 2 days |
  | `agreed` | Договорились | ours: make the page, invite | 2 days |
  | `declined` | Отказ | closed | |
  | `silent` | Не отвечает | closed | |

  Making the author's page from an application moves it to `agreed`
  (`studio_link_application`). `status` (new / contacted / closed) is derived
  from the stage, because the applicant's own page and the Telegram feed read
  it; the old `set_author_application_status` still works and moves the stage.
- **«Что уточнить»** (`focus`): one line the team keeps current (what is open,
  what worries us, what to ask), shown on the list.
- **a journal** (`author_application_events`): notes, stage moves (from, to,
  an optional why) and every change of «Что уточнить», each with who and
  when, newest first. Nothing is edited or deleted; what the person filled in
  is never changed.

The list opens on «В работе», our moves first with the longest waiting on
top, then those waiting for the author; filters «Наш ход», «Ждём ответа»,
«Закрытые», «Все», and a search by name, contact, @handle, links or the line.
A row says the stage, whose move and for how many days, and is marked when it
waits too long. Opened, it shows the stage buttons, the line, the journal and
everything the person sent (the contact as a link when it is an email,
Telegram, VK or a phone), their account or that they applied as a guest, and
how many other applications came from the same account, device or contact.
«Ведение авторов» reads the same stage for whose move it is.

## To the team's Telegram

`deploy/ops/inbox.py`, run every minute by `alerts.sh`, posts each new
feedback note (with the page or step it came from), each application, and
each work an author sends for review (not the team's own imports) to the
team's group through the Telegram relay (`ops/notify.sh`). Each feed keeps a
watermark in the ops state folder; the first run only sets it.

Прохоров's page and the published example open in a new tab.
