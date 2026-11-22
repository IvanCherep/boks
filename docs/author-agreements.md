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
   runs from that day; the author sees «Оплачен … · действует до …» and the
   receipt.

Until the payment is marked, nothing of the author's opens to readers: the
page, a work on it, a bok (`boks_guard_unpaid_publication` on
`author_spaces`, `author_space_works` and `reels`, for the author's own
actions; Studio is not held). The publish button on My page says so.
A free plan (`launch`) has nothing to pay and its year starts at acceptance.

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
