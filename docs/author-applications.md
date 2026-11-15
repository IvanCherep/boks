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

| Offer | Price | |
|---|---|---|
| Author page | ~~45 000 ₽~~ 30 000 ₽ a year | up to 50 short works moved over, an illustration for each, page and cabinet designed, a year in the boks feed after review, the profile in the main Boks Series section for the year, the Series recorder, priority support (answered within a working day); until 1 January 2027 five Boks Series as a gift |
| Five Boks Series | 10 000 ₽ a pack | an extra for authors with a cabinet: five issues with illustrations and sound, in the author's voice or recorded with the teleprompter |
| Joint launch | free | everything in the Author page, on one condition: a series of posts about boks that reaches 30 000 views in total; open to authors with around 500 followers |

Above the offers, "Why boks": new readers beyond the author's own followers,
a page of a new kind, and Boks Series with a teleprompter.

The texts are in `components/boks/author-landing/messages.ts`; the page also
shows the Series recorder (`docs/series-recorder.md`) as the new format.

## Applications

`submit_author_application` (`20261117150000_boks_author_applications.sql`):
an account, a name, at least one link, a way to reach them, the offer
(`page`, `series`, `launch` or `unsure`), optionally the audience and a few
words. Three a day per account. A guest fills the form, signs in by email and
sends it; the draft waits in this tab's storage meanwhile. The page then says
the application is in and what became of it.

The team reads them in Studio → Authors, newest first, with the applicant's
@name and email, and marks each as written to or closed
(`list_author_applications`, `set_author_application_status`; admins only).

A question on the page carries where to answer it (Telegram, VK or email;
not a phone - the team is often abroad) and goes to Studio → Feedback as
`author_landing`.

## To the team's Telegram

`deploy/ops/inbox.py`, run every minute by `alerts.sh`, posts each new
feedback note (with the page or step it came from), each application, and
each work an author sends for review (not the team's own imports) to the
team's group through the Telegram relay (`ops/notify.sh`). Each feed keeps a
watermark in the ops state folder; the first run only sets it.

"See an example" opens Прохоров's page; its Back returns to this page
(a mark in this tab's storage, read once by that page within half an hour).
