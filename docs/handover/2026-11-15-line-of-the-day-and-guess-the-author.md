# Line of the day and Guess the author (2026-11-15, local only)

Built from the "boks daily flows v2" mock-ups and flows. Branch `daily-flows`, worktree
`fd-daily`. Nothing committed, pushed, migrated or released.

## What exists

- Migrations `20261117100000_boks_lines.sql` (`shared_lines`, `daily_letters`, `line_links`,
  `saved_lines`, `reader_time_zones`), `20261117110000_boks_reader_days.sql` (`reader_days`) and
  `20261117120000_boks_author_game.sql` (`author_game_issues`, `author_game_candidates`,
  `author_game_answers`), all reached only
  through RPCs (ADR 0011). Behaviour is proven in `scripts/local-supabase/checks.sql`
  (the last two blocks): fair hand-out, never your own line, one letter per account and
  date, editorial fallback, signature rules, taken-down sources, deleted and suspended
  senders, time zones; game stocking, three different surnames, idempotent publication,
  editor's choice, fall-through, answers, reveal, empty catalogue, grants.
- Reader: selection menu in the text, send sheet, home envelope, letter, "Back to the
  letter" with the line marked; Settings → Received lines, Saved lines, Guess the author.
- Studio → Editorial → Guess the author: seven days, candidates, preview, replace, choose,
  return to automatic.

## Changed on the user's request (2026-11-15, second pass)

- Three actions on a selected line: Share with the world, Send a line (a link
  `/b/<bok>?line=<code>`, table `line_links`, `create_line_link` / `get_line_link`;
  `line` is forwarded by `lib/boks/shared-bok-redirect.ts`), Save for myself.
- The handle always signs a line; the "show my handle" switch is gone.

## Day card, My days and the guest's way in (third pass)

- Migration `20261117110000_boks_reader_days.sql`: `reader_days`, `get_daily_arrival`,
  `mark_daily_card_seen`, `get_my_days`. The day card (`components/boks/daily/day-card.tsx`)
  replaces the envelope prompt: once a day across devices, at the cover or the ending, and at
  once after a guest signs up. You → Settings → My days.
- Guests (`guest-cards.tsx`, `lib/boks/daily/days.ts`): a welcome on the first bok, a reminder
  every two boks (letter, game, progress, last two), an account after 10 (was 5 / 10 / 15;
  AGENTS.md updated). Signing up from any of them closes the panel and shows the welcome card.
- The old reminders' storage keys (`first`, `second`) are ignored; the new ones are `r2`..`r8`.
  A guest who already read 10-14 boks on the old rules meets the account screen on their next
  new bok.

## Decisions taken without the user

- No cron: the day's first request publishes the issue and restocks the next seven days;
  Studio restocks when opened. A server cron calling `boks_game_fill(7)` can be added.
- The game uses Russian catalogue texts only (`language = 'ru'`, publisher accounts,
  2 minutes or less, 20-360 words, named author).
- The line pool is lines shared in the 7 days before the reader's day began (shared today, received from tomorrow); a line already received by a reader in
  the last 60 days is given to them again only if nothing else is left.
- Editorial lines are automatic: the first line of a short catalogue poem chosen per date.
- A ceiling of 100 sent lines per account per day (anti-script, not a product quota) and
  2000 saved lines.
- Shares show from 10 confirmed answers; reveal is allowed and not counted.
- "Мои дни" (the previous concept's tracker) does not exist in the code, so opening a
  letter marks nothing yet.

## Before release

`bash deploy/migrate.sh` (it adds the migration), then the usual release; update
`docs/project-state.md` when it ships.
