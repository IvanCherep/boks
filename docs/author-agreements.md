# The author contract online

Status 2026-11-23: semi-automatic. The team still talks to every author and
prepares the page; the author accepts the contract on the site with three
boxes, works in the cabinet at once, and pays by QR code or СБП; the team
marks the payment in Studio. No acquiring yet.

Migrations: `20261123100000_boks_author_agreements.sql` (tables, calls,
guards) and `20261123110000_boks_author_terms_20261123.sql` (the texts,
generated). Client: `lib/boks/author/agreement.ts`,
`components/boks/author-cabinet/{invite-terms,agreement-card,terms-page}.tsx`,
`components/boks/admin/author-agreement.tsx`. Checks: the last block of
`scripts/local-supabase/checks.sql`.

## The flow

1. The team agrees the plan with the author by email or messenger and gets
   the full name, a short biography, a photo and the email for the account.
2. Studio → Authors → the page: name, address, photo, works as before.
   «Пригласить автора» now has the plan (`Кабинет автора` 30 000 ₽,
   `Совместный запуск` free, `без продвижения` 500 000 ₽, or no offer for a
   special project arranged separately) and, optionally, the full name for
   the contract. The link goes to the author.
3. The author opens the link and signs in with the code from the email.
   The invitation screen shows the plan and its price, the full name (filled
   in when the team wrote it), and three unticked boxes, each with its
   document: the offer, the consent to processing, the consent to
   distribution. «Принять и открыть кабинет» works once the name looks like
   a full name and all three are ticked.
4. Accepting is the contract (`accept_author_invite_with_terms`): a row in
   `author_agreements` with the number (`2026/001`, numbered within the
   year), the plan and price, the name, the email, the versions of the three
   texts, the time, the address (`x-forwarded-for`) and the browser. The bare
   `accept_author_invite` refuses an invitation with a plan
   (trigger `boks_invite_needs_terms`).
5. The cabinet opens at once («подготовительный период»): texts, the
   teleprompter, the queue. «Договор и оплата» is on My page and on the
   Workshop's home: the amount, the day to pay by (30 days), «Оплатить»
   with the QR code, the СБП phone, the purpose with the contract number,
   and «Я оплатил(а)».
6. «Я оплатил(а)» sets `reported`; the team's Telegram hears it
   (`deploy/ops/inbox.py`, feed `contracts`, which also announces each
   acceptance and each marked payment).
7. The team checks the bank, then Studio → Authors → «Договоры авторов» (or
   the page's «Договор и оплата») → «Оплата получена»: the day the money
   came, the amount, optionally the receipt link from «Мой налог». The year
   runs from that day; the author sees «Оплачен … · действует до …». The
   receipt is not on the site: the team sends it to the author in a personal
   message (the link stays in Studio for the team).

Until the payment is marked, nothing of the author's opens to readers: the
page, a work on it, a bok (`boks_guard_unpaid_publication` on
`author_spaces`, `author_space_works` and `reels`, for the author's own
actions; Studio is not held). The publish button on My page says so.
A free plan (`launch`) has nothing to pay and its year starts at acceptance.

## The way in (the letter to new authors)

`20261123180000_boks_author_start_path.sql`, `components/boks/admin/author-seeds.tsx`,
`app/api/admin/author-seeds/[seed]/voice/route.ts`. The letter promises:
the author replies with texts (and recordings, if any), the team prepares a
closed page with them, the author accepts the invitation, records the rest
with the teleprompter, queues the pieces, pays, gets the first Series and
opens the page with all of them at once.

- **Texts from the team.** Studio → Authors → the page → «Тексты для
  кабинета»: paste a text (title optional, poem or prose), «Приложить запись»
  for the author's own file (audio, or an mp4/webm video up to 25 MB; a
  larger video: take the sound out first). They wait on the page
  (`author_space_seeds`) and become the author's Workshop drafts when the
  invitation is accepted (trigger on `author_space_invites`), keeping the id,
  so a recording attached earlier (`voices/<id>/`) is already the author's
  chosen take. A page that already has its author gets a new text at once.
  An account that has not accepted the site's terms yet gets the texts the
  moment it does (drafts are its own writes). Once handed over a text is the
  author's: Studio cannot change it, and attaches a recording only while it
  is still a draft.
- **An account with a page of its own.** Accepting merges the team's page
  into it (as before) and now marks that page verified, so the Workshop and
  the voice open for it too.
- **No Series work before the payment.** `studio_accept_bok` refuses while
  the author's contract is `awaiting` or `reported`; Moderation shows
  «ждёт оплаты» and the contract number beside such pieces.
- **The page opens with all its first Series.** While the page is closed,
  the Workshop has no per-Series «Опубликовать»: it says how many are ready
  of how many in work, and once none is left with the editors offers
  «Открыть страницу с N сериями», which publishes the page with every ready
  Series in one call (since 2026-11-25 the author unticks any that should
  wait).

Not covered: an author who already owns a team-made page (a special
project) cannot be given a paid contract from Studio yet (the invitation
needs a page without an owner).

## Who pays

`20261123190000_boks_author_billing.sql`, `components/boks/admin/author-billing.tsx`.
The way in serves two kinds of authors, and the page says which
(`author_spaces.billing`), set in Studio → the page → «Условия автора»:

- `partner`, **наш автор** (default): partners brought in through the team's
  contacts, special projects, and every author from before the online
  contract. No payment step, no yearly limit in the Workshop
  (`get_my_workshop` gives `perYear: null`); the team decides how many
  Series go out together by how many it accepts into work.
- `paid`, **по договору**: the contract's tariff (`author_agreements.plan`,
  `price_rub`; new tariffs need no change to this). Accepting an invitation
  with a paid tariff makes the page paid; one without a tariff, or a free
  one, keeps it ours.

The yearly number of Series belongs to the tariff
(`boks_plan_series_per_year`: 30 for the paid tariffs, none for free and
ours) and is written on the contract when it is accepted
(`author_agreements.series_per_year`): if it changes one day (with a new
edition of the offer), contracts keep the number they were signed with.

Switching a paid author to ours waives the payment on the contract
(`pay_state = 'waived'`: the author sees «Без оплаты, по договорённости с
редакцией», the year starts that day). Switching back asks for it again with
a fresh 30 days. An author with no paid contract cannot be made paid from
here yet: they need an offer on a paid tariff, and an invitation is only for
a page without an owner.

## What the author sees (walkthrough 2026-11-23)

- The invitation says what waits in the cabinet («В кабинете уже ждут 3
  ваших текста, 2 из них с вашей записью») and, for a paid tariff, «до 30
  серий в год, не чаще одной в неделю».
- After accepting, and whenever a verified author opens `/author`, the
  Workshop is home (`/author/desk`); «Моя страница» is in its header.
- While the page is closed the Workshop home starts with «Как откроется ваша
  страница» (`components/boks/author-desk/start-path.tsx`): Тексты, Голос,
  Отдать редакции, Оплата (paid only), Серии, Страница открывается; only the
  current step is explained, with its button (Прочитать, Отдать все
  записанные, Оплатить, Открыть страницу с N сериями).
- Queue dates («на этой неделе») only for a paid author whose page is open
  and paid; before the payment «после оплаты», otherwise no week promised.
- Saving: a text that did not reach the server is kept in the browser
  (`boks-desk-unsaved-v1`), protected from the next load, and sent again
  when the connection returns; the «Добавить текст» sheet keeps what was
  pasted until it is saved.
- After the page opens: «Поделитесь сериями…» in «Ждёт вас» until the post
  links are sent (with the 30-day date for paid authors).

## The texts

`docs/legal/author/{offer,processing,distribution}.md`, in a small markdown
subset (`lib/boks/author/legal-markdown.ts`: `#`, `>`, `##`, `###`,
paragraphs, `- `, tables, `**bold**`). They are stored word for word in
`boks_legal_documents` (kind, version, sha256), and a stored edition is never
changed (trigger). The site shows them at `/author/terms/offer`,
`/author/terms/processing`, `/author/terms/distribution`, the edition in
force or `?v=<version>`, with the checksum.

A new edition: edit the files, then
`node scripts/legal/author-terms-sql.mjs <YYYY-MM-DD> <migration stamp>`,
and apply the migration it writes. New invitations show it at once; an
author who accepted earlier keeps the edition the contract names. An author
with the page open when it changes is asked to reload.

## Payment details

Studio → Authors → «Договоры авторов» → «Реквизиты для оплаты»
(`author_payment_details`, one row): recipient, ИНН, account, bank, BIC,
correspondent account, the СБП phone and bank, and optionally a ready
payment link. The QR code is the link when there is one, else the bank
receipt format (ГОСТ Р 56042-2014, `ST00012`) with the amount and the
purpose filled in. Check it with a couple of banking apps before sending
authors to it. The details are shown only to an author whose contract waits
for payment.

## Not yet

- No acquiring: checks in «Мой налог» are made by hand and pasted as a link.
- An unpaid contract is not closed automatically after 30 days; the team
  decides (the offer, 5.2.2).
- Cancelling a contract (refund, refusal) has a state (`cancelled`) but no
  Studio button yet.

## One name (2026-11-24)

An author's account and their page have one @name. A page made from an
application keeps the applicant's @handle (Studio leaves the address empty and
shows it); the team types another only when the author asks for a pen name.
Names are unique across accounts and pages with one lock
(`20261124120000_boks_handle_one_owner.sql`); service names are refused for
pages too, and Studio says while typing whether an address is free.

The author changes it themselves: Workshop → «изменить адрес» (My page). No
hand work follows: `/@old` and `/a/old/photo` lead to the new address, the
previews and story cards are drawn from the current name, the shelf places a
section by its Series (`seriesShelfPrints`), and the old name stays the
author's so nobody else can take it. Only files the team made by hand (share
card pictures with a name drawn in) would need redoing.

## Contract and payments (2026-11-24)

The author's contract lives on `/author/billing` («Договор и оплаты», or
«Договор и документы» when nothing is paid): the tariff and its year, the
Series made against the yearly number, every payment with its receipt, the
document editions they accepted, earlier contracts. The Workshop and My page
show the contract card only while a payment is asked for; otherwise one quiet
link at the foot of the Workshop and under My page.

Payments have their own table (`author_payments`, `20261124140000`), so a
contract can carry a renewal or an extra payment and a year more than one
contract. The tariff's payment still lives on the contract row, where Studio
and the guards read it; a trigger keeps its payment row the same. The receipt
is now on the site (on this page only) and still goes by email (offer, 5.3).
Studio lists a contract's payments under it.

## Keeping track (2026-11-24)

Studio › «Авторы» opens on «Ведение авторов»: one row per author, from the
application to the open page (`studio_author_pipeline` gathers the facts,
`lib/boks/author/pipeline.ts` decides, tested). Each row has the step (dots:
Заявка → Страница → Приглашение → Тексты и голос → Оплата for paid → Series →
Открытие → Публикуется), whose move it is («Наш ход» / «Ждём автора» / «Всё
идёт»), what to do next and since when, and one button to where it is done:
the application, the page, Модерация or «Boks Series в работе». Ours come
first; a wait longer than its step should take (`stuckAfterDays`) is
«застрял». Filters: Ждут нас, Застряли, Ждём автора, Страница открыта, Все;
search by name, @ or email.

## Our authors without a contract (2026-11-25)

Walked end to end for friends of the team (`docs/author-runbook.md`, «Наш
автор»). Two fixes:

- The invitation has no tariff chosen until the team picks one («Пригласить»
  waits). It used to start on the paid «Кабинет автора», so a friend invited in
  a hurry saw 30 000 ₽ and an offer.
- Posts with a link to each Series are a contract's condition (any tariff,
  «Сотрудничество» included): the date («ждём ссылку на пост до …», «до 25
  декабря») and «условие тарифа» show only to an author with a contract that is
  not cancelled (`useShareLinks().duty`, from `get_my_author_agreement`), and
  «Ведение авторов» reminds about posts only for them. Before, an author of
  ours with no contract got a 30-day date, while a «Сотрудничество» author did
  not see it on the Workshop home (it was tied to `billing = 'paid'`).

- «Открыть страницу с N сериями» lets the author choose: every ready Series
  ticked, untick what should not go out yet (`OpenPage` in
  `components/boks/author-desk/start-path.tsx`). The rest stay ready, with
  their own «Опубликовать» once the page is open. Before, the page could only
  open with all of them, and «Попросить исправить» held the opening until the
  team redid that one.

Not built: the site sends the author no email when a Series is ready; the team
writes to them.
