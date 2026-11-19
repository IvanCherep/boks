# QA of every user journey, 2026-11-20

Local stack, a clean Chrome (no extensions, no profile), at phone width
(iPhone 13, also iPhone SE height) and on a desktop. Email by the local
Mailpit: `[auth.email.smtp]` was switched off for the run and restored after,
as `docs/local-environment-runbook.md` §2 says. The scripts and screenshots
were throwaway.

## Journeys walked

| Journey | Phone | Desktop |
|---|---|---|
| Guest: welcome, feed, read, swipe, like and comments ask to sign in, What to read, Series tab, end of feed | ok | ok |
| Guest limit: reminders at 2, 4, 6, 8 read boks; the wall at 10 (counted after 8 s of reading, not on the cover) | ok after B4 | - |
| Sign-up: email, 6-digit code, the welcome day card; from Like, from You, at the wall | ok after B5, B6, B7 | ok |
| Reader: comment, follow an author from their page, sign out, sign in again | ok | ok |
| Becoming an author: /author landing, the application signed in and as a guest; it shows in Studio → Authors | ok | ok |
| Invitation: Studio makes a page, adds a text, marks it ready, invites; the invitee opens the link, signs in, accepts, publishes the page; New bok appears | ok | - |
| Verified author: New bok drawn / own photo / editors' cover / draft; errors in Russian; list order and states | ok | ok |
| Reader sees the new author's boks with their covers, in the bok and on the author page | ok | ok |
| Editors' cover in Moderation; approve refused without a cover | ok (2026-11-19) | ok |

## Bugs found and fixed

- **B1.** The guest welcome said «С ним откроется ещё три вещи». Now it reads «откроются».
- **B2.** On a short phone (667 px), «Читать без аккаунта» sat under the screen
  edge of the guest welcome and the day card. They are now compact below 700 px
  height (`app/daily.css`).
- **B4.** A guest reaching the 10-bok wall got two sheets at once: the sign-up
  wall, and «Обратная связь, вы прочитали 10 боков» under it, which greeted
  them right after they signed up. Now the feedback milestone waits for a
  signed-in read.
- **B5.** A guest who tapped Like and signed up landed in «Ваша активность»
  with nothing liked. Now the like is kept through the sign-in and put on the
  same bok, and the account sheet closes. Signing up at the wall or from a
  reminder also returns to reading. Opening the account yourself still stays
  in it.
- **B6.** On a first sign-in, two concurrent `ensure_boks_user_profile` calls
  meant the slower one answered 409 (the nickname's unique index), although
  the row existed. It is now retried once.
- **B7.** The day card told a brand-new account «Угадай автора · Ответ дан ·
  Итоги» when there was no issue that day (status `none`). The row is hidden
  then.

## Noted, not changed

- **B3.** The reader's loading screen is server-rendered in English
  («Loading bok…») until the client knows the device language. It is visible
  only on a slow first load. A fix means reading `Accept-Language` on the
  server, which is a separate change.
- The application form on the designers' page requires «О вас и ваших
  текстах» (`required` in their HTML) without marking it required. The doc
  calls that field optional.
- A work the team prepares and the author publishes from an invitation can go
  out without a cover (it shows a letter). The cover rule binds the composer
  only.
- Local data only: the author landing's Прохоров files 404 locally (they live
  in link-only on the server); the local Series shelf is empty.
