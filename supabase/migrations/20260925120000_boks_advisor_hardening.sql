-- What Supabase's Security Advisor found, now that we have read it.
--
-- The Advisor is free on every plan and we had never opened it. It reports
-- three classes against this database; this migration acts on two of them and
-- records why the third is left alone.
--
-- **Functions without a fixed `search_path` (13 signatures).** A function that
-- does not pin its search path resolves unqualified names through whatever the
-- caller's path happens to be. Here the exposure is small - `anon` and
-- `authenticated` hold only USAGE on `public`, not CREATE, so neither can plant
-- an object to be found first - but the protection costs nothing and the
-- failure mode is one we have already lived through: a path that did not carry
-- `extensions` took the feed down for four minutes when `avg(vector)` stopped
-- resolving. Every one of these thirteen already qualifies its own references
-- with `public.`, so the empty path is the exact statement of what they need.
-- `alter function` sets it without re-declaring a body, which is the point:
-- rebuilding a function from an older migration is how we once silently
-- reverted a fix.
--
-- **Trigger functions callable over HTTP.** Four functions return `trigger` and
-- exist only to be fired by one, yet both reader roles held EXECUTE on them and
-- PostgREST publishes anything executable as an RPC.
-- Postgres checks EXECUTE when a trigger is created, not when it fires, so the
-- triggers keep working with nobody holding it.
--
-- **`boks_embedding_coverage` was readable by guests.** It was granted to
-- `anon` in `20260920100000_boks_embeddings.sql`, and it reports the embedding
-- model, when the catalogue was last embedded, and how many boks sit in
-- `pending_review` - operational numbers, and the pending count is not public
-- information. The admin console calls it as an admin and the Edge Function
-- calls it as `service_role`; no guest path touches it.
--
-- **Left as it is: the three "Security Definer View" errors.**
-- `published_boks`, `boks_comments` and `boks_public_identity` run as their
-- owner by design. Each is a narrow projection - published rows only, comments
-- on published boks only, `user_id` and `handle` and nothing else - and that
-- projection is the access control. Switching them to `security_invoker` would
-- mean granting the reader roles SELECT on `reels`, `comments` and
-- `user_profiles` themselves, which widens the surface rather than narrowing
-- it. `20260925100000_boks_data_api_grants.sql` removed the part that was
-- genuinely wrong: the writes.

-- 1. Pin the search path. Bodies are untouched.
alter function public.boks_daily_submission_limit() set search_path = '';
alter function public.boks_detect_language(p_text text) set search_path = '';
alter function public.boks_handle_is_valid(p_handle text) set search_path = '';
alter function public.boks_handle_seed_from_email(p_email text) set search_path = '';
alter function public.boks_max_text_characters() set search_path = '';
alter function public.boks_reading_minutes(p_words integer) set search_path = '';
alter function public.boks_reading_minutes(p_text text) set search_path = '';
alter function public.boks_reading_shape(p_text text) set search_path = '';
alter function public.boks_reserved_handles() set search_path = '';
alter function public.boks_set_reel_word_count() set search_path = '';
alter function public.boks_word_count(p_text text) set search_path = '';
alter function public.generate_boks_handle(p_seed text, p_user_id uuid) set search_path = '';
alter function public.normalize_boks_handle(p_handle text) set search_path = '';

-- 2. Trigger functions belong to their triggers, not to the API. The Advisor's
-- list showed three; the assertion in checks.sql, which asks Postgres for every
-- function returning `trigger` rather than reading a screen, found the fourth.
revoke all on function public.boks_set_reel_word_count() from public, anon, authenticated;
revoke all on function public.boks_reels_title_and_hook() from public, anon, authenticated;
revoke all on function public.boks_reels_clear_stale_embedding() from public, anon, authenticated;
revoke all on function public.boks_validate_comment_parent() from public, anon, authenticated;

-- 3. Embedding coverage is an operator's number, not a reader's.
revoke all on function public.boks_embedding_coverage() from public, anon;
grant execute on function public.boks_embedding_coverage() to authenticated, service_role;
