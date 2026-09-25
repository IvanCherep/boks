-- Who the Data API may reach, written down instead of inherited.
--
-- Two reasons, and the first one is a hole.
--
-- **`boks_public_identity` was writable by anyone.** It is `select user_id,
-- handle from user_profiles` - a simple view, so Postgres makes it updatable -
-- and `anon` held INSERT, UPDATE and DELETE on it, inherited from Supabase's
-- default grants on new objects in `public`. A view without `security_invoker`
-- runs as its owner, so row-level security on `user_profiles` does not apply to
-- writes through it. The publishable key ships in every browser. Probed against
-- production before this migration: `PATCH
-- /rest/v1/boks_public_identity?user_id=eq.<id>` answered 200 and `DELETE`
-- answered 204 - they changed nothing only because the id was one that does not
-- exist. Anyone could have renamed or deleted any reader's @handle.
-- `bok_rights` and `bok_reports` carried the same full grant for `anon`, where
-- the policies allow an admin to read and nothing else.
--
-- **And from 30 October Supabase stops granting new tables automatically.** A
-- migration that creates a table without a GRANT leaves it unreachable through
-- the Data API - on a new project, a preview branch, or a local reset. Existing
-- tables keep what they have, so production is unaffected, but a catalogue of
-- migrations that only works because of a platform default is a catalogue that
-- no longer rebuilds.
--
-- So: everything `anon` and `authenticated` hold in `public` is revoked, and
-- exactly what the app uses is granted back. The list below is the whole Data
-- API surface of boks; `scripts/local-supabase/checks.sql` asserts it, and
-- asserts that no view is writable by a reader, so neither mistake can return
-- quietly. `service_role` is untouched: it is the key the Edge Function holds
-- and it never reaches a browser.

revoke all on all tables in schema public from anon, authenticated;

-- Reading, for everyone, including guests.
grant select on public.published_boks to anon, authenticated;
grant select on public.boks_comments to anon, authenticated;
-- user_id and handle, which are what a byline shows anyway.
grant select on public.boks_public_identity to anon, authenticated;

-- Reading, for a signed-in reader. Row-level security decides which rows;
-- these grants only decide whether the table can be addressed at all.
grant select on public.reels to authenticated;
grant select on public.comments to authenticated;
grant select on public.author_follows to authenticated;
grant select on public.recommendation_events to authenticated;
grant select on public.recommendation_assignments to authenticated;
grant select on public.recommendation_experiments to authenticated;
grant select on public.served_feed to authenticated;
grant select on public.served_feed_item to authenticated;
-- Both are admin-only by policy, and were readable and writable by anyone.
grant select on public.bok_rights to authenticated;
grant select on public.bok_reports to authenticated;

-- Writing, for a signed-in reader, where the client writes directly rather
-- than through an RPC.
grant select, insert, update, delete on public.likes to authenticated;
grant select, insert, delete on public.comment_likes to authenticated;
grant select, insert on public.views to authenticated;
grant select, insert on public.user_profiles to authenticated;

-- Everything else in `public` is reached only through security-definer
-- functions, which run as their owner and do not need the caller to hold
-- anything: boks_feedback, boks_journey_events, boks_team_devices,
-- deleted_boks_users, boks_reels.

-- Sequences follow the tables that use them: an INSERT into a table with a
-- generated key fails without them.
grant usage, select on all sequences in schema public to anon, authenticated;

-- No default privileges are set here, deliberately. Restoring an automatic
-- grant for future tables would recreate exactly what Supabase is removing,
-- and what it is removing is worth keeping removed: the hole above existed
-- because a view inherited rights nobody chose for it. From now on a new table
-- reachable by the Data API grants explicitly, in the migration that creates
-- it, and `checks.sql` fails the build when the grant is missing.
