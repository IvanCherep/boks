# Pre-launch QA, before the first 100 test readers (2026-09-19)

Working log, kept current so another session can continue.

## How it is being tested

- **Guest** flows on `https://read.tryboks.workers.dev` - same Worker as
  tryboks.com, but a different origin, so the browser has no session there.
- **Signed-in** flows on `https://tryboks.com` with the owner's (admin) account.
- Desktop and phone width (390 px, via an iframe of the same origin).
- Two background code reviews: reader side; account/author/admin side.
  Findings are verified before anything is changed.
- Test data created on production (comments, likes, submissions) is removed
  afterwards and listed here.

## Checklist

Reader, guest: first load; tap shows controls; next/previous (buttons, keys,
swipe, pull); like/comment/follow as guest -> sign-up prompt; share; bok menu
(copy link, report); author sheet; guest read limit notices and forced
sign-up; share link `/b/<id>`; language filter; theme; phone layout.

Reader, signed in: like/unlike; comment, reply, comment like; follow/unfollow;
library (read/liked/commented); settings (languages, theme; nickname not
changed); report.

Author: form validation, quota, submit, refusal with reason, revision.

Admin: every tab loads; inspector; moderation approve/refuse; content
hide/restore.

Static: terms/privacy pages, licence file, 404, bad share id.

## Findings and fixes

(appended as they happen)

1. **Escape did not close the comments, author or "This bok" sheets** unless
   focus was inside the sheet - and opening one from the rail leaves focus on
   the page. Fixed in `ReaderSheet`: a window listener, while the sheet is
   open. [fixed]
2. **No first-visit guidance.** With the controls hidden, a new reader sees
   only the text; on a phone next/previous are gestures only. [fixed: a
   one-time hint, `firstVisitHint` in reader-feed]
3. **"bok" is one, "boks" is several** (`countLabel`); "this boks" in copy is
   wrong. [fixed where found]
4. Author sheet listed 40 of a writer's boks under a heading with the full
   count. [fixed: p_limit 200 + "Showing the newest N of M"]
5. Every reader message (Link copied, like/follow/report/language errors)
   went to `status`, shown only on the empty-feed screen. [fixed: `notify()`]
6. Guest reads counted on arrival - flicking through 15 titles hit the wall.
   [fixed: counted after 8 s on screen, `guestReadDwellMs`]
7. One boks titled "* * *". [fixed: a wordless title counts as empty]
8. No way to delete a comment, for its writer or an admin. [fixed:
   `delete_boks_comment`, inline confirm in the sheet and the admin view]
9. Cloudflare Worker CPU (1102) intermittently fails any route - /author
   4/4 at one point. [owner: Workers Paid, $5/month]
10. Terms show an internal "have counsel adapt it" note; no contact; no
    privacy page. [note removed; privacy/contact need the owner]

From the two code reviews, verified before fixing:

- Email link opened in another browser (mail app's in-app browser): raw PKCE
  error shown, and the reader locked in the forced-signup panel. [fixed:
  plain message, closable sign-in panel; code sign-in needs a template change]
- Opening an old link signed a signed-in user out. [fixed: link errors no
  longer clear the session]
- "Sign out of this device" signed out everywhere, and left the old account's
  state in memory. [fixed: scope local + reload]
- Feed reloaded on every return to the tab (SIGNED_IN from session recovery).
  [fixed: reload only on a real identity change]
- Language filter not sent to the Worker feed. [fixed]
- Selecting text with the mouse turned the page. [fixed]
- Space after clicking a control pressed it again (unlike/unfollow). [fixed:
  blur on mouse click]
- Feed stopped dead after 80 boks. [fixed: next slate appended near the end]
- Like reloaded 80 boks per tap; rollback on reload failure; no in-flight
  guard. Share had no error handling and reloaded too. [fixed]
- Comment count double-counted after a fresher copy. [fixed: base-keyed delta]
- Opened boks replaced the feed's copy and lost a like twice. [fixed]
- Comments load failure looked like "No comments yet". [fixed: retry state]
- Follow under a byline followed the publisher silently. [fixed: "Follow @boks"]
- Author signing up from /author landed on / and lost the draft. [fixed:
  redirect + draft kept on the device]
- Author status off-screen on phones; Revise did not scroll. [fixed]
- Restore always published (a hidden pending boks skipped review); Approve
  ignored rights and accepted archived boks. [fixed: status remembered,
  approve needs confirmed rights]
- Revise created a second boks. [fixed: `p_bok_id`, resubmitted in place]
- Wordless titles in the database ("* * *"). [fixed: trigger + backfill]
- No self-service account deletion. [fixed: `delete_my_boks_account`]

Checked after that pass, on the owner's question - following is per account,
never per byline:

- The rail's Follow, the sheet's Follow and the Following list all write
  `author_user_id` (`reader-feed.tsx`, `author-sheet.tsx`,
  `user-auth-panel.tsx`); no path follows a name. `get_boks_author` filters a
  byline only inside one account (`author_handle` + `author_name`), so two
  accounts publishing the same writer stay two separate follows.
- Tapping the printed name opens that writer inside that account; tapping the
  @handle opens the account's whole catalogue (907 boks, 58 writers, follower
  count). Under a byline both buttons read "Follow @handle" so no one thinks
  they are following the dead poet.
- **Fixed in this pass:** a writer's list named its publisher as plain text,
  with no way into the account's catalogue from there. "published by @handle"
  is now a link back, and the note says another account publishing the same
  writer is followed separately. Worker `9c01a5c3`. [cosmetic, but it was the
  one dead end in that navigation]

## State at the end of the pass

- Deployed: Worker `066aad86-4615-4877-aebc-aa963e57290f` (tryboks.com and
  read.tryboks.workers.dev). Migration `20260919260000` pushed first; all 39
  migrations match (`supabase migration list --linked`).
- Gates before deploy: lint clean, typecheck clean, 355 unit tests pass
  (15 skipped: live Supabase flow), `verify:schema` 39 migrations / 300 checks,
  build clean.
- Checked on production after deploy: every route 200 (unknown path 404,
  unknown share id opens the reader); first-visit hint shows and leaves on the
  first turn; Escape closes comments; the "* * *" bok now reads "Прощай,
  немытая Россия"; `/api/feed` served by the Worker (200); no console errors.
- Load-more is covered by `reader-place.test.ts` (`shouldLoadMore`,
  `appendNewStories`); the live end-of-feed walk was impractical in a
  background tab.
- Not committed. Nothing pushed to GitHub in this pass.

## Not verified live, and why

- Signed-in flows on tryboks.com: the browser session there became a guest
  during testing (an old email link, which is the bug fixed above). Covered by
  `checks.sql` and unit tests; a signed-in walk by the owner is worth doing.
- Test guest `ddc9334c-36c0-4ea4-91d3-c5b4eb99a522` produced ~27 skip events
  on production analytics - exclude it.

## Settled on 2026-09-20

1. ~~Cloudflare Workers Paid~~ - bought; no CPU-limit errors since.
2. ~~Supabase compute~~ - Pro was already paid, project moved Nano -> Micro
   (1 GB) at +$0.00; slate cut to 30 boks, breaker to 2 min, `cpu_ms` capped.
3. ~~A real contact address~~ - `support@tryboks.com` receives through
   Cloudflare Email Routing and is published in the app.

## Owner decisions still open

1. Cloudflare Workers Paid ($5/month): the Worker uses 30-97 ms CPU per
   request against the Free plan's 10 ms; error 1102 took whole pages down.
   This is the one blocker for 100 readers.
2. Supabase compute upgrade (planned): Free Nano is swapping.
3. **Auth rate limits, still at their defaults** (Supabase ->
   Authentication -> Rate Limits). Changing them from this session is blocked
   by policy, so the owner sets them: sending emails 30/h -> **100/h**;
   anonymous sign-ins 30/h per IP -> **300/h** (every guest gets one, and a
   group on one Wi-Fi shares an IP); token verifications 30 per 5 min ->
   **100**; sign-ups and sign-ins 30 per 5 min -> **100**. Leave SMS and Web3
   alone. Also check Resend's daily email cap before a 100-person invite.
4. Sign-in by 6-digit code in the email (works across browsers and mail apps)
   needs an email template change in the Supabase dashboard.
5. A real contact address for Privacy/Terms (hello@tryboks.com has no MX);
   the page currently says "through the person who invited you".
6. Rotate the Resend API key that was pasted into a chat earlier.
7. Known limitations kept: a guest's history is not carried into the new
   account; the nickname is derived from the email.
