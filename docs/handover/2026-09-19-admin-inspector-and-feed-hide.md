# Admin inspector and admin-only hide from the feed (2026-09-19)

Working log, kept current so another session can pick this up mid-task.

## The request

1. From the admin console, open one specific boks - from Moderation, Rights and
   Content - through **one shared view**, so there is a single thing to maintain.
2. In People, open one person: the boks they wrote, liked and commented on, and
   their own metrics, for analytics.
3. In the reader feed, a button next to Share, **admins only**, that hides a
   boks: it goes to `archived` (the admin "Deleted" view), is not erased, only
   after a warning, and must be impossible for anyone but an admin.
4. Test, then deploy.

## What already existed (uncommitted work in the tree when this started)

- `supabase/migrations/20260919200000_boks_admin_content_and_user_lifecycle.sql`
  (already applied to production): `archive_bok`, `restore_archived_bok`,
  `delete_archived_bok`, `get_boks_content(..., p_status)`, `get_boks_people`,
  bans, account deletion. Every mutation is a security-definer RPC that checks
  `is_boks_admin(auth.uid())`, which reads the role from `user_profiles` (not
  the JWT) and refuses banned or deleted accounts.
- `authenticated` has only `SELECT` on `public.reels`; `anon` has nothing. No
  client can change a boks's status except through those RPCs.
- Content tab already has Published / Deleted scopes with archive, restore and
  typed-title permanent deletion.

## Plan

- [x] Migration `20260919220000_boks_admin_inspector.sql`:
      `get_admin_bok(uuid)` and `get_admin_person(uuid)`, admin-only, same metric
      definitions as `get_boks_content` / `get_boks_people`.
- [x] `checks.sql`: admin-only access; metrics agree with the list RPCs; the
      hide authorisation matrix (guest, reader, the boks's own author, banned
      admin, direct table update - all refused; admin allowed); a hidden boks
      leaves `published_boks`, candidates and reaction counts.
- [x] Data layer + types (`loadAdminBok`, `loadAdminPerson`).
- [x] `admin/admin-inspector.tsx`: one Sheet, a context with `openBok(id)` /
      `openPerson(id)`, back stack. Bok view and person view.
- [x] `admin/bok-lifecycle-dialog.tsx`: archive / restore / delete dialog shared
      by Content and the bok view.
- [x] Wire Moderation, Rights, Content, People to the inspector.
- [x] Reader: admin-only Hide button after Share, warning dialog with reason,
      `archiveBok`, the boks leaves the admin's feed at once.
- [x] lint, typecheck, test, verify:schema, build; `supabase db push --linked`
      before `npm run deploy`; verify on tryboks.com.

## Progress

- Migration + checks done: `BOKS_SCHEMA_PORT=55439 npm run verify:schema` ->
  37 migrations, 266 checks (30 new). Port 55432 is taken on this machine by
  another project's container (`crm1980-scratch`); do not stop it.
- Running `checks.sql` twice on a kept container fails on the very first
  assertion ("a fresh database serves the for_you ranker") - that is expected;
  run `npm run verify:schema -- --down` first for a fresh database.
- Client done. Files: `components/boks/admin/{inspector-context,admin-inspector,
  bok-inspector,person-inspector,bok-lifecycle-dialog,inspector-format}.tsx|ts`;
  `reader-place.ts` gained `composeReaderRanking` (feed + opened boks + held
  boks - boks hidden this visit), used by all three ranking sites in
  `reader-feed.tsx`. `ActionButton` gained `tone="danger"`.
- lint, typecheck, 320 unit tests green before build.
- Deployed: migration `20260919220000` pushed (`supabase db push --linked`),
  then Worker versions `f0fae3e9` and `2f587b21` (the second fixes the person
  tabs showing list length instead of totals, and a new view opening at the
  previous view's scroll position).
- Verified on production:
  - guest and reader sessions are refused by `archive_bok`, `restore_archived_bok`,
    `get_admin_bok`, `get_admin_person` (guest: no EXECUTE at all; reader:
    "Admin access required."), and by direct PATCH / DELETE on `reels`
    ("permission denied for table reels"). Probed with a nonexistent id, so a
    failure of the guard could not have changed data.
  - Content → title → boks view; Rights → title → boks view; People → person
    view (numbers equal the People row); boks view → liker → person view →
    commented boks → boks view → Back; Escape closes.
  - Reader as admin: 4th rail button, warning dialog, Cancel leaves the boks,
    reason required, Hide moves on to the next boks with a notice; the boks left
    `published_boks`, reaction counts and feed candidates for readers; it showed
    in Content → Deleted with reason and "by @boks"; restored from the boks view,
    the Deleted list refreshed itself, and readers saw it again.
    The boks used was "Sonnet 21" (public domain); its `reviewed_at/by` now
    record the restore.
  - Phone width (390px): the admin rail's 4 buttons fit (247px).
- Not verified live: opening a boks from Moderation - the production queue was
  empty. Same `openBok` wiring as the other tabs.
- Local Postgres container removed after the run.
