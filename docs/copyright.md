# Copyright

Two halves: an attestation on the way in, and a way to complain afterwards.

Neither is legal advice, and neither makes boks safe by itself. What they do is
make the question answerable — who said this could be published here, and what
happened when someone objected — instead of leaving it to memory.

---

## 1. Publishing asks, and will not take no for an answer

The submission form carries a required checkbox:

> **I hold the rights to publish this bok.**
> Your own work, or work you are allowed to publish — public domain, an open
> licence, or permission you have been given.

Submit stays disabled until it is ticked, and `submit_bok_for_review` refuses
the call regardless of what the page did: `p_rights_confirmed` defaults to
false, so an older or hand-rolled client gets *"Confirm you hold the rights to
publish this bok."* rather than quietly writing an unattested piece.

Underneath is an optional free-text field, **where the rights come from**. One
line is enough: `Project Gutenberg #1342, public domain`, `my translation`,
`permission from the estate`. It is the field that makes a public-domain
catalogue auditable a year later.

**The attestation is not remembered between pieces.** A box that stays ticked
has stopped being a statement about anything, and reworking a refused bok
clears it too — the refusal may have been about the rights.

### It is not public

The note can name a person, an estate or a contract, so it is not a column on
`reels`. It lives in `bok_rights`, a table whose row policy admits admins only.

That choice is worth understanding, because the obvious alternative is wrong:
`authenticated` holds table-wide `SELECT` on `public.reels`, and the row policy
admits every published row. A column there is readable by any signed-in reader
through PostgREST — including one nobody thought to query, because `select *`
returns it. A separate table makes the privacy a row policy on a table whose
whole purpose is to be admin-only, rather than a promise that no query ever
selects too much.

The cost: a bok could exist with no rights row, which a `not null` column would
have made impossible. `checks.sql` asserts the invariant instead — *"every bok
has a rights record"*.

---

## 2. Any reader can report a bok

Every bok has a **⋯** button in the action rail. It opens the bok's own sheet:
copy its link, or report a problem — **Copyright** or **Something else** — with
a reason.

- The reason is required and has to be a sentence or two. A report an admin
  cannot act on wastes the one person who reads it, so both the button and the
  RPC refuse anything under ten characters.
- **Guests can report.** The person whose work was taken does not necessarily
  have a boks account, and asking them to make one before they can complain is
  the wrong order.
- One open report per person per bok. Pressing it again says *"you have already
  reported this bok"* rather than piling up rows.
- Reporters cannot read the reports, not even their own. Asserted under a real
  `authenticated` session, not as an owner.

---

## 3. What an admin sees

Console → **Rights**. Two panels, because they are the same question asked from
opposite ends — *may this be here?*

**Reports.** Each complaint shows the reader's own words, and directly beneath
it what the author claimed: *"The author confirmed they hold the rights"* or
*"Nobody has confirmed the rights"*, plus their note. An admin deciding a
copyright complaint needs the claim and the grievance in one glance.

Two actions:

| Action | What happens |
|---|---|
| **Take the bok down** | Requires a reason. The bok goes to `rejected` and leaves the feed; the author sees the reason in their cabinet; the attestation is revoked so the piece cannot quietly come back. |
| **Dismiss** | The report closes. The bok stays up and the author is never told it was reported. |

Taking a piece down needed its own path: `review_bok_submission` only touches
boks that are `pending_review`, `rejected` or `archived`, so it cannot withdraw
something already published.

**Rights nobody has confirmed.** Boks published before boks asked the question,
and boks withdrawn after a report. Every pre-existing bok was backfilled as
*unattested* with a note saying so, rather than given an attestation nobody
made. An admin can record where the rights come from here. This list is the
honest state, not a queue that has to be emptied.

---

## 4. Importing a catalogue

A bulk load attests **once for the batch**, not per file: a Project Gutenberg
load is hundreds of files with the same answer. The console asks for the
confirmation and a batch note, and records both against every piece under the
importing admin's account.

A file that needs its own answer overrides the batch note with a front-matter
line — `rights:`, `license:`, `source:` and `permission:` all work:

```markdown
---
title: Pride and Prejudice, Chapter One
rights: Project Gutenberg #1342, public domain in the US
---
```

See `docs/catalogue-import.md` for the rest of the format.

---

## What this does not do

- **No takedown notice workflow.** There is no form for a formal DMCA-style
  notice, no counter-notice, and no record of correspondence. A report and an
  admin's note are what exist.
- **No jurisdiction anywhere.** "Public domain" is recorded as free text
  because it is not a single fact — a work can be public domain in the US and
  in copyright in the EU. The note says what the person believed; nothing
  checks it.
- **No automatic detection.** Nothing scans text against a corpus. The
  attestation is a person's word and the report is a person's objection.
- **No notice to the reporter.** They are told the report arrived, and nothing
  after that. If reports become frequent, telling a reporter the outcome is the
  first thing to add.

---

## Where it lives

| Piece | File |
|---|---|
| Tables, RPCs, the backfill | `supabase/migrations/20260916140000_boks_rights_and_reports.sql` |
| The attestation on the form | `components/boks/author-console.tsx` |
| The bok's menu and report sheet | `components/boks/reader-feed.tsx`, `components/boks/reader-sheet.tsx` |
| The admin panel | `components/boks/admin/rights-review.tsx` |
| Batch attestation | `components/boks/admin/catalogue-import.tsx` |
| Behaviour asserted | `scripts/local-supabase/checks.sql`, `lib/boks/supabase-flow.test.ts` |

RPCs: `report_bok` (any signed-in reader), and `get_boks_rights_review`,
`review_bok_report`, `set_bok_rights` (admin only).
