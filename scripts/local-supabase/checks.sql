-- Behavioral checks for the boks Supabase schema, run against a plain Postgres
-- container with `scripts/local-supabase/shim.sql` applied. See docs/testing.md.
--
-- Every check raises an exception on failure, so `psql -v ON_ERROR_STOP=1`
-- turns this file into a pass/fail gate.

\set ON_ERROR_STOP on

-- Acting as a given user means setting the same JWT claims PostgREST would set.
create or replace function public.boks_test_login(p_user_id uuid, p_is_anonymous boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_user_id::text, 'role', 'authenticated', 'is_anonymous', p_is_anonymous)::text,
    false
  );
end;
$$;

create or replace function public.boks_test_logout()
returns void
language sql
set search_path = ''
as $$
  select set_config('request.jwt.claims', '{}', false);
$$;

create or replace function public.boks_assert(p_condition boolean, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_condition is not true then
    raise exception 'CHECK FAILED: %', p_message;
  end if;
  raise notice 'ok: %', p_message;
end;
$$;

-- These checks exercise the old write-and-review functions, still kept for
-- Studio and server jobs; since 20261122160000 an author reaches the editors
-- only the voiced way (`reels_review_needs_voice`), so the trigger is off for
-- this block and checked on its own below.
alter table public.reels disable trigger reels_review_needs_voice;

do $$
declare
  v_author uuid := '11111111-1111-4111-8111-111111111111';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_managed uuid := '44444444-4444-4444-8444-444444444444';
  -- An admin whose account is suspended: holds the role, must not use it.
  v_suspended_admin uuid := '55555555-5555-4555-8555-555555555555';
  v_reel uuid;
  -- The boks the admin inspector and the hide button are proven on.
  v_inspected uuid;
  v_row jsonb;
  -- Boks submitted by the optional-title checks, removed again afterwards.
  v_untitled uuid;
  v_titled uuid;
  -- Pre-launch fixes: a comment and its reply, a boks to revise in place.
  v_qa_comment bigint;
  v_qa_reply bigint;
  v_qa_bok uuid;
  v_lifecycle uuid;
  -- Its own boks, so the reaction checks never move `v_reel`, which later checks rely on.
  v_counted uuid;
  v_root_comment bigint;
  v_reply_comment bigint;
  v_result jsonb;
  v_quota jsonb;
  v_error text;
  v_count integer;
  v_feed_id uuid;
begin
  -- Clean slate for repeated runs.
  delete from public.recommendation_events;
  delete from public.recommendation_assignments;
  delete from public.reels where author_user_id is not null;
  delete from public.deleted_boks_users where user_id in (v_author, v_admin, v_reader, v_managed, v_suspended_admin);
  delete from public.user_profiles where user_id in (v_author, v_admin, v_reader, v_managed, v_suspended_admin);
  delete from auth.users where id in (v_author, v_admin, v_reader, v_managed, v_suspended_admin);

  -- The split a fresh database starts on, asserted before any test touches it.
  perform public.boks_assert(
    (select control_algorithm_id from public.recommendation_experiments where is_active) = 'for_you',
    'a fresh database serves the for_you ranker as control'
  );
  perform public.boks_assert(
    (select arms from public.recommendation_experiments where is_active)
      = '[{"algorithmId":"for_you","weight":50},{"algorithmId":"completion_first","weight":50}]'::jsonb,
    'the seeded split is the pairing the divergence gate could resolve'
  );


  insert into auth.users (id, email, is_anonymous) values
    (v_author, 'author@boks.test', false),
    (v_admin, 'admin@boks.test', false),
    (v_reader, 'reader@boks.test', false),
    (v_managed, 'managed@boks.test', false);

  -- ---------------------------------------------------------------- authoring
  perform public.boks_test_login(v_author);
  perform public.ensure_boks_user_profile();
  perform public.accept_boks_terms('security-test');

  -- The @handle comes from the email, with nothing asked of the reader.
  perform public.boks_assert(
    (select handle from public.user_profiles where user_id = v_author) = 'author',
    'a new profile takes its @nickname from the email address'
  );

  v_quota := public.get_my_bok_quota();
  perform public.boks_assert((v_quota ->> 'unlimited')::boolean, 'an author has no daily submission limit');
  perform public.boks_assert((v_quota ->> 'usedToday')::int = 0, 'a new author starts at zero submissions');

  -- No byline given: it falls back to the @nickname.
  perform public.submit_bok_for_review(
    'Test bok 1', 'A hook.',
    'A short story body that is well under fifteen minutes.', 'literary', 'quiet', 4,
    '', true, 'Written by me.'
  );
  -- A byline is optional. Left empty, the reader is attributed by their
  -- @handle alone, and nothing is stored on the work.
  perform public.boks_assert(
    exists (select 1 from public.reels where title = 'Test bok 1' and author_name is null),
    'a boks published with no byline stores none'
  );
  perform public.boks_assert(
    (select author_handle from public.boks_reels where title = 'Test bok 1') = 'author',
    'a boks with no byline is still attributed by @handle'
  );
  perform public.boks_assert(
    public.get_my_default_author_name() = '',
    'an author who never chose a byline starts with an empty field'
  );
  -- Submissions in life are minutes apart; in one transaction they are not, so
  -- the order is made explicit rather than left to a shared `now()`.
  update public.reels set submitted_at = now() - interval '2 hours' where title = 'Test bok 1';

  -- A pen name, chosen for this piece.
  perform public.submit_bok_for_review(
    'Test bok 2', 'A hook.',
    'A second short story body, well under fifteen minutes.', 'literary', 'quiet', 4, 'Mira Vale',
    true, ''
  );
  perform public.boks_assert(
    exists (select 1 from public.reels where title = 'Test bok 2' and author_name = 'Mira Vale'),
    'an author can publish under a pen name'
  );
  update public.reels set submitted_at = now() - interval '1 hour' where title = 'Test bok 2';
  perform public.boks_assert(
    public.get_my_default_author_name() = 'Mira Vale',
    'the next boks defaults to the pen name used last'
  );

  -- The server stores exactly what it was given. Carrying the previous byline
  -- forward is the *form* pre-filling a field, not the database inventing a
  -- name for work that was submitted without one.
  perform public.submit_bok_for_review(
    'Test bok 3', 'A hook.',
    'A third short story body, well under fifteen minutes.', '', '', 0, '', true
  );
  perform public.boks_assert(
    (select author_name from public.reels where title = 'Test bok 3') is null,
    'submitting with an empty byline stores no byline'
  );
  perform public.boks_assert(
    public.get_my_default_author_name() = 'Mira Vale',
    'the form is still offered the byline this author last chose'
  );

  -- A rename moves the @handle and leaves published work alone. The byline was
  -- a decision the author made about that piece; a later change of nickname is
  -- not a reason to rewrite it.
  update public.user_profiles set handle = 'renamed_author' where user_id = v_author;
  perform public.boks_assert(
    (select author_handle from public.boks_reels where title = 'Test bok 2') = 'renamed_author',
    'renaming an author moves the @handle on work they already published'
  );
  perform public.boks_assert(
    (select author_name from public.boks_reels where title = 'Test bok 2') = 'Mira Vale',
    'renaming an author leaves the byline they chose alone'
  );
  update public.user_profiles set handle = 'author' where user_id = v_author;

  perform public.boks_assert(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reels' and column_name in ('author_handle', 'hook')
    ),
    'a handle is never stored on the work - it is always joined from the profile'
  );

  v_quota := public.get_my_bok_quota();
  perform public.boks_assert((v_quota ->> 'usedToday')::int = 3, 'three submissions are counted');
  perform public.boks_assert(not (v_quota ->> 'exhausted')::boolean, 'the quota is never exhausted');

  -- A fourth, fifth, ... submission the same day is accepted: there is no
  -- daily limit for authors any more.
  perform public.submit_bok_for_review(
    'Fourth bok', 'A hook.',
    'A fourth piece on the same day is accepted.', 'literary', 'quiet', 4, '', true
  );
  perform public.submit_bok_for_review(
    'Fifth bok', 'A hook.',
    'And a fifth one, because a real author has a body of work.', 'literary', 'quiet', 4, '', true
  );
  perform public.boks_assert(
    (select count(*) from public.reels where author_user_id = v_author and status = 'pending_review') = 5,
    'five submissions in one day are all waiting for review'
  );

  -- The same text twice is refused while the first copy is waiting.
  begin
    perform public.submit_bok_for_review(
      'Fifth bok again', 'A hook.',
      'And a fifth one, because a real author has a body of work.', 'literary', 'quiet', 4, '', true
    );
    perform public.boks_assert(false, 'the same text twice is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error = 'You have already submitted this exact text.', 'the same text twice is refused: ' || v_error);
  end;

  -- The history is paged, counted by status, and searchable by title.
  v_quota := public.get_my_bok_submissions_page('', '', 2, 0);
  perform public.boks_assert(jsonb_array_length(v_quota -> 'items') = 2, 'a history page holds the page size');
  perform public.boks_assert((v_quota ->> 'total')::int = 5, 'the history total counts every submission');
  perform public.boks_assert((v_quota -> 'counts' ->> 'pending_review')::int = 5, 'the history counts by status');
  perform public.boks_assert(
    (v_quota -> 'items' -> 0 ->> 'body') = '',
    'a history page carries no text for a piece that is not refused'
  );
  v_quota := public.get_my_bok_submissions_page('', 'fifth', 20, 0);
  perform public.boks_assert((v_quota ->> 'total')::int = 1, 'the history searches by title');
  v_quota := public.get_my_bok_submissions_page('published', '', 20, 0);
  perform public.boks_assert((v_quota ->> 'total')::int = 0, 'the history filters by status');
  delete from public.reels where author_user_id = v_author and title in ('Fourth bok', 'Fifth bok');

  -- ------------------------------------------- the author controls their work
  -- Waiting: withdrawn leaves the queue, and comes back to it.
  v_quota := public.withdraw_my_bok((select id from public.reels where title = 'Test bok 1'));
  perform public.boks_assert(v_quota ->> 'status' = 'withdrawn', 'an author withdraws a piece waiting for review');
  perform public.boks_assert(
    (public.get_my_bok_submissions_page('withdrawn', '', 20, 0) ->> 'total')::int = 1,
    'the history lists a withdrawn piece under its own status'
  );
  perform public.boks_assert(
    (public.get_my_bok_submissions_page('withdrawn', '', 20, 0) -> 'items' -> 0 ->> 'body') <> '',
    'a withdrawn piece carries its text, so it can be edited'
  );
  v_quota := public.restore_my_bok((select id from public.reels where title = 'Test bok 1'));
  perform public.boks_assert(v_quota ->> 'status' = 'pending_review', 'a withdrawn waiting piece returns to the queue');

  -- Published: withdrawn leaves every reader surface, and returns without review.
  update public.reels set status = 'published', reviewed_at = now() where title = 'Test bok 2';
  perform public.withdraw_my_bok((select id from public.reels where title = 'Test bok 2'));
  perform public.boks_assert(
    not exists (select 1 from public.published_boks where title = 'Test bok 2'),
    'a withdrawn published piece is off the reader surfaces'
  );
  v_quota := public.restore_my_bok((select id from public.reels where title = 'Test bok 2'));
  perform public.boks_assert(v_quota ->> 'status' = 'published', 'a withdrawn published piece returns published');

  -- Stats are the author's own.
  v_quota := public.get_my_bok_stats((select id from public.reels where title = 'Test bok 2'));
  perform public.boks_assert((v_quota -> 'metrics' ->> 'readers')::int = 0, 'a new piece has no readers yet');
  perform public.boks_assert(jsonb_typeof(v_quota -> 'comments') = 'array', 'stats carry the comments');

  -- Withdrawn and edited, it goes back to review.
  perform public.withdraw_my_bok((select id from public.reels where title = 'Test bok 2'));
  perform public.submit_bok_for_review(
    'Test bok 2', '', 'A second short story body, edited after withdrawing.', '', '', 0, 'Mira Vale', true, '',
    (select id from public.reels where title = 'Test bok 2')
  );
  perform public.boks_assert(
    (select status from public.reels where title = 'Test bok 2') = 'pending_review',
    'an edited withdrawn piece goes back to review'
  );
  update public.reels
  set text = 'A second short story body, well under fifteen minutes.', status = 'pending_review'
  where title = 'Test bok 2';

  -- Delete for good: only withdrawn, only with the exact title.
  begin
    perform public.delete_my_bok((select id from public.reels where title = 'Test bok 3'), 'Test bok 3');
    perform public.boks_assert(false, 'a piece that is not withdrawn cannot be deleted');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Withdraw the text first%', 'delete needs a withdrawn piece: ' || v_error);
  end;

  perform public.submit_bok_for_review('Mistaken bok', '', 'Sent by mistake, then deleted.', '', '', 0, '', true);
  perform public.withdraw_my_bok((select id from public.reels where title = 'Mistaken bok'));
  begin
    perform public.delete_my_bok((select id from public.reels where title = 'Mistaken bok'), 'mistaken');
    perform public.boks_assert(false, 'delete needs the exact title');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Type the title exactly%', 'delete needs the exact title: ' || v_error);
  end;
  perform public.delete_my_bok((select id from public.reels where title = 'Mistaken bok'), 'Mistaken bok');
  perform public.boks_assert(
    not exists (select 1 from public.reels where title = 'Mistaken bok'),
    'a withdrawn piece is deleted for good with its exact title'
  );

  -- Yesterday's submissions are not counted as today's.
  update public.reels
  set submitted_at = now() - interval '2 days'
  where author_user_id = v_author;

  v_quota := public.get_my_bok_quota();
  perform public.boks_assert((v_quota ->> 'usedToday')::int = 0, 'the day counter resets for a new day');

  -- A submission stays private until an admin approves it.
  perform public.boks_assert(
    not exists (select 1 from public.reels where author_user_id = v_author and status = 'published'),
    'submitted boks are not published before review'
  );

  -- ---------------------------------------------- optional title, no hook
  -- The same vectors as lib/boks/bok-title.test.ts. Change one, change both.
  perform public.boks_assert(
    public.boks_title_from_text(E'\n\n   \nПод вечер\nшёл дождь') = 'Под вечер',
    'title: the first line with words on it'
  );
  perform public.boks_assert(
    public.boks_title_from_text(E'  The   quiet    hour  \nand after') = 'The quiet hour',
    'title: runs of spaces collapse'
  );
  perform public.boks_assert(
    public.boks_title_from_text(E'Дорогая, сядем рядом,\nПоглядим в глаза друг другу.') = 'Дорогая, сядем рядом',
    'title: a verse line''s trailing comma is dropped'
  );
  perform public.boks_assert(
    public.boks_title_from_text(E'It was the last train —\nand nobody ran') = 'It was the last train',
    'title: a trailing dash is dropped'
  );
  perform public.boks_assert(
    public.boks_title_from_text(E'Who knocked?\nNobody.') = 'Who knocked?',
    'title: a sentence keeps its own question mark'
  );
  perform public.boks_assert(
    public.boks_title_from_text(
      'In the charming place in which he found himself there were so many sympathetic faces that he felt more than ever convinced'
    ) = 'In the charming place in which he found himself there were so many sympathetic…',
    'title: a long first line is cut at a word and the cut is marked'
  );
  perform public.boks_assert(
    public.boks_title_from_text(repeat('x', 200)) = repeat('x', 80) || '…',
    'title: one enormous word is cut at the limit'
  );
  perform public.boks_assert(
    public.boks_title_from_text(E'* * *\nПод вечер шёл дождь') = 'Под вечер шёл дождь',
    'title: a * * * divider is skipped'
  );
  perform public.boks_assert(
    public.boks_title_from_text(E'***\n\n —\nText') = 'Text',
    'title: lines with no words are skipped'
  );
  perform public.boks_assert(
    public.boks_title_from_text('— Ой, рыба, — горячо говорит один.') = 'Ой, рыба, — горячо говорит один.',
    'title: a dialogue dash is dropped'
  );
  perform public.boks_assert(
    public.boks_title_from_text(E'First line\r\nSecond line') = 'First line',
    'title: Windows line endings'
  );
  perform public.boks_assert(
    public.boks_title_from_text('') = '' and public.boks_title_from_text(E' \n \n') = '',
    'title: empty text has no title'
  );

  v_result := public.submit_bok_for_review(
    p_title => '',
    p_text => E'Untitled opening line,\nand the rest of the piece.',
    p_rights_confirmed => true
  );
  v_untitled := (v_result ->> 'id')::uuid;
  perform public.boks_assert(
    v_result ->> 'title' = 'Untitled opening line'
      and (select title from public.reels where id = v_untitled) = 'Untitled opening line',
    'a boks submitted without a title is titled by its first line'
  );

  -- An old browser tab still sends a hook; it is not stored.
  v_result := public.submit_bok_for_review(
    'Given title', 'An old hook, from an old tab.', 'Body text.', '', '', 0, '', true
  );
  v_titled := (v_result ->> 'id')::uuid;
  perform public.boks_assert(
    v_result ->> 'title' = 'Given title' and (select hook from public.boks_reels where id = v_titled) = '',
    'a title the author gives is kept, and a hook sent by an old client is not stored'
  );

  -- The column is gone; the views keep a `hook` column, always '', because an
  -- old tab may still select it.
  perform public.boks_assert(
    not exists (select 1 from public.published_boks where hook is distinct from '')
      and (select hook from public.boks_reels where id = v_titled) = '',
    'the views still answer hook, always empty'
  );
  update public.reels set title = '   ' where id = v_titled;
  perform public.boks_assert(
    (select title from public.reels where id = v_titled) = 'Body text.',
    'clearing a title falls back to the first line'
  );
  perform public.boks_assert(
    not exists (select 1 from public.boks_reels where hook <> ''),
    'no boks carries a hook'
  );

  begin
    perform public.submit_bok_for_review('', '', E'* * *\n—', '', '', 0, '', true);
    perform public.boks_assert(false, 'a text with no words in it is refused');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a text with no words in it is refused');
  end;

  delete from public.reels where id in (v_untitled, v_titled);

  -- ------------------------------------------------------------- moderation
  perform public.boks_test_login(v_admin);
  perform public.ensure_boks_user_profile('Test Admin');
  perform public.accept_boks_terms('security-test');
  update public.user_profiles set role = 'admin' where user_id = v_admin;
  perform public.boks_assert(public.is_boks_admin(v_admin), 'an operator can bootstrap the first admin');
  perform public.boks_assert(
    not has_function_privilege('authenticated', 'public.claim_initial_boks_admin()', 'EXECUTE'),
    'a reader cannot claim the first admin role over the Data API'
  );

  select id into v_reel from public.reels where author_user_id = v_author order by created_at limit 1;
  v_result := public.review_bok_submission(v_reel, 'approve', '');
  perform public.boks_assert(v_result ->> 'status' = 'published', 'an approved bok is published');

  -- ---------------------------------------------------- account governance
  perform public.boks_test_login(v_managed);
  perform public.ensure_boks_user_profile();
  begin
    insert into public.likes (user_id, reel_id) values (v_managed, v_reel);
    perform public.boks_assert(false, 'an account without accepted terms cannot react');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'an account without accepted terms cannot react');
  end;
  perform public.accept_boks_terms('security-test');
  perform public.boks_test_login(v_admin);

  v_result := public.set_boks_admin_role(v_managed, true);
  perform public.boks_assert(
    v_result ->> 'role' = 'admin' and public.is_boks_admin(v_managed),
    'an admin can grant admin access to another permanent account'
  );
  v_result := public.set_boks_admin_role(v_managed, false);
  perform public.boks_assert(
    v_result ->> 'role' = 'reader' and not public.is_boks_admin(v_managed),
    'an admin can revoke admin access from another account'
  );

  v_result := public.set_boks_user_ban(v_managed, true, 'Repeated abuse in comments.');
  perform public.boks_assert(
    (v_result ->> 'banned')::boolean
      and (select ban_reason from public.user_profiles where user_id = v_managed) = 'Repeated abuse in comments.',
    'an admin can suspend an account with a reason'
  );
  v_result := public.get_boks_people(50, 0, 'managed');
  perform public.boks_assert(
    v_result -> 'rows' -> 0 ->> 'bannedAt' is not null,
    'the People list exposes the suspended state'
  );

  perform public.boks_test_login(v_managed);
  begin
    insert into public.likes (user_id, reel_id) values (v_managed, v_reel);
    perform public.boks_assert(false, 'a suspended account cannot like a boks');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a suspended account cannot like a boks');
  end;

  perform public.boks_test_login(v_admin);
  perform public.set_boks_user_ban(v_managed, false, '');
  perform public.boks_assert(
    (select banned_at from public.user_profiles where user_id = v_managed) is null,
    'an admin can restore a suspended account'
  );

  perform public.boks_test_login(v_managed);
  insert into public.likes (user_id, reel_id) values (v_managed, v_reel);
  delete from public.likes where user_id = v_managed and reel_id = v_reel;
  perform public.boks_assert(true, 'a restored account can interact again');

  perform public.boks_test_login(v_admin);
  insert into public.reels (title, author_name, text, genre, mood, status, author_user_id)
  values (
    'Lifecycle test bok', null,
    'This boks exists only to prove account and content deletion behavior.',
    'literary', 'quiet', 'published', v_managed
  ) returning id into v_lifecycle;
  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by)
  values (v_lifecycle, true, 'Lifecycle test rights.', v_managed);

  begin
    perform public.delete_boks_user(v_managed, 'wrong');
    perform public.boks_assert(false, 'account deletion requires the exact nickname');
  exception when others then
    perform public.boks_assert(true, 'account deletion requires the exact nickname');
  end;

  v_result := public.delete_boks_user(v_managed, 'managed');
  perform public.boks_assert(
    (v_result ->> 'archivedBoks')::integer = 1
      and not exists (select 1 from auth.users where id = v_managed),
    'deleting an account removes Auth data and reports how many boks were archived'
  );
  perform public.boks_assert(
    exists (
      select 1 from public.reels
      where id = v_lifecycle and status = 'archived' and author_user_id is null
        and author_name = 'Deleted author'
        and archived_from_status = 'published' and review_note is null
    ),
    'an account deletion anonymises and archives authored boks instead of erasing them'
  );
  perform public.boks_assert(
    public.is_boks_user_blocked(v_managed),
    'a UUID-only tombstone blocks the deleted account while an old JWT can still exist'
  );

  v_result := public.get_boks_content(50, 0, 'Lifecycle test', 'newest', 'archived');
  perform public.boks_assert(
    v_result -> 'rows' -> 0 ->> 'id' = v_lifecycle::text,
    'deleted boks are available in the admin Deleted view'
  );

  perform public.restore_archived_bok(v_lifecycle);
  perform public.boks_assert(
    (select status from public.reels where id = v_lifecycle) = 'published',
    'an admin can restore a deleted boks to the reader feed'
  );
  perform public.archive_bok(v_lifecycle, 'Lifecycle test removal.');
  perform public.boks_assert(
    (select archive_reason from public.reels where id = v_lifecycle) = 'Lifecycle test removal.',
    'soft deletion records the admin reason'
  );

  begin
    perform public.delete_archived_bok(v_lifecycle, 'wrong');
    perform public.boks_assert(false, 'permanent boks deletion requires the exact title');
  exception when others then
    perform public.boks_assert(true, 'permanent boks deletion requires the exact title');
  end;
  perform public.delete_archived_bok(v_lifecycle, 'Lifecycle test bok');
  perform public.boks_assert(
    not exists (select 1 from public.reels where id = v_lifecycle),
    'a confirmed permanent deletion removes an already archived boks'
  );

  select id into v_reel from public.reels where author_user_id = v_author and status = 'pending_review' limit 1;
  v_result := public.review_bok_submission(v_reel, 'reject', 'Needs a stronger ending.');
  perform public.boks_assert(v_result ->> 'status' = 'rejected', 'a refused bok is rejected');
  perform public.boks_assert(v_result ->> 'reviewNote' = 'Needs a stronger ending.', 'the refusal reason reaches the author');

  begin
    perform public.review_bok_submission(v_reel, 'reject', '');
    perform public.boks_assert(false, 'refusing without a reason is blocked');
  exception when others then
    perform public.boks_assert(true, 'refusing without a reason is blocked');
  end;

  -- Removing a refused piece keeps the author's refusal reason: the removal
  -- reason is its own field, and a restore gives the refusal back.
  perform public.archive_bok(v_reel, 'Removed while refused.');
  perform public.boks_assert(
    (select review_note from public.reels where id = v_reel) = 'Needs a stronger ending.'
      and (select archive_reason from public.reels where id = v_reel) = 'Removed while refused.',
    'removing a refused piece keeps its refusal reason'
  );
  perform public.boks_test_login(v_author);
  perform public.boks_assert(
    (select i ->> 'reviewNote'
     from jsonb_array_elements(public.get_my_bok_submissions_page('archived', '', 100, 0) -> 'items') i
     where i ->> 'id' = v_reel::text) = 'Removed while refused.',
    'the author of a removed piece is told why it was removed'
  );
  perform public.boks_test_login(v_admin);
  perform public.restore_archived_bok(v_reel);
  perform public.boks_assert(
    (select status from public.reels where id = v_reel) = 'rejected'
      and (select review_note from public.reels where id = v_reel) = 'Needs a stronger ending.',
    'a refused piece restored by an admin comes back with its own refusal reason'
  );

  -- Status invariants hold whatever writes the row (docs/adr/0017).
  begin
    update public.reels set archived_at = now() where id = v_reel;
    perform public.boks_assert(false, 'a piece that is not removed has no removal time');
  exception when check_violation then
    perform public.boks_assert(true, 'a piece that is not removed has no removal time');
  end;
  begin
    update public.reels set status = 'archived' where id = v_reel;
    perform public.boks_assert(false, 'a removed piece has a removal time');
  exception when check_violation then
    perform public.boks_assert(true, 'a removed piece has a removal time');
  end;
  begin
    update public.reels set withdrawn_at = now(), withdrawn_from_status = 'published' where id = v_reel;
    perform public.boks_assert(false, 'only a withdrawn piece has a withdrawal time');
  exception when check_violation then
    perform public.boks_assert(true, 'only a withdrawn piece has a withdrawal time');
  end;
  begin
    update public.reels set status = 'archived', archived_at = now(), archived_from_status = 'archived' where id = v_reel;
    perform public.boks_assert(false, 'a piece is never removed from being removed');
  exception when check_violation then
    perform public.boks_assert(true, 'a piece is never removed from being removed');
  end;
  begin
    update public.reels set withdrawn_from_status = 'gone' where id = v_reel;
    perform public.boks_assert(false, 'a withdrawal records a real status');
  exception when check_violation then
    perform public.boks_assert(true, 'a withdrawal records a real status');
  end;

  perform public.boks_assert(
    to_regclass('public.boks_comments') is null,
    'the boks_comments view is gone; comments are read through get_bok_comments'
  );

  -- A reader must not be able to review or grant admin.
  perform public.boks_test_login(v_reader);

  -- Nobody but the author withdraws, returns, reads the stats of, or deletes a piece.
  begin
    perform public.withdraw_my_bok((select id from public.reels where title = 'Test bok 1'));
    perform public.boks_assert(false, 'another account cannot withdraw an author''s piece');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Only your own text%', 'another account cannot withdraw: ' || v_error);
  end;
  begin
    perform public.get_my_bok_stats((select id from public.reels where title = 'Test bok 1'));
    perform public.boks_assert(false, 'another account cannot read an author''s stats');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error = 'That boks is not available.', 'another account cannot read stats: ' || v_error);
  end;
  perform public.ensure_boks_user_profile('Test Reader');
  perform public.accept_boks_terms('security-test');
  begin
    perform public.review_bok_submission(v_reel, 'approve', '');
    perform public.boks_assert(false, 'a reader cannot approve a bok');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot approve a bok');
  end;

  begin
    perform public.set_boks_admin_role(v_reader, true);
    perform public.boks_assert(false, 'a reader cannot grant themselves admin');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot grant themselves admin');
  end;

  -- -------------------------------------------------------- recommendations
  v_result := public.get_active_recommendation_experiment();
  perform public.boks_assert(v_result ->> 'key' = 'boks-feed-v1', 'an active experiment exists');
  perform public.boks_assert(jsonb_array_length(v_result -> 'arms') = 2, 'the default experiment runs two arms, not four');

  select id into v_reel from public.reels where status = 'published' order by created_at limit 1;

  perform public.record_recommendation_assignment('boks-feed-v1', 'for_you', 'new_reader', 'visitor-x');
  perform public.boks_assert(
    exists (select 1 from public.recommendation_assignments where user_id = v_reader and algorithm_id = 'for_you'),
    'a reader assignment is recorded'
  );

  -- The arm must not be rewritten by a later page load, or every cohort and
  -- before/after reading would be based on history that had been overwritten.
  perform public.record_recommendation_assignment('boks-feed-v1', 'balanced', 'general', 'visitor-x');
  perform public.boks_assert(
    exists (select 1 from public.recommendation_assignments where user_id = v_reader and algorithm_id = 'for_you'),
    'a second assignment call does not silently move the reader to another arm'
  );

  v_result := public.get_my_recommendation_assignment('boks-feed-v1');
  perform public.boks_assert(v_result ->> 'algorithmId' = 'for_you', 'the stored assignment is readable by its owner');

  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 0, 'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'start', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 2, 'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'complete', 'storyId', v_reel::text, 'value', 180, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 180, 'activeSeconds', 180, 'progress', 0.91,
      'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'not_a_real_event', 'storyId', v_reel::text, 'algorithmId', 'for_you'),
    jsonb_build_object('eventType', 'start', 'storyId', 'not-a-uuid', 'algorithmId', 'for_you')
  ));
  perform public.boks_assert(v_count = 3, 'the event batch accepts three valid events and drops two invalid ones');

  begin
    perform public.record_recommendation_events(jsonb_build_array(
      jsonb_build_object(
        'eventType', 'start', 'storyId', v_reel::text,
        'metadata', jsonb_build_object('payload', repeat('x', 9000))
      )
    ));
    perform public.boks_assert(false, 'oversized event metadata is refused');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'oversized event metadata is refused');
  end;

  perform public.boks_assert(
    not exists (select 1 from public.recommendation_events where user_id <> v_reader),
    'recorded events are attributed to the calling reader only'
  );

  v_result := public.get_recommendation_candidates(50);
  perform public.boks_assert(jsonb_array_length(v_result) >= 1, 'candidate rollups return published boks');
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result) as c
      where c ->> 'id' = v_reel::text and (c ->> 'completes')::int = 1 and (c ->> 'readSecondsTotal')::numeric = 180
    ),
    'candidate rollups include attributed completion counters'
  );

  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result) as c
      where c ->> 'id' = v_reel::text and (c ->> 'wordCount')::int > 0
    ),
    'candidates carry a real word count, not a clamped minute estimate'
  );

  -- Reading time is cumulative per (session, boks). Replaying the batch, or a
  -- heartbeat arriving after the final event, must not add time twice.
  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'heartbeat', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 60, 'activeSeconds', 60, 'progress', 0.4,
      'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'heartbeat', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 120, 'activeSeconds', 120, 'progress', 0.7,
      'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x')
  ));
  perform public.boks_assert(v_count = 2, 'heartbeat events are accepted');

  -- Every event type the table accepts must also survive the RPC's own filter.
  -- They were two literal lists once, and 'aftertaste' was added to one only:
  -- a month of aftertaste events vanished without an error.
  perform public.boks_assert(
    (
      select array_agg(m[1] order by m[1])
      from regexp_matches(
        (select pg_get_constraintdef(c.oid) from pg_constraint c
         where c.conname = 'recommendation_events_event_type_check'),
        '''([a-z_]+)''', 'g'
      ) as m
    ) = (select array_agg(t order by t) from unnest(public.boks_recommendation_event_types()) as t),
    'the RPC accepts exactly the event types the table allows'
  );
  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'aftertaste', 'storyId', v_reel::text, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'surface', 'reader', 'sessionId', 's1', 'visitorId', 'visitor-x',
      'metadata', jsonb_build_object('tags', jsonb_build_array('moved')))
  ));
  perform public.boks_assert(v_count = 1, 'an aftertaste event is recorded, not silently dropped');
  delete from public.recommendation_events where user_id = v_reader and event_type = 'aftertaste';

  -- One bad event must not cost the batch: a bok that no longer exists, a
  -- feed id that is not a uuid and a value that is not a number used to raise
  -- and take every other event in the batch with them.
  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'sessionId', 's-robust',
      'metadata', jsonb_build_object('probe', 'robust')),
    jsonb_build_object('eventType', 'impression', 'storyId', gen_random_uuid()::text, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'sessionId', 's-robust',
      'metadata', jsonb_build_object('probe', 'robust')),
    jsonb_build_object('eventType', 'start', 'storyId', v_reel::text, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'sessionId', 's-robust',
      'value', 'not-a-number', 'rank', 'first', 'feedId', 'not-a-uuid', 'progress', 'NaN',
      'metadata', jsonb_build_object('probe', 'robust'))
  ));
  perform public.boks_assert(
    v_count = 2,
    'a batch with an erased bok and malformed fields keeps its good events'
  );
  perform public.boks_assert(
    (select value = 1 and rank = 0 and feed_id is null and progress = 0
     from public.recommendation_events
     where user_id = v_reader and metadata ->> 'probe' = 'robust' and event_type = 'start'),
    'malformed numbers fall back to their defaults instead of raising'
  );

  -- The arm an event is credited to is the reader's stored live arm, not the
  -- one the browser names; the claim is kept.
  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'algorithmId', 'recency',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'sessionId', 's-robust',
      'metadata', jsonb_build_object('probe', 'claimed'))
  ));
  perform public.boks_assert(
    (select algorithm_id = 'for_you' and metadata ->> 'claimedAlgorithmId' = 'recency'
     from public.recommendation_events
     where user_id = v_reader and metadata ->> 'probe' = 'claimed'),
    'an event is credited to the reader''s stored arm, with the browser''s claim kept'
  );
  -- Keys nothing reads are dropped on the way in (20261116120000); a tab
  -- loaded before that release still sends them.
  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'algorithmId', 'for_you',
      'experimentKey', 'boks-feed-v1', 'sessionId', 's-robust',
      'metadata', jsonb_build_object('probe', 'unread', 'entry', 'feed', 'genre', 'literary',
        'mood', 'quiet', 'catalogSize', 9, 'unseenCount', 4))
  ));
  perform public.boks_assert(
    (select metadata = jsonb_build_object('probe', 'unread', 'entry', 'feed')
     from public.recommendation_events
     where user_id = v_reader and metadata ->> 'probe' = 'unread'),
    'event metadata nobody reads is not stored; the rest is kept'
  );
  delete from public.recommendation_events
  where user_id = v_reader and metadata ->> 'probe' in ('robust', 'claimed', 'unread');

  -- A served feed is credited the same way, and the candidate query refuses
  -- the expensive part to a caller past the hourly feed ceiling. Both probed
  -- inside a block that is rolled back.
  begin
    perform public.record_served_feed(
      jsonb_build_object('experimentKey', 'boks-feed-v1', 'algorithmId', 'recency', 'sessionId', 's-probe'),
      '[]'::jsonb
    );
    perform public.boks_assert(
      (select algorithm_id = 'for_you' and claimed_algorithm_id = 'recency'
       from public.served_feed where user_id = v_reader and session_id = 's-probe'),
      'a served feed is credited to the reader''s stored arm, with the claim kept'
    );
    -- A caller cannot plant a claim; only the crediting above records one.
    perform public.record_served_feed(
      jsonb_build_object('experimentKey', 'boks-feed-v1', 'algorithmId', 'for_you', 'sessionId', 's-planted',
        'claimedAlgorithmId', 'planted'),
      '[]'::jsonb
    );
    perform public.boks_assert(
      (select claimed_algorithm_id is null
       from public.served_feed where user_id = v_reader and session_id = 's-planted'),
      'a served feed''s claim comes from the crediting, never from the caller'
    );
    insert into public.served_feed (user_id, session_id, experiment_key, algorithm_id, candidate_request_id)
    select v_reader, 's-flood', 'boks-feed-v1', 'for_you', gen_random_uuid() from generate_series(1, 300);
    perform public.boks_assert(
      jsonb_array_length(public.get_recommendation_candidates(50)) = 0,
      'a caller past the hourly feed ceiling gets no candidates'
    );
    raise exception 'boks_probe_rollback';
  exception when raise_exception then
    if sqlerrm <> 'boks_probe_rollback' then raise; end if;
  end;
  perform public.boks_assert(
    jsonb_array_length(public.get_recommendation_candidates(50)) >= 1,
    'under the ceiling the candidate query answers as before'
  );

  -- An assignment is recorded only for a live arm of the active experiment.
  -- A fresh reader, created and removed inside a rolled-back block.
  begin
    insert into auth.users (id, email, is_anonymous)
    values ('66666666-6666-4666-8666-666666666666', null, true);
    perform public.boks_test_login('66666666-6666-4666-8666-666666666666', true);
    v_result := public.record_recommendation_assignment('boks-feed-v1', 'recency', 'general', 'visitor-a');
    perform public.boks_assert(
      v_result ->> 'algorithmId' is null
        and not exists (select 1 from public.recommendation_assignments
                        where user_id = '66666666-6666-4666-8666-666666666666'),
      'an algorithm the experiment is not running cannot be claimed as an assignment'
    );
    perform public.record_recommendation_assignment('invented-key', 'for_you', 'general', 'visitor-a');
    perform public.boks_assert(
      not exists (select 1 from public.recommendation_assignments
                  where user_id = '66666666-6666-4666-8666-666666666666'),
      'an assignment cannot be recorded under an invented experiment key'
    );
    v_result := public.record_recommendation_assignment('boks-feed-v1', 'for_you', 'general', 'visitor-a');
    perform public.boks_assert(
      v_result ->> 'algorithmId' = 'for_you',
      'a live arm of the active experiment is recorded'
    );
    raise exception 'boks_probe_rollback';
  exception when raise_exception then
    if sqlerrm <> 'boks_probe_rollback' then raise; end if;
  end;
  perform public.boks_test_login(v_reader);

  v_result := public.get_recommendation_candidates(50);
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result) as c
      where c ->> 'id' = v_reel::text and (c ->> 'readSecondsTotal')::numeric = 180
    ),
    'repeated heartbeats do not inflate reading time: the rollup takes the maximum, not the sum'
  );

  begin
    perform public.get_recommendation_lab(30);
    perform public.boks_assert(false, 'a reader cannot open the recommendation lab');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot open the recommendation lab');
  end;

  perform public.boks_test_login(v_admin);
  v_result := public.get_recommendation_lab(30);
  perform public.boks_assert(jsonb_array_length(v_result -> 'counters') = 1, 'the lab returns one counter row per algorithm-segment-day');
  perform public.boks_assert(
    (v_result -> 'counters' -> 0 ->> 'completes')::int = 1
      and (v_result -> 'counters' -> 0 ->> 'readSecondsTotal')::numeric = 180
      and (v_result -> 'counters' -> 0 ->> 'paceCount')::int = 1,
    'the lab counters carry completion, read seconds and pace samples'
  );

  v_result := public.save_recommendation_experiment(
    'boks-feed-v1', 'balanced',
    '[{"algorithmId":"balanced","weight":50},{"algorithmId":"taste_match","weight":50}]'::jsonb,
    25
  );
  perform public.boks_assert(jsonb_array_length(v_result -> 'arms') = 2, 'an admin can change the live experiment split');
  perform public.boks_assert((v_result ->> 'minimumImpressionsPerArm')::int = 25, 'an admin can change the minimum sample');

  -- The lab reads assignments and events of the active experiment only.
  v_count := (
    select coalesce(sum((a ->> 'readers')::int), 0)
    from jsonb_array_elements(public.get_recommendation_lab(30) -> 'assignments') a
  );
  insert into public.recommendation_assignments (user_id, experiment_key, algorithm_id)
  values (v_reader, 'an-old-experiment', 'recency');
  perform public.boks_assert(
    (
      select coalesce(sum((a ->> 'readers')::int), 0)
      from jsonb_array_elements(public.get_recommendation_lab(30) -> 'assignments') a
    ) = v_count,
    'a reader''s assignment under another experiment is not counted in the lab'
  );
  delete from public.recommendation_assignments
  where user_id = v_reader and experiment_key = 'an-old-experiment';

  -- The minimum sample is readers now, defaulting to 10 with a floor of 2.
  perform public.boks_assert(
    (select column_default = '10' from information_schema.columns
     where table_schema = 'public' and table_name = 'recommendation_experiments'
       and column_name = 'minimum_impressions_per_arm')
      and (public.save_recommendation_experiment(
        'boks-feed-v1', 'balanced',
        '[{"algorithmId":"balanced","weight":50},{"algorithmId":"taste_match","weight":50}]'::jsonb,
        1
      ) ->> 'minimumImpressionsPerArm')::int = 2,
    'the minimum readers per arm defaults to 10 and cannot go below 2'
  );

  -- There is no author limit, so there is nothing to reset.
  perform public.boks_assert(
    (public.get_my_bok_quota() -> 'resetsAt') = 'null'::jsonb,
    'an unlimited quota names no reset time'
  );

  perform public.boks_test_login(v_reader);
  begin
    perform public.save_recommendation_experiment('boks-feed-v1', 'balanced', '[{"algorithmId":"balanced","weight":100}]'::jsonb, 10);
    perform public.boks_assert(false, 'a reader cannot change the experiment split');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot change the experiment split');
  end;

  -- -------------------------------------------------------------- overview
  begin
    perform public.get_boks_overview(7);
    perform public.boks_assert(false, 'a reader cannot open the overview');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot open the overview');
  end;

  perform public.boks_test_login(v_admin);
  v_result := public.get_boks_overview(7);

  perform public.boks_assert(
    (v_result -> 'catalog' ->> 'published')::int = (select count(*)::int from public.reels where status = 'published'),
    'the overview counts the published catalog'
  );
  perform public.boks_assert(
    (v_result -> 'reading' ->> 'activeSeconds')::int = 180,
    'reading time sums the maximum per session and boks, so repeated heartbeats do not inflate it'
  );
  perform public.boks_assert(
    (v_result -> 'readers' ->> 'active')::int >= 1,
    'the overview counts active readers from attributed events'
  );
  perform public.boks_assert(
    (v_result -> 'dataQuality' ->> 'readsWithOutcome')::int <= (v_result -> 'dataQuality' ->> 'reads')::int,
    'the data quality tile cannot report more outcomes than reads'
  );
  perform public.boks_assert(
    (v_result -> 'supply' ->> 'pending') is not null and (v_result -> 'supply' ->> 'approved') is not null,
    'the overview reports supply health'
  );

  -- ---------------------------------------------------------------- growth
  v_result := public.get_boks_growth(12);
  perform public.boks_assert(
    (v_result -> 'daySeven' ->> 'returned')::int <= (v_result -> 'daySeven' ->> 'eligible')::int,
    'return on day 7 is counted inside its own denominator'
  );
  perform public.boks_assert(
    jsonb_array_length(v_result -> 'weekly') = 12,
    'growth returns one row per week in the window, including weeks with nothing in them'
  );
  perform public.boks_assert(
    (v_result -> 'totals' ->> 'readers')::int >= 1,
    'growth counts every reader ever seen, not just this week'
  );
  perform public.boks_assert(
    (v_result -> 'stickiness' ->> 'monthly')::int >= (v_result -> 'stickiness' ->> 'weekly')::int
      and (v_result -> 'stickiness' ->> 'weekly')::int >= (v_result -> 'stickiness' ->> 'daily')::int,
    'daily readers are a subset of weekly, and weekly of monthly'
  );
  perform public.boks_assert(
    (v_result -> 'activation' ->> 'finishedOne')::int >= (v_result -> 'activation' ->> 'finishedThree')::int,
    'more new readers finish one bok than finish three'
  );
  perform public.boks_assert(
    jsonb_array_length(v_result -> 'cohorts') >= 1
      and (v_result -> 'cohorts' -> 0 ->> 'size')::int >= 1,
    'growth reports at least one signup cohort with a size'
  );

  -- People and content now come from events, so they agree with everything else.
  v_result := public.get_boks_people(50, 0, '');
  perform public.boks_assert(
    (v_result ->> 'total')::int >= 2,
    'people lists permanent readers'
  );
  perform public.boks_assert(
    (v_result -> 'rows' -> 0 ->> 'minutes') is not null,
    'people reports reading minutes from events, not from the views table'
  );

  v_result := public.get_boks_content(50, 0, '', 'minutes');
  perform public.boks_assert(
    (v_result ->> 'total')::int >= 1,
    'content lists published boks'
  );
  perform public.boks_assert(
    (v_result -> 'rows' -> 0 ->> 'wordCount')::int > 0,
    'content reports a real word count'
  );

  -- A bok's stated length must match the text on the page. It is the one
  -- promise the product makes to a reader.
  perform public.boks_assert(
    not exists (
      select 1 from public.reels
      where minutes <> public.boks_reading_minutes(text)
    ),
    'every bok reports the reading time its text actually implies'
  );
  -- And the promise has to hold in more than one language. The ceiling was
  -- derived from English word lengths, so the same 20,000 characters used to
  -- be fifteen minutes of English and nearly seventeen of Russian.
  perform public.boks_assert(
    public.boks_reading_minutes(repeat('a', public.boks_max_text_characters())) = 15
      and public.boks_reading_minutes(repeat('слово ', public.boks_max_text_characters() / 6)) = 15,
    'the character ceiling is fifteen minutes whatever the language'
  );
  perform public.boks_assert(
    not exists (select 1 from public.boks_reels where author_handle like '@%'),
    'handles are stored bare, so the @ is never doubled when rendered'
  );

  perform public.boks_test_login(v_reader);
  begin
    perform public.get_boks_growth(12);
    perform public.boks_assert(false, 'a reader cannot open growth metrics');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot open growth metrics');
  end;
  begin
    perform public.get_boks_people(10, 0, '');
    perform public.boks_assert(false, 'a reader cannot list people');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot list people');
  end;
  perform public.boks_test_login(v_admin);

  -- ------------------------------------------------ the fifteen minute rule

  perform public.boks_assert(
    public.boks_max_text_characters() = 20000,
    'the 15 minute promise is 20000 characters'
  );
  begin
    perform public.submit_bok_for_review(
      'Far too long', 'A hook.', repeat('a ', public.boks_max_text_characters()), '', '', 0, '', true
    );
    perform public.boks_assert(false, 'a boks over the character ceiling is refused');
  exception when others then
    perform public.boks_assert(true, 'a boks over the character ceiling is refused');
  end;
  -- Enforced by the table too, not only by the RPC that normally writes it.
  begin
    insert into public.reels (title, author_name, text, genre, mood, minutes, status)
    values ('Direct and too long', 'Seed', repeat('b', 20001), 'literary', 'quiet', 1, 'published');
    perform public.boks_assert(false, 'the table refuses an over-long boks whatever writes it');
  exception when check_violation then
    perform public.boks_assert(true, 'the table refuses an over-long boks whatever writes it');
  end;
  perform public.boks_assert(
    not exists (select 1 from public.reels where char_length(text) > public.boks_max_text_characters()),
    'every stored boks fits inside fifteen minutes'
  );

  -- --------------------------------------------------- identity is single

  -- A byline is optional for an account-backed boks and required for a seeded
  -- one, which has no profile to be attributed from.
  perform public.boks_assert(
    not exists (
      select 1 from public.reels
      where author_user_id is null and btrim(coalesce(author_name, '')) = ''
    ),
    'a boks with no account behind it still carries a byline'
  );
  perform public.boks_assert(
    not exists (select 1 from public.reels where btrim(author_name) = ''),
    'a byline is either a name or nothing, never an empty string'
  );
  perform public.boks_assert(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'display_name'
    ),
    'a person has one name and it is their @nickname'
  );
  -- Attribution, not a name: a byline is optional, the @handle is not.
  perform public.boks_assert(
    not exists (
      select 1 from public.published_boks
      where btrim(coalesce(author_handle, '')) = '' and btrim(coalesce(author_name, '')) = ''
    ),
    'every published boks is attributed to someone: an account''s @handle or a byline'
  );

  -- The comment table has no identity columns at all; there is nothing to drift.
  perform public.boks_assert(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'comments'
        and column_name in ('visitor_name', 'visitor_handle')
    ),
    'comments carry no copy of who wrote them'
  );
  perform public.boks_assert(
    not exists (select 1 from public.user_profiles where handle is null),
    'every profile has the @handle that identifies it'
  );

  -- ------------------------------------------------- the nickname shape

  perform public.boks_assert(
    public.boks_handle_is_valid('ivan_ystal') and public.boks_handle_is_valid('reader_2026'),
    'a nickname may use English letters, digits and underscores'
  );
  -- The trailing underscore had no rule against it, but the input normaliser
  -- stripped it on every keystroke, which made an underscore impossible to
  -- type anywhere. Asserted so the two ends stay agreed on what is legal.
  perform public.boks_assert(
    public.boks_handle_is_valid('ivan_'),
    'a nickname may end in an underscore'
  );
  perform public.boks_assert(
    not public.boks_handle_is_valid('9ivan') and not public.boks_handle_is_valid('_ivan'),
    'a nickname has to start with a letter'
  );
  perform public.boks_assert(
    not public.boks_handle_is_valid('иван') and not public.boks_handle_is_valid('ivan_иван'),
    'a nickname uses English letters only'
  );
  perform public.boks_assert(
    not public.boks_handle_is_valid('ivan.ystal') and not public.boks_handle_is_valid('ivan-ystal'),
    'a nickname has no punctuation'
  );
  perform public.boks_assert(
    not public.boks_handle_is_valid('ab') and not public.boks_handle_is_valid(repeat('a', 25)),
    'a nickname is 3 to 24 characters'
  );

  -- The table constraint repeats the rule rather than calling the function, so
  -- the two are asserted to agree on every shape that matters.
  perform public.boks_assert(
    (select bool_and(public.boks_handle_is_valid(candidate) = (candidate ~ '^[a-z][a-z0-9_]{2,23}$'))
     from unnest(array['ivan_ystal', 'ivan_', '9ivan', '_ivan', 'иван', 'ivan.ystal', 'ab', repeat('a', 25)]) candidate),
    'the nickname constraint and boks_handle_is_valid agree'
  );

  -- Derivation sanitises, because there is no one to refuse: an email that
  -- starts with a digit still has to yield a usable nickname.
  perform public.boks_assert(
    public.normalize_boks_handle('9ivan') = 'ivan',
    'a seed that starts with a digit is trimmed to start with a letter'
  );
  perform public.boks_assert(
    public.normalize_boks_handle('@Ivan.Ystal') = 'ivan_ystal',
    'a seed is lowercased and punctuation becomes an underscore'
  );
  perform public.boks_assert(
    public.normalize_boks_handle('999') is null,
    'a seed with no letters yields nothing, so generation falls back'
  );
  perform public.boks_assert(
    public.boks_handle_is_valid(
      public.generate_boks_handle(public.boks_handle_seed_from_email('999@boks.test'), '44444444-4444-4444-8444-444444444444')
    ),
    'a generated nickname is always valid, whatever the email looked like'
  );
  perform public.boks_assert(
    not exists (select 1 from public.user_profiles where handle is not null and not public.boks_handle_is_valid(handle)),
    'no stored nickname breaks the rule'
  );

  -- ----------------------------------------------------- content shape

  perform public.boks_assert(
    public.boks_word_count('') = 0,
    'empty text is zero words, not one'
  );
  perform public.boks_assert(
    public.boks_reading_shape('') = 'unknown',
    'a boks with no text has no reading shape'
  );
  perform public.boks_assert(
    public.boks_reading_shape(E'Light on the sill.\nA cup, half drunk.\nThe morning waits.\nNobody speaks.\nThe kettle cools.') = 'verse',
    'short broken lines are recognised as verse'
  );
  perform public.boks_assert(
    public.boks_reading_shape('A single paragraph that simply runs on without any line breaks at all.') = 'short_prose',
    'an unbroken short paragraph is short prose'
  );
  perform public.boks_assert(
    public.boks_reading_shape(repeat('word ', 600)) = 'long_prose',
    'six hundred words is long prose'
  );
  perform public.boks_assert(
    not exists (
      select 1 from public.reels
      where reading_shape <> public.boks_reading_shape(text)
    ),
    'every boks carries the reading shape its text implies'
  );

  -- --------------------------------------------------------- author follows

  perform public.boks_test_login(v_reader);
  v_result := public.set_author_follow(v_author, true);
  perform public.boks_assert(
    (v_result ->> 'following')::boolean and (v_result ->> 'followers')::integer = 1,
    'a signed-in reader can follow an author'
  );
  -- Written once: a second follow is not a second follower.
  v_result := public.set_author_follow(v_author, true);
  perform public.boks_assert(
    (v_result ->> 'followers')::integer = 1,
    'following twice leaves one follow'
  );
  perform public.boks_assert(
    jsonb_array_length(public.get_my_followed_authors()) = 1,
    'a reader can list who they follow'
  );

  begin
    perform public.set_author_follow(v_reader, true);
    perform public.boks_assert(false, 'a reader cannot follow themselves');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot follow themselves');
  end;

  perform public.boks_test_login(v_author);
  perform public.boks_assert(
    jsonb_array_length(public.get_my_followed_authors()) = 0,
    'follows are private to the reader who made them'
  );

  perform public.boks_test_login(v_reader, true);
  begin
    perform public.set_author_follow(v_author, false);
    perform public.boks_assert(false, 'an anonymous reader cannot follow an author');
  exception when others then
    perform public.boks_assert(true, 'an anonymous reader cannot follow an author');
  end;

  perform public.boks_test_login(v_reader);
  v_result := public.set_author_follow(v_author, false);
  perform public.boks_assert(
    not (v_result ->> 'following')::boolean,
    'a reader can unfollow an author'
  );

  -- ------------------------------------------------------- feed provenance
  -- Everything here exists because a served feed used to leave no trace: the
  -- ranking ran in the browser and only its consequences were stored.

  perform public.boks_test_login(v_reader);
  v_feed_id := public.record_served_feed(
    jsonb_build_object(
      'sessionId', 'session-checks',
      'experimentKey', 'boks-feed-v1',
      'algorithmId', 'balanced',
      'assignmentSource', 'assigned',
      'candidateCount', 2,
      'catalogSize', 2,
      'servingBackend', 'worker',
      'signalsVersion', 'signals.v1',
      'rankingVersion', 'ranking.v1',
      'labelingVersion', 'labeling.v1',
      -- Sent by servers released before 20261116120000; accepted and not stored.
      'profileSnapshot', jsonb_build_object('genreAffinity', jsonb_build_object('literary', 3))
    ),
    jsonb_build_array(
      jsonb_build_object('reelId', v_reel::text, 'deliveredRank', 0, 'score', 0.91,
        'creditedAlgorithmId', 'balanced')
    )
  );
  perform public.boks_assert(v_feed_id is not null, 'a reader can record the feed they were served');
  begin
    perform public.record_served_feed(
      jsonb_build_object('sessionId', 'oversized-feed'),
      (select jsonb_agg(jsonb_build_object('reelId', v_reel::text, 'deliveredRank', n))
       from generate_series(1, 201) n)
    );
    perform public.boks_assert(false, 'a feed cannot write more than 200 slots');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a feed cannot write more than 200 slots');
  end;
  perform public.boks_assert(
    (select count(*) from public.served_feed_item where feed_id = v_feed_id) = 1,
    'a served feed keeps one row per delivered slot'
  );
  perform public.boks_assert(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'served_feed' and column_name = 'profile_snapshot'
    )
      and (select claimed_algorithm_id is null and algorithm_id = 'balanced'
           from public.served_feed where id = v_feed_id),
    'a served feed still accepts an old server''s profile snapshot and does not store it'
  );

  -- A feed id is a hint from the client, never an authority. One belonging to
  -- somebody else must be dropped rather than trusted.
  perform public.boks_test_login(v_author);
  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'algorithmId', 'balanced',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'general', 'surface', 'reader', 'rank', 0,
      'sessionId', 'session-foreign', 'feedId', v_feed_id::text, 'servingBackend', 'worker',
      'labelingVersion', 'labeling.v1')
  ));
  perform public.boks_assert(v_count = 1, 'an event with somebody else''s feed id is still recorded');
  perform public.boks_assert(
    (select feed_id from public.recommendation_events where session_id = 'session-foreign') is null,
    'an event may not claim a feed that belongs to another reader'
  );

  perform public.boks_test_login(v_reader);
  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'algorithmId', 'balanced',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'general', 'surface', 'reader', 'rank', 0,
      'sessionId', 'session-checks', 'feedId', v_feed_id::text, 'servingBackend', 'worker',
      'labelingVersion', 'labeling.v1', 'activeSeconds', 30, 'progress', 0.4),
    jsonb_build_object('eventType', 'heartbeat', 'storyId', v_reel::text, 'algorithmId', 'balanced',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'general', 'surface', 'reader', 'rank', 0,
      'sessionId', 'session-checks', 'feedId', v_feed_id::text, 'servingBackend', 'worker',
      'labelingVersion', 'labeling.v1', 'activeSeconds', 90, 'progress', 0.7),
    jsonb_build_object('eventType', 'complete', 'storyId', v_reel::text, 'algorithmId', 'balanced',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'general', 'surface', 'reader', 'rank', 0,
      'sessionId', 'session-checks', 'feedId', v_feed_id::text, 'servingBackend', 'worker',
      'labelingVersion', 'labeling.v1', 'activeSeconds', 140, 'progress', 0.95)
  ));
  perform public.boks_assert(v_count = 3, 'a reader records their own attributed events');
  perform public.boks_assert(
    (select count(*) from public.recommendation_events
      where session_id = 'session-checks' and feed_id = v_feed_id) = 3,
    'events carry the feed that served them'
  );

  -- ------------------------------------------------------- reader outcomes
  perform public.boks_test_login(v_admin);
  v_result := public.get_reader_outcomes(30, 'boks-feed-v1');
  perform public.boks_assert(
    jsonb_array_length(v_result) >= 1,
    'reader outcomes come back one row per reader, algorithm and day'
  );
  -- Three events, one reader, one algorithm, one day: one row. Counting the
  -- events instead is the pseudo-replication this whole phase exists to remove.
  perform public.boks_assert(
    (select count(*) from jsonb_array_elements(v_result) row
      where row ->> 'userId' = v_reader::text and row ->> 'algorithmId' = 'balanced') = 1,
    'a reader appears once per algorithm and day, never once per event'
  );
  perform public.boks_assert(
    (select (row ->> 'activeSeconds')::integer from jsonb_array_elements(v_result) row
      where row ->> 'userId' = v_reader::text and row ->> 'algorithmId' = 'balanced') = 140,
    'cumulative reading time rolls up with max(), so a repeated heartbeat costs nothing'
  );
  perform public.boks_assert(
    (select (row ->> 'sessions')::integer from jsonb_array_elements(v_result) row
      where row ->> 'userId' = v_reader::text and row ->> 'algorithmId' = 'balanced') = 1,
    'three events in one session are one session'
  );
  perform public.boks_assert(
    (select (row ->> 'totalEvents')::integer from jsonb_array_elements(v_result) row
      where row ->> 'userId' = v_reader::text and row ->> 'algorithmId' = 'balanced') = 3,
    'the event count is still reported, as a denominator rather than a sample size'
  );

  -- The evaluation claims to be cohort-aware, so the analysis unit has to know
  -- which reader it belongs to. Without these two fields a reader who joined
  -- this week and one reading for a month are the same observation, and an arm
  -- that helps one while hurting the other averages to nothing.
  perform public.boks_assert(
    (select row ->> 'cohortWeek' from jsonb_array_elements(v_result) row
      where row ->> 'userId' = v_reader::text and row ->> 'algorithmId' = 'balanced')
      ~ '^\d{4}-\d{2}-\d{2}$',
    'every outcome row names the reader''s cohort week'
  );
  perform public.boks_assert(
    (select (row ->> 'tenureDays')::integer from jsonb_array_elements(v_result) row
      where row ->> 'userId' = v_reader::text and row ->> 'algorithmId' = 'balanced') = 0,
    'a reader measured on their first day has a tenure of zero'
  );
  perform public.boks_assert(
    (select bool_and((row ->> 'tenureDays')::integer >= 0) from jsonb_array_elements(v_result) row),
    'tenure is never negative, whatever the window'
  );

  perform public.boks_test_login(v_reader);
  begin
    perform public.get_reader_outcomes(30, '');
    perform public.boks_assert(false, 'a reader cannot read everybody''s outcomes');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot read everybody''s outcomes');
  end;

  -- --------------------------------------------------------- data quality
  perform public.boks_test_login(v_admin);
  v_result := public.get_recommendation_data_quality(30);
  perform public.boks_assert(
    (v_result ->> 'feeds')::integer = 1,
    'the data-quality panel counts served feeds'
  );
  perform public.boks_assert(
    (v_result ->> 'eventsWithoutFeed')::integer >= 1,
    'an event with no provenance is counted, not hidden'
  );
  perform public.boks_assert(
    (v_result -> 'feedsByBackend' ->> 'worker')::integer = 1,
    'feeds are counted by the backend that served them'
  );
  perform public.boks_assert(
    (v_result ->> 'algorithmMismatch')::integer = 0
      and (v_result ->> 'rankNotInFeed')::integer = 0
      and (v_result ->> 'eventsBeforeFeed')::integer = 0,
    'a well-formed serve trips none of the attribution checks'
  );
  perform public.boks_assert(
    (v_result -> 'labelingVersions' ->> 'labeling.v1')::integer = 4,
    'every event records the labelling rules in force when it was written'
  );

  -- ----------------------------------------------------------- anonymous path
  perform public.boks_test_login(v_reader, true);
  begin
    perform public.submit_bok_for_review('Anon bok', '', 'Anonymous readers must not publish.', 'literary', 'quiet', 2, '', true);
    perform public.boks_assert(false, 'an anonymous reader cannot submit a bok');
  exception when others then
    perform public.boks_assert(true, 'an anonymous reader cannot submit a bok');
  end;

  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'algorithmId', 'balanced',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'general', 'surface', 'reader', 'rank', 1)
  ));
  perform public.boks_assert(v_count = 1, 'an anonymous guest reader still produces attributed events');

  -- --------------------------------------------------- the catalogue import
  -- A publisher account is an ordinary account that an admin has marked. The
  -- per-piece byline is what lets one account publish many writers.
  perform public.boks_test_login(v_admin);

  begin
    perform public.import_boks_batch('author', jsonb_build_array(
      jsonb_build_object('importKey', 'x', 'title', 'T', 'text', 'Text.')
    ), true, true);
    perform public.boks_assert(false, 'an account that is not a publisher refuses an import');
  exception when others then
    perform public.boks_assert(true, 'an account that is not a publisher refuses an import');
  end;

  perform public.set_boks_publisher('author', true);
  perform public.boks_assert(
    (select is_publisher from public.user_profiles where user_id = v_author),
    'an admin can mark an account as a publisher'
  );

  -- The batch is attested once, and a row may carry its own note.
  v_result := public.import_boks_batch('author', jsonb_build_array(
    jsonb_build_object('importKey', 'cat-1', 'title', 'With a byline', 'hook', 'One line.',
                       'text', 'A short imported piece.', 'authorName', 'Abel Mensah',
                       'createdAt', '1998-04-02T00:00:00Z', 'rightsNote', 'Project Gutenberg #1342'),
    jsonb_build_object('importKey', 'cat-2', 'title', 'Without one', 'text', 'Another imported piece.'),
    jsonb_build_object('importKey', 'cat-3', 'text', 'No title at all.'),
    jsonb_build_object('importKey', 'cat-4', 'title', 'Too long', 'text', repeat('x', 20001)),
    jsonb_build_object('title', 'No key', 'text', 'Nothing to deduplicate on.')
  ), true, true, 'Public domain, verified against the source.');

  perform public.boks_assert((v_result ->> 'imported')::integer = 2, 'an import writes the rows that are sound');
  perform public.boks_assert(
    (v_result ->> 'rejected')::integer = 3,
    'a bad row is reported and the rest of the batch still lands'
  );
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result -> 'results') r
      where r.value ->> 'importKey' = 'cat-4' and r.value ->> 'reason' like '%15 minutes%'
    ),
    'an over-long import row is refused by the same fifteen-minute rule as the form'
  );
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result -> 'results') r
      where r.value ->> 'status' = 'rejected' and r.value ->> 'reason' like '%import key is required%'
    ),
    'a row with no import key is refused, because the load could not be repeated'
  );

  -- Published outright: a catalogue does not queue for review.
  perform public.boks_assert(
    (select status from public.reels where import_key = 'cat-1') = 'published',
    'an imported boks is published, not queued'
  );
  perform public.boks_assert(
    (select author_user_id from public.reels where import_key = 'cat-1') = v_author,
    'an imported boks belongs to the publisher account, which is what a reader follows'
  );
  perform public.boks_assert(
    (select author_name from public.reels where import_key = 'cat-1') = 'Abel Mensah'
      and (select author_name from public.reels where import_key = 'cat-2') is null,
    'each imported piece carries its own byline, and may carry none'
  );
  -- Read through the sanctioned projection, which is what the app queries.
  -- `import_key` is bookkeeping and deliberately not part of it.
  perform public.boks_assert(
    (select v.author_handle from public.boks_reels v
     where v.id = (select r.id from public.reels r where r.import_key = 'cat-1')) = 'author',
    'an imported boks is attributed by the publisher @handle as well as its byline'
  );
  perform public.boks_assert(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'boks_reels' and column_name = 'import_key'
    ),
    'the import key stays out of the reader-facing projection'
  );
  perform public.boks_assert(
    (select created_at from public.reels where import_key = 'cat-1')::date = '1998-04-02'::date,
    'an import keeps the catalogue''s own date'
  );
  perform public.boks_assert(
    (select word_count from public.reels where import_key = 'cat-1') = 4
      and (select minutes from public.reels where import_key = 'cat-1') = 1,
    'the same trigger derives length for an imported boks as for a submitted one'
  );

  perform public.boks_assert(
    (select confirmed from public.bok_rights br
     join public.reels r on r.id = br.reel_id where r.import_key = 'cat-1'),
    'an imported bok carries the attestation the admin made for the batch'
  );
  perform public.boks_assert(
    (select note from public.bok_rights br
     join public.reels r on r.id = br.reel_id where r.import_key = 'cat-1') = 'Project Gutenberg #1342',
    'a row with its own rights note keeps it'
  );
  perform public.boks_assert(
    (select note from public.bok_rights br
     join public.reels r on r.id = br.reel_id where r.import_key = 'cat-2')
      = 'Public domain, verified against the source.',
    'a row with no note of its own takes the batch note'
  );

  begin
    perform public.import_boks_batch('author', jsonb_build_array(
      jsonb_build_object('importKey', 'unattested', 'title', 'T', 'text', 'Text.')
    ), true, false);
    perform public.boks_assert(false, 'an import without a rights confirmation is refused');
  exception when others then
    perform public.boks_assert(true, 'an import without a rights confirmation is refused');
  end;

  -- The whole point of the import key.
  v_result := public.import_boks_batch('author', jsonb_build_array(
    jsonb_build_object('importKey', 'cat-1', 'title', 'With a byline', 'text', 'A short imported piece.')
  ), true, true);
  perform public.boks_assert(
    (v_result ->> 'skipped')::integer = 1 and (v_result ->> 'imported')::integer = 0,
    'importing the same key twice imports nothing the second time'
  );

  -- Removal, and the confirmation that gates it.
  v_result := public.delete_boks_import('author', 'cat-', null);
  perform public.boks_assert(
    (v_result ->> 'matched')::integer = 2 and (v_result ->> 'deleted')::integer = 0,
    'a removal without confirmation counts and deletes nothing'
  );
  v_result := public.delete_boks_import('author', 'cat-', 'cat-');
  perform public.boks_assert(
    (v_result ->> 'deleted')::integer = 2,
    'a confirmed removal takes the batch out'
  );

  -- A reader must not be able to publish into an account or empty one.
  perform public.boks_test_login(v_reader);
  begin
    perform public.import_boks_batch('author', jsonb_build_array(
      jsonb_build_object('importKey', 'sneak', 'title', 'T', 'text', 'Text.')
    ), true, true);
    perform public.boks_assert(false, 'a reader cannot import boks into an account');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot import boks into an account');
  end;
  begin
    perform public.set_boks_publisher('author', true);
    perform public.boks_assert(false, 'a reader cannot make an account a publisher');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot make an account a publisher');
  end;

  -- ------------------------------------------------------ reading languages
  perform public.boks_assert(
    public.boks_detect_language('Абель зажигал девяносто четыре фонаря тридцать один год, и он знал каждый из них.') = 'ru',
    'Cyrillic prose is detected as Russian'
  );
  perform public.boks_assert(
    public.boks_detect_language('Abel had lit the same ninety-four lamps for thirty-one years, and he knew each one of them.') = 'en',
    'English prose is detected as English'
  );
  -- Latin script alone is not English. A classifier that guesses here would
  -- serve Spanish to a reader who asked for English only.
  perform public.boks_assert(
    public.boks_detect_language('Abel encendía las mismas noventa y cuatro lámparas desde hacía treinta y un años.') = 'und',
    'Latin script that is not English is left undetermined rather than guessed'
  );
  perform public.boks_assert(
    public.boks_detect_language('') = 'und' and public.boks_detect_language('Hi.') = 'und',
    'too little text is undetermined, not a coin flip'
  );
  -- The rule this replaced searched the raw text for ' the ', which a poem
  -- almost never contains: every word sits against a line break or a comma.
  -- It was measuring prose, not English, and it lost twenty poems on
  -- production. Verse in short lines has to come back as English.
  perform public.boks_assert(
    public.boks_detect_language(
      E'The morns are meeker than they were,\nThe nuts are getting brown;\nThe berry\'s cheek is plumper,\nThe rose is out of town.'
    ) = 'en',
    'verse in short lines is English, not undetermined - punctuation is not a language'
  );
  -- Latin script in the languages most likely to be mistaken for English.
  -- These share almost no function words with it, and must stay undetermined
  -- rather than be served to someone who asked for English.
  perform public.boks_assert(
    public.boks_detect_language(
      E'La nebbia in me si fermava ogni sera, e non sapevo piu se la casa\nche vedevo in fondo alla strada fosse la mia o quella di un altro.'
    ) = 'und'
    and public.boks_detect_language(
      E'Es war in diesem Sommer, als der alte Mann mit der Laterne jeden\nAbend durch die Gassen ging und niemand sich daran erinnerte.'
    ) = 'und',
    'Italian and German are left undetermined rather than called English'
  );
  perform public.boks_assert(
    not exists (select 1 from public.reels where language is null),
    'every boks carries a derived language'
  );

  -- The filter lives in retrieval, and a reader who narrowed gets only what
  -- they named. `und` is not evidence that they can read a piece: treating it
  -- as eligible is how twenty English poems reached a Russian-only reader.
  perform public.boks_test_login(v_reader);
  perform public.boks_assert(
    (select count(*) from jsonb_array_elements(public.get_recommendation_candidates(50, array['ru']))) = 0
      or (select bool_and((c.value ->> 'language') = 'ru')
          from jsonb_array_elements(public.get_recommendation_candidates(50, array['ru'])) c),
    'a reader who narrowed to Russian is offered nothing else, undetermined included'
  );
  perform public.boks_assert(
    (select count(*) from jsonb_array_elements(public.get_recommendation_candidates(50, array[]::text[])))
      >= (select count(*) from jsonb_array_elements(public.get_recommendation_candidates(50, array['ru']))),
    'no filter offers at least as much as a filter'
  );

  -- An empty array means "all", never "none": a filter that can silently empty
  -- the feed must be impossible to set by accident.
  v_result := public.set_my_reading_languages(array['ru-RU', 'RU', 'ja']);
  perform public.boks_assert(
    (v_result -> 'readingLanguages')::text = '["ru"]',
    'a region tag is stored as its language, and an unsupported one is dropped'
  );
  perform public.boks_assert(
    (select reading_languages from public.user_profiles where user_id = v_reader) = array['ru'],
    'the reader''s choice is stored on their account'
  );
  -- Stored choice beats whatever the client sends.
  perform public.boks_assert(
    (select count(*) from jsonb_array_elements(public.get_recommendation_candidates(50, array['en']))) = 0
      or (select bool_and((c.value ->> 'language') = 'ru')
          from jsonb_array_elements(public.get_recommendation_candidates(50, array['en'])) c),
    'a stored language filter is not overridden by the request'
  );
  v_result := public.set_my_reading_languages(array[]::text[]);
  perform public.boks_assert(
    (v_result -> 'readingLanguages')::text = '[]',
    'clearing the filter is allowed and means everything is eligible'
  );
  -- Narrowing excludes `und`, so the reader who narrowed nothing has to be the
  -- one who can still reach it. Otherwise an unplaceable piece is unreachable
  -- by anybody, which is a quiet way to delete it.
  insert into public.reels (title, text, genre, mood, minutes, status, author_user_id, author_name, language)
  values ('Unplaceable', 'Zzz qqq xxx vvv zzz qqq xxx vvv.', 'fiction', 'calm', 1, 'published', v_admin, 'Nobody', 'und');
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(public.get_recommendation_candidates(400, array[]::text[])) c
      where c.value ->> 'title' = 'Unplaceable'
    ),
    'a reader with no filter can still reach a piece the detector could not place'
  );
  delete from public.reels where title = 'Unplaceable';

  perform public.boks_assert(
    (public.boks_language_coverage() -> 'en') is not null
      or public.boks_language_coverage() = '{}'::jsonb,
    'the catalogue reports what it holds per language'
  );

  -- ---------------------------------------------- public reaction counts
  -- The rail shows how many liked and how many replied, next to each icon.
  -- A like row is private (a reader sees only their own), so the number has
  -- to come from an aggregate - never from counting the rows a client can see,
  -- which would give the reader's own 0 or 1.
  perform public.boks_test_logout();
  insert into public.reels (title, text, genre, mood, minutes, status, author_user_id, author_name, language)
  values ('Counted', 'A piece that people react to, long enough to be a piece.', 'literary', 'quiet', 1, 'published', v_admin, 'Counted Author', 'en')
  returning id into v_counted;
  insert into public.likes (user_id, reel_id) values (v_reader, v_counted), (v_author, v_counted);
  insert into public.comments (user_id, reel_id, body)
  values (v_reader, v_counted, 'A root comment.')
  returning id into v_root_comment;

  perform public.boks_test_login(v_reader);
  v_result := public.get_my_reader_library();
  perform public.boks_assert(
    exists (
      select 1
      from jsonb_array_elements(v_result) item
      where item.value ->> 'storyId' = v_counted::text
        and (item.value ->> 'liked')::boolean
        and (item.value ->> 'commented')::boolean
        and item.value ->> 'readAt' is null
    ),
    'likes and comments reach their account library even without a read'
  );
  -- Read time is the reader's own impression in the reader; an admin's
  -- preview surface or a heartbeat does not make a bok read.
  insert into public.recommendation_events (user_id, reel_id, event_type, surface, created_at)
  values (v_reader, v_counted, 'heartbeat', 'reader', now() - interval '1 minute'),
         (v_reader, v_counted, 'impression', 'admin', now() - interval '1 minute');
  perform public.boks_assert(
    (select item.value ->> 'readAt' is null
     from jsonb_array_elements(public.get_my_reader_library()) item
     where item.value ->> 'storyId' = v_counted::text),
    'only a reader impression, start or complete makes a bok read'
  );
  insert into public.recommendation_events (user_id, reel_id, event_type, surface, created_at)
  values (v_reader, v_counted, 'impression', 'reader', now() - interval '2 hours');
  -- A read kept from the retired views table counts too, and the later time wins.
  insert into public.reader_library_legacy_reads (user_id, reel_id, read_at)
  values (v_reader, v_counted, now() - interval '1 hour');
  perform public.boks_assert(
    (select (item.value ->> 'readAt')::timestamptz > now() - interval '61 minutes'
     from jsonb_array_elements(public.get_my_reader_library()) item
     where item.value ->> 'storyId' = v_counted::text),
    'the library''s read time is the latest of the reader''s events and the kept views'
  );
  delete from public.reader_library_legacy_reads where user_id = v_reader;
  v_result := public.get_my_reader_library();
  perform public.boks_assert(
    exists (
      select 1
      from jsonb_array_elements(v_result) item
      where item.value ->> 'storyId' = v_counted::text
        and item.value ->> 'readAt' is not null
        and item.value ->> 'likedAt' is not null
        and item.value ->> 'commentedAt' is not null
    ),
    'the account library reports each action time independently'
  );
  perform public.boks_test_login(v_reader, true);
  perform public.boks_assert(
    public.get_my_reader_library() = '[]'::jsonb,
    'an anonymous session cannot read a permanent account library'
  );
  perform public.boks_test_login(v_reader);

  v_result := public.get_bok_reactions(array[v_counted]);
  perform public.boks_assert(
    (v_result -> 0 ->> 'likes')::int = 2 and (v_result -> 0 ->> 'comments')::int = 1,
    'reaction counts are the totals, not the reader''s own like'
  );
  perform public.boks_assert(
    not (v_result -> 0 ? 'user_id') and v_result::text not like '%' || v_author::text || '%',
    'reaction counts say how many, never who'
  );
  -- One number whichever way the boks was reached: opened from the feed or
  -- from a library or a shared link.
  perform public.boks_assert(
    (
      select (c.value ->> 'likes')::int
      from jsonb_array_elements(public.get_recommendation_candidates(400, array[]::text[])) c
      where c.value ->> 'id' = v_counted::text
    ) = 2,
    'the feed and the single-boks path report the same like count'
  );

  -- ------------------------------------------------ comment conversations
  v_result := public.create_bok_comment(v_counted, 'A reply to the root.', v_root_comment);
  v_reply_comment := (v_result ->> 'id')::bigint;
  perform public.boks_assert(
    (v_result ->> 'parentCommentId')::bigint = v_root_comment,
    'a signed-in reader can reply to a root comment'
  );
  perform public.boks_assert(
    jsonb_array_length(public.get_bok_comments(v_counted)) = 2
      and exists (
        select 1 from jsonb_array_elements(public.get_bok_comments(v_counted)) c
        where (c.value ->> 'id')::bigint = v_reply_comment
          and (c.value ->> 'parentCommentId')::bigint = v_root_comment
      ),
    'the public comment model keeps a reply under its conversation'
  );

  begin
    perform public.create_bok_comment(v_counted, 'Too deeply nested.', v_reply_comment);
    perform public.boks_assert(false, 'comment conversations stay one level deep');
  exception when others then
    perform public.boks_assert(true, 'comment conversations stay one level deep');
  end;

  v_result := public.set_bok_comment_like(v_root_comment, true);
  perform public.boks_assert(
    (v_result ->> 'likedByMe')::boolean and (v_result ->> 'likesCount')::integer = 1,
    'a signed-in reader can like a comment once'
  );
  v_result := public.set_bok_comment_like(v_root_comment, true);
  perform public.boks_assert(
    (v_result ->> 'likesCount')::integer = 1,
    'liking the same comment twice is idempotent'
  );
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(public.get_bok_comments(v_counted)) c
      where (c.value ->> 'id')::bigint = v_root_comment
        and (c.value ->> 'likesCount')::integer = 1
        and (c.value ->> 'likedByMe')::boolean
    ),
    'the comment model returns totals and only the caller own like state'
  );

  perform public.boks_test_login(v_reader, true);
  begin
    perform public.set_bok_comment_like(v_root_comment, true);
    perform public.boks_assert(false, 'an anonymous reader cannot like a comment');
  exception when others then
    perform public.boks_assert(true, 'an anonymous reader cannot like a comment');
  end;
  perform public.boks_test_login(v_reader);

  update public.reels set status = 'pending_review' where id = v_counted;
  perform public.boks_assert(
    jsonb_array_length(public.get_bok_comments(v_counted)) = 0,
    'comments disappear with an unpublished boks'
  );
  perform public.boks_assert(
    jsonb_array_length(public.get_bok_reactions(array[v_counted])) = 0,
    'an unpublished boks has no public counts'
  );
  perform public.boks_assert(
    jsonb_array_length(public.get_bok_reactions(array[]::uuid[])) = 0
      and jsonb_array_length(public.get_bok_reactions(null)) = 0,
    'no ids asks for nothing'
  );
  delete from public.reels where id = v_counted;

  -- ------------------------------------------- reading a writer, not a feed
  -- A publishing account holds many writers, and both halves of a byline are
  -- tapped. They have to lead to different places.
  perform public.boks_test_login(v_admin);
  perform public.set_boks_publisher('author', true);
  perform public.import_boks_batch('author', jsonb_build_array(
    jsonb_build_object('importKey', 'w-1', 'title', 'First by Ada', 'text', 'A piece.', 'authorName', 'Ada Lovelace'),
    jsonb_build_object('importKey', 'w-2', 'title', 'Second by Ada', 'text', 'Another piece.', 'authorName', 'Ada Lovelace'),
    jsonb_build_object('importKey', 'w-3', 'title', 'Only by Bo', 'text', 'A third piece.', 'authorName', 'Bo Yun')
  ), true, true, 'Public domain');

  v_result := public.get_boks_author('author');
  perform public.boks_assert(
    (v_result ->> 'byline') is null,
    'the @handle view is the publisher, not one of its writers'
  );
  perform public.boks_assert(
    jsonb_array_length(v_result -> 'writers') >= 2,
    'the publisher view indexes the writers it publishes'
  );
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result -> 'writers') w
      where w.value ->> 'name' = 'Ada Lovelace' and (w.value ->> 'boks')::int = 2
    ),
    'each writer is listed with how much of them there is'
  );

  v_result := public.get_boks_author('author', 'Ada Lovelace');
  perform public.boks_assert(
    v_result ->> 'byline' = 'Ada Lovelace' and v_result ->> 'authorName' = 'Ada Lovelace',
    'asking for a writer returns that writer, not the account'
  );
  perform public.boks_assert(
    (v_result ->> 'totalBoks')::int = 2 and jsonb_array_length(v_result -> 'boks') = 2,
    'a writer view holds only that writer''s boks'
  );
  perform public.boks_assert(
    v_result ->> 'authorHandle' = 'author',
    'the writer view still names the account that published them, which is what Follow follows'
  );
  perform public.boks_assert(
    public.get_boks_author('author', 'Nobody At All') is null,
    'a byline nobody wrote is a stale link, not an empty writer'
  );

  -- Retrieval has to be able to reach the whole catalogue, not just the newest
  -- slice: with 457 published boks and a window of 200, more than half of them
  -- were unreachable for everyone.
  perform public.boks_assert(
    (select count(*) from jsonb_array_elements(public.get_recommendation_candidates(20))) <= 20,
    'candidate retrieval respects its limit'
  );

  perform public.delete_boks_import('author', 'w-', 'w-');

  -- ------------------------------------------------- clearing the demo set
  perform public.boks_test_login(v_admin);
  v_result := public.delete_seed_boks(null);
  perform public.boks_assert(
    (v_result ->> 'deleted')::integer = 0,
    'clearing the demo catalogue reports before it deletes'
  );
  perform public.boks_assert(
    (v_result ->> 'seeds')::integer > 0 and (v_result ->> 'authored')::integer >= 0,
    'the report separates seeded boks from work an author published'
  );

  perform public.boks_test_login(v_reader);
  begin
    perform public.delete_seed_boks('delete the demo catalogue');
    perform public.boks_assert(false, 'a reader cannot clear the catalogue');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot clear the catalogue');
  end;

  -- ------------------------------------------------------- reserved nicknames
  begin
    perform public.update_boks_user_profile('', 'boks');
    perform public.boks_assert(false, 'a reader cannot take a reserved nickname');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot take a reserved nickname');
  end;

  perform public.boks_test_login(v_admin);
  perform public.update_boks_user_profile('', 'boks');
  perform public.boks_assert(
    (select handle from public.user_profiles where user_id = v_admin) = 'boks',
    'an admin can take a reserved nickname, which is how the official account gets its name'
  );

  -- Derivation has to respect the list too, or signing up as boks@... would
  -- hand out the platform's own name.
  perform public.boks_assert(
    public.generate_boks_handle('boks', '55555555-5555-4555-8555-555555555555') <> 'boks',
    'a reserved nickname is never handed out by derivation'
  );
  perform public.boks_assert(
    public.boks_handle_is_valid(
      public.generate_boks_handle('boks', '55555555-5555-4555-8555-555555555555')
    ),
    'the nickname derivation falls back to something valid'
  );

  -- ------------------------------------------------------------------ rights
  perform public.boks_test_login(v_author);

  -- The attestation is not optional, and the refusal names what is missing.
  begin
    perform public.submit_bok_for_review('Unattested', 'A hook.', 'Text that nobody vouched for.');
    perform public.boks_assert(false, 'publishing without confirming the rights is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(
      v_error like '%rights%',
      'publishing without confirming the rights is refused, saying so'
    );
  end;

  perform public.boks_assert(
    (select confirmed from public.bok_rights br
     join public.reels r on r.id = br.reel_id where r.title = 'Test bok 1'),
    'a submitted bok carries its author''s attestation'
  );
  perform public.boks_assert(
    (select note from public.bok_rights br
     join public.reels r on r.id = br.reel_id where r.title = 'Test bok 1') = 'Written by me.',
    'the rights note is stored as written'
  );
  perform public.boks_assert(
    (select note from public.bok_rights br
     join public.reels r on r.id = br.reel_id where r.title = 'Test bok 2') is null,
    'an empty rights note is stored as nothing, not as an empty string'
  );
  perform public.boks_assert(
    not exists (select 1 from public.reels r where not exists
      (select 1 from public.bok_rights br where br.reel_id = r.id)),
    'every bok has a rights record'
  );

  -- Rights text can name a person, an estate or a contract, so it is not in
  -- the reader-facing projection and not readable by a reader.
  perform public.boks_assert(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name in ('boks_reels', 'published_boks')
        and column_name in ('rights_note', 'note', 'rights_confirmed', 'confirmed')
    ),
    'no rights field reaches the reader-facing projections'
  );

  -- ----------------------------------------------------------------- reports
  perform public.boks_test_login(v_reader);

  -- A reason an admin cannot act on is worse than no report at all.
  begin
    perform public.report_bok(v_reel, 'bad');
    perform public.boks_assert(false, 'a report needs a reason worth reading');
  exception when others then
    perform public.boks_assert(true, 'a report needs a reason worth reading');
  end;

  v_result := public.report_bok(v_reel, 'This is my translation, published in 1998 without my permission.');
  perform public.boks_assert(v_result ->> 'status' = 'received', 'a reader can report a bok');

  v_result := public.report_bok(v_reel, 'This is my translation, published in 1998 without my permission.');
  perform public.boks_assert(
    v_result ->> 'status' = 'already',
    'reporting the same bok twice does not pile up rows for an admin to read twice'
  );

  -- Whether a reader can *read* these tables is asserted in the row-level
  -- security block at the end of this file: this block runs as the database
  -- owner, for which RLS is bypassed, so a check here would always pass.

  perform public.boks_test_login(v_admin);
  v_result := public.get_boks_rights_review('open', 50);
  perform public.boks_assert(
    (v_result ->> 'openReports')::integer = 1,
    'an admin sees the open report'
  );
  perform public.boks_assert(
    (v_result -> 'reports' -> 0 ->> 'reason') like '%my translation%',
    'an admin reads the reason the reader gave'
  );
  perform public.boks_assert(
    (v_result -> 'reports' -> 0 ->> 'rightsNote') is not null
      or (v_result -> 'reports' -> 0 ->> 'rightsConfirmed') is not null,
    'the report arrives next to what the author claimed about the rights'
  );
  perform public.boks_assert(
    (v_result ->> 'unattested')::integer >= 1,
    'boks published before the rights record are listed as unattested'
  );

  -- Taking a piece down needs a reason, because the author is told it.
  begin
    perform public.review_bok_report((v_result -> 'reports' -> 0 ->> 'id')::uuid, 'actioned', '');
    perform public.boks_assert(false, 'taking a bok down requires a reason');
  exception when others then
    perform public.boks_assert(true, 'taking a bok down requires a reason');
  end;

  v_result := public.review_bok_report(
    (public.get_boks_rights_review('open', 50) -> 'reports' -> 0 ->> 'id')::uuid,
    'actioned',
    'Confirmed with the translator. Withdrawn.'
  );
  perform public.boks_assert(
    v_result ->> 'status' = 'actioned' and v_result ->> 'bokStatus' = 'rejected',
    'acting on a report takes the bok out of the feed, which review_bok_submission cannot do'
  );
  perform public.boks_assert(
    not (select confirmed from public.bok_rights where reel_id = v_reel),
    'a withdrawn bok loses its attestation, so it cannot quietly come back'
  );
  perform public.boks_assert(
    (select review_note from public.reels where id = v_reel) like '%translator%',
    'the author is told why their bok was withdrawn'
  );
  -- The withdrawal is appended to whatever the author claimed, and a piece
  -- whose author left no note must not end up with a note that begins with a
  -- separator - which is what naive concatenation produced.
  perform public.boks_assert(
    (select note from public.bok_rights where reel_id = v_reel) like '%Withdrawn after a report:%'
      and (select btrim(note) from public.bok_rights where reel_id = v_reel) not like '|%',
    'a withdrawal is appended to the author''s claim without a leading separator'
  );
  -- The same path with nothing to append to.
  perform public.boks_test_login(v_admin);
  perform public.set_bok_rights(v_reel, true, '');
  perform public.boks_test_login(v_reader);
  v_result := public.report_bok(v_reel, 'Reporting it a second time, now that the note is empty.');
  perform public.boks_test_login(v_admin);
  perform public.review_bok_report(
    (v_result ->> 'id')::uuid, 'actioned', 'Withdrawn again.'
  );
  perform public.boks_assert(
    (select note from public.bok_rights where reel_id = v_reel) = 'Withdrawn after a report: Withdrawn again.',
    'with no claim to append to, the withdrawal note stands on its own'
  );
  perform public.boks_assert(
    (public.get_boks_rights_review('open', 50) ->> 'openReports')::integer = 0,
    'a resolved report leaves the open list'
  );

  -- A reader cannot review reports or rewrite a rights record.
  perform public.boks_test_login(v_reader);
  begin
    perform public.get_boks_rights_review('open', 50);
    perform public.boks_assert(false, 'a reader cannot read the rights review');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot read the rights review');
  end;
  begin
    perform public.set_bok_rights(v_reel, true, 'Nothing to see here.');
    perform public.boks_assert(false, 'a reader cannot rewrite a rights record');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot rewrite a rights record');
  end;

  -- -------------------------------------------------------- the admin inspector
  -- One boks and one person, as the console's detail views read them. Every
  -- number must match the list row the view is opened from.
  perform public.boks_test_login(v_reader);
  perform public.ensure_boks_user_profile();
  perform public.boks_test_login(v_admin);
  insert into public.reels (title, author_name, text, genre, mood, status, author_user_id)
  values (
    'Inspector test bok', null,
    'This boks exists only to prove the admin inspector and the admin hide action.',
    'literary', 'quiet', 'published', v_author
  ) returning id into v_inspected;
  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by)
  values (v_inspected, true, 'Inspector test rights.', v_author);
  insert into public.recommendation_events (user_id, reel_id, session_id, event_type, surface, active_seconds) values
    (v_reader, v_inspected, 'inspector-1', 'impression', 'reader', 0),
    (v_reader, v_inspected, 'inspector-1', 'start', 'reader', 30),
    (v_reader, v_inspected, 'inspector-1', 'complete', 'reader', 150),
    (v_reader, v_inspected, 'inspector-2', 'start', 'reader', 45),
    (v_admin, v_inspected, 'inspector-3', 'skip', 'reader', 5);
  perform public.boks_test_login(v_reader);
  insert into public.likes (user_id, reel_id) values (v_reader, v_inspected);
  insert into public.comments (user_id, reel_id, body) values (v_reader, v_inspected, 'Inspector test comment.');

  perform public.boks_test_login(v_admin);
  v_result := public.get_admin_bok(v_inspected);
  v_row := public.get_boks_content(50, 0, 'Inspector test bok', 'newest', 'published') -> 'rows' -> 0;
  perform public.boks_assert(v_row ->> 'id' = v_inspected::text, 'the inspected boks is in the Content list');
  perform public.boks_assert(
    (v_result -> 'metrics' ->> 'minutes') = (v_row ->> 'minutes')
      and (v_result -> 'metrics' ->> 'readers') = (v_row ->> 'readers')
      and (v_result -> 'metrics' ->> 'starts') = (v_row ->> 'starts')
      and (v_result -> 'metrics' ->> 'completes') = (v_row ->> 'completes')
      and (v_result -> 'metrics' ->> 'skips') = (v_row ->> 'skips')
      and (v_result -> 'metrics' ->> 'likes') = (v_row ->> 'likes')
      and (v_result -> 'metrics' ->> 'comments') = (v_row ->> 'comments')
      and (v_result -> 'metrics' -> 'finishRate') = (v_row -> 'finishRate'),
    'the boks view reports the same numbers as the Content row it opens from'
  );
  -- 150 + 45 + 5 active seconds over three sessions is 3 minutes; two people;
  -- one finish from two starts.
  perform public.boks_assert(
    (v_result -> 'metrics' ->> 'minutes')::integer = 3
      and (v_result -> 'metrics' ->> 'readers')::integer = 2
      and (v_result -> 'metrics' ->> 'finishRate')::integer = 50,
    'boks minutes sum each session''s furthest active time; readers count people'
  );
  perform public.boks_assert(
    v_result ->> 'body' like 'This boks exists only%'
      and v_result ->> 'authorUserId' = v_author::text
      and (v_result -> 'rights' ->> 'confirmed')::boolean
      and v_result -> 'comments' -> 0 ->> 'body' = 'Inspector test comment.'
      and v_result -> 'likers' -> 0 ->> 'userId' = v_reader::text,
    'the boks view carries the text, the author, rights, comments and likers'
  );

  v_result := public.get_admin_person(v_reader);
  select value into v_row
  from jsonb_array_elements(public.get_boks_people(500, 0, '') -> 'rows')
  where value ->> 'userId' = v_reader::text;
  perform public.boks_assert(
    v_row is not null
      and (v_result -> 'metrics' ->> 'minutes') = (v_row ->> 'minutes')
      and (v_result -> 'metrics' ->> 'sessions') = (v_row ->> 'sessions')
      and (v_result -> 'metrics' ->> 'boksOpened') = (v_row ->> 'boksOpened')
      and (v_result -> 'metrics' ->> 'boksFinished') = (v_row ->> 'boksFinished'),
    'the person view reports the same numbers as the People row it opens from'
  );
  perform public.boks_assert(
    exists (select 1 from jsonb_array_elements(v_result -> 'likedBoks') x where x ->> 'id' = v_inspected::text)
      and exists (select 1 from jsonb_array_elements(v_result -> 'comments') x
                  where x ->> 'reelId' = v_inspected::text and x ->> 'body' = 'Inspector test comment.')
      and exists (select 1 from jsonb_array_elements(v_result -> 'readBoks') x
                  where x ->> 'id' = v_inspected::text and (x ->> 'finished')::boolean),
    'the person view lists what they liked, commented on and read'
  );
  v_result := public.get_admin_person(v_author);
  perform public.boks_assert(
    exists (select 1 from jsonb_array_elements(v_result -> 'authoredBoks') x where x ->> 'id' = v_inspected::text)
      and (v_result -> 'metrics' ->> 'likesReceived')::integer >= 1
      and (v_result -> 'metrics' ->> 'readersReached')::integer >= 1,
    'the person view lists what they wrote and what it received'
  );
  begin
    perform public.get_admin_bok(gen_random_uuid());
    perform public.boks_assert(false, 'the boks view refuses an id that does not exist');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'the boks view refuses an id that does not exist');
  end;

  perform public.boks_test_login(v_reader);
  begin
    perform public.get_admin_bok(v_inspected);
    perform public.boks_assert(false, 'a reader cannot open the admin boks view');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot open the admin boks view');
  end;
  begin
    perform public.get_admin_person(v_reader);
    perform public.boks_assert(false, 'a reader cannot open the admin person view, not even their own');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot open the admin person view, not even their own');
  end;

  -- ------------------------------------------- hiding a boks is for admins only
  -- The reader feed offers admins a Hide button. Its whole safety is here: the
  -- RPC reads the role from `user_profiles`, not from anything the client
  -- sends, and every other kind of caller is refused - with the admin error
  -- specifically, so a refusal can never be mistaken for a missing boks.
  perform public.boks_test_logout();
  begin
    perform public.archive_bok(v_inspected, 'Guest attempt.');
    perform public.boks_assert(false, 'a guest cannot hide a boks');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a guest cannot hide a boks');
  end;

  perform public.boks_test_login(gen_random_uuid(), true);
  begin
    perform public.archive_bok(v_inspected, 'Anonymous attempt.');
    perform public.boks_assert(false, 'an anonymous session cannot hide a boks');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'an anonymous session cannot hide a boks');
  end;

  perform public.boks_test_login(v_reader);
  begin
    perform public.archive_bok(v_inspected, 'Reader attempt.');
    perform public.boks_assert(false, 'a reader cannot hide a boks');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot hide a boks');
  end;

  perform public.boks_test_login(v_author);
  begin
    perform public.archive_bok(v_inspected, 'Author attempt.');
    perform public.boks_assert(false, 'an author cannot hide a boks through the admin action, not even their own');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'an author cannot hide a boks through the admin action, not even their own');
  end;

  insert into auth.users (id, email, is_anonymous) values (v_suspended_admin, 'suspended-admin@boks.test', false);
  perform public.boks_test_login(v_suspended_admin);
  perform public.ensure_boks_user_profile();
  perform public.accept_boks_terms('security-test');
  perform public.boks_test_login(v_admin);
  update public.user_profiles
  set role = 'admin', banned_at = now(), ban_reason = 'Suspended for the hide check.'
  where user_id = v_suspended_admin;
  perform public.boks_test_login(v_suspended_admin);
  begin
    perform public.archive_bok(v_inspected, 'Suspended admin attempt.');
    perform public.boks_assert(false, 'a suspended admin cannot hide a boks');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a suspended admin cannot hide a boks');
  end;

  perform public.boks_assert(
    (select status from public.reels where id = v_inspected) = 'published',
    'every refused attempt left the boks published'
  );

  perform public.boks_test_login(v_admin);
  v_result := public.archive_bok(v_inspected, 'Hidden from the feed by an admin.');
  perform public.boks_assert(
    (select status = 'archived' and archived_by = v_admin
            and archive_reason = 'Hidden from the feed by an admin.' and archived_at is not null
     from public.reels where id = v_inspected),
    'an admin hides a boks: archived, with who, when and why recorded'
  );
  perform public.boks_assert(
    exists (select 1 from public.likes where reel_id = v_inspected)
      and exists (select 1 from public.comments where reel_id = v_inspected)
      and exists (select 1 from public.recommendation_events where reel_id = v_inspected),
    'hiding keeps the boks, its likes, comments and reading history in the database'
  );
  perform public.boks_assert(
    not exists (select 1 from public.published_boks where id = v_inspected),
    'a hidden boks leaves the published view readers are served from'
  );
  perform public.boks_assert(
    jsonb_array_length(public.get_bok_reactions(array[v_inspected])) = 0,
    'a hidden boks has no public reaction counts'
  );
  perform public.boks_assert(
    not exists (
      select 1 from jsonb_array_elements(public.get_recommendation_candidates(400, null)) c
      where c ->> 'id' = v_inspected::text
    ),
    'a hidden boks is never a feed candidate'
  );
  v_row := public.get_boks_content(50, 0, 'Inspector test bok', 'newest', 'archived') -> 'rows' -> 0;
  perform public.boks_assert(
    v_row ->> 'id' = v_inspected::text and v_row ->> 'archiveReason' = 'Hidden from the feed by an admin.',
    'a hidden boks is listed under Deleted with its reason'
  );
  perform public.boks_assert(
    public.get_admin_bok(v_inspected) ->> 'status' = 'archived',
    'the admin boks view still opens a hidden boks'
  );
  begin
    perform public.archive_bok(v_inspected, 'Twice.');
    perform public.boks_assert(false, 'hiding an already hidden boks is refused, not repeated');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'hiding an already hidden boks is refused, not repeated');
  end;
  perform public.restore_archived_bok(v_inspected);
  perform public.boks_assert(
    exists (select 1 from public.published_boks where id = v_inspected),
    'a hidden boks can be restored to the feed'
  );

  delete from public.reels where id = v_inspected;
  delete from public.user_profiles where user_id = v_suspended_admin;
  delete from auth.users where id = v_suspended_admin;

  -- ---------------------------------------------------- pre-launch fixes
  -- Titles with no words are replaced by the first line.
  perform public.boks_test_login(v_admin);
  insert into public.reels (title, author_name, text, genre, mood, status, author_user_id)
  values ('* * *', null, E'Прощай, немытая Россия,\nСтрана рабов, страна господ.', 'literary', 'quiet', 'published', v_author)
  returning id into v_qa_bok;
  perform public.boks_assert(
    (select title from public.reels where id = v_qa_bok) = 'Прощай, немытая Россия',
    'a title with no words in it becomes the first line'
  );
  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by) values (v_qa_bok, true, 'QA.', v_author);

  -- Hide and restore give back the status the boks had.
  update public.reels set status = 'pending_review' where id = v_qa_bok;
  perform public.archive_bok(v_qa_bok, 'QA: hidden while waiting.');
  v_result := public.restore_archived_bok(v_qa_bok);
  perform public.boks_assert(
    v_result ->> 'status' = 'pending_review' and (select status from public.reels where id = v_qa_bok) = 'pending_review',
    'restoring a boks hidden while waiting puts it back in the queue, not in the feed'
  );
  update public.reels set status = 'published' where id = v_qa_bok;
  perform public.archive_bok(v_qa_bok, 'QA: hidden while published.');
  v_result := public.restore_archived_bok(v_qa_bok);
  perform public.boks_assert(v_result ->> 'status' = 'published', 'restoring a published boks publishes it again');

  -- Approval needs confirmed rights, and a deleted boks is restored, not approved.
  update public.reels set status = 'rejected' where id = v_qa_bok;
  update public.bok_rights set confirmed = false where reel_id = v_qa_bok;
  begin
    perform public.review_bok_submission(v_qa_bok, 'approve', '');
    perform public.boks_assert(false, 'a boks without confirmed rights cannot be approved');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a boks without confirmed rights cannot be approved');
  end;
  update public.bok_rights set confirmed = true where reel_id = v_qa_bok;
  perform public.archive_bok(v_qa_bok, 'QA: deleted.');
  begin
    perform public.review_bok_submission(v_qa_bok, 'approve', '');
    perform public.boks_assert(false, 'a deleted boks cannot be approved around Restore');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a deleted boks cannot be approved around Restore');
  end;
  perform public.restore_archived_bok(v_qa_bok);
  perform public.boks_assert(
    (select status from public.reels where id = v_qa_bok) = 'rejected',
    'restoring a boks deleted while refused leaves it refused'
  );

  -- Revising a refused boks resubmits the same row.
  update public.reels set submitted_at = now() - interval '2 days' where author_user_id = v_author;
  perform public.boks_test_login(v_author);
  v_result := public.submit_bok_for_review(
    'Revised title', '', 'A revised text for the refused boks.', '', '', 0, '', true, '', v_qa_bok
  );
  perform public.boks_assert(
    (v_result ->> 'id')::uuid = v_qa_bok
      and (select status from public.reels where id = v_qa_bok) = 'pending_review'
      and (select text from public.reels where id = v_qa_bok) = 'A revised text for the refused boks.',
    'revising a refused boks resubmits it in place instead of adding a copy'
  );
  begin
    perform public.submit_bok_for_review('Again', '', 'Not refused any more.', '', '', 0, '', true, '', v_qa_bok);
    perform public.boks_assert(false, 'only a refused boks can be revised');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'only a refused boks can be revised');
  end;
  perform public.boks_test_login(v_reader);
  begin
    perform public.submit_bok_for_review('Not mine', '', 'Someone else''s boks.', '', '', 0, '', true, '', v_qa_bok);
    perform public.boks_assert(false, 'a reader cannot revise another author''s boks');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot revise another author''s boks');
  end;

  -- Comments can be deleted by their writer or an admin, and only by them.
  update public.reels set status = 'published' where id = v_qa_bok;
  perform public.boks_test_login(v_reader);
  insert into public.comments (user_id, reel_id, body) values (v_reader, v_qa_bok, 'QA comment.') returning id into v_qa_comment;
  perform public.boks_test_login(v_author);
  insert into public.comments (user_id, reel_id, body, parent_comment_id)
  values (v_author, v_qa_bok, 'QA reply.', v_qa_comment) returning id into v_qa_reply;
  begin
    perform public.delete_boks_comment(v_qa_comment);
    perform public.boks_assert(false, 'a reader cannot delete someone else''s comment');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot delete someone else''s comment');
  end;
  perform public.boks_test_logout();
  begin
    perform public.delete_boks_comment(v_qa_comment);
    perform public.boks_assert(false, 'a guest with no session cannot delete a comment');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a guest with no session cannot delete a comment');
  end;
  perform public.boks_test_login(v_reader);
  v_result := public.delete_boks_comment(v_qa_comment);
  perform public.boks_assert(
    (v_result ->> 'repliesRemoved')::integer = 1
      and not exists (select 1 from public.comments where id in (v_qa_comment, v_qa_reply)),
    'the writer deletes their comment, and the replies to it go with it'
  );
  perform public.boks_test_login(v_reader);
  insert into public.comments (user_id, reel_id, body) values (v_reader, v_qa_bok, 'QA comment two.') returning id into v_qa_comment;
  perform public.boks_test_login(v_admin);
  perform public.delete_boks_comment(v_qa_comment);
  perform public.boks_assert(
    not exists (select 1 from public.comments where id = v_qa_comment),
    'an admin can delete anyone''s comment'
  );

  delete from public.reels where id = v_qa_bok;

  -- A reader can delete their own account; an admin cannot delete itself.
  insert into auth.users (id, email, is_anonymous) values (v_suspended_admin, 'leaving@boks.test', false);
  perform public.boks_test_login(v_suspended_admin);
  perform public.ensure_boks_user_profile();
  perform public.accept_boks_terms('security-test');
  insert into public.reels (title, author_name, text, genre, mood, status, author_user_id)
  values ('Leaving author bok', null, 'A piece by someone about to leave.', 'literary', 'quiet', 'published', v_suspended_admin)
  returning id into v_qa_bok;
  -- A reader with reactions: the cascade that removes them used to hit the
  -- suspended-account trigger and roll the whole deletion back.
  insert into public.likes (user_id, reel_id) values (v_suspended_admin, v_qa_bok);

  -- Whether someone else is an admin or suspended is not a reader's question.
  perform public.boks_assert(
    not public.is_boks_admin(v_admin),
    'a reader cannot ask whether another account is an admin'
  );
  begin
    perform public.delete_my_boks_account('not-my-name');
    perform public.boks_assert(false, 'deleting your account needs your exact nickname');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'deleting your account needs your exact nickname');
  end;
  v_result := public.delete_my_boks_account('@' || (select handle from public.user_profiles where user_id = v_suspended_admin));
  perform public.boks_assert(
    (v_result ->> 'archivedBoks')::integer = 1
      and not exists (select 1 from auth.users where id = v_suspended_admin)
      and (select status = 'archived' and author_user_id is null from public.reels where id = v_qa_bok)
      and public.is_boks_user_blocked(v_suspended_admin),
    'a reader deletes their own account: boks anonymised and hidden, account gone, old session blocked'
  );
  -- The deleted account's session is blocked from writing, which is the point;
  -- clean up as the admin.
  perform public.boks_test_login(v_admin);
  delete from public.reels where id = v_qa_bok;
  delete from public.deleted_boks_users where user_id = v_suspended_admin;

  begin
    perform public.delete_my_boks_account((select handle from public.user_profiles where user_id = v_admin));
    perform public.boks_assert(false, 'an admin cannot delete its own account');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'an admin cannot delete its own account');
  end;

  perform public.boks_test_logout();
  raise notice 'ALL CHECKS PASSED';
end $$;

-- Back on: the voiced way is the only way in for an author (see the checks of
-- `reels_review_needs_voice` and the author's Boks Series flow further down).
alter table public.reels enable trigger reels_review_needs_voice;

-- From a voiced piece to its Boks Series (20261122200000): withdraw, accept,
-- the lock, the series sent back, the author's publish, a return that unlocks.
do $$
declare
  v_author uuid := 'f1a00000-0000-4000-8000-000000000001';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_bok uuid := 'f1a00000-0000-4000-8000-0000000000b1';
  v_other uuid := 'f1a00000-0000-4000-8000-0000000000b2';
  v_text text := E'Голос и серия.\nВторая строка.';
  v_work public.author_space_works;
  v_error text;
begin
  perform public.boks_test_logout();
  insert into auth.users (id, email, is_anonymous) values (v_author, 'series-flow@boks.test', false);
  perform public.boks_test_login(v_author);
  perform public.ensure_boks_user_profile();
  perform public.accept_boks_terms('security-test');
  insert into public.author_spaces (kind, status, name, owner_user_id, verified, published_at)
  values ('author', 'published', 'Автор Серии', v_author, true, now());

  perform public.set_my_bok_voice(v_bok, jsonb_build_object('file', 'take-1.webm', 'durationMs', 5000, 'source', 'teleprompter',
    'fingerprint', public.boks_voice_fingerprint(v_text), 'recordedAt', now() - interval '1 minute'));
  perform public.save_my_bok(v_bok, 'Голос и серия', v_text, true, null, true);
  perform public.withdraw_my_sent_bok(v_bok);
  perform public.boks_assert((select status from public.reels where id = v_bok) = 'draft', 'a sent piece taken back is a draft again');
  perform public.save_my_bok(v_bok, 'Голос и серия', v_text, true, null, true);
  perform public.boks_assert((select status from public.reels where id = v_bok) = 'pending_review', 'a piece taken back goes to the editors again with its voice');

  perform public.boks_test_login(v_admin);
  perform public.studio_accept_bok(v_bok);
  perform public.boks_assert(
    not exists (select 1 from jsonb_array_elements(public.get_boks_admin_snapshot(100, 0, '', 'newest') -> 'moderationQueue') q where q ->> 'id' = v_bok::text),
    'a piece in work for its Boks Series leaves the review queue');
  begin
    perform public.studio_send_series_to_author(v_bok, 'SeriesFlowCheckToken0001');
    perform public.boks_assert(false, 'a series goes to the author only with the cover');
  exception when sqlstate '22023' then
    perform public.boks_assert(true, 'a series goes to the author only with the cover');
  end;
  insert into public.bok_covers (bok_id, webp, jpeg, source) values (v_bok, decode(repeat('00', 1200), 'hex'), decode(repeat('00', 1200), 'hex'), 'upload');
  begin
    perform public.review_bok_submission(v_bok, 'approve', '');
    perform public.boks_assert(false, 'a piece sent from My page is not published from moderation');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a piece sent from My page is not published from moderation');
  end;

  perform public.boks_test_login(v_author);
  begin
    perform public.withdraw_my_sent_bok(v_bok);
    perform public.boks_assert(false, 'a piece in work cannot be taken back');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a piece in work cannot be taken back');
  end;
  begin
    perform public.save_my_bok(v_bok, 'Голос и серия', E'Другой текст.', false, null, false);
    perform public.boks_assert(false, 'a piece in work cannot be changed by its author');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a piece in work cannot be changed by its author');
  end;

  perform public.boks_test_login(v_admin);
  perform public.studio_send_series_to_author(v_bok, 'SeriesFlowCheckToken0001');
  perform public.boks_test_login(v_author);
  select * into v_work from public.author_space_works where bok_id = v_bok;
  perform public.boks_assert(v_work.status = 'ready' and v_work.format = 'series', 'the series comes to the author ready to publish');
  perform public.publish_my_author_space(jsonb_build_array(jsonb_build_object('workId', v_work.id, 'revision', v_work.revision)), false, 'checks', gen_random_uuid());
  perform public.boks_assert(
    (select r.status from public.reels r where r.id = v_bok) = 'published'
      and (select w.series_published from public.author_space_works w where w.id = v_work.id)
      and (select state from public.bok_series_work where bok_id = v_bok) = 'published',
    'the author publishes the piece with its series');

  perform public.set_my_bok_voice(v_other, jsonb_build_object('file', 'take-1.webm', 'durationMs', 5000, 'source', 'upload',
    'fingerprint', public.boks_voice_fingerprint(E'Второй бок.'), 'recordedAt', now() - interval '1 minute'));
  perform public.save_my_bok(v_other, 'Второй', E'Второй бок.', true, null, true);
  perform public.boks_test_login(v_admin);
  perform public.studio_accept_bok(v_other);
  perform public.studio_decide_bok(v_other, 'changes', 'recording', 'Запись обрывается.');
  perform public.boks_assert(
    (select status from public.reels where id = v_other) = 'draft' and (select state from public.bok_series_work where bok_id = v_other) = 'returned',
    'a piece returned from work is unlocked and back with its author');
  perform public.boks_test_logout();
end $$;

-- The Workshop (20261122220000): who may use it, meta and notes, shelving,
-- the author's queue, what get_my_workshop returns.
do $$
declare
  v_author uuid := 'f1a00000-0000-4000-8000-000000000001';
  v_rival uuid := 'f1a00000-0000-4000-8000-000000000002';
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_draft uuid := 'f1a00000-0000-4000-8000-0000000000c1';
  v_a uuid := 'f1a00000-0000-4000-8000-0000000000c2';
  v_b uuid := 'f1a00000-0000-4000-8000-0000000000c3';
  v_c uuid := 'f1a00000-0000-4000-8000-0000000000c4';
  v_long uuid := 'f1a00000-0000-4000-8000-0000000000c5';
  v_foreign uuid := 'f1a00000-0000-4000-8000-0000000000c6';
  v_title text := left('Ночь 🌙 ليلة ' || repeat('с', 200), 120);
  v_ws jsonb;
  v_piece jsonb;
  v_meta jsonb;
  v_queue jsonb;
  v_error text;
  v_hint text;
begin
  -- Only a verified author: everyone else is told apart by 42501 and the hint.
  perform public.boks_test_login(v_reader);
  begin
    perform public.get_my_workshop();
    perform public.boks_assert(false, 'the Workshop is closed to an author the editors did not invite');
  exception when insufficient_privilege then
    get stacked diagnostics v_error = message_text, v_hint = pg_exception_hint;
    perform public.boks_assert(v_error = 'The Workshop is open to authors the editors invited.' and v_hint = 'workshop_closed',
      'the Workshop is closed to an author the editors did not invite');
  end;

  perform public.boks_test_logout();
  insert into auth.users (id, email, is_anonymous) values (v_rival, 'workshop-rival@boks.test', false);
  perform public.boks_test_login(v_rival);
  perform public.ensure_boks_user_profile();
  perform public.accept_boks_terms('security-test');
  insert into public.author_spaces (kind, status, name, owner_user_id, verified) values ('author', 'draft', 'Соперник', v_rival, true);
  perform public.save_my_bok(v_foreign, 'Чужое', 'Чужой текст.', false, null, false);

  perform public.boks_test_login(v_author);
  -- A title of 120 characters with an emoji and right-to-left letters; a text exactly at the limit, and one past it.
  perform public.save_my_bok(v_draft, v_title, 'Черновик мастерской.', false, null, false);
  perform public.save_my_bok(v_long, '', repeat('а', public.boks_max_text_characters()), false, null, false);
  begin
    perform public.save_my_bok(v_long, '', repeat('а', public.boks_max_text_characters() + 1), false, null, false);
    perform public.boks_assert(false, 'a text past the bok limit is refused');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a text past the bok limit is refused');
  end;

  v_ws := public.get_my_workshop();
  select p into v_piece from jsonb_array_elements(v_ws -> 'pieces') p where p ->> 'id' = v_draft::text;
  perform public.boks_assert(
    v_piece ->> 'title' = v_title and v_piece ->> 'form' = 'poem' and v_piece -> 'notes' = '{}'::jsonb
      and v_piece -> 'voice' = 'null'::jsonb and v_piece -> 'series' = 'null'::jsonb and v_piece ? 'importedFrom',
    'a piece without Workshop meta comes with the defaults');
  perform public.boks_assert(
    (v_ws -> 'author' ->> 'userId') = v_author::text and (v_ws -> 'author' ->> 'pageId') is not null
      and v_ws -> 'plan' -> 'perYear' = 'null'::jsonb and (v_ws -> 'plan' ->> 'usedThisYear')::int >= 1
      and not exists (select 1 from jsonb_array_elements(v_ws -> 'pieces') p where p ->> 'id' = v_foreign::text)
      and char_length((select p ->> 'text' from jsonb_array_elements(v_ws -> 'pieces') p where p ->> 'id' = v_long::text)) = public.boks_max_text_characters(),
    'get_my_workshop: the author, the plan, the author''s own pieces only, the whole text');

  -- Meta: form, notes and their caps, another author's piece.
  v_meta := public.save_my_workshop_meta(v_draft, '{"form": "prose", "notes": {"about": "о ночи", "plan": [{"id": "1", "text": "начало", "done": false}]}}');
  perform public.boks_assert(v_meta ->> 'form' = 'prose' and v_meta -> 'notes' ->> 'about' = 'о ночи', 'the form and the notes are saved');
  v_meta := public.save_my_workshop_meta(v_draft, '{"notes": {}}');
  perform public.boks_assert(v_meta ->> 'form' = 'prose' and v_meta -> 'notes' = '{}'::jsonb, 'empty notes are saved, the form stays');
  begin
    perform public.save_my_workshop_meta(v_draft, '{"form": "verse"}');
    perform public.boks_assert(false, 'a form other than poem or prose is refused');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a form other than poem or prose is refused');
  end;
  begin
    perform public.save_my_workshop_meta(v_draft, jsonb_build_object('notes', jsonb_build_object('thoughts',
      (select jsonb_agg(jsonb_build_object('text', repeat('x', 1999))) from generate_series(1, 40)))));
    perform public.boks_assert(false, 'notes over 64 KB are refused');
  exception when invalid_parameter_value then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error = 'The notes are longer than 64 KB.', 'notes over 64 KB are refused');
  end;
  begin
    perform public.save_my_workshop_meta(v_draft, jsonb_build_object('notes', jsonb_build_object('plan',
      (select jsonb_agg(jsonb_build_object('id', g::text)) from generate_series(1, 201) g))));
    perform public.boks_assert(false, 'a list of more than 200 entries is refused');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a list of more than 200 entries is refused');
  end;
  begin
    perform public.save_my_workshop_meta(v_draft, jsonb_build_object('notes', jsonb_build_object('about', repeat('я', 2001))));
    perform public.boks_assert(false, 'a note longer than 2000 characters is refused');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a note longer than 2000 characters is refused');
  end;
  begin
    perform public.save_my_workshop_meta(v_foreign, '{"form": "prose"}');
    perform public.boks_assert(false, 'another author''s piece is refused');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'another author''s piece is refused');
  end;

  -- Shelving a draft, and back.
  perform public.boks_assert(public.save_my_workshop_meta(v_draft, '{"shelved": true}') ->> 'shelvedAt' is not null, 'a draft is put aside');
  perform public.boks_assert(public.save_my_workshop_meta(v_draft, '{"shelved": false}') ->> 'shelvedAt' is null, 'a draft is back in work');

  -- Three pieces sent with their voices take places 1, 2, 3 by themselves.
  perform public.set_my_bok_voice(v_a, jsonb_build_object('file', 'take-1.webm', 'durationMs', 4000, 'source', 'upload', 'fingerprint', public.boks_voice_fingerprint('Первый.')));
  perform public.set_my_bok_voice(v_b, jsonb_build_object('file', 'take-1.webm', 'durationMs', 4000, 'source', 'upload', 'fingerprint', public.boks_voice_fingerprint('Второй.')));
  perform public.set_my_bok_voice(v_c, jsonb_build_object('file', 'take-1.webm', 'durationMs', 4000, 'source', 'teleprompter', 'fingerprint', public.boks_voice_fingerprint('Третий.')));
  perform public.save_my_bok(v_a, 'Первый', 'Первый.', true, null, true);
  perform public.save_my_bok(v_b, 'Второй', 'Второй.', true, null, true);
  perform public.save_my_bok(v_c, 'Третий', 'Третий.', true, null, true);
  perform public.boks_assert(
    (select array_agg(queue_pos order by queue_pos) from public.bok_workshop where bok_id in (v_a, v_b, v_c)) = array[1, 2, 3],
    'a piece sent to the editors takes the last place in its author''s queue');
  begin
    perform public.save_my_workshop_meta(v_b, '{"shelved": true}');
    perform public.boks_assert(false, 'a sent piece is not put aside before it is taken back');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a sent piece is not put aside before it is taken back');
  end;

  -- The order: given first, the rest after; refused for a draft, a foreign or a repeated id; the same call twice is the same.
  v_queue := public.set_my_queue_order(array[v_c, v_a]);
  perform public.boks_assert(
    (select queue_pos from public.bok_workshop where bok_id = v_c) = 1 and (select queue_pos from public.bok_workshop where bok_id = v_a) = 2
      and (select queue_pos from public.bok_workshop where bok_id = v_b) = 3 and jsonb_array_length(v_queue) = 3,
    'the author''s order: the given pieces first, every other waiting one after');
  perform public.boks_assert(public.set_my_queue_order(array[v_c, v_a]) = v_queue, 'the same order twice changes nothing');
  begin
    perform public.set_my_queue_order(array[v_draft]);
    perform public.boks_assert(false, 'a piece not sent is not put in the queue');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a piece not sent is not put in the queue');
  end;
  begin
    perform public.set_my_queue_order(array[v_foreign]);
    perform public.boks_assert(false, 'another author''s piece is not put in the queue');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'another author''s piece is not put in the queue');
  end;
  begin
    perform public.set_my_queue_order(array[v_a, v_a]);
    perform public.boks_assert(false, 'a piece named twice is refused');
  exception when invalid_parameter_value then
    perform public.boks_assert(true, 'a piece named twice is refused');
  end;
  -- Two tabs, one after the other: the last order wins and the places stay 1..n.
  perform public.set_my_queue_order(array[v_a, v_b, v_c]);
  perform public.set_my_queue_order(array[v_b, v_c, v_a]);
  perform public.boks_assert(
    (select array_agg(bok_id order by queue_pos) from public.bok_workshop where author_id = v_author and queue_pos is not null) = array[v_b, v_c, v_a]
      and (select array_agg(queue_pos order by queue_pos) from public.bok_workshop where author_id = v_author and queue_pos is not null) = array[1, 2, 3],
    'the last order wins and the places stay whole');

  -- Studio sees the author's order.
  perform public.boks_test_login(v_admin);
  perform public.boks_assert(
    (select (q ->> 'queuePos')::int from jsonb_array_elements(public.get_boks_admin_snapshot(100, 0, '', 'newest') -> 'moderationQueue') q where q ->> 'id' = v_c::text) = 2,
    'the review queue carries the author''s order');
  perform public.studio_accept_bok(v_a);
  perform public.boks_test_login(v_author);
  perform public.withdraw_my_sent_bok(v_b);
  perform public.boks_assert(
    (select queue_pos from public.bok_workshop where bok_id = v_a) is null and (select queue_pos from public.bok_workshop where bok_id = v_b) is null,
    'a piece taken into work or taken back leaves the queue');
  v_queue := public.set_my_queue_order(array[v_a, v_c]);
  perform public.boks_assert(jsonb_array_length(v_queue) = 1 and v_queue -> 0 ->> 'bokId' = v_c::text, 'a piece in work is skipped in the order');

  -- The voice of an edited text is no longer current.
  perform public.boks_assert(
    (select (p -> 'voice' ->> 'current')::boolean from jsonb_array_elements(public.get_my_workshop() -> 'pieces') p where p ->> 'id' = v_b::text),
    'a voice of the text as it is is current');
  perform public.save_my_bok(v_b, 'Второй', 'Второй, исправленный.', false, null, false);
  perform public.boks_assert(
    not (select (p -> 'voice' ->> 'current')::boolean from jsonb_array_elements(public.get_my_workshop() -> 'pieces') p where p ->> 'id' = v_b::text),
    'after the text is edited the voice is no longer current');

  -- A piece deleted while the Workshop has it open.
  perform public.delete_my_draft(v_draft);
  begin
    perform public.save_my_workshop_meta(v_draft, '{"form": "poem"}');
    perform public.boks_assert(false, 'a deleted piece is refused');
  exception when insufficient_privilege then
    perform public.boks_assert(not exists (select 1 from public.bok_workshop where bok_id = v_draft), 'a deleted piece is refused and its meta is gone');
  end;

  -- At most 200 pieces, newest first.
  perform public.boks_test_logout();
  insert into public.reels (title, author_name, text, genre, mood, status, author_user_id, created_at)
  select 'Много ' || g, 'Автор Серии', 'Текст номер ' || g || '.', 'literary', 'quiet', 'draft', v_author, now() + make_interval(secs => g)
  from generate_series(1, 205) g;
  perform public.boks_test_login(v_author);
  v_ws := public.get_my_workshop();
  perform public.boks_assert(jsonb_array_length(v_ws -> 'pieces') = 200 and v_ws -> 'pieces' -> 0 ->> 'title' = 'Много 205',
    'get_my_workshop returns at most 200 pieces, newest first');
  perform public.boks_test_logout();
  delete from public.reels where author_user_id = v_author and title like 'Много %';
end $$;

-- Row level security must hold for a plain authenticated session too.
set role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', '33333333-3333-4333-8333-333333333333', 'role', 'authenticated', 'is_anonymous', false)::text, false);

do $$
begin
  perform public.boks_assert(
    (select count(*) from public.recommendation_events) = 0,
    'a reader cannot select the recommendation event stream'
  );
  -- Rights text can name a person, an estate or a contract; a complaint names
  -- a grievance. Neither is a reader's to read - not even their own report.
  perform public.boks_assert(
    (select count(*) from public.bok_rights) = 0,
    'a reader cannot read the rights records'
  );
  perform public.boks_assert(
    (select count(*) from public.bok_reports) = 0,
    'a reader cannot read the reports, including the one they filed'
  );
  perform public.boks_assert(
    (select count(*) from public.recommendation_experiments where is_active) = 1,
    'a reader can read the active experiment row'
  );

  begin
    insert into public.recommendation_events (user_id, reel_id, event_type)
    values ('33333333-3333-4333-8333-333333333333', null, 'impression');
    perform public.boks_assert(false, 'a reader cannot insert events directly, only through the RPC');
  exception when others then
    perform public.boks_assert(true, 'a reader cannot insert events directly, only through the RPC');
  end;

  -- No way around the admin RPCs: a session has no write privilege on the
  -- table at all, so status cannot be flipped with a plain PostgREST PATCH.
  begin
    update public.reels set status = 'archived' where status = 'published';
    perform public.boks_assert(false, 'a reader cannot hide a boks by updating the table directly');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot hide a boks by updating the table directly');
  end;
  begin
    delete from public.reels where status = 'published';
    perform public.boks_assert(false, 'a reader cannot delete a boks from the table directly');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot delete a boks from the table directly');
  end;
  begin
    perform public.archive_bok((select id from public.reels where status = 'published' limit 1), 'Session attempt.');
    perform public.boks_assert(false, 'a plain reader session cannot call the hide RPC to effect');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a plain reader session cannot call the hide RPC to effect');
  end;
end $$;

reset role;

-- A guest reads the counts, and still cannot read who liked. The ids are
-- taken before the role switch: a guest has no access to `reels` itself and
-- gets ids from the feed, never by querying the table.
select set_config(
  'boks.published_ids',
  (select coalesce(string_agg(id::text, ','), '') from (select id from public.reels where status = 'published' limit 3) s),
  false
);
set role anon;
select set_config('request.jwt.claims', '{}', false);

do $$
declare
  v_ids uuid[] := string_to_array(nullif(current_setting('boks.published_ids'), ''), ',')::uuid[];
  v_result jsonb;
begin
  v_result := public.get_bok_reactions(v_ids);
  perform public.boks_assert(
    cardinality(v_ids) > 0 and jsonb_array_length(v_result) = cardinality(v_ids),
    'a guest can read public reaction counts'
  );
  -- Either answer is right: no privilege on the table at all, which is what a
  -- guest has today, or row-level security leaving nothing visible. What must
  -- never happen is a guest seeing a row - who liked what.
  begin
    perform public.boks_assert(
      (select count(*) from public.likes) = 0,
      'a guest cannot read the like rows the counts are made from'
    );
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a guest cannot read the like rows the counts are made from');
  end;
  -- A guest may not even call the admin functions.
  begin
    perform public.archive_bok(v_ids[1], 'Guest attempt.');
    perform public.boks_assert(false, 'a guest cannot call the hide RPC at all');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a guest cannot call the hide RPC at all');
  end;
  begin
    perform public.get_admin_bok(v_ids[1]);
    perform public.boks_assert(false, 'a guest cannot call the admin boks view');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a guest cannot call the admin boks view');
  end;
end $$;

reset role;


-- Embeddings (migrations 20260920100000 / 20260920103000).
--
-- The semantic side of the ranker is only as good as these guarantees: the
-- column really is a 384-dimension vector, a wrong-sized vector is refused
-- rather than stored, an edited text loses its stale vector, and the candidate
-- RPC actually computes a similarity for a reader who has liked something.
do $$
declare
  v_ids uuid[] := string_to_array(nullif(current_setting('boks.published_ids'), ''), ',')::uuid[];
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_one uuid := v_ids[1];
  v_two uuid := v_ids[2];
  v_vector_a jsonb := (select jsonb_agg(case when n = 1 then 1 else 0 end) from generate_series(1, 384) n);
  v_vector_b jsonb := (select jsonb_agg(case when n = 2 then 1 else 0 end) from generate_series(1, 384) n);
  v_candidates jsonb;
  v_entry jsonb;
  v_coverage jsonb;
  v_text text;
begin
  perform public.boks_assert(
    exists (select 1 from pg_extension where extname = 'vector'),
    'the vector extension is installed'
  );
  perform public.boks_assert(
    (
      select format_type(a.atttypid, a.atttypmod)
      from pg_attribute a
      where a.attrelid = 'public.reels'::regclass and a.attname = 'embedding'
    -- Schema-qualified or not, depending on the search path this runs under:
    -- the extension lives in `extensions`, so `format_type` may print either.
    ) like '%vector(384)',
    'reels.embedding is a 384-dimension vector'
  );

  -- A model swapped for one of another size must fail here, not silently
  -- store vectors that no comparison can use.
  begin
    perform public.set_bok_embedding(v_one, '[0.1, 0.2, 0.3]'::jsonb, public.boks_embedding_model());
    perform public.boks_assert(false, 'an embedding of the wrong size is refused');
  exception when others then
    perform public.boks_assert(sqlstate = '22023', 'an embedding of the wrong size is refused');
  end;

  -- Two models in one column would make every comparison meaningless, and
  -- nothing about that failure is visible in a feed, so it is refused.
  begin
    perform public.set_bok_embedding(v_one, v_vector_a, 'some-other-model');
    perform public.boks_assert(false, 'a vector from another model is refused');
  exception when others then
    perform public.boks_assert(sqlstate = '22023', 'a vector from another model is refused');
  end;

  perform public.set_bok_embedding(v_one, v_vector_a, public.boks_embedding_model());
  perform public.set_bok_embedding(v_two, v_vector_b, public.boks_embedding_model());
  perform public.boks_assert(
    (select embedding is not null and embedding_model = public.boks_embedding_model() and embedded_at is not null
     from public.reels where id = v_one),
    'a stored embedding records its model and time'
  );

  -- Needs-embedding is "no vector", so the two just written are not in it.
  perform public.boks_assert(
    not exists (
      select 1 from jsonb_array_elements(public.get_boks_needing_embedding(100)) e
      where (e ->> 'id')::uuid in (v_one, v_two)
    ),
    'an embedded bok is not offered for embedding again'
  );

  v_coverage := public.boks_embedding_coverage();
  perform public.boks_assert(
    (v_coverage ->> 'publishedEmbedded')::integer >= 2
      and (v_coverage ->> 'publishedTotal')::integer >=
          (v_coverage ->> 'publishedEmbedded')::integer,
    'coverage counts the embedded boks'
  );

  -- An edited text is a different text: the vector of the old words must go.
  select text into v_text from public.reels where id = v_two;
  update public.reels set text = v_text || E'\n\nOne more line, added by the checks.' where id = v_two;
  perform public.boks_assert(
    (select embedding is null and embedded_at is null from public.reels where id = v_two),
    'editing the text clears the stale embedding'
  );
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(public.get_boks_needing_embedding(100)) e
      where (e ->> 'id')::uuid = v_two
    ),
    'a bok whose text changed is offered for embedding again'
  );
  perform public.set_bok_embedding(v_two, v_vector_b, public.boks_embedding_model());

  -- The reader side. With nothing liked or finished there is no taste vector,
  -- and the ranker must be given a null rather than a fabricated zero.
  perform public.boks_test_login(v_reader);
  delete from public.likes where user_id = v_reader;
  v_candidates := public.get_recommendation_candidates(50, null);
  select e into v_entry from jsonb_array_elements(v_candidates) e where (e ->> 'id')::uuid = v_one;
  perform public.boks_assert(
    (v_entry ->> 'hasEmbedding')::boolean,
    'the candidate set reports which boks carry a vector'
  );
  perform public.boks_assert(
    v_entry ->> 'tasteSimilarity' is null and (v_entry ->> 'tasteSamples')::integer = 0,
    'a reader with no history gets no taste similarity at all'
  );

  -- One like is enough for the vectors to be compared, and a piece identical
  -- to the liked one must score higher than an orthogonal one.
  insert into public.likes (reel_id, user_id) values (v_one, v_reader)
  on conflict do nothing;
  v_candidates := public.get_recommendation_candidates(50, null);
  select e into v_entry from jsonb_array_elements(v_candidates) e where (e ->> 'id')::uuid = v_one;
  perform public.boks_assert(
    (v_entry ->> 'tasteSamples')::integer >= 1 and (v_entry ->> 'tasteSimilarity')::numeric > 0.9,
    'the boks a reader liked is closest to their own taste vector'
  );
  select e into v_entry from jsonb_array_elements(v_candidates) e where (e ->> 'id')::uuid = v_two;
  perform public.boks_assert(
    (v_entry ->> 'tasteSimilarity')::numeric < 0.5,
    'an unrelated boks scores far from that taste vector'
  );
  delete from public.likes where user_id = v_reader and reel_id = v_one;
  perform public.boks_test_logout();
end $$;


-- Feedback (migration 20260921100000).
--
-- The promise of this feature is that a reader with no account can say
-- something and that nobody but an admin can read it. Both halves are checked
-- here, because both are the kind of thing that breaks quietly.
do $$
declare
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_guest uuid := '88888888-8888-4888-8888-888888888888';
  v_result jsonb;
  v_index integer;
  v_odd_surface bigint;
begin
  -- A guest has an anonymous Supabase session. Bare publishable-key calls are
  -- not accepted, so every write has an accountable, rate-limited identity.
  insert into auth.users (id, is_anonymous) values (v_guest, true) on conflict (id) do nothing;
  perform public.boks_test_login(v_guest, true);
  set local role authenticated;
  v_result := public.submit_boks_feedback('The reader is lovely but I cannot find the light theme.', 'settings', 2, 'device-guest-1');
  perform public.boks_assert((v_result ->> 'ok')::boolean, 'an anonymous signed-in reader can send feedback');
  reset role;

  -- A signed-in reader, from a milestone prompt.
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  v_result := public.submit_boks_feedback('Three boks in and I am staying. More Chekhov please.', 'after_3', 3, 'device-reader-1');
  perform public.boks_assert((v_result ->> 'ok')::boolean, 'a signed-in reader can send feedback');

  -- Too short is refused, and an unknown surface is recorded rather than
  -- rejected: losing a note over a bad label would be the wrong trade.
  begin
    perform public.submit_boks_feedback(' ', 'settings', 0, 'device-reader-1');
    perform public.boks_assert(false, 'an empty note is refused');
  exception when sqlstate '22023' then
    perform public.boks_assert(true, 'an empty note is refused');
  end;
  -- Kept for a look after the role is dropped: a reader has no privilege on
  -- the table itself, which the assertion further down proves.
  v_result := public.submit_boks_feedback('Sent from somewhere new.', 'somewhere-else', 1, 'device-reader-1');
  v_odd_surface := (v_result ->> 'id')::bigint;

  -- Five an hour, then a friendly stop.
  v_index := 0;
  while v_index < 3 loop
    v_index := v_index + 1;
    begin
      perform public.submit_boks_feedback(format('Filling the inbox, note %s.', v_index), 'settings', 3, 'device-reader-1');
    exception when sqlstate '54023' then
      null;
    end;
  end loop;
  begin
    perform public.submit_boks_feedback('One too many.', 'settings', 3, 'device-reader-1');
    perform public.boks_assert(false, 'a sixth note in an hour is refused');
  exception when sqlstate '54023' then
    perform public.boks_assert(true, 'a sixth note in an hour is refused');
  end;

  -- A reader cannot read the inbox. Someone's complaint about another reader
  -- is not public, and neither is a complaint about whoever runs this.
  begin
    perform public.get_boks_feedback(10, 0);
    perform public.boks_assert(false, 'a reader cannot read the feedback inbox');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot read the feedback inbox');
  end;
  begin
    perform public.boks_assert(
      (select count(*) from public.boks_feedback) = 0,
      'a reader cannot read the feedback table directly'
    );
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot read the feedback table directly');
  end;
  reset role;

  -- The admin can, and gets the context with it.
  perform public.boks_test_login(v_admin);
  set local role authenticated;
  v_result := public.get_boks_feedback(50, 0);
  perform public.boks_assert((v_result ->> 'total')::integer >= 3, 'an admin reads every note');
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result -> 'rows') r
      where r.value ->> 'surface' = 'after_3' and (r.value ->> 'boksRead')::integer = 3
    ),
    'a note carries where it was written and how much had been read'
  );
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_result -> 'rows') r
      where r.value ->> 'handle' is null and r.value ->> 'visitorId' = 'device-guest-1'
    ),
    'a note from a reader with no account carries the device, not a name'
  );
  reset role;
  perform public.boks_test_logout();

  perform public.boks_assert(
    (select surface = 'other' from public.boks_feedback where id = v_odd_surface),
    'an unrecognised surface is stored as other rather than refused'
  );

  delete from public.boks_feedback where visitor_id in ('device-guest-1', 'device-reader-1');
  delete from auth.users where id = v_guest;
end $$;


-- The guest journey (migration 20260922100000).
--
-- What has to hold: a visitor with no session can be recorded, a reload is not
-- a second visit, nothing it does not recognise can break a page, a reader
-- cannot read the funnel, and a device that was a guest and then an account is
-- counted as a conversion - which is the number the whole feature exists for.
do $$
declare
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_guest uuid := '66666666-6666-4666-8666-666666666666';
  v_reel uuid;
  v_funnel jsonb;
begin
  select id into v_reel from public.reels where status = 'published' limit 1;

  -- A guest device: an anonymous user reads, meets the limit, asks for a link,
  -- and the same device then reads as a signed-in reader.
  insert into auth.users (id, is_anonymous) values (v_guest, true) on conflict (id) do nothing;
  insert into public.recommendation_events (user_id, reel_id, visitor_id, session_id, event_type, surface, value)
  values
    (v_guest, v_reel, 'device-journey-1', 'session-journey-1', 'start', 'reader', 1),
    (v_guest, v_reel, 'device-journey-1', 'session-journey-1', 'complete', 'reader', 40),
    (v_reader, v_reel, 'device-journey-1', 'session-journey-2', 'start', 'reader', 1);

  perform public.boks_test_login(v_guest, true);
  set local role authenticated;
  perform public.record_boks_journey_event('visit', 'device-journey-1', 'session-journey-1', null, 'shared_bok', 't.me', 'tg', 'social', 'launch');
  perform public.record_boks_journey_event('visit', 'device-journey-1', 'session-journey-1', null, 'shared_bok', 't.me', null, null, null);
  perform public.record_boks_journey_event('signup_prompt', 'device-journey-1', 'session-journey-1', 'limit');
  perform public.record_boks_journey_event('signup_request', 'device-journey-1', 'session-journey-1', 'limit');
  -- Unknown events are dropped, not raised: analytics must never fail a page.
  perform public.record_boks_journey_event('drop table reels', 'device-journey-1', 'session-journey-1');
  reset role;

  perform public.boks_assert(
    (select count(*) from public.boks_journey_events where visitor_id = 'device-journey-1' and event = 'visit') = 1,
    'a reload in the same session is not a second visit'
  );
  perform public.boks_assert(
    (select count(*) from public.boks_journey_events where visitor_id = 'device-journey-1') = 3,
    'an anonymous signed-in visitor is recorded, and an unknown event is dropped silently'
  );

  -- A reader cannot read the funnel, and cannot read the journey table.
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  begin
    perform public.get_guest_funnel(14);
    perform public.boks_assert(false, 'a reader cannot read the guest funnel');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot read the guest funnel');
  end;
  begin
    perform public.boks_assert((select count(*) from public.boks_journey_events) = 0, 'a reader cannot read journey rows');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot read journey rows');
  end;
  reset role;

  -- The admin sees the conversion, counted by device.
  perform public.boks_test_login(v_admin);
  set local role authenticated;
  v_funnel := public.get_guest_funnel(14);
  reset role;
  perform public.boks_test_logout();

  perform public.boks_assert((v_funnel -> 'funnel' ->> 'guests')::integer >= 1, 'the funnel counts guest devices');
  perform public.boks_assert((v_funnel -> 'funnel' ->> 'finishedOne')::integer >= 1, 'a guest who finished a bok is counted as having read');
  perform public.boks_assert((v_funnel -> 'funnel' ->> 'requestedLink')::integer >= 1, 'a guest who asked for a link is counted');
  perform public.boks_assert(
    (v_funnel -> 'funnel' ->> 'createdAccount')::integer >= 1,
    'a device that was a guest and then an account is a conversion'
  );
  perform public.boks_assert((v_funnel -> 'limit' ->> 'hit')::integer >= 1, 'hitting the guest limit is counted');
  perform public.boks_assert(
    exists (select 1 from jsonb_array_elements(v_funnel -> 'sources' -> 'referrer') r where r ->> 'value' = 't.me'),
    'the referrer of a visit reaches the sources table'
  );

  -- One day opened up (migration 20261014150000): the device, where it came
  -- from, and the bok it finished; and the day row counts what hands did.
  perform public.boks_assert(
    (v_funnel -> 'daily' -> 0) ? 'touched' and (v_funnel -> 'daily' -> 0) ? 'countries',
    'each day says how many guests touched a bok and where they were'
  );
  perform public.boks_test_login(v_admin);
  set local role authenticated;
  v_funnel := public.get_guest_day((now() at time zone 'UTC')::date);
  reset role;
  perform public.boks_test_logout();
  perform public.boks_assert(
    exists (
      select 1 from jsonb_array_elements(v_funnel -> 'devices') d
      where d ->> 'device' = right('device-journey-1', 6)
        and d -> 'visits' -> 0 ->> 'referrer' = 't.me'
        and (d -> 'boks' -> 0 ->> 'finished')::boolean
        and (d ->> 'guest')::boolean and (d ->> 'account')::boolean
        and d -> 'prompts' ->> 0 = 'limit'
    ),
    'a day opened up shows the device, its referrer, its prompt and the bok it finished'
  );
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  begin
    perform public.get_guest_day((now() at time zone 'UTC')::date);
    perform public.boks_assert(false, 'a reader cannot open a day');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot open a day');
  end;
  reset role;
  perform public.boks_test_logout();

  delete from public.boks_journey_events where visitor_id = 'device-journey-1';
  delete from public.recommendation_events where visitor_id = 'device-journey-1';
end $$;


-- Countries and team devices (migration 20260922120000).
--
-- The point of both is telling strangers from ourselves, so each check is a
-- way that could go wrong: a garbage country stored as a country, the team's
-- own devices counted as guests, a hidden country still counted.
do $$
declare
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_guest uuid := '77777777-7777-4777-8777-777777777777';
  v_reel uuid;
  v_funnel jsonb;
begin
  select id into v_reel from public.reels where status = 'published' limit 1;
  insert into auth.users (id, is_anonymous) values (v_guest, true) on conflict (id) do nothing;

  -- Three guest devices: a stranger in Russia, a developer's device that an
  -- admin also used, and a developer's private window in Serbia.
  insert into public.recommendation_events (user_id, reel_id, visitor_id, session_id, event_type, surface, value)
  values
    (v_guest, v_reel, 'geo-stranger', 'geo-s1', 'start', 'reader', 1),
    (v_guest, v_reel, 'geo-dev-phone', 'geo-s2', 'start', 'reader', 1),
    (v_admin, v_reel, 'geo-dev-phone', 'geo-s3', 'start', 'reader', 1),
    (v_guest, v_reel, 'geo-dev-private', 'geo-s4', 'start', 'reader', 1);

  perform public.boks_test_login(v_guest, true);
  set local role authenticated;
  perform public.record_boks_journey_event('visit', 'geo-stranger', 'geo-s1', null, 'home', null, null, null, null, 'ru');
  perform public.record_boks_journey_event('visit', 'geo-dev-private', 'geo-s4', null, 'home', null, null, null, null, 'RS');
  perform public.record_boks_journey_event('visit', 'geo-junk-1', 'geo-s5', null, 'home', null, null, null, null, 'XX');
  perform public.record_boks_journey_event('visit', 'geo-junk-2', 'geo-s6', null, 'home', null, null, null, null, 'Russia');
  reset role;

  perform public.boks_assert(
    (select country from public.boks_journey_events where visitor_id = 'geo-stranger') = 'RU',
    'a country code is stored upper-case'
  );
  perform public.boks_assert(
    (select count(*) from public.boks_journey_events where visitor_id in ('geo-junk-1', 'geo-junk-2') and country is not null) = 0,
    'an unknown or malformed country is stored as nothing, not as a country'
  );

  -- Marking a device is for admins only.
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  begin
    perform public.mark_team_device('geo-stranger');
    perform public.boks_assert(false, 'a reader cannot mark a device as the team''s');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot mark a device as the team''s');
  end;
  reset role;

  perform public.boks_test_login(v_admin);
  set local role authenticated;

  v_funnel := public.get_guest_funnel(14);
  perform public.boks_assert(
    not exists (select 1 from jsonb_array_elements(v_funnel -> 'countries') c where c ->> 'country' = 'RS')
      or (select (c ->> 'devices')::integer from jsonb_array_elements(v_funnel -> 'countries') c where c ->> 'country' = 'RS') >= 1,
    'the funnel answers with countries'
  );
  -- A device an admin ever used is the team's, including its guest history.
  perform public.boks_assert(
    (select count(*) from jsonb_array_elements(v_funnel -> 'countries') c) >= 1
      and (v_funnel -> 'team' ->> 'devices')::integer >= 1,
    'a device used by an admin is recognised as the team''s'
  );
  perform public.boks_assert(
    (public.get_guest_funnel(14, true) -> 'funnel' ->> 'guests')::integer
      > (v_funnel -> 'funnel' ->> 'guests')::integer,
    'team devices are left out unless asked for, and counted when they are'
  );

  -- A private window cannot be linked to anyone; hiding its country is the tool.
  perform public.boks_assert(
    (public.get_guest_funnel(14, false, array['rs']) -> 'funnel' ->> 'guests')::integer
      < (v_funnel -> 'funnel' ->> 'guests')::integer,
    'hiding a country removes its devices from the funnel'
  );

  -- Marking by hand works too.
  perform public.mark_team_device('geo-stranger', 'check');
  perform public.boks_assert(
    (public.get_guest_funnel(14) -> 'funnel' ->> 'guests')::integer
      < (v_funnel -> 'funnel' ->> 'guests')::integer,
    'a device marked by hand is left out'
  );
  perform public.unmark_team_device('geo-stranger');
  reset role;
  perform public.boks_test_logout();

  delete from public.boks_journey_events where visitor_id like 'geo-%';
  delete from public.recommendation_events where visitor_id like 'geo-%';
end $$;


-- Tracked links (migration 20261011100000).
--
-- The question the feature answers is "the link we sent there: did anyone
-- come, read the bok, read another, sign up". Each check is a way that answer
-- could be wrong: a hand-typed code counted as a link, a damaged bok id
-- failing a page, the arriving session's own reading missed because the visit
-- row landed after it, a sign-in to an old account counted as a sign-up, a
-- reader seeing any of it.
do $$
declare
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_guest uuid := '88888888-8888-4888-8888-888888888888';
  v_new_account uuid := '99999999-9999-4999-8999-999999999999';
  v_old_guest uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_reel uuid;
  v_other uuid;
  v_link jsonb;
  v_code text;
  v_report jsonb;
  v_row jsonb;
begin
  select id into v_reel from public.reels where status = 'published' order by created_at, id limit 1;
  select id into v_other from public.reels where status = 'published' and id <> v_reel order by created_at, id limit 1;

  -- Only admins make links.
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  begin
    perform public.create_tracked_link('nope', v_reel::text);
    perform public.boks_assert(false, 'a reader cannot create a tracked link');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot create a tracked link');
  end;
  begin
    perform public.get_link_attribution(30);
    perform public.boks_assert(false, 'a reader cannot read link attribution');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot read link attribution');
  end;
  begin
    perform 1 from public.boks_tracked_links;
    perform public.boks_assert(false, 'a reader cannot read tracked links');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot read tracked links');
  end;
  reset role;

  perform public.boks_test_login(v_admin);
  set local role authenticated;
  v_link := public.create_tracked_link('Check university', v_reel::text);
  v_code := v_link ->> 'code';
  perform public.boks_assert(v_code ~ '^[0-9a-f]{6}$', 'a link without a code gets a generated one');
  perform public.boks_assert((v_link ->> 'bokId')::uuid = v_reel, 'a link remembers its bok');
  perform public.create_tracked_link('Check home page', null, 'check-home');
  begin
    perform public.create_tracked_link('Duplicate', null, 'check-home');
    perform public.boks_assert(false, 'a taken code is refused');
  exception when unique_violation then
    perform public.boks_assert(true, 'a taken code is refused');
  end;
  begin
    perform public.create_tracked_link('Bad', null, 'Not A Code!');
    perform public.boks_assert(false, 'a malformed code is refused');
  exception when sqlstate '22023' then
    perform public.boks_assert(true, 'a malformed code is refused');
  end;
  begin
    perform public.create_tracked_link('Bad', '00000000-0000-4000-8000-000000000000');
    perform public.boks_assert(false, 'a link to a bok that does not exist is refused');
  exception when sqlstate '22023' then
    perform public.boks_assert(true, 'a link to a bok that does not exist is refused');
  end;
  reset role;

  -- An account that predates the visit, used by the device that signs in.
  insert into auth.users (id, is_anonymous, created_at)
  values (v_old_guest, false, now() - interval '30 days')
  on conflict (id) do nothing;
  insert into auth.users (id, is_anonymous) values (v_guest, true) on conflict (id) do nothing;

  -- Device 1 arrives through the link as a guest. Its start of the landed bok
  -- is a second before the visit row, as on production; it opens the
  -- production, finishes it, finishes another, comes back tomorrow, and signs
  -- up as a new account.
  insert into public.recommendation_events (user_id, reel_id, visitor_id, session_id, event_type, surface, value, active_seconds, metadata, created_at)
  values
    (v_guest, v_reel, 'link-device-1', 'link-s1', 'start', 'reader', 1, 0, '{"entry":"share"}', now() - interval '1 day' - interval '1 second'),
    (v_guest, v_reel, 'link-device-1', 'link-s1', 'heartbeat', 'reader', 1, 120, '{"entry":"share","format":"cinema"}', now() - interval '1 day' + interval '2 minutes'),
    (v_guest, v_reel, 'link-device-1', 'link-s1', 'complete', 'reader', 1, 180, '{"entry":"share","format":"cinema"}', now() - interval '1 day' + interval '3 minutes'),
    (v_guest, v_other, 'link-device-1', 'link-s1', 'complete', 'reader', 1, 60, '{}', now() - interval '1 day' + interval '6 minutes');

  -- Device 2 arrives through the link and leaves at once, then signs in to
  -- an account it already had: that is not a sign-up.
  insert into public.recommendation_events (user_id, reel_id, visitor_id, session_id, event_type, surface, value, created_at)
  values
    (v_guest, v_reel, 'link-device-2', 'link-s2', 'impression', 'reader', 1, now() - interval '1 day'),
    (v_old_guest, v_other, 'link-device-2', 'link-s3', 'start', 'reader', 1, now() - interval '1 day' + interval '1 minute');

  perform public.boks_test_login(v_guest, true);
  set local role authenticated;
  perform public.record_boks_journey_event('visit', 'link-device-1', 'link-s1', null, 'shared_bok', 'vk.com', null, null, null, 'RU', upper(v_reel::text), upper(v_code));
  perform public.record_boks_journey_event('visit', 'link-device-2', 'link-s2', null, 'shared_bok', null, null, null, null, 'RU', v_reel::text, v_code);
  -- A hand-typed code and a damaged id are dropped, not raised.
  perform public.record_boks_journey_event('visit', 'link-device-3', 'link-s4', null, 'shared_bok', null, null, null, null, null, 'a1e3baf7-damaged', 'not-a-link');
  -- A sign-up prompt does not carry a link even if a client sends one.
  perform public.record_boks_journey_event('signup_prompt', 'link-device-1', 'link-s1', 'limit', null, null, null, null, null, null, v_reel::text, v_code);
  reset role;

  -- Backdate the visits to when the reading above happened.
  update public.boks_journey_events set created_at = now() - interval '1 day'
  where visitor_id in ('link-device-1', 'link-device-2');
  -- Tomorrow, device 1 reads again - as the account it just created.
  insert into auth.users (id, is_anonymous, created_at)
  values (v_new_account, false, now() - interval '1 day' + interval '10 minutes')
  on conflict (id) do nothing;
  insert into public.recommendation_events (user_id, reel_id, visitor_id, session_id, event_type, surface, value, created_at)
  values (v_new_account, v_other, 'link-device-1', 'link-s5', 'start', 'reader', 1, now());

  perform public.boks_assert(
    (select link_code = v_code and landing_reel_id = v_reel from public.boks_journey_events
     where visitor_id = 'link-device-1' and event = 'visit'),
    'a visit carries its link and its landed bok, whatever their case'
  );
  perform public.boks_assert(
    (select link_code is null and landing_reel_id is null from public.boks_journey_events where visitor_id = 'link-device-3'),
    'an unknown code and a damaged bok id are stored as nothing, and the visit is still recorded'
  );
  perform public.boks_assert(
    (select link_code is null and landing_reel_id is null from public.boks_journey_events
     where visitor_id = 'link-device-1' and event = 'signup_prompt'),
    'only a visit carries a link and a landed bok'
  );

  perform public.boks_test_login(v_admin);
  set local role authenticated;
  v_report := public.get_link_attribution(30);
  reset role;
  perform public.boks_test_logout();

  select l into v_row from jsonb_array_elements(v_report -> 'links') l where l ->> 'code' = v_code;
  perform public.boks_assert((v_row -> 'stats' ->> 'visits')::integer = 2, 'a link counts its visits');
  perform public.boks_assert((v_row -> 'stats' ->> 'devices')::integer = 2, 'a link counts its arriving devices');
  perform public.boks_assert(
    (v_row -> 'stats' ->> 'startedBok')::integer = 1,
    'the arriving session''s start counts even though it was recorded before the visit'
  );
  perform public.boks_assert((v_row -> 'stats' ->> 'finishedBok')::integer = 1, 'finishing the landed bok is counted');
  perform public.boks_assert((v_row -> 'stats' ->> 'openedFormat')::integer = 1, 'opening the production is counted');
  perform public.boks_assert((v_row -> 'stats' ->> 'readAnother')::integer = 1, 'reading on past the landed bok is counted');
  perform public.boks_assert((v_row -> 'stats' ->> 'cameBack')::integer = 1, 'coming back on a later day is counted');
  perform public.boks_assert(
    (v_row -> 'stats' ->> 'createdAccount')::integer = 1,
    'a guest who signs up after arriving is counted, and signing in to an older account is not'
  );
  perform public.boks_assert(
    exists (select 1 from jsonb_array_elements(v_row -> 'referrers') r where r ->> 'value' = 'vk.com'),
    'a link reports where its visits came from'
  );
  perform public.boks_assert(
    exists (select 1 from jsonb_array_elements(v_report -> 'links') l
            where l ->> 'code' = 'check-home' and (l -> 'stats' ->> 'visits')::integer = 0),
    'a link nobody used yet is listed with zero visits'
  );
  perform public.boks_assert(
    exists (select 1 from jsonb_array_elements(v_report -> 'boks') b
            where (b ->> 'bokId')::uuid = v_reel and (b -> 'stats' ->> 'devices')::integer = 2
              and (b ->> 'throughLinks')::integer = 2),
    'the landed bok is reported, with how many arrived through a tracked link'
  );

  -- Hiding the country removes both devices; archiving keeps the history.
  perform public.boks_test_login(v_admin);
  set local role authenticated;
  perform public.boks_assert(
    coalesce((select (l -> 'stats' ->> 'devices')::integer from jsonb_array_elements(public.get_link_attribution(30, false, array['ru']) -> 'links') l where l ->> 'code' = v_code), 0) = 0,
    'a hidden country leaves the link numbers'
  );
  perform public.set_tracked_link_archived(v_code, true);
  perform public.boks_assert(
    (select (l ->> 'archived')::boolean and (l -> 'stats' ->> 'devices')::integer = 2
     from jsonb_array_elements(public.get_link_attribution(30) -> 'links') l where l ->> 'code' = v_code),
    'an archived link keeps its numbers'
  );
  reset role;
  perform public.boks_test_login(v_guest, true);
  set local role authenticated;
  perform public.record_boks_journey_event('visit', 'link-device-4', 'link-s6', null, 'shared_bok', null, null, null, null, null, v_reel::text, v_code);
  reset role;
  perform public.boks_test_logout();
  perform public.boks_assert(
    (select link_code = v_code from public.boks_journey_events where visitor_id = 'link-device-4'),
    'an archived link still records visits - old links keep being tapped'
  );

  delete from public.boks_journey_events where visitor_id like 'link-device-%';
  delete from public.recommendation_events where visitor_id like 'link-device-%';
  delete from public.boks_tracked_links where code in (v_code, 'check-home');
  delete from auth.users where id in (v_guest, v_new_account, v_old_guest);
end $$;


-- Studies (migration 20261026100000).
--
-- The switch is the point: a study that is off takes no participant and no
-- answer, and a reader can never turn one on, read another participant's
-- answers or see which b3 fragments the algorithm chose.
do $$
declare
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_guest uuid := '88888888-8888-4888-8888-888888888888';
  v_new_account uuid := '99999999-9999-4999-8999-999999999999';
  v_old_guest uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_reel uuid;
  v_study jsonb;
  v_first jsonb;
  v_again jsonb;
  v_other jsonb;
  v_fragment jsonb;
  v_trace jsonb;
  v_count integer;
begin
  insert into auth.users (id, is_anonymous) values (v_guest, true), (v_new_account, false) on conflict (id) do nothing;
  select id into v_reel from public.reels where status = 'published' order by created_at, id limit 1;

  -- A reader sees the study as off, with no materials, and cannot join.
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  v_study := public.get_boks_study('rg1');
  perform public.boks_assert((v_study ->> 'enabled')::boolean = false, 'a study starts switched off');
  perform public.boks_assert(v_study -> 'participant' = 'null'::jsonb, 'nobody is in a study before joining');
  begin
    perform public.enroll_in_boks_study('rg1', 'visitor-1');
    perform public.boks_assert(false, 'nobody joins a study that is off');
  exception when sqlstate '55000' then
    perform public.boks_assert(true, 'nobody joins a study that is off');
  end;
  begin
    perform public.set_boks_study_enabled('rg1', true);
    perform public.boks_assert(false, 'a reader cannot switch a study on');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot switch a study on');
  end;
  begin
    perform public.list_boks_studies();
    perform public.boks_assert(false, 'a reader cannot list studies');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot list studies');
  end;
  begin
    perform 1 from public.boks_study_responses;
    perform public.boks_assert(false, 'a reader cannot read study answers directly');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot read study answers directly');
  end;
  reset role;

  -- The admin switches rg1 on with materials, and b1 and b3 too.
  perform public.boks_test_login(v_admin);
  set local role authenticated;
  perform public.set_boks_study_materials('rg1', jsonb_build_object('targets', jsonb_build_array(v_reel)));
  perform public.set_boks_study_enabled('rg1', true);
  perform public.set_boks_study_enabled('b1', true);
  perform public.set_boks_study_enabled('b3', true);
  perform public.boks_assert(
    public.import_boks_study_fragments('check', jsonb_build_array(
      jsonb_build_object('method', 'algorithm', 'sourceTitle', 'Война и мир', 'body', 'Один два три четыре.', 'rank', 1),
      jsonb_build_object('method', 'window', 'sourceTitle', 'Война и мир', 'body', 'Пять шесть семь.')
    )) = 2,
    'an admin imports b3 fragments');
  reset role;

  -- Joining: a balanced condition, the same one on a second call.
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  v_study := public.get_boks_study('rg1');
  perform public.boks_assert(v_study -> 'materials' -> 'targets' ->> 0 = v_reel::text, 'a running study shows its materials');
  v_first := public.enroll_in_boks_study('rg1', 'visitor-1');
  perform public.boks_assert(v_first ->> 'condition' in ('series', 'text'), 'rg1 assigns series or text');
  v_again := public.enroll_in_boks_study('rg1', 'visitor-1');
  perform public.boks_assert(v_again ->> 'id' = v_first ->> 'id', 'joining twice keeps the same assignment');
  perform public.record_boks_study_response((v_first ->> 'id')::uuid, 'after_reading',
    '{"moved": 6, "thought": 5}'::jsonb, v_reel, null, v_first ->> 'condition', 120);
  v_study := public.get_boks_study('rg1');
  perform public.boks_assert(v_study -> 'participant' -> 'steps' -> 0 ->> 'step' = 'after_reading',
    'a participant sees the steps they finished');
  reset role;

  perform public.boks_test_login(v_guest, true);
  set local role authenticated;
  v_other := public.enroll_in_boks_study('rg1', 'visitor-2');
  perform public.boks_assert(v_other ->> 'condition' <> v_first ->> 'condition',
    'the second participant gets the other condition');
  begin
    perform public.record_boks_study_response((v_first ->> 'id')::uuid, 'after_reading', '{}'::jsonb);
    perform public.boks_assert(false, 'nobody answers for another participant');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'nobody answers for another participant');
  end;
  reset role;

  -- Switched off: answers stop, what was collected stays.
  perform public.boks_test_login(v_admin);
  set local role authenticated;
  perform public.set_boks_study_enabled('rg1', false);
  perform public.boks_assert(
    ((public.get_boks_study_responses('rg1') ->> 'total')::integer) = 1,
    'an admin reads the answers collected');
  reset role;
  perform public.boks_test_login(v_reader);
  set local role authenticated;
  begin
    perform public.record_boks_study_response((v_first ->> 'id')::uuid, 'after_reading', '{}'::jsonb);
    perform public.boks_assert(false, 'no answers while the study is off');
  exception when sqlstate '55000' then
    perform public.boks_assert(true, 'no answers while the study is off');
  end;
  begin
    perform public.get_boks_study_responses('rg1');
    perform public.boks_assert(false, 'a reader cannot read study answers');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot read study answers');
  end;

  -- b3: the method stays hidden, and a rater never gets the same fragment twice.
  v_first := public.enroll_in_boks_study('b3', 'visitor-1');
  v_fragment := public.next_boks_study_fragment((v_first ->> 'id')::uuid);
  perform public.boks_assert(v_fragment ? 'body' and not v_fragment ? 'method', 'a rater sees the fragment, not its method');
  perform public.record_boks_study_response((v_first ->> 'id')::uuid, 'fragment_rating',
    '{"standalone": "yes", "complete": "no"}'::jsonb, null, (v_fragment ->> 'id')::uuid);
  perform public.boks_assert(
    public.next_boks_study_fragment((v_first ->> 'id')::uuid) ->> 'id' <> v_fragment ->> 'id',
    'a rater is not given a fragment they rated');

  -- b1: an active trace is replayed by exactly one passive participant.
  v_first := public.enroll_in_boks_study('b1', 'visitor-1');
  perform public.boks_assert(public.claim_boks_study_trace((v_first ->> 'id')::uuid, v_reel) is null,
    'with no trace recorded the first participant is active');
  perform public.record_boks_study_response((v_first ->> 'id')::uuid, 'trace',
    '{"events": [[1000, "down", 0.5, 0.5]]}'::jsonb, v_reel, null, 'active');
  reset role;

  perform public.boks_test_login(v_guest, true);
  set local role authenticated;
  v_other := public.enroll_in_boks_study('b1', 'visitor-2');
  v_trace := public.claim_boks_study_trace((v_other ->> 'id')::uuid, v_reel);
  perform public.boks_assert(v_trace -> 'trace' -> 'events' -> 0 ->> 1 = 'down', 'a passive participant gets the recorded trace');
  perform public.boks_assert(
    public.claim_boks_study_trace((v_other ->> 'id')::uuid, v_reel) ->> 'traceId' = v_trace ->> 'traceId',
    'a reload claims the same trace again');
  reset role;

  perform public.boks_test_login(v_new_account);
  set local role authenticated;
  v_other := public.enroll_in_boks_study('b1', 'visitor-3');
  perform public.boks_assert(public.claim_boks_study_trace((v_other ->> 'id')::uuid, v_reel) is null,
    'a trace is replayed by one passive participant only');
  reset role;

  select count(*) into v_count from public.boks_study_yokes;
  perform public.boks_assert(v_count = 1, 'one yoke was stored');

  -- a3 (migration 20261028100000): its participants resume from their own
  -- ratings, and the ranking snapshot is theirs and an admin's only.
  perform public.boks_test_login(v_admin);
  set local role authenticated;
  perform public.set_boks_study_enabled('a3', true);
  perform public.boks_assert(
    jsonb_array_length(public.get_boks_study_a3_candidates(null, array[v_reel])) = 1,
    'an admin previewing a3 gets the snapshot of a published bok');
  reset role;

  perform public.boks_test_login(v_reader);
  set local role authenticated;
  begin
    perform public.get_boks_study_a3_candidates(null, array[v_reel]);
    perform public.boks_assert(false, 'a reader is not an admin previewing a3');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader is not an admin previewing a3');
  end;
  v_first := public.enroll_in_boks_study('a3', 'visitor-1');
  perform public.boks_assert(v_first ->> 'condition' = 'profile', 'a3 assigns its one condition');
  perform public.record_boks_study_response((v_first ->> 'id')::uuid, 'interest',
    jsonb_build_object('phase', 'profile', 'interest', 4), v_reel, null, 'profile', 30);
  v_study := public.get_boks_study('a3');
  perform public.boks_assert(
    (v_study -> 'participant' -> 'steps' -> 0 -> 'answers' ->> 'interest')::integer = 4,
    'an a3 participant gets their own ratings back to resume');
  perform public.boks_assert(
    (public.get_boks_study_a3_candidates((v_first ->> 'id')::uuid, array[v_reel]) -> 0 ->> 'id')::uuid = v_reel,
    'an a3 participant gets the snapshot of the boks asked for');
  reset role;

  perform public.boks_test_login(v_guest);
  set local role authenticated;
  begin
    perform public.get_boks_study_a3_candidates((v_first ->> 'id')::uuid, array[v_reel]);
    perform public.boks_assert(false, 'nobody reads another participant''s a3 snapshot');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'nobody reads another participant''s a3 snapshot');
  end;
  reset role;

  delete from public.boks_study_participants;
  delete from public.boks_study_fragments where batch = 'check';
  update public.boks_studies set enabled = false, materials = '{}'::jsonb;
  delete from auth.users where id in (v_guest, v_new_account);
end $$;
reset role;

-- The Data API surface (migration 20260925100000).
--
-- Two mistakes this makes impossible. A reader able to write through a view -
-- which is how `boks_public_identity` came to let anyone rename any @handle,
-- because a view without `security_invoker` runs as its owner and row-level
-- security never sees the write. And a table the app needs that nobody granted:
-- from 30 October Supabase stops granting new tables automatically, so a
-- migration that forgets leaves the table unreachable on any rebuilt project.
do $$
declare
  v_writable text;
  v_missing text;
  v_expected text[][] := array[
    array['published_boks', 'anon', 'SELECT'],
    array['published_boks', 'authenticated', 'SELECT'],
    array['reels', 'authenticated', 'SELECT'],
    array['comments', 'authenticated', 'SELECT'],
    array['bok_rights', 'authenticated', 'SELECT'],
    array['bok_reports', 'authenticated', 'SELECT'],
    array['likes', 'authenticated', 'INSERT'],
    array['likes', 'authenticated', 'DELETE'],
    array['comment_likes', 'authenticated', 'INSERT']
  ];
  v_row text[];
begin
  -- Nothing a browser can hold may write through a view.
  select string_agg(format('%s→%s:%s', g.table_name, g.grantee, g.privilege_type), ', ')
  into v_writable
  from information_schema.role_table_grants g
  join pg_class c on c.relname = g.table_name
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where g.table_schema = 'public'
    and c.relkind = 'v'
    and g.grantee in ('anon', 'authenticated')
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  perform public.boks_assert(
    v_writable is null,
    coalesce('no view in public is writable by a reader; found: ' || v_writable, 'no view in public is writable by a reader')
  );

  -- And nothing a guest holds may write anywhere: a guest reads, and every
  -- change a guest is allowed to make goes through a function.
  select string_agg(format('%s:%s', g.table_name, g.privilege_type), ', ')
  into v_writable
  from information_schema.role_table_grants g
  where g.table_schema = 'public' and g.grantee = 'anon'
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  perform public.boks_assert(
    v_writable is null,
    coalesce('the anonymous role cannot write anywhere in public; found: ' || v_writable, 'the anonymous role cannot write anywhere in public')
  );

  perform public.boks_assert(
    not has_function_privilege(
      'anon',
      'public.submit_boks_feedback(text,text,integer,text)',
      'EXECUTE'
    ) and not has_function_privilege(
      'anon',
      'public.record_boks_journey_event(text,text,text,text,text,text,text,text,text,text,text,text)',
      'EXECUTE'
    ),
    'bare anonymous requests cannot write feedback or journey telemetry'
  );
  perform public.boks_assert(
    has_function_privilege(
      'authenticated',
      'public.submit_boks_feedback(text,text,integer,text)',
      'EXECUTE'
    ) and has_function_privilege(
      'authenticated',
      'public.record_boks_journey_event(text,text,text,text,text,text,text,text,text,text,text,text)',
      'EXECUTE'
    ),
    'anonymous Supabase sessions can still write guest feedback and telemetry'
  );

  -- Everything the app addresses through the Data API is granted, by a
  -- migration rather than by a platform default.
  foreach v_row slice 1 in array v_expected loop
    if not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = v_row[1]
        and g.grantee = v_row[2] and g.privilege_type = v_row[3]
    ) then
      v_missing := concat_ws(', ', v_missing, format('%s→%s:%s', v_row[1], v_row[2], v_row[3]));
    end if;
  end loop;
  perform public.boks_assert(
    v_missing is null,
    coalesce('every object the Data API reaches is granted explicitly; missing: ' || v_missing,
             'every object the Data API reaches is granted explicitly')
  );

  -- A profile is created only by `ensure_boks_user_profile`, which enforces
  -- reserved handles, terms and the publisher flag; a direct insert skipped all
  -- three. And there is no directory of every account's id and handle.
  perform public.boks_assert(
    not has_table_privilege('authenticated', 'public.user_profiles', 'INSERT'),
    'a reader cannot insert a profile row directly'
  );
  perform public.boks_assert(
    not has_table_privilege('anon', 'public.boks_public_identity', 'SELECT')
      and not has_table_privilege('authenticated', 'public.boks_public_identity', 'SELECT'),
    'no reader can list every account through boks_public_identity'
  );
end $$;

-- What the Security Advisor reports, asserted here so it stays reported clean.
-- Three things: every function in `public` pins its search path, no reader role
-- can call a trigger function over HTTP, and embedding coverage is not a guest's
-- to read. See 20260925120000_boks_advisor_hardening.sql.
do $$
declare
  v_unpinned text;
  v_callable text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname)
  into v_unpinned
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  where p.prokind = 'f'
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as c(setting)
      where c.setting like 'search\_path=%'
    );
  perform public.boks_assert(
    v_unpinned is null,
    coalesce('every function in public pins its search_path; unpinned: ' || v_unpinned,
             'every function in public pins its search_path')
  );

  -- A function returning `trigger` is fired by a trigger, never called. Postgres
  -- checks EXECUTE when the trigger is created, so revoking costs the trigger
  -- nothing and takes the function off the Data API.
  select string_agg(format('%s→%s', p.proname, r.rolname), ', ')
  into v_callable
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
  cross join (values ('anon'), ('authenticated')) as r(rolname)
  where p.prorettype = 'pg_catalog.trigger'::regtype
    and has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  perform public.boks_assert(
    v_callable is null,
    coalesce('no reader role can execute a trigger function; found: ' || v_callable,
             'no reader role can execute a trigger function')
  );

  perform public.boks_assert(
    not has_function_privilege('anon', 'public.boks_embedding_coverage()', 'EXECUTE'),
    'a guest cannot read embedding coverage'
  );
  perform public.boks_assert(
    has_function_privilege('authenticated', 'public.boks_embedding_coverage()', 'EXECUTE'),
    'the admin console can still read embedding coverage'
  );
end $$;

-- Revoking EXECUTE on a trigger function must not stop the trigger.
--
-- Postgres checks EXECUTE when a trigger is created, not each time it fires, so
-- this should hold - but "should" is what the previous grant mistake also said.
-- A probe table carrying the columns the reels trigger writes, a reader who
-- cannot call that function, one insert.
create table public.boks_trigger_probe (
  id bigserial primary key,
  text text,
  word_count integer,
  minutes integer,
  reading_shape text,
  line_break_count integer,
  language text
);
create trigger boks_trigger_probe_derive
before insert on public.boks_trigger_probe
for each row execute function public.boks_set_reel_word_count();
grant insert, select on public.boks_trigger_probe to authenticated;
grant usage, select on sequence public.boks_trigger_probe_id_seq to authenticated;

set role authenticated;
do $$
begin
  perform public.boks_assert(
    not has_function_privilege('authenticated', 'public.boks_set_reel_word_count()', 'EXECUTE'),
    'the writing reader holds no EXECUTE on the trigger function'
  );
  insert into public.boks_trigger_probe (text)
  values (E'Two short lines here,\nand a second one after the break.');
  perform public.boks_assert(
    (select word_count from public.boks_trigger_probe order by id desc limit 1) = 11
      and (select line_break_count from public.boks_trigger_probe order by id desc limit 1) = 1
      and (select language from public.boks_trigger_probe order by id desc limit 1) = 'en',
    'the trigger still fires, and still derives, for a reader who cannot call it'
  );
end $$;
reset role;

drop table public.boks_trigger_probe;

-- Rights pages are bounded before aggregation, independently offset, and do
-- not expose admin evidence to readers. All fixtures live in the throwaway DB.
do $$
declare
  v_admin uuid := '22222222-2222-4222-8222-222222222222';
  v_reader uuid := '33333333-3333-4333-8333-333333333333';
  v_ids uuid[];
  v_first jsonb;
  v_second jsonb;
  v_page jsonb;
begin
  perform public.boks_test_login(v_admin);
  with inserted as (
    insert into public.reels (title, text, status, author_user_id, created_at)
    select 'Rights pagination probe ' || n, 'A complete little test bok.', 'published', v_admin, now() + interval '1 day'
    from generate_series(1, 205) n
    returning id
  ) select array_agg(id) into v_ids from inserted;

  insert into public.bok_rights (reel_id, confirmed)
  select unnest(v_ids), false
  on conflict (reel_id) do update set confirmed = false;
  insert into public.bok_reports (reel_id, reporter_user_id, kind, reason, created_at)
  select unnest(v_ids), v_reader, 'copyright', 'Rights pagination regression evidence.', now() + interval '1 day';

  v_first := public.get_boks_rights_review_page('open', 2, 0, 0);
  v_second := public.get_boks_rights_review_page('open', 2, 2, 2);
  perform public.boks_assert(jsonb_array_length(v_first->'reports') = 2 and jsonb_array_length(v_first->'unattestedBoks') = 2,
    'Rights limits both arrays before JSON aggregation');
  perform public.boks_assert(not exists (
    select 1 from jsonb_array_elements(v_first->'reports') a, jsonb_array_elements(v_second->'reports') b
    where a->>'id' = b->>'id'
  ), 'Rights report pages are disjoint with tied timestamps');
  perform public.boks_assert(not exists (
    select 1 from jsonb_array_elements(v_first->'unattestedBoks') a, jsonb_array_elements(v_second->'unattestedBoks') b
    where a->>'reelId' = b->>'reelId'
  ), 'Rights unattested pages are disjoint with tied timestamps');
  v_page := public.get_boks_rights_review_page('open', 2, 2, 0);
  perform public.boks_assert(v_page->'unattestedBoks' = v_first->'unattestedBoks' and v_page->'reports' = v_second->'reports',
    'Rights reports and unattested boks have independent offsets');
  perform public.boks_assert((v_page->>'reportsTotal')::integer >= 205 and (v_page->>'unattested')::integer >= 205,
    'Rights counts describe the full filtered result, not the page');
  v_page := public.get_boks_rights_review_page('all', 10000, -10, -20);
  perform public.boks_assert(jsonb_array_length(v_page->'reports') = 200 and jsonb_array_length(v_page->'unattestedBoks') = 200
    and (v_page->>'reportsOffset')::integer = 0 and (v_page->>'unattestedOffset')::integer = 0,
    'Rights clamps oversized limits and negative offsets');
  v_page := public.get_boks_rights_review('all', 1);
  perform public.boks_assert(jsonb_array_length(v_page->'reports') = 1 and jsonb_array_length(v_page->'unattestedBoks') = 1,
    'The legacy Rights RPC is bounded too');
  v_page := public.get_boks_rights_review_page('all', 2, 100000, 100000);
  perform public.boks_assert(v_page->'reports' = '[]'::jsonb and v_page->'unattestedBoks' = '[]'::jsonb,
    'Rights out-of-range pages return empty arrays');
  perform public.boks_test_login(v_reader);
  begin
    perform public.get_boks_rights_review_page('all', 2, 0, 0);
    raise exception 'CHECK FAILED: a reader accessed Rights';
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'A reader cannot call the paginated Rights RPC');
  end;
  perform public.boks_assert(
    has_function_privilege('authenticated', 'public.get_boks_rights_review_page(text,integer,integer,integer)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_boks_rights_review_page(text,integer,integer,integer)', 'EXECUTE'),
    'Rights grants reach authenticated sessions only, with the admin role checked inside');
  perform public.boks_test_login(v_admin);
  delete from public.reels where id = any(v_ids);
end $$;

-- A complaint is a guest right, not a social write. Exercise the same
-- authenticated role and is_anonymous JWT claim as a Supabase guest session,
-- with no profile or terms acceptance; owner-only fixtures roll back below.
begin;
select public.boks_test_logout();
insert into auth.users (id, is_anonymous)
values ('ac170000-0000-4000-8000-000000000001', true);
insert into public.reels (id, title, text, author_name, status) values
  ('ac170000-0000-4000-8000-000000000002', 'Guest report probe', 'A complete little test bok.', 'Schema probe', 'published'),
  ('ac170000-0000-4000-8000-000000000003', 'Suspended report probe', 'Another complete little test bok.', 'Schema probe', 'published');
select public.boks_test_login('ac170000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare
  v_guest uuid := 'ac170000-0000-4000-8000-000000000001';
  v_bok uuid := 'ac170000-0000-4000-8000-000000000002';
  v_first jsonb;
  v_second jsonb;
begin
  perform public.boks_assert(
    current_user = 'authenticated' and (auth.jwt()->>'is_anonymous')::boolean
      and not exists (select 1 from public.user_profiles where user_id = v_guest),
    'guest report checks use an anonymous session without a profile or terms acceptance');
  v_first := public.report_bok(v_bok, 'This translation was published without permission.');
  perform public.boks_assert(v_first->>'status' = 'received' and v_first->>'id' is not null,
    'an anonymous session can submit a copyright report without accepting terms');
  v_second := public.report_bok(v_bok, 'Another reason does not duplicate the open report.', 'other');
  perform public.boks_assert(v_second->>'status' = 'already' and v_second->>'id' = v_first->>'id',
    'a repeated guest report returns the same open report instead of inserting another');
  perform public.boks_assert((select count(*) from public.bok_reports) = 0,
    'RLS hides every report from a guest, including their own accepted report');

  begin
    insert into public.bok_reports (reel_id, reporter_user_id, kind, reason)
    values (v_bok, v_guest, 'other', 'A direct insert must never bypass the report RPC.');
    raise exception 'CHECK FAILED: a guest inserted a raw report';
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a guest cannot insert reports directly');
  end;
  begin
    insert into public.likes (user_id, reel_id) values (v_guest, v_bok);
    raise exception 'CHECK FAILED: a guest liked a bok after the report exception';
  exception when insufficient_privilege then
    perform public.boks_assert(sqlerrm = 'Accept the boks terms before using this feature.',
      'the write trigger still rejects anonymous likes after exempting reports');
  end;
  begin
    perform public.create_bok_comment(v_bok, 'A guest report must not unlock comments.');
    raise exception 'CHECK FAILED: a guest commented after the report exception';
  exception when insufficient_privilege then
    perform public.boks_assert(sqlerrm = 'Create a free account to join the conversation.',
      'anonymous comments still require a permanent account');
  end;
end $$;
reset role;

-- Count the stored rows as owner: an empty reader SELECT alone cannot prove
-- that the RPC actually wrote once. Then suspend the same guest and try a
-- different bok so the duplicate shortcut cannot mask the suspension check.
select public.boks_test_logout();
select public.boks_assert(
  (select count(*) from public.bok_reports where reporter_user_id = 'ac170000-0000-4000-8000-000000000001') = 1,
  'the guest report and retry stored exactly one private row');
insert into public.user_profiles (user_id, handle, banned_at, ban_reason)
values ('ac170000-0000-4000-8000-000000000001', 'reportguestprobe', now(), 'Suspension regression check.');
select public.boks_test_login('ac170000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
begin
  begin
    perform public.report_bok('ac170000-0000-4000-8000-000000000003', 'A suspended guest must not submit another report.');
    raise exception 'CHECK FAILED: a suspended guest submitted a report';
  exception when insufficient_privilege then
    perform public.boks_assert(sqlerrm = 'This boks account is suspended.',
      'suspension still blocks a guest report independently of terms acceptance');
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform public.report_bok('ac170000-0000-4000-8000-000000000003', 'A bare publishable key is not a guest session.');
    raise exception 'CHECK FAILED: bare anon called the report RPC';
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'bare anon still cannot execute the report RPC');
  end;
end $$;
reset role;
rollback;

-- Background job log (20261108120000): written by the server's own jobs as
-- the owner, read only by admins through get_background_job_runs.
begin;
insert into public.background_job_runs (job, status, processed, remaining) values ('embedder', 'ok', 2, 0);
set local role anon;
do $$
begin
  begin
    perform 1 from public.background_job_runs;
    raise exception 'CHECK FAILED: anon read the background job log';
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'anon cannot read the background job log');
  end;
end $$;
reset role;
select public.boks_test_login('ac180000-0000-4000-8000-000000000001', false);
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.background_job_runs;
    raise exception 'CHECK FAILED: a reader read the background job log';
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a signed-in reader cannot read the background job log');
  end;
  begin
    perform public.get_background_job_runs('embedder', 5);
    raise exception 'CHECK FAILED: a reader called get_background_job_runs';
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'only an admin can call get_background_job_runs');
  end;
end $$;
reset role;
select public.boks_test_logout();
rollback;

-- Feed data cleanup (20261116120000): the retired views table, the library's
-- kept reads and the pruning of old job runs.
begin;
select public.boks_assert(to_regclass('public.views') is null, 'the views table is gone');
select public.boks_assert(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'reader_library_legacy_reads'
      and grantee in ('anon', 'authenticated')
  ),
  'the library''s kept reads are reachable only through get_my_reader_library'
);
select public.boks_assert(
  not has_function_privilege('anon', 'public.boks_prune_old_data()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.boks_prune_old_data()', 'EXECUTE'),
  'only the server prunes old data'
);
insert into public.background_job_runs (job, status, started_at) values
  ('prune-probe', 'ok', now() - interval '91 days'),
  ('prune-probe', 'ok', now() - interval '89 days');
select public.boks_assert(
  (public.boks_prune_old_data() ->> 'backgroundJobRuns')::int >= 1,
  'pruning reports the job runs it removed'
);
select public.boks_assert(
  (select count(*) from public.background_job_runs where job = 'prune-probe') = 1,
  'pruning removes job runs older than 90 days and keeps the rest'
);
select public.boks_test_logout();
select public.boks_assert(
  not (public.get_boks_user_context() ? 'views'),
  'the user context no longer counts views'
);
rollback;

-- Bok slugs (20261109100000): a readable address given once on publishing,
-- unique, never changed; a twin gets the start of its id.
begin;
do $$
begin
  perform public.boks_assert(public.boks_slug_base('Незнакомка', 'Александр Блок') = 'neznakomka-blok', 'a Russian title and surname become neznakomka-blok');
  perform public.boks_assert(public.boks_slug_base('Три пальмы', 'М. Ю. Лермонтов') = 'tri-palmy-lermontov', 'initials are dropped, the surname stays');
  perform public.boks_assert(public.boks_slug_base('Hope is the thing with feathers', 'Emily Dickinson') = 'hope-is-the-thing-with-feathers-dickinson', 'an English title keeps its words');
  perform public.boks_assert(public.boks_slug_base('Щедрый вечер, ёлка!', 'boks') = 'shchedryi-vecher-elka', 'boks as the author adds nothing');
  perform public.boks_assert(char_length(public.boks_slug_base(repeat('очень длинное название ', 10), 'Блок')) <= 60, 'a long title is cut at a word');
end $$;
insert into public.reels (id, title, author_name, text, status) values
  ('5a190000-0000-4000-8000-000000000001', 'Осень', 'Александр Блок', 'Текст', 'published'),
  ('5a190000-0000-4000-8000-000000000002', 'Осень', 'Александр Блок', 'Текст', 'published'),
  ('5a190000-0000-4000-8000-000000000003', 'Осень', 'Александр Блок', 'Текст', 'draft');
do $$
begin
  perform public.boks_assert((select slug from public.reels where id = '5a190000-0000-4000-8000-000000000001') = 'osen-blok', 'the first «Осень» gets the plain slug');
  perform public.boks_assert((select slug from public.reels where id = '5a190000-0000-4000-8000-000000000002') = 'osen-blok-5a19', 'its twin gets the start of its id');
  perform public.boks_assert((select slug from public.reels where id = '5a190000-0000-4000-8000-000000000003') is null, 'a draft has no slug yet');
end $$;
update public.reels set title = 'Осень (новая редакция)' where id = '5a190000-0000-4000-8000-000000000001';
update public.reels set status = 'published' where id = '5a190000-0000-4000-8000-000000000003';
do $$
begin
  perform public.boks_assert((select slug from public.reels where id = '5a190000-0000-4000-8000-000000000003') like 'osen-blok-5a19%' and (select slug from public.reels where id = '5a190000-0000-4000-8000-000000000003') <> 'osen-blok-5a19', 'a third twin gets a longer piece of its id');
  perform public.boks_assert((select slug from public.reels where id = '5a190000-0000-4000-8000-000000000001') = 'osen-blok', 'a new title does not move a slug');
  perform public.boks_assert((select count(*) from public.published_boks where slug like 'osen-blok%') = 3, 'published_boks carries the slug');
end $$;
rollback;

-- Author page name and photo (20261110100000, on the page's space since
-- 20261116100000): the author sets them, readers see them, a stale tab cannot
-- overwrite a newer save.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('a9a90000-0000-4000-8000-000000000001', 'page@boks.test', false),
  ('a9a90000-0000-4000-8000-000000000002', 'guest-page@boks.test', true);
insert into public.user_profiles (user_id, handle) values
  ('a9a90000-0000-4000-8000-000000000001', 'pagewriter')
on conflict (user_id) do update set handle = excluded.handle;
do $$
declare
  v_page jsonb;
  v_error text;
  v_jpeg text := encode('\xffd8ffe0'::bytea || convert_to(repeat('x', 200), 'UTF8'), 'base64');
begin
  perform public.boks_assert(public.get_boks_author_page('pagewriter') is null, 'an account with no page has no name or photo for readers');
  perform public.boks_test_login('a9a90000-0000-4000-8000-000000000001');
  v_page := public.get_my_author_page();
  perform public.boks_assert((v_page ->> 'version')::integer = 0 and v_page ->> 'name' is null, 'a new author page has no name and version 0');

  v_page := public.save_my_author_page('  Мира   Вейл ', v_jpeg, 0);
  perform public.boks_assert(v_page ->> 'name' = 'Мира Вейл', 'the name is saved with its spaces tidied');
  perform public.boks_assert((v_page ->> 'version')::integer = 1 and (v_page ->> 'photoVersion')::integer = 1, 'name and photo are saved together as version 1');

  begin
    perform public.save_my_author_page('Другое имя', 'keep', 0);
    perform public.boks_assert(false, 'a save from an overtaken tab is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Your page was changed in another tab%', 'a stale version is refused: ' || v_error);
  end;

  begin
    perform public.save_my_author_page(repeat('я', 61), 'keep', 1);
    perform public.boks_assert(false, 'a name over 60 characters is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'The name on your page%', 'a long name is refused: ' || v_error);
  end;

  begin
    perform public.save_my_author_page('Мира', encode(convert_to('<svg onload=alert(1)>' || repeat('x', 200), 'UTF8'), 'base64'), 1);
    perform public.boks_assert(false, 'a photo that is not a JPEG is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'This photo could not be read%', 'only a JPEG is accepted: ' || v_error);
  end;

  v_page := public.save_my_author_page('', 'remove', 1);
  perform public.boks_assert(v_page ->> 'name' is null and v_page ->> 'photoVersion' is null and (v_page ->> 'version')::integer = 2, 'an empty name and removed photo bring the monogram back');
  v_page := public.save_my_author_page('Мира Вейл', v_jpeg, 2);
  perform public.boks_assert((v_page ->> 'photoVersion')::integer > 1, 'a photo put back gets a new address, not an old one');
  perform public.boks_assert(
    (select count(*) from public.author_spaces s
     where s.owner_user_id = 'a9a90000-0000-4000-8000-000000000001' and s.status = 'published' and s.kind = 'author' and s.name = 'Мира Вейл') = 1,
    'the name and photo live on the account''s one page, published as they always were');

  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author_page('@PageWriter') ->> 'name' = 'Мира Вейл', 'a reader sees the saved name by handle');
  perform public.boks_assert(public.get_boks_author_photo('pagewriter') ->> 'jpeg' = v_jpeg, 'a reader gets the saved photo');
  perform public.boks_assert(public.get_boks_author_page('nobody-here') is null, 'an unknown handle has no page');

  perform public.boks_test_login('a9a90000-0000-4000-8000-000000000002', true);
  begin
    perform public.save_my_author_page('Гость', 'keep', 0);
    perform public.boks_assert(false, 'a guest cannot save an author page');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Sign in required%', 'a guest is refused: ' || v_error);
  end;
  perform public.boks_test_logout();
end $$;
rollback;

-- Author spaces (20261114100000): a page prepared in Studio stays closed
-- until its owner publishes; an invitation binds only the invited address,
-- once; an existing page keeps everything; a repeat publishes nothing twice;
-- the order is the page's; a classic's page is followed as a page.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('a5a50000-0000-4000-8000-000000000001', 'editor@boks.test', false),
  ('a5a50000-0000-4000-8000-000000000002', 'darya@boks.test', false),
  ('a5a50000-0000-4000-8000-000000000003', 'stranger@boks.test', false),
  ('a5a50000-0000-4000-8000-000000000004', 'guest-space@boks.test', true),
  ('a5a50000-0000-4000-8000-000000000005', 'alexey@boks.test', false),
  ('a5a50000-0000-4000-8000-000000000006', 'reader-space@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('a5a50000-0000-4000-8000-000000000001', 'spaceeditor', 'admin', now(), 'v1'),
  ('a5a50000-0000-4000-8000-000000000002', 'darya_mail', 'reader', now(), 'v1'),
  ('a5a50000-0000-4000-8000-000000000003', 'stranger_one', 'reader', now(), 'v1'),
  ('a5a50000-0000-4000-8000-000000000005', 'alexey_space', 'reader', now(), 'v1'),
  ('a5a50000-0000-4000-8000-000000000006', 'reader_space', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
insert into public.reels (id, title, text, author_name, status, author_user_id, created_at) values
  ('a5a50000-0000-4000-8000-0000000000b1', 'Старое', 'Старый текст Алексея.', 'Алексей', 'published', 'a5a50000-0000-4000-8000-000000000005', now() - interval '2 days'),
  ('a5a50000-0000-4000-8000-0000000000b2', 'Новое', 'Новый текст Алексея.', 'Алексей', 'published', 'a5a50000-0000-4000-8000-000000000005', now() - interval '1 day'),
  ('a5a50000-0000-4000-8000-0000000000c1', 'Зимнее утро', 'Мороз и солнце; день чудесный!', 'Александр Пушкин', 'published', null, now()),
  ('a5a50000-0000-4000-8000-0000000000c2', 'Анчар', 'В пустыне чахлой и скупой', 'Александр Пушкин', 'published', null, now());
insert into public.author_follows (follower_user_id, author_user_id) values
  ('a5a50000-0000-4000-8000-000000000006', 'a5a50000-0000-4000-8000-000000000005');

do $$
declare
  v_jpeg text := encode('\xffd8ffe0'::bytea || convert_to(repeat('x', 200), 'UTF8'), 'base64');
  v_space jsonb;
  v_id uuid;
  v_work uuid;
  v_invite jsonb;
  v_token text;
  v_old_token text;
  v_answer jsonb;
  v_error text;
  v_mine jsonb;
  v_request uuid := gen_random_uuid();
  v_bok uuid;
  v_pushkin uuid;
begin
  -- Nobody but the team prepares a page.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  begin
    perform public.studio_save_author_space(null, 'author', 'Тестовая Поэтесса', 'test_poetess', null, 0);
    perform public.boks_assert(false, 'a reader cannot prepare a page');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Admin access required%', 'a reader cannot prepare a page: ' || v_error);
  end;

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  v_space := public.studio_save_author_space(null, 'author', 'Тестовая Поэтесса', 'test_poetess', v_jpeg, 0);
  v_id := (v_space ->> 'id')::uuid;
  perform public.boks_assert(v_space ->> 'status' = 'draft' and v_space ->> 'proposedHandle' = 'test_poetess', 'the team prepares a closed page with a proposed address');
  v_space := public.studio_save_space_work(v_id, null, 'Тёплый снег', 'Снег шёл тёплый, как молоко.', 'text', null);
  v_work := ((v_space -> 'works') -> 0 ->> 'id')::uuid;
  -- One tab saves (version 1 -> 2); the other, still at 1, is refused.
  v_space := public.studio_save_author_space(v_id, 'author', 'Тестовая Поэтесса', 'test_poetess', 'keep', 1);
  perform public.boks_assert((v_space ->> 'version')::integer = 2, 'a Studio save bumps the version');
  begin
    perform public.studio_save_author_space(v_id, 'author', 'Дарья', 'test_poetess', 'keep', 1);
    perform public.boks_assert(false, 'a stale Studio tab cannot overwrite the page');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'This page was changed in another tab%', 'a stale Studio save is refused: ' || v_error);
  end;

  -- The proposed address is reserved: nobody else takes it in settings.
  begin
    update public.user_profiles set handle = 'test_poetess' where user_id = 'a5a50000-0000-4000-8000-000000000003';
    perform public.boks_assert(false, 'a reserved address cannot be taken');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'That nickname is already taken%', 'a reserved address is refused: ' || v_error);
  end;

  -- Closed: no public read shows the page, its name or its photo.
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author('test_poetess') is null, 'a guest sees no prepared page by its address');
  perform public.boks_assert(public.get_boks_author_page('test_poetess') is null and public.get_boks_author_photo('test_poetess') is null, 'a guest gets no name or photo of a prepared page');
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000004', true);
  begin
    perform public.get_author_space_preview(v_id);
    perform public.boks_assert(false, 'a guest session cannot preview a prepared page');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'This page is not available%', 'a guest session is refused the preview: ' || v_error);
  end;
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  begin
    perform public.get_author_space_preview(v_id);
    perform public.boks_assert(false, 'another account cannot preview a prepared page');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'This page is not available%', 'a stranger is refused the preview: ' || v_error);
  end;

  -- The invitation: only a hash is kept, a new one revokes the old.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  v_invite := public.studio_issue_author_invite(v_id, 'Darya@Boks.test');
  v_old_token := v_invite ->> 'token';
  v_invite := public.studio_issue_author_invite(v_id, 'darya@boks.test');
  v_token := v_invite ->> 'token';
  perform public.boks_assert(not exists (select 1 from public.author_space_invites where token_hash = convert_to(v_token, 'UTF8')), 'the token itself is not stored');
  perform public.boks_assert((select count(*) from public.author_space_invites where space_id = v_id and revoked_at is not null) = 1, 'a new invitation revokes the earlier one');

  perform public.boks_test_logout();
  perform public.boks_assert(public.peek_author_invite(v_token) ->> 'state' = 'sign_in', 'before sign-in the link tells nothing');
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  v_answer := public.accept_author_invite(v_token);
  perform public.boks_assert(v_answer ->> 'state' = 'wrong_email' and v_answer ->> 'emailHint' = 'd•••@boks.test', 'another address is told which one, masked');
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000002');
  perform public.boks_assert(public.accept_author_invite(v_old_token) ->> 'state' = 'revoked', 'a revoked link does not bind');
  perform public.boks_assert(public.peek_author_invite(v_token) ->> 'state' = 'pending', 'the invited address sees the invitation');
  v_answer := public.accept_author_invite(v_token);
  perform public.boks_assert(v_answer ->> 'state' = 'accepted' and (v_answer ->> 'existingPage')::boolean = false, 'the invited address accepts a first page');
  perform public.boks_assert((select handle from public.user_profiles where user_id = 'a5a50000-0000-4000-8000-000000000002') = 'test_poetess', 'the proposed address becomes the account''s @handle');
  perform public.boks_assert(public.accept_author_invite(v_token) ->> 'state' = 'accepted', 'accepting twice is the same acceptance');
  perform public.boks_assert((select count(*) from public.author_spaces where owner_user_id = 'a5a50000-0000-4000-8000-000000000002') = 1, 'a repeat creates no second page');
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.boks_assert(public.accept_author_invite(v_token) ->> 'state' = 'used', 'an accepted link is used for anyone else');

  -- Still closed after accepting.
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author_page('test_poetess') is null, 'an accepted page stays closed until published');
  perform public.boks_assert(public.get_boks_author_photo('test_poetess') is null, 'and so does its photo');

  -- Its owner still sees their own photo in the cabinet.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000002');
  perform public.boks_assert(public.get_my_author_page() ->> 'photo' is not null, 'the owner sees their photo while the page is closed');

  -- The owner sees, asks, publishes; a changed work is refused.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000002');
  v_mine := public.get_my_author_space();
  perform public.boks_assert(jsonb_array_length(v_mine -> 'items') = 1 and v_mine -> 'space' ->> 'status' = 'draft', 'the owner sees the prepared work');
  perform public.boks_assert(public.get_author_space_preview(null) ->> 'access' = 'owner', 'the owner previews the page');
  begin
    perform public.publish_my_author_space(jsonb_build_array(jsonb_build_object('workId', v_work, 'revision', 1)), true, 'test-terms', v_request);
    perform public.boks_assert(false, 'a work not marked ready is not published');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like '%is not ready to publish%', 'an unchecked work is refused: ' || v_error);
  end;

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.studio_set_space_work_status(v_work, 'ready', 'Тестовые данные, права подтверждены письмом');
  perform public.studio_save_space_work(v_id, v_work, 'Тёплый снег', 'Снег шёл тёплый, как парное молоко.', 'text', null);
  perform public.studio_set_space_work_status(v_work, 'ready', 'Перепроверено');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000002');
  begin
    perform public.publish_my_author_space(jsonb_build_array(jsonb_build_object('workId', v_work, 'revision', 1)), true, 'test-terms', v_request);
    perform public.boks_assert(false, 'an older revision is not published');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'A work changed after you opened the preview%', 'a changed work asks for a new look: ' || v_error);
  end;
  v_answer := public.publish_my_author_space(jsonb_build_array(jsonb_build_object('workId', v_work, 'revision', 2)), true, 'test-terms', v_request);
  v_bok := ((v_answer -> 'published') -> 0 ->> 'bokId')::uuid;
  perform public.boks_assert((v_answer ->> 'pagePublished')::boolean and (select status from public.reels where id = v_bok) = 'published', 'one publication opens the page and the work');
  perform public.boks_assert((select text from public.reels where id = v_bok) = 'Снег шёл тёплый, как парное молоко.', 'the published text is the confirmed revision');
  perform public.boks_assert((public.publish_my_author_space('[]'::jsonb, true, 'test-terms', v_request) ->> 'repeat')::boolean, 'a second press returns the first answer');
  perform public.boks_assert((select count(*) from public.reels where author_user_id = 'a5a50000-0000-4000-8000-000000000002') = 1, 'and publishes nothing twice');
  perform public.boks_assert((select terms_version from public.author_space_publications where request_id = v_request) = 'test-terms', 'the publication records the terms version');

  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author_page('test_poetess') ->> 'name' = 'Тестовая Поэтесса', 'published: readers see the name');
  perform public.boks_assert((public.get_boks_author('test_poetess') ->> 'totalBoks')::integer = 1, 'published: readers see the work');

  -- An author with a page: everything stays, drafts go to the end.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  v_space := public.studio_save_author_space(null, 'author', 'Алексей Подготовленный', 'alexey_new', null, 0);
  perform public.studio_save_space_work((v_space ->> 'id')::uuid, null, 'Черновик', 'Подготовленный текст.', 'text', null);
  v_token := public.studio_issue_author_invite((v_space ->> 'id')::uuid, 'alexey@boks.test') ->> 'token';
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000005');
  perform public.boks_assert((public.peek_author_invite(v_token) ->> 'existingPage')::boolean, 'an author with boks is told they already have a page');
  v_answer := public.accept_author_invite(v_token);
  perform public.boks_assert(v_answer ->> 'state' = 'accepted' and (v_answer ->> 'existingPage')::boolean and (v_answer ->> 'works')::integer = 1, 'their page receives the draft');
  perform public.boks_assert((select handle from public.user_profiles where user_id = 'a5a50000-0000-4000-8000-000000000005') = 'alexey_space', 'their @handle stays');
  perform public.boks_assert(exists (select 1 from public.author_follows where author_user_id = 'a5a50000-0000-4000-8000-000000000005'), 'their followers stay');
  v_mine := public.get_my_author_space();
  perform public.boks_assert(
    (v_mine -> 'items' -> 0 ->> 'title') = 'Новое' and (v_mine -> 'items' -> 1 ->> 'title') = 'Старое' and (v_mine -> 'items' -> 2 ->> 'title') = 'Черновик',
    'their order stays (newest first) and the draft comes last');
  perform public.boks_test_logout();
  perform public.boks_assert((public.get_boks_author('alexey_space') -> 'boks' -> 0 ->> 'title') = 'Новое' and (public.get_boks_author('alexey_space') ->> 'totalBoks')::integer = 2, 'readers see the same page, without the draft');

  -- One order, saved by the author; a stale tab is refused; applied before the limit.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000005');
  v_mine := public.get_my_author_space();
  perform public.save_author_space_order(
    (v_mine -> 'space' ->> 'id')::uuid,
    array[v_mine -> 'items' -> 2 ->> 'key', v_mine -> 'items' -> 1 ->> 'key', v_mine -> 'items' -> 0 ->> 'key'],
    (v_mine ->> 'orderVersion')::integer);
  begin
    perform public.save_author_space_order((v_mine -> 'space' ->> 'id')::uuid, array[v_mine -> 'items' -> 0 ->> 'key'], (v_mine ->> 'orderVersion')::integer);
    perform public.boks_assert(false, 'a stale order is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'The order was changed in another tab%', 'a stale order is refused: ' || v_error);
  end;
  perform public.boks_test_logout();
  perform public.boks_assert((public.get_boks_author('alexey_space', null, 1) -> 'boks' -> 0 ->> 'title') = 'Старое', 'the saved order is the public order, sorted before the limit');
  perform public.boks_assert(public.get_boks_author('alexey_space') ? 'followers' and public.get_boks_author('alexey_space') ? 'authorUserId', 'every field an older client reads is still there');

  -- A classic's page: run by the team, followed as a page.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  v_space := public.studio_save_author_space(null, 'editorial', 'Александр Пушкин', 'pushkin', v_jpeg, 0);
  v_pushkin := (v_space ->> 'id')::uuid;
  v_space := public.studio_save_space_work(v_pushkin, null, '', '', 'series', 'a5a50000-0000-4000-8000-0000000000c1');
  v_space := public.studio_save_space_work(v_pushkin, null, '', '', 'text', 'a5a50000-0000-4000-8000-0000000000c2');
  perform public.studio_set_space_work_status(w.id, 'ready', 'Общественное достояние, сверено') from public.author_space_works w where w.space_id = v_pushkin;
  begin
    perform public.studio_publish_editorial_space(v_pushkin, '[]'::jsonb, 'public_domain', '', true, gen_random_uuid());
    perform public.boks_assert(false, 'a classic is not published without a source');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'State the basis of the rights%', 'the basis and the source are required: ' || v_error);
  end;
  v_answer := public.studio_publish_editorial_space(
    v_pushkin,
    (select jsonb_agg(jsonb_build_object('workId', w.id, 'revision', w.revision)) from public.author_space_works w where w.space_id = v_pushkin),
    'public_domain', 'Викитека', true, gen_random_uuid());
  perform public.boks_assert(jsonb_array_length(v_answer -> 'published') = 2, 'the team publishes the classic''s page');
  perform public.boks_assert((select actor_user_id from public.author_space_publications where space_id = v_pushkin) = 'a5a50000-0000-4000-8000-000000000001', 'the editorial basis records the editor');

  perform public.boks_test_logout();
  v_answer := public.get_boks_author('@Pushkin');
  perform public.boks_assert(v_answer ->> 'pageId' = v_pushkin::text and (v_answer ->> 'totalBoks')::integer = 2, 'readers open /@pushkin');
  perform public.boks_assert(exists (select 1 from jsonb_array_elements(v_answer -> 'boks') b where b ->> 'title' = 'Зимнее утро' and b ->> 'format' = 'series'), 'a Series version shows as Series');
  perform public.boks_assert(public.get_boks_author_photo('pushkin') ->> 'jpeg' = v_jpeg, 'the classic''s photo is served by its address');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000004', true);
  begin
    perform public.set_author_page_follow(v_pushkin, true);
    perform public.boks_assert(false, 'a guest cannot follow a page');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Sign in to follow%', 'a guest is asked to sign in: ' || v_error);
  end;
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000006');
  perform public.boks_assert((public.set_author_page_follow(v_pushkin, true) ->> 'following')::boolean, 'a reader follows the classic''s page');
  perform public.boks_assert(public.get_my_followed_pages() -> 0 ->> 'authorHandle' = 'pushkin', 'You → Following lists it');
  perform public.boks_assert(jsonb_array_length(public.get_my_followed_authors()) = 1, 'the account follows an older client reads are unchanged');

  -- Taking a Series down keeps the text it was attached to.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.unpublish_space_work(w.id) from public.author_space_works w where w.space_id = v_pushkin and w.format = 'series';
  perform public.boks_assert((select status from public.reels where id = 'a5a50000-0000-4000-8000-0000000000c1') = 'published', 'the catalogue bok stays published');
  perform public.boks_test_logout();
  perform public.boks_assert((public.get_boks_author('pushkin') ->> 'totalBoks')::integer = 1, 'and leaves the classic''s page');
end $$;

-- A Series prepared in a link-only folder for a new text: seen by the team and
-- the owner, approved with the text, released by hand after publication.
do $$
declare
  v_space jsonb;
  v_id uuid;
  v_work uuid;
  v_token text;
  v_error text;
  v_mine jsonb;
  v_result jsonb;
  v_bok uuid;
  v_piece text := 'AbCdEfGhIjKlMnOpQrStUv';
begin
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  v_space := public.studio_save_author_space(null, 'author', 'Поэтесса', 'stranger_poet', null, 0);
  v_id := (v_space ->> 'id')::uuid;
  v_space := public.studio_save_space_work(v_id, null, 'Связь', 'Город полнится воющим голосом.', 'text', null);
  v_work := ((v_space -> 'works') -> 0 ->> 'id')::uuid;
  perform public.studio_set_space_work_status(v_work, 'ready', 'Текст и запись от автора');
  v_space := public.studio_set_space_work_series(v_work, 'http://localhost:5173/l/' || v_piece, false);
  perform public.boks_assert((v_space -> 'works') -> 0 ->> 'seriesPiece' = v_piece, 'a pasted Series link keeps only its token');
  perform public.boks_assert((v_space -> 'works') -> 0 ->> 'status' = 'preparing' and ((v_space -> 'works') -> 0 ->> 'revision')::integer = 2,
    'attaching a Series is a new version to check again');
  begin
    perform public.studio_set_space_work_series(v_work, v_piece, true);
    perform public.boks_assert(false, 'a Series cannot go live before its text');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'A Series goes live after its text is published%', 'a Series cannot go live before its text: ' || v_error);
  end;
  begin
    perform public.studio_set_space_work_series(v_work, 'short', false);
    perform public.boks_assert(false, 'a malformed Series link is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Paste the Series link%', 'a malformed Series link is refused: ' || v_error);
  end;
  perform public.studio_set_space_work_status(v_work, 'ready', 'Текст и запись от автора');
  v_token := public.studio_issue_author_invite(v_id, 'stranger@boks.test') ->> 'token';

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000006');
  begin
    perform public.studio_set_space_work_series(v_work, v_piece, false);
    perform public.boks_assert(false, 'a reader cannot attach a Series');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Admin access required%', 'a reader cannot attach a Series: ' || v_error);
  end;

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.accept_author_invite(v_token);
  v_mine := public.get_author_space_preview(null);
  perform public.boks_assert(v_mine -> 'items' -> 0 ->> 'seriesPiece' = v_piece, 'the owner sees the Series of a work in the preview');
  perform public.boks_test_logout();
  perform public.boks_assert(position(v_piece in coalesce(public.get_boks_author('stranger_poet')::text, '')) = 0
    and position(v_piece in coalesce(public.get_boks_author_page('stranger_poet')::text, '')) = 0,
    'before the author publishes, readers never receive the Series token');
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  v_result := public.publish_my_author_space(
    jsonb_build_array(jsonb_build_object('workId', v_work::text, 'revision', 2)), true, 'v-test#author-content', gen_random_uuid());
  perform public.boks_assert((v_result -> 'published' -> 0 ->> 'withSeries')::boolean, 'the publication records that the Series was approved');
  v_bok := (v_result -> 'published' -> 0 ->> 'bokId')::uuid;

  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author('stranger_poet') -> 'boks' -> 0 ->> 'format' = 'series'
    and public.get_boks_author('stranger_poet') -> 'boks' -> 0 ->> 'seriesPiece' = v_piece,
    'published with its text, the Series plays from the author''s page at once');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.studio_set_space_work_series(v_work, v_piece, true);
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author('stranger_poet') -> 'boks' -> 0 ->> 'format' = 'series', 'released, it shows as Series');
  perform public.boks_assert((select status from public.reels where id = v_bok) = 'published', 'the text stays published');

  -- The link preview card belongs to the page, not to its address.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.studio_set_author_space_share(v_id, 'https://tryboks.com/l/' || v_piece || '/f/poet-share.jpg');
  begin
    perform public.studio_set_author_space_share(v_id, '/l/' || v_piece || '/f/poet.jpg');
    perform public.boks_assert(false, 'only a -share card is accepted');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Paste the card%', 'only a -share card is accepted: ' || v_error);
  end;
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author_page('stranger_poet') ->> 'shareCard' = '/l/' || v_piece || '/f/poet-share.jpg', 'readers'' link previews get the page''s card');

  -- The author may change the address: it is their @name, and the page moves with it.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.update_boks_user_profile('', 'poet_renamed');
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author('poet_renamed') -> 'boks' -> 0 ->> 'format' = 'series', 'a renamed author keeps the page, its works and the Series');
  perform public.boks_assert(coalesce(jsonb_array_length(public.get_boks_author('stranger_poet') -> 'boks'), 0) = 0, 'the old address no longer opens the page');
  perform public.boks_assert(public.get_boks_author_page('poet_renamed') ->> 'name' = 'Поэтесса', 'the page name follows the new address');
  perform public.boks_assert(public.get_boks_author_page('poet_renamed') ->> 'shareCard' = '/l/' || v_piece || '/f/poet-share.jpg', 'the card follows the page to its new address');
  perform public.boks_assert(public.get_boks_author_moved('@stranger_poet') = 'poet_renamed', 'an old link is sent to the new address');
  perform public.boks_assert(public.get_boks_author_moved('poet_renamed') is null and public.get_boks_author_moved('nobody_here') is null, 'a current or unknown address is not a move');

  -- Nobody else takes the old address; the author may take it back.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000006');
  begin
    perform public.update_boks_user_profile('', 'stranger_poet');
    perform public.boks_assert(false, 'another account cannot take an author''s old address');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like '%already taken%', 'another account cannot take an author''s old address: ' || v_error);
  end;
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  begin
    perform public.studio_save_author_space(null, 'author', 'Другая', 'stranger_poet', null, 0);
    perform public.boks_assert(false, 'Studio cannot propose an author''s old address');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like '%already taken%', 'Studio cannot propose an author''s old address: ' || v_error);
  end;
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.update_boks_user_profile('', 'stranger_poet');
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author_moved('stranger_poet') is null and public.get_boks_author_moved('poet_renamed') = 'stranger_poet',
    'taking the old address back makes it current, and the other one leads to it');

  -- The author hides a published work and puts it back, from "My page".
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.withdraw_my_bok(v_bok);
  perform public.boks_assert(exists (
    select 1 from jsonb_array_elements(public.get_my_author_space() -> 'items') i
    where i ->> 'bokId' = v_bok::text and (i ->> 'hidden')::boolean and not (i ->> 'published')::boolean
  ), 'a hidden work stays on My page, marked hidden');
  perform public.boks_test_logout();
  perform public.boks_assert(coalesce(jsonb_array_length(public.get_boks_author('stranger_poet') -> 'boks'), 0) = 0, 'readers no longer see a hidden work');
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.restore_my_bok(v_bok);
  perform public.boks_assert(exists (
    select 1 from jsonb_array_elements(public.get_my_author_space() -> 'items') i
    where i ->> 'bokId' = v_bok::text and (i ->> 'published')::boolean and i -> 'hidden' is null
  ), 'put back, it is published again');
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author('stranger_poet') -> 'boks' -> 0 ->> 'format' = 'series', 'readers see it again, still as Series');
end $$;

-- The page's conversation: the author's notes, the team's answers, unread on both sides.
do $$
declare
  v_space jsonb;
  v_id uuid;
  v_work uuid;
  v_token text;
  v_mine jsonb;
  v_error text;
begin
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  v_space := public.studio_save_author_space(null, 'author', 'Переписка', 'msg_poet', null, 0);
  v_id := (v_space ->> 'id')::uuid;
  v_space := public.studio_save_space_work(v_id, null, 'Письмо', 'Текст письма.', 'text', null);
  v_work := ((v_space -> 'works') -> 0 ->> 'id')::uuid;
  perform public.studio_set_space_work_status(v_work, 'ready', 'Проверено');
  v_space := public.studio_set_author_space_share(v_id, '/l/AbCdEfGhIjKlMnOpQrStUv/f/msg-share.jpg', 'https://tryboks.com/l/AbCdEfGhIjKlMnOpQrStUv/f/msg-share.mp4');
  perform public.boks_assert(v_space ->> 'shareVideo' = '/l/AbCdEfGhIjKlMnOpQrStUv/f/msg-share.mp4', 'a page keeps its moving link preview');
  v_token := public.studio_issue_author_invite(v_id, 'reader-space@boks.test') ->> 'token';

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000006');
  perform public.accept_author_invite(v_token);
  v_mine := public.request_author_space_changes(v_work, 'Поменяйте шрифт заголовка');
  perform public.boks_assert(v_mine -> 'messages' -> 0 ->> 'body' = 'Поменяйте шрифт заголовка' and (v_mine -> 'messages' -> 0 ->> 'fromAuthor')::boolean,
    'asking for changes is a message to the team');
  perform public.boks_assert(exists (
    select 1 from jsonb_array_elements(v_mine -> 'items') i
    where i -> 'work' ->> 'id' = v_work::text and i -> 'work' ->> 'note' = 'Поменяйте шрифт заголовка'
  ), 'the work''s note is the author''s request, read from the conversation');
  v_mine := public.send_author_space_message('И фото хочется посветлее');
  perform public.boks_assert(jsonb_array_length(v_mine -> 'messages') = 2 and v_mine -> 'messages' -> 1 ->> 'workId' is null, 'the author writes about the page as a whole');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.boks_assert((public.studio_author_space(v_id) ->> 'unread')::integer = 2, 'the team sees two unread messages');
  perform public.boks_assert(exists (
    select 1 from jsonb_array_elements(public.studio_author_spaces('msg_poet', 10, 0) -> 'rows') r where (r ->> 'unread')::integer = 2
  ), 'and the list of pages says so');
  perform public.studio_mark_author_space_seen(v_id);
  perform public.boks_assert((public.studio_author_space(v_id) ->> 'unread')::integer = 0, 'read in Studio, nothing is unread');
  perform public.boks_assert(public.studio_author_space(v_id) -> 'works' -> 0 ->> 'note' = 'Поменяйте шрифт заголовка', 'the team sees the request on the work');
  perform public.studio_set_space_work_status(v_work, 'ready', 'Проверено', 'Шрифт заменили');
  perform public.boks_assert(public.studio_author_space(v_id) -> 'works' -> 0 ? 'note'
    and public.studio_author_space(v_id) -> 'works' -> 0 ->> 'note' is null, 'once the changes are made the work has no open request');
  perform public.studio_send_author_space_message(v_id, 'Фото заменим завтра');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000006');
  v_mine := public.get_my_author_space();
  perform public.boks_assert((v_mine ->> 'unread')::integer = 2, 'the author is told the changes are made, and the answer');
  perform public.boks_assert(v_mine -> 'messages' -> 2 ->> 'body' = 'Шрифт заменили' and v_mine -> 'messages' -> 2 ->> 'workTitle' = 'Письмо',
    'the fix names its work');
  perform public.mark_author_space_messages_seen();
  perform public.boks_assert((public.get_my_author_space() ->> 'unread')::integer = 0, 'read by the author, nothing is unread');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000004');
  begin
    perform public.send_author_space_message('чужое');
    perform public.boks_assert(false, 'a guest writes to nobody');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Sign in required%' or v_error like 'There is no page%', 'a guest writes to nobody: ' || v_error);
  end;
  perform public.boks_test_logout();
end $$;

-- No link needed: signed in with the invited address, the cabinet offers the page.
do $$
declare
  v_id uuid;
  v_invite uuid;
  v_mine jsonb;
begin
  insert into auth.users (id, email) values ('a5a50000-0000-4000-8000-000000000007', 'nolink@boks.test');
  insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version)
  values ('a5a50000-0000-4000-8000-000000000007', 'nolink_reader', 'reader', now(), 'v1')
  on conflict (user_id) do nothing;

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  v_id := (public.studio_save_author_space(null, 'author', 'Без ссылки', 'nolink_poet', null, 0) ->> 'id')::uuid;
  perform public.studio_save_space_work(v_id, null, 'Стих', 'Текст.', 'text', null);
  v_invite := (public.studio_issue_author_invite(v_id, 'NoLink@boks.test') -> 'invite' ->> 'id')::uuid;

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.boks_assert(not exists (
    select 1 from jsonb_array_elements(public.get_my_author_invites()) x where x ->> 'name' = 'Без ссылки'
  ), 'another address is not offered the page');
  perform public.boks_assert(public.accept_author_invite(null, v_invite) ->> 'state' = 'wrong_email', 'nor can it take the page by its id');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000007');
  v_mine := public.get_my_author_invites();
  perform public.boks_assert(jsonb_array_length(v_mine) = 1 and v_mine -> 0 ->> 'name' = 'Без ссылки' and v_mine -> 0 ->> 'handle' = 'nolink_poet'
    and (v_mine -> 0 ->> 'works')::integer = 1, 'the invited address is offered its page without a link');
  perform public.boks_assert(position('token' in v_mine::text) = 0, 'and is never handed the token');
  perform public.boks_assert(public.accept_author_invite(null, v_invite) ->> 'state' = 'accepted', 'it accepts the page from the cabinet');
  perform public.boks_assert(jsonb_array_length(public.get_my_author_invites()) = 0, 'an accepted page is no longer offered');
  perform public.boks_assert((select handle from public.user_profiles where user_id = 'a5a50000-0000-4000-8000-000000000007') = 'nolink_poet',
    'the proposed address becomes the account''s @name, as with the link');
  perform public.boks_test_logout();
end $$;

-- One page, one row (20261116100000): Studio edits what readers see, the
-- preview and the public page agree, a deleted account's page comes down.
do $$
declare
  v_jpeg2 text := encode('\xffd8ffe1'::bytea || convert_to(repeat('y', 200), 'UTF8'), 'base64');
  v_id uuid;
  v_version integer;
  v_photo_version integer;
  v_page jsonb;
  v_error text;
begin
  select id, version into v_id, v_version from public.author_spaces
  where owner_user_id = 'a5a50000-0000-4000-8000-000000000002' and status <> 'merged';
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000002');
  v_photo_version := (public.get_my_author_page() ->> 'photoVersion')::integer;
  perform public.boks_assert((public.get_my_author_page() ->> 'version')::integer = v_version, 'the cabinet and Studio hold the same page version');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.studio_save_author_space(v_id, 'author', 'Дарья Мальо', null, v_jpeg2, v_version);

  perform public.boks_test_logout();
  v_page := public.get_boks_author_page('test_poetess');
  perform public.boks_assert(v_page ->> 'name' = 'Дарья Мальо', 'Studio''s edit of an owned page is what readers see');
  perform public.boks_assert((v_page ->> 'photoVersion')::integer > v_photo_version, 'a new photo from Studio is a new photo address');
  perform public.boks_assert(public.get_boks_author_photo('test_poetess') ->> 'jpeg' = v_jpeg2
    and (public.get_boks_author_photo('test_poetess') ->> 'version')::integer = (v_page ->> 'photoVersion')::integer,
    'readers get Studio''s photo under the version the page names');

  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000002');
  perform public.boks_assert(public.get_author_space_preview(null) ->> 'name' = v_page ->> 'name'
    and public.get_my_author_page() ->> 'name' = v_page ->> 'name'
    and public.get_my_author_space() ->> 'name' = v_page ->> 'name',
    'the preview, the cabinet and the public page show the same name');
  begin
    perform public.save_my_author_page('Старое имя', 'keep', v_version);
    perform public.boks_assert(false, 'the author''s tab opened before Studio''s save is stale');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Your page was changed in another tab%', 'a cabinet tab overtaken by Studio is refused: ' || v_error);
  end;
  perform public.save_my_author_page('Дарья', 'keep', v_version + 1);
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.boks_assert(public.studio_author_space(v_id) ->> 'name' = 'Дарья', 'Studio sees the author''s own edit');
  -- The author may clear the name; Studio can still save the page.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000002');
  perform public.save_my_author_page('', 'keep', v_version + 2);
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.studio_save_author_space(v_id, 'author', '', null, 'keep', v_version + 3);

  -- The author deletes their account: the page comes down with its name and photo.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000003');
  perform public.delete_my_boks_account('stranger_poet');
  perform public.boks_test_logout();
  perform public.boks_assert(
    not exists (select 1 from public.author_spaces s where s.status = 'published' and s.kind = 'author' and s.owner_user_id is null),
    'no published page is left without an owner');
  perform public.boks_assert(
    exists (select 1 from public.author_spaces s where s.handle is null and s.owner_user_id is null and s.status = 'unpublished'
            and s.name is null and s.photo is null and s.share_card is not null),
    'a deleted author''s page is unpublished and keeps no name or photo');
  perform public.boks_assert(public.get_boks_author_page('stranger_poet') is null, 'readers get nothing for a deleted author''s page');

  -- An admin deletes an account: the same.
  perform public.boks_test_login('a5a50000-0000-4000-8000-000000000001');
  perform public.delete_boks_user('a5a50000-0000-4000-8000-000000000002', 'test_poetess');
  perform public.boks_assert((select status from public.author_spaces where id = v_id) = 'unpublished', 'an account deleted by an admin takes its page down');
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_author_page('test_poetess') is null and public.get_boks_author_photo('test_poetess') is null,
    'readers get no name or photo for it');

  perform public.boks_assert(to_regclass('public.author_pages') is null, 'author_pages is gone: the space is the page');
  perform public.boks_assert(not exists (
    select 1 from information_schema.columns where table_schema = 'public' and table_name = 'author_space_works' and column_name = 'note'
  ), 'a work keeps no copy of the author''s request');
  perform public.boks_assert(not exists (
    select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc ilike '%author_pages%'
  ), 'no function reads author_pages');
end $$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['author_spaces', 'author_space_works', 'author_space_invites', 'author_space_publications', 'author_space_order', 'author_space_follows', 'author_handle_moves', 'author_space_messages'] loop
    perform public.boks_assert(
      not has_table_privilege('anon', 'public.' || v_table, 'SELECT') and not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT'),
      v_table || ' is reached only through its functions');
  end loop;
  perform public.boks_assert(
    not has_function_privilege('anon', 'public.studio_author_space(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_author_space_preview(uuid)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.accept_author_invite(text,uuid)', 'EXECUTE'),
    'a bare anonymous request reaches no prepared page');
  perform public.boks_assert(
    has_function_privilege('anon', 'public.get_boks_author(text,text,integer)', 'EXECUTE'),
    'the public author page stays open to guests');
end $$;
rollback;

-- Line of the day and Guess the author (20261117100000).
begin;
insert into auth.users (id, email, is_anonymous)
select ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'daily' || n || '@boks.test', n = 99
from generate_series(1, 30) n
union all select 'd0000000-0000-4000-8000-000000000099', null, true;
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version, is_publisher)
select ('d0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'daily_' || n,
  case when n = 30 then 'admin' else 'reader' end, now(), 'v1', n = 29
from generate_series(1, 30) n;

do $$
declare
  v_publisher uuid := 'd0000000-0000-4000-8000-000000000029';
  v_admin uuid := 'd0000000-0000-4000-8000-000000000030';
  v_guest uuid := 'd0000000-0000-4000-8000-000000000099';
  v_bok uuid;
  v_letter jsonb;
  v_first jsonb;
  v_sent jsonb;
  v_error text;
  v_counts integer[];
  v_n integer;
  v_text text;
  v_erased record;
  v_spaced uuid;
  v_titled uuid;
begin
  -- Six catalogue poets, six short poems each: enough that a replacement always has a text by another surname.
  for v_n in 1..36 loop
    insert into public.reels (title, author_name, author_user_id, text, status, language, minutes, reading_shape, is_seed)
    values (
      'Стихотворение ' || v_n,
      (array['Александр Пушкин', 'Фёдор Тютчев', 'Афанасий Фет', 'Лев Толстой', 'Алексей Толстой', 'Александр Блок'])[1 + (v_n - 1) % 6],
      v_publisher,
      'Мороз и солнце, день чудесный ' || v_n || E'\nЕщё ты дремлешь, друг прелестный\nПора, красавица, проснись\n\n'
        || E'Вечор, ты помнишь, вьюга злилась\nНа мутном небе мгла носилась\nЛуна, как бледное пятно ' || v_n,
      'published', 'ru', 1, 'verse', true
    );
  end loop;
  select id into v_bok from public.reels where title = 'Стихотворение 1' and author_user_id = v_publisher;

  -- Sending a line.
  perform public.boks_test_login(v_guest, true);
  begin
    perform public.share_line(v_bok, 'Мороз и солнце');
    raise exception 'guest sent a line';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'A permanent user account is required.', 'a guest cannot send a line');

  perform public.boks_test_login('d0000000-0000-4000-8000-000000000001');
  begin
    perform public.share_line(v_bok, 'слова, которых нет в тексте');
    raise exception 'sent words not in the bok';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Only words from the bok itself can be sent.', 'only words of the bok itself can be sent');
  v_sent := public.share_line(v_bok, 'день чудесный 1' || E'\n' || 'Ещё ты дремлешь');
  perform public.boks_assert((v_sent ->> 'created')::boolean, 'a line across two lines of verse is sent');
  perform public.boks_assert(
    public.share_line(v_bok, '  ДЕНЬ чудесный  1 ещё ты   дремлешь ') ->> 'id' = v_sent ->> 'id',
    'the same line again, spaced or cased differently, is one line in the pool');
  perform public.boks_assert(
    public.share_line(v_bok, 'день чудесный 1 Еще ты дремлешь') ->> 'id' = v_sent ->> 'id',
    'ё and е are the same letter for a line');

  -- Alone in the pool: the sender never receives their own line.
  v_letter := public.open_daily_letter('Europe/Belgrade');
  perform public.boks_assert(v_letter ->> 'source' = 'editorial' and v_letter ->> 'senderHandle' is null,
    'with only your own line in the pool the letter is the editorial one');
  perform public.boks_assert(public.open_daily_letter('Europe/Belgrade') = v_letter, 'opening again shows the same letter');
  perform public.boks_assert((public.get_daily_arrival('Europe/Belgrade') ->> 'letterOpened')::boolean, 'today is marked opened');
  perform public.boks_assert(position(v_letter ->> 'passage' in (select text from public.reels where id = (v_letter ->> 'bokId')::uuid)) > 0,
    'the editorial line is words of its poem');

  -- Five senders, one line each, ten readers open: two letters per line.
  for v_n in 2..5 loop
    perform public.boks_test_login(('d0000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid);
    perform public.share_line(
      (select id from public.reels where title = 'Стихотворение ' || v_n and author_user_id = v_publisher),
      'Ещё ты дремлешь, друг прелестный');
  end loop;
  -- Shared today, received from tomorrow.
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000010');
  perform public.boks_assert(public.open_daily_letter(null) ->> 'source' = 'editorial', 'a line shared today is not handed out today');
  delete from public.daily_letters where recipient_user_id = 'd0000000-0000-4000-8000-000000000010';
  update public.shared_lines set created_at = now() - interval '1 day';
  for v_n in 10..19 loop
    perform public.boks_test_login(('d0000000-0000-4000-8000-' || lpad(v_n::text, 12, '0'))::uuid);
    v_letter := public.open_daily_letter(null);
    perform public.boks_assert(v_letter ->> 'source' = 'reader', 'reader ' || v_n || ' receives a reader''s line');
  end loop;
  select array_agg(c order by c) into v_counts from (
    select count(*)::integer c from public.daily_letters l where l.source = 'reader' group by l.shared_line_id
  ) x;
  perform public.boks_assert(v_counts = array[2, 2, 2, 2, 2], 'five lines among ten letters: each line twice');
  perform public.boks_assert((select count(distinct (recipient_user_id, letter_date)) from public.daily_letters) = (select count(*) from public.daily_letters),
    'one letter per account and day');

  -- The signature: always the sender's handle.
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000010');
  v_first := public.open_daily_letter(null);
  perform public.boks_assert(
    (v_first ->> 'senderHandle') = (
      select s.handle from public.daily_letters l join public.user_profiles s on s.user_id = l.sender_user_id
      where l.recipient_user_id = 'd0000000-0000-4000-8000-000000000010'),
    'the letter is signed with its sender''s handle');
  perform public.boks_assert(not exists (
    select 1 from public.daily_letters l where l.source = 'editorial' and (l.sender_user_id is not null or public.boks_daily_letter_json(l) ->> 'senderHandle' is not null)),
    'an editorial letter carries no handle');
  perform public.boks_assert(position('daily' in coalesce(v_first ->> 'senderHandle', 'daily_')) = 1 and position('@boks.test' in v_first::text) = 0,
    'an email never reaches a letter');

  -- A line sent later in the day joins the next openings; nothing is rewritten.
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000006');
  perform public.share_line((select id from public.reels where title = 'Стихотворение 6' and author_user_id = v_publisher), 'Вечор, ты помнишь, вьюга злилась');
  update public.shared_lines set created_at = now() - interval '1 day' where passage = 'Вечор, ты помнишь, вьюга злилась';
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000020');
  v_letter := public.open_daily_letter(null);
  perform public.boks_assert(v_letter ->> 'passage' = 'Вечор, ты помнишь, вьюга злилась', 'a line nobody has received today goes before a repeat');
  update public.shared_lines set created_at = now() - interval '9 days' where passage = 'Вечор, ты помнишь, вьюга злилась';
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000024');
  perform public.boks_assert(public.open_daily_letter(null) ->> 'passage' <> 'Вечор, ты помнишь, вьюга злилась', 'a line older than a week leaves the pool');
  update public.shared_lines set created_at = now() - interval '1 day' where passage = 'Вечор, ты помнишь, вьюга злилась';
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000010');
  perform public.boks_assert(public.open_daily_letter(null) = v_first, 'a letter already opened does not change');

  -- A suspended sender's lines leave the pool.
  update public.user_profiles set banned_at = now() where user_id = 'd0000000-0000-4000-8000-000000000006';
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000021');
  perform public.boks_assert(public.open_daily_letter(null) ->> 'passage' <> 'Вечор, ты помнишь, вьюга злилась', 'a suspended sender''s line is not handed out');

  -- The source taken down: the letter stays, marked unavailable, without the words.
  update public.reels set status = 'archived', archived_at = now(), archived_from_status = 'published'
  where id = (v_first ->> 'bokId')::uuid;
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000010');
  v_letter := public.get_my_daily_letters(null, 30) -> 0;
  perform public.boks_assert(not (v_letter ->> 'available')::boolean and v_letter ->> 'passage' is null and v_letter ->> 'bokId' is null,
    'a letter whose bok was taken down is unavailable and shows no words');
  update public.reels set status = 'published', archived_at = null, archived_from_status = null where id = (v_first ->> 'bokId')::uuid;

  -- A sender who deletes their account: the letter stays, signed as a boks reader.
  delete from auth.users where id = (select sender_user_id from public.daily_letters where recipient_user_id = 'd0000000-0000-4000-8000-000000000010');
  v_letter := public.get_my_daily_letters(null, 30) -> 0;
  perform public.boks_assert(v_letter ->> 'senderHandle' is null and v_letter ->> 'passage' = v_first ->> 'passage',
    'a deleted sender''s letter keeps its words and loses the handle');

  -- The day follows the account's zone; a nonsense zone falls back to it.
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000022');
  perform public.boks_assert((public.get_daily_arrival('Pacific/Kiritimati') ->> 'date')::date = (now() at time zone 'Pacific/Kiritimati')::date,
    'the letter''s date is the account''s own day');
  perform public.boks_assert((public.get_daily_arrival('Not/AZone') ->> 'date')::date = (now() at time zone 'Pacific/Kiritimati')::date,
    'an invalid zone falls back to the account''s remembered zone');
  perform public.boks_assert((public.get_daily_arrival('America/Los_Angeles') ->> 'date')::date = (now() at time zone 'Pacific/Kiritimati')::date,
    'a remembered zone changes at most once a day');
  update public.reader_time_zones set updated_at = now() - interval '2 days' where user_id = 'd0000000-0000-4000-8000-000000000022';
  perform public.open_daily_letter(null);
  perform public.boks_assert((public.get_daily_arrival('America/Los_Angeles') ->> 'date')::date = (now() at time zone 'Pacific/Kiritimati')::date,
    'nor on a day whose letter is already open');

  -- Imported texts carry no-break spaces; the reader shows them as plain ones.
  insert into public.reels (title, author_name, author_user_id, text, status, language, minutes, reading_shape, is_seed)
  values ('Пробелы', 'Иван Пробелов', v_publisher, 'Вот строка с' || chr(160) || 'неразрывным пробелом,' || E'\nи ещё одна —' || chr(160) || 'с тире.', 'published', 'ru', 1, 'verse', true)
  returning id into v_spaced;

  -- A reader who reads only English gets no Russian reader's line.
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000026');
  perform public.boks_assert(public.save_line(v_spaced, 'с неразрывным пробелом, и ещё одна — с тире') ->> 'id' is not null,
    'a line across no-break spaces is the bok''s own words');
  update public.user_profiles set reading_languages = '{en}' where user_id = 'd0000000-0000-4000-8000-000000000026';
  perform public.boks_assert(public.open_daily_letter(null) ->> 'source' = 'editorial', 'a letter keeps to the reader''s languages');
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000022');

  -- A line sent by link: a letter from its sender, open to anyone with it.
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000025');
  v_sent := public.create_line_link(v_bok, 'Пора, красавица, проснись');
  perform public.boks_assert((v_sent ->> 'created')::boolean and v_sent ->> 'code' ~ '^[0-9a-f]{16}$', 'a line gets its own link');
  perform public.boks_assert(public.create_line_link(v_bok, 'пора,  красавица, проснись') ->> 'code' = v_sent ->> 'code', 'the same line keeps its one link');
  perform public.boks_assert(not exists (select 1 from public.shared_lines where sender_user_id = 'd0000000-0000-4000-8000-000000000025'),
    'a line sent by link does not join the letters');
  begin
    perform public.create_line_link(v_bok, 'чужие слова');
    raise exception 'linked words not in the bok';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Only words from the bok itself can be sent.', 'only words of the bok get a link');
  perform public.boks_test_logout();
  v_letter := public.get_line_link(v_sent ->> 'code');
  perform public.boks_assert(v_letter ->> 'senderHandle' = 'daily_25' and v_letter ->> 'passage' = 'Пора, красавица, проснись' and v_letter ->> 'bokId' = v_bok::text,
    'anyone with the link sees the line and who sent it');
  perform public.boks_assert(public.get_line_link('nope') is null and public.get_line_link('0000000000000000') is null, 'an unknown link opens nothing');
  perform public.boks_assert(position('@boks.test' in v_letter::text) = 0, 'a link never carries an email');
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000022');

  -- An editorial line is never the poem's own title.
  begin
    update public.reels set status = 'archived', archived_at = now(), archived_from_status = 'published' where status = 'published';
    insert into public.reels (title, author_name, author_user_id, text, status, language, minutes, reading_shape, is_seed)
    values ('Заглавие', 'Иван Заглавный', v_publisher, E'Заглавие\n\nПервая настоящая строка стиха\nВторая строка стиха\nТретья строка\nЧетвёртая строка', 'published', 'ru', 1, 'verse', true)
    returning id into v_titled;
    perform public.boks_assert((public.boks_editorial_line('d0000000-0000-4000-8000-000000000027', current_date, null)).passage = 'Первая настоящая строка стиха',
      'an editorial line skips the title a text opens with');
    raise exception 'undo';
  exception when others then
    if sqlerrm <> 'undo' then raise; end if;
  end;

  -- An erased bok: its letters stay, without a copy of its words.
  select recipient_user_id, bok_id into v_erased from public.daily_letters where bok_id <> v_bok and source = 'reader' limit 1;
  delete from public.reels where id = v_erased.bok_id;
  perform public.boks_assert(
    (select passage = '' and bok_id is null from public.daily_letters where recipient_user_id = v_erased.recipient_user_id),
    'an erased bok leaves no words in the letters that carried it');
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000022');

  -- Saving a line for yourself.
  perform public.save_line(v_bok, 'Пора, красавица, проснись');
  perform public.save_line(v_bok, 'ПОРА,  красавица, проснись');
  perform public.boks_assert(jsonb_array_length(public.get_saved_lines(null, 30)) = 1, 'a saved line is kept once');
  begin
    perform public.save_line(v_bok, 'чужие слова');
    raise exception 'saved words not in the bok';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Only words from the bok itself can be saved.', 'only words of the bok can be saved');
  v_text := public.get_saved_lines(null, 30) -> 0 ->> 'id';
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000023');
  perform public.boks_assert(jsonb_array_length(public.get_saved_lines(null, 30)) = 0, 'saved lines are private to their reader');
  perform public.delete_saved_line(v_text::uuid);
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000022');
  perform public.boks_assert(jsonb_array_length(public.get_saved_lines(null, 30)) = 1, 'nobody else can remove them');
  perform public.delete_saved_line(v_text::uuid);
  perform public.boks_assert(jsonb_array_length(public.get_saved_lines(null, 30)) = 0, 'their reader removes a saved line');
end $$;

-- Guess the author.
do $$
declare
  v_admin uuid := 'd0000000-0000-4000-8000-000000000030';
  v_guest uuid := 'd0000000-0000-4000-8000-000000000099';
  v_today date := public.boks_game_today();
  v_game jsonb;
  v_result jsonb;
  v_day jsonb;
  v_issue public.author_game_issues;
  v_published_at timestamptz;
  v_error text;
  v_title text;
begin
  -- Not an editor: no Studio.
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000010');
  begin
    perform public.studio_author_game_calendar(7);
    raise exception 'a reader opened the game calendar';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Admin access required.', 'only an editor sees the game calendar');

  perform public.boks_test_login(v_admin);
  v_day := public.studio_author_game_calendar(7);
  perform public.boks_assert(jsonb_array_length(v_day -> 'days') = 7, 'the calendar shows seven days');
  perform public.boks_assert(not exists (
    select 1 from jsonb_array_elements(v_day -> 'days') d where (d ->> 'available')::integer <> 3
  ), 'every day of the horizon has three available candidates');
  perform public.boks_assert(not exists (
    select c.game_date from public.author_game_candidates c join public.reels b on b.id = c.bok_id
    group by c.game_date having count(distinct public.boks_surname(b.author_name)) <> 3
  ), 'a day''s three candidates are by three different authors, never two Tolstoys');
  perform public.boks_assert(not exists (
    select 1 from public.author_game_candidates c join public.reels b on b.id = c.bok_id
    where not (b.author_name = any (c.options))
      or (select count(distinct public.boks_surname(o)) from unnest(c.options) o) <> 3
      or c.options[c.correct + 1] <> b.author_name
  ), 'each candidate''s three names include its author once, with three different surnames');
  perform public.boks_assert((select count(*) from public.author_game_candidates) = (select count(distinct bok_id) from public.author_game_candidates),
    'no text is planned twice in the week');

  -- The editor reads tomorrow's second text and chooses it.
  v_day := public.studio_author_game_day(v_today + 1);
  perform public.boks_assert((v_day -> 'candidates' -> 1 ->> 'text') is not null, 'the preview has the full text');
  v_day := public.studio_author_game_day(v_today + 1);
  perform public.boks_assert(v_day ->> 'chosenPosition' is null, 'opening a preview is not a choice');
  v_day := public.studio_author_game_choose(v_today + 1, 2);
  perform public.boks_assert((v_day ->> 'chosenPosition')::integer = 2, 'the editor chooses the second text');

  -- Replacing the chosen text clears the choice; replacing another keeps it.
  v_day := public.studio_author_game_choose(v_today + 2, 3);
  v_day := public.studio_author_game_replace(v_today + 2, 3);
  perform public.boks_assert((v_day ->> 'choiceCleared')::boolean and v_day ->> 'chosenPosition' is null,
    'replacing the chosen text returns the date to the automatic choice');
  perform public.boks_assert((v_day -> 'candidates' -> 2 ->> 'replacedAt') is not null, 'the replacement takes the same position');

  -- Today, nobody chose: the first available candidate is published, once.
  perform public.boks_test_login(v_guest, true);
  v_game := public.get_author_game();
  perform public.boks_assert(v_game ->> 'status' = 'open', 'a guest reads today''s text');
  select * into v_issue from public.author_game_issues where game_date = v_today;
  perform public.boks_assert(v_issue.published_position = 1, 'without a choice the first candidate is published');
  select title into v_title from public.reels where id = v_issue.published_bok_id;
  perform public.boks_assert(
    position(v_issue.published_bok_id::text in v_game::text) = 0 and position(v_title in v_game::text) = 0
      and v_game -> 'result' = 'null'::jsonb and not (v_game ? 'bokId') and not (v_game ? 'title'),
    'the reader gets no id, title or answer before answering');
  perform public.boks_assert(jsonb_array_length(v_game -> 'options') = 3, 'three names to choose from');
  perform public.boks_assert(public.boks_game_text(E'Басни. Книга первая\n\nXXII. Орёл и Куры\n\nЖелая светлым днём\nвполне налюбоваться,', 'Орёл и Куры')
    = E'Желая светлым днём\nвполне налюбоваться,', 'the game drops a heading that names the text');
  perform public.boks_assert(public.boks_game_text(E'Ночевала тучка золотая\nНа груди утёса-великана;', 'Утёс') = E'Ночевала тучка золотая\nНа груди утёса-великана;',
    'a title word in the poem itself is not a heading');
  perform public.boks_assert(public.boks_game_text(E'Утёс\nНочевала тучка золотая', 'Утёс') = E'Утёс\nНочевала тучка золотая',
    'a first line that is the title but runs into the poem stays');
  perform public.boks_assert(public.boks_game_text(E'Утёс\n\nНочевала тучка золотая', 'Утёс') = 'Ночевала тучка золотая',
    'a title standing as a heading goes');
  perform public.boks_assert(public.get_author_game_status() = 'open', 'the status says today''s text waits');
  v_published_at := v_issue.published_at;
  perform public.boks_game_publish(v_today);
  perform public.boks_assert((select published_at from public.author_game_issues where game_date = v_today) = v_published_at,
    'publishing again changes nothing');
  perform public.boks_assert(public.get_author_game() -> 'options' = v_game -> 'options', 'the order of the names is fixed for the day');

  -- Tomorrow with the editor's choice.
  v_issue := public.boks_game_publish(v_today + 1);
  perform public.boks_assert(v_issue.published_position = 2, 'the editor''s choice is what is published');
  perform public.boks_test_login(v_admin);
  begin
    perform public.studio_author_game_choose(v_today + 1, 1);
    raise exception 'changed a published issue';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'This issue is already published and can no longer change.', 'a published issue cannot change');

  -- A chosen text taken down before its day: the next available one goes out.
  v_day := public.studio_author_game_choose(v_today + 3, 1);
  update public.reels set status = 'archived', archived_at = now(), archived_from_status = 'published'
  where id = (v_day -> 'candidates' -> 0 ->> 'bokId')::uuid;
  v_issue := public.boks_game_publish(v_today + 3);
  perform public.boks_assert(v_issue.published_position = 2, 'an unavailable choice falls through to the next candidate');

  -- Answers.
  perform public.boks_test_login(v_guest, true);
  begin
    perform public.answer_author_game(v_today, 0);
    raise exception 'a guest answered';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'A permanent user account is required.', 'answering needs an account');
  select * into v_issue from public.author_game_issues where game_date = v_today;
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000011');
  v_result := public.answer_author_game(v_today, v_issue.published_correct);
  perform public.boks_assert((v_result ->> 'correct')::boolean and v_result ->> 'authorName' = v_issue.published_options[v_issue.published_correct + 1]
    and v_result ->> 'title' = v_title, 'a right answer opens the name and the title');
  v_result := public.answer_author_game(v_today, (v_issue.published_correct + 1) % 3);
  perform public.boks_assert((v_result ->> 'correct')::boolean, 'a second attempt does not replace the first');
  perform public.boks_test_login('d0000000-0000-4000-8000-000000000012');
  v_result := public.answer_author_game(v_today, null);
  perform public.boks_assert((v_result ->> 'revealed')::boolean and not (v_result ->> 'correct')::boolean, 'a reader may reveal the answer');
  perform public.boks_assert((select sum(x::integer) from jsonb_array_elements_text(v_result -> 'counts') x) = 1,
    'a revealed answer is not counted among the answers');
  perform public.boks_assert(public.get_author_game() ->> 'status' = 'answered', 'the reader comes back to their result');
  perform public.boks_assert(public.get_author_game_status() = 'answered', 'and the status says so, without the text');

  -- Nothing left to publish: readers are told, nothing breaks.
  begin
    update public.reels set status = 'archived', archived_at = now(), archived_from_status = 'published'
    where status = 'published';
    v_issue := public.boks_game_publish(v_today + 6);
    perform public.boks_assert(v_issue.published_at is null, 'with an empty catalogue no issue is published');
    perform public.boks_test_login(v_admin);
    perform public.boks_assert((public.studio_author_game_day(v_today + 6) ->> 'available')::integer = 0, 'the editor sees the date needs stock');
    raise exception 'undo';
  exception when others then
    if sqlerrm <> 'undo' then raise; end if;
  end;
end $$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['line_links', 'shared_lines', 'daily_letters', 'reader_time_zones', 'saved_lines', 'author_game_issues', 'author_game_candidates', 'author_game_answers'] loop
    perform public.boks_assert(
      not has_table_privilege('anon', 'public.' || v_table, 'SELECT') and not has_table_privilege('authenticated', 'public.' || v_table, 'SELECT'),
      v_table || ' is reached only through its functions');
  end loop;
  perform public.boks_assert(
    not has_function_privilege('anon', 'public.open_daily_letter(text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_author_game()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.boks_game_publish(date)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.boks_editorial_line(uuid,date,text[])', 'EXECUTE')
      and has_function_privilege('anon', 'public.get_line_link(text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.create_line_link(uuid,text)', 'EXECUTE'),
    'internal daily functions are not callable from the browser');
end $$;
rollback;

-- My days (20261117110000).
begin;
insert into auth.users (id, email, is_anonymous) values
  ('e0000000-0000-4000-8000-000000000001', 'days1@boks.test', false),
  ('e0000000-0000-4000-8000-000000000002', 'days2@boks.test', false),
  ('e0000000-0000-4000-8000-000000000099', null, true);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('e0000000-0000-4000-8000-000000000001', 'days_one', 'reader', now(), 'v1'),
  ('e0000000-0000-4000-8000-000000000002', 'days_two', 'reader', now(), 'v1');
do $$
declare
  v_arrival jsonb;
  v_today date;
  v_error text;
begin
  perform public.boks_test_login('e0000000-0000-4000-8000-000000000099', true);
  begin
    perform public.get_daily_arrival('Europe/Moscow');
    raise exception 'a guest got a day';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'A permanent user account is required.', 'a guest keeps no days on the server');

  perform public.boks_test_login('e0000000-0000-4000-8000-000000000001');
  v_arrival := public.get_daily_arrival('Europe/Moscow');
  v_today := (v_arrival ->> 'date')::date;
  perform public.boks_assert(v_today = (now() at time zone 'Europe/Moscow')::date, 'the day is the account''s own day');
  perform public.boks_assert((v_arrival ->> 'total')::integer = 1 and (v_arrival ->> 'streak')::integer = 1 and not (v_arrival ->> 'cardSeen')::boolean,
    'a first day: one day, a run of one, the card not yet shown');
  perform public.boks_assert(jsonb_array_length(v_arrival -> 'week') = 7
    and extract(isodow from (v_arrival -> 'week' -> 0 ->> 'date')::date) = 1
    and (select count(*) from jsonb_array_elements(v_arrival -> 'week') w where (w ->> 'visited')::boolean) = 1,
    'the week runs Monday to Sunday with today marked');
  perform public.boks_assert(public.get_daily_arrival('Europe/Moscow') ->> 'total' = '1', 'coming back the same day is the same day');

  perform public.mark_daily_card_seen(v_today);
  perform public.boks_assert((public.get_daily_arrival('Europe/Moscow') ->> 'cardSeen')::boolean, 'the card is shown once a day, on any device');

  insert into public.reader_days (user_id, day) values
    ('e0000000-0000-4000-8000-000000000001', v_today - 1),
    ('e0000000-0000-4000-8000-000000000001', v_today - 2),
    ('e0000000-0000-4000-8000-000000000001', v_today - 4);
  v_arrival := public.get_daily_arrival('Europe/Moscow');
  perform public.boks_assert((v_arrival ->> 'total')::integer = 4 and (v_arrival ->> 'streak')::integer = 3, 'four days in all, three of them in a row');
  perform public.boks_assert((public.get_my_days(v_today) -> 'days') @> jsonb_build_array(jsonb_build_object('date', v_today, 'letter', false)),
    'the month shows today');
  perform public.boks_assert((public.get_my_days(v_today) ->> 'since')::date = v_today - 4, 'and since when');

  perform public.boks_test_login('e0000000-0000-4000-8000-000000000002');
  perform public.boks_assert(jsonb_array_length(public.get_my_days(v_today) -> 'days') = 0 and (public.get_my_days(v_today) ->> 'total')::integer = 0,
    'nobody sees another account''s days');
  perform public.mark_daily_card_seen(v_today);
  perform public.boks_assert(not exists (select 1 from public.reader_days where user_id = 'e0000000-0000-4000-8000-000000000002'),
    'marking a card does not invent a day');
  perform public.boks_assert(not has_table_privilege('authenticated', 'public.reader_days', 'SELECT') and not has_table_privilege('anon', 'public.reader_days', 'SELECT'),
    'reader_days is reached only through its functions');
end $$;
rollback;

-- Applications from the page for authors (20261117150000) and its feedback (20261117140000).
begin;
insert into auth.users (id, email, is_anonymous) values
  ('f0000000-0000-4000-8000-000000000001', 'apply1@boks.test', false),
  ('f0000000-0000-4000-8000-000000000002', 'apply2@boks.test', false),
  ('f0000000-0000-4000-8000-000000000099', null, true);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('f0000000-0000-4000-8000-000000000001', 'apply_one', 'reader', now(), 'v1'),
  ('f0000000-0000-4000-8000-000000000002', 'apply_two', 'reader', now(), 'v1');
do $$
declare
  v_access jsonb;
  v_error text;
begin
  perform public.boks_test_login('f0000000-0000-4000-8000-000000000099', true);
  -- Since 20261118150000 a guest (or an anonymous session) may apply from the
  -- page for authors; the application is kept without an account.
  v_error := null;
  begin
    perform public.submit_author_application('page', 'Гость', 'https://t.me/x', null, '@guest_x', null);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error is null, 'a guest may apply from the page for authors: ' || coalesce(v_error, ''));

  perform public.boks_test_login('f0000000-0000-4000-8000-000000000001');
  v_access := public.get_my_author_access();
  perform public.boks_assert((v_access ->> 'published')::integer = 0 and not (v_access ->> 'admin')::boolean and v_access -> 'application' = 'null'::jsonb,
    'a reader with nothing published has no cabinet yet');
  begin
    perform public.submit_author_application('page', 'Анна', 'x', null, '@anna', null);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Add at least one link: where your readers are.', 'an application needs a link');
  perform public.submit_author_application('launch', 'Анна', 'https://t.me/anna', '600', '@anna', 'Стихи');
  perform public.boks_assert(public.get_my_author_access() -> 'application' ->> 'offer' = 'launch', 'the page knows the application was sent');
  perform public.submit_author_application('nonsense', 'Анна', 'https://t.me/anna', null, '@anna', null);
  perform public.submit_author_application('page', 'Анна', 'https://t.me/anna', null, '@anna', null);
  begin
    perform public.submit_author_application('page', 'Анна', 'https://t.me/anna', null, '@anna', null);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error like 'Three applications a day%', 'three applications a day at most');
  perform public.boks_assert((select offer from public.author_applications where user_id = 'f0000000-0000-4000-8000-000000000001' order by id limit 1 offset 1) = 'unsure',
    'an unknown offer is kept as not sure');
  begin
    perform public.list_author_applications(10);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Admin access is required.', 'only Studio reads the applications');

  perform public.boks_test_login('f0000000-0000-4000-8000-000000000002');
  perform public.boks_assert(public.get_my_author_access() -> 'application' = 'null'::jsonb, 'nobody sees another account''s application');
  perform public.boks_assert(not has_table_privilege('authenticated', 'public.author_applications', 'SELECT') and not has_table_privilege('anon', 'public.author_applications', 'SELECT'),
    'author_applications is reached only through its functions');

  perform public.submit_boks_feedback('Непонятно про тарифы', 'author_landing', null, null);
  perform public.submit_boks_feedback('Суфлёр быстрый', 'series_record', null, null);
  perform public.boks_assert((select array_agg(surface order by id) from public.boks_feedback where user_id = 'f0000000-0000-4000-8000-000000000002') = array['author_landing', 'series_record'],
    'a note says which page or step it came from');
end $$;
rollback;

-- Boks Series granted to authors (20261117160000).
begin;
insert into auth.users (id, email, is_anonymous) values
  ('f1000000-0000-4000-8000-000000000001', 'series1@boks.test', false),
  ('f1000000-0000-4000-8000-000000000002', 'series2@boks.test', false),
  ('f1000000-0000-4000-8000-000000000003', 'series-admin@boks.test', false),
  ('f1000000-0000-4000-8000-000000000099', null, true);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('f1000000-0000-4000-8000-000000000001', 'series_one', 'reader', now(), 'v1'),
  ('f1000000-0000-4000-8000-000000000002', 'series_two', 'reader', now(), 'v1'),
  ('f1000000-0000-4000-8000-000000000003', 'series_admin', 'admin', now(), 'v1');
do $$
declare
  v_error text;
begin
  perform public.boks_test_login('f1000000-0000-4000-8000-000000000099', true);
  begin
    perform public.get_my_series_access();
    raise exception 'a guest got access';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'A permanent user account is required.', 'a guest has no recorder');

  perform public.boks_test_login('f1000000-0000-4000-8000-000000000001');
  perform public.boks_assert(not (public.get_my_series_access() ->> 'allowed')::boolean, 'no grant, no recorder');
  begin
    perform public.spend_series_credit();
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error like 'No Boks Series left%', 'nothing to spend without a grant');
  begin
    perform public.set_series_credits('series_one', 100);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Admin access is required.', 'an author cannot grant themselves Series');

  perform public.boks_test_login('f1000000-0000-4000-8000-000000000003');
  perform public.set_series_credits('@series_one', 2);
  perform public.boks_assert(exists (select 1 from jsonb_array_elements(public.list_series_credits()) x where x ->> 'handle' = 'series_one' and (x ->> 'granted')::integer = 2),
    'Studio lists the grant');
  perform public.boks_assert((public.get_my_series_access() ->> 'allowed')::boolean and (public.spend_series_credit() ->> 'left') is null,
    'Studio needs no grant and spends nothing');

  perform public.boks_test_login('f1000000-0000-4000-8000-000000000001');
  perform public.boks_assert((public.get_my_series_access() ->> 'left')::integer = 2, 'the author sees two left');
  perform public.spend_series_credit();
  perform public.spend_series_credit();
  begin
    perform public.spend_series_credit();
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error like 'No Boks Series left%' and (public.get_my_series_access() ->> 'used')::integer = 2,
    'the last one cannot be spent twice');

  perform public.boks_test_login('f1000000-0000-4000-8000-000000000002');
  perform public.boks_assert((public.get_my_series_access() ->> 'granted')::integer = 0, 'another author''s grant is theirs alone');

  perform public.boks_test_login('f1000000-0000-4000-8000-000000000003');
  begin
    perform public.set_series_credits('series_one', 1);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'They have already made more than that.', 'a grant never drops below what was made');
  perform public.boks_assert(not has_table_privilege('authenticated', 'public.series_credits', 'SELECT')
    and not has_table_privilege('authenticated', 'public.series_credits', 'UPDATE'),
    'series_credits is reached only through its functions');
end $$;
rollback;

-- A recorded Series straight onto the author's page (20261117170000), and the page preview for every author (20261117180000).
begin;
insert into auth.users (id, email, is_anonymous) values
  ('f2000000-0000-4000-8000-000000000001', 'rec1@boks.test', false),
  ('f2000000-0000-4000-8000-000000000002', 'rec2@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('f2000000-0000-4000-8000-000000000001', 'rec_one', 'reader', now(), 'v1'),
  ('f2000000-0000-4000-8000-000000000002', 'rec_two', 'reader', now(), 'v1');
insert into public.reels (id, title, author_name, text, status, author_user_id, submitted_at, reviewed_at)
values ('f2000000-0000-4000-8000-0000000000b2', 'Чужое', 'Второй', 'строка один строка два', 'published', 'f2000000-0000-4000-8000-000000000002', now(), now());
do $$
declare
  v_error text;
  v_result jsonb;
  v_preview jsonb;
begin
  perform public.boks_test_login('f2000000-0000-4000-8000-000000000001');
  begin
    perform public.publish_my_recorded_series(null, 'Т', 'строка', 'AAAAAAAAAAAAAAAAAAAAAA');
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Boks Series are not open to this account.', 'no grant, nothing published');

  insert into public.series_credits (user_id, granted, used) values ('f2000000-0000-4000-8000-000000000001', 3, 1);
  begin
    perform public.publish_my_recorded_series(null, 'Т', 'строка', 'not a token');
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'This Series has no recording to publish.', 'a token must be a link-only folder');

  v_result := public.publish_my_recorded_series(null, 'Записанная', 'первая строка' || chr(10) || 'вторая строка', 'AAAAAAAAAAAAAAAAAAAAAA');
  perform public.boks_assert((select status from public.reels where id = (v_result ->> 'bokId')::uuid) = 'published', 'published at once, no review');
  perform public.boks_assert(exists (select 1 from public.author_spaces s where s.owner_user_id = 'f2000000-0000-4000-8000-000000000001' and s.status = 'published'),
    'an author without a page gets one');
  perform public.boks_assert((public.boks_space_bok_format((select id from public.author_spaces where owner_user_id = 'f2000000-0000-4000-8000-000000000001'), (v_result ->> 'bokId')::uuid) ->> 'seriesPiece') = 'AAAAAAAAAAAAAAAAAAAAAA',
    'the page plays its recording');
  begin
    perform public.publish_my_recorded_series(null, 'Ещё', 'строка', 'BBBBBBBBBBBBBBBBBBBBBB');
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Every Series you made is already on your page.', 'no more on the page than were made');
  perform public.publish_my_recorded_series((v_result ->> 'bokId')::uuid, 'Записанная', 'первая строка', 'CCCCCCCCCCCCCCCCCCCCCC');
  perform public.boks_assert((select series_piece from public.author_space_works where bok_id = (v_result ->> 'bokId')::uuid) = 'CCCCCCCCCCCCCCCCCCCCCC',
    'a kept rebuild replaces it in place');
  begin
    perform public.publish_my_recorded_series('f2000000-0000-4000-8000-0000000000b2', 'Подмена', 'строка', 'DDDDDDDDDDDDDDDDDDDDDD');
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'This Series is not one of yours.' and (select title from public.reels where id = 'f2000000-0000-4000-8000-0000000000b2') = 'Чужое',
    'another author''s bok cannot be overwritten');

  perform public.boks_test_login('f2000000-0000-4000-8000-000000000002');
  v_preview := public.get_author_space_preview(null);
  perform public.boks_assert(v_preview ->> 'access' = 'owner' and jsonb_array_length(v_preview -> 'items') = 1 and v_preview -> 'items' -> 0 ->> 'key' = 'b:f2000000-0000-4000-8000-0000000000b2',
    'an author with no page is previewed from their published boks');
end $$;
rollback;

-- Studio publishes a recording onto an author's page (20261117190000).
begin;
insert into auth.users (id, email, is_anonymous) values
  ('f3000000-0000-4000-8000-000000000001', 'srec-admin@boks.test', false),
  ('f3000000-0000-4000-8000-000000000002', 'srec-author@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('f3000000-0000-4000-8000-000000000001', 'srec_admin', 'admin', now(), 'v1'),
  ('f3000000-0000-4000-8000-000000000002', 'srec_poet', 'reader', now(), 'v1');
insert into public.reels (id, title, author_name, text, status, author_user_id, submitted_at, reviewed_at)
values ('f3000000-0000-4000-8000-0000000000b1', 'Старое', 'Поэт Студийный', 'строка', 'published', 'f3000000-0000-4000-8000-000000000002', now(), now());
do $$
declare
  v_error text;
  v_result jsonb;
begin
  perform public.boks_test_login('f3000000-0000-4000-8000-000000000002');
  begin
    perform public.studio_publish_recorded_series('srec_poet', null, 'Т', 'строка', 'AAAAAAAAAAAAAAAAAAAAAA');
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Only Studio can publish onto another author''s page.', 'only Studio publishes onto another page');

  perform public.boks_test_login('f3000000-0000-4000-8000-000000000001');
  perform public.boks_assert(public.studio_series_author_for('  поэт студийный ') ->> 'handle' = 'srec_poet', 'the byline finds its author');
  perform public.boks_assert(public.studio_series_author_for('Никто Никакой') is null, 'an unknown byline finds nobody');
  begin
    perform public.studio_publish_recorded_series('@nobody_here', null, 'Т', 'строка', 'AAAAAAAAAAAAAAAAAAAAAA');
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'There is no account @nobody_here.', 'an unknown handle is refused');

  v_result := public.studio_publish_recorded_series('@srec_poet', null, 'Записанная студией', 'строка', 'EEEEEEEEEEEEEEEEEEEEEE');
  perform public.boks_assert(v_result ->> 'handle' = 'srec_poet', 'the answer names the page');
  perform public.boks_assert((select author_user_id from public.reels where id = (v_result ->> 'bokId')::uuid) = 'f3000000-0000-4000-8000-000000000002'
    and (select author_name from public.reels where id = (v_result ->> 'bokId')::uuid) = 'Поэт Студийный',
    'it is the author''s bok, under their own name');
  perform public.boks_assert((select series_piece from public.author_space_works where bok_id = (v_result ->> 'bokId')::uuid) = 'EEEEEEEEEEEEEEEEEEEEEE',
    'their page plays Studio''s recording');
  perform public.studio_publish_recorded_series('srec_poet', (v_result ->> 'bokId')::uuid, 'Записанная студией', 'строка', 'FFFFFFFFFFFFFFFFFFFFFF');
  perform public.boks_assert((select series_piece from public.author_space_works where bok_id = (v_result ->> 'bokId')::uuid) = 'FFFFFFFFFFFFFFFFFFFFFF',
    'Studio replaces its own recording in place');

  -- Studio's recording is not the author's to account for.
  perform public.boks_test_login('f3000000-0000-4000-8000-000000000002');
  insert into public.series_credits (user_id, granted, used) values ('f3000000-0000-4000-8000-000000000002', 2, 1);
  v_result := public.publish_my_recorded_series(null, 'Своя', 'строка', 'GGGGGGGGGGGGGGGGGGGGGG');
  perform public.boks_assert(v_result ->> 'bokId' is not null, 'Studio''s publication is not counted against the author''s grant');
end $$;
rollback;

-- Reading facets (20261118120000): labels are checked against the registry,
-- the view merges bok, byline and derived facets, and only admins see coverage.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('f4000000-0000-4000-8000-000000000001', 'facets@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('f4000000-0000-4000-8000-000000000001', 'facets_reader', 'reader', now(), 'v1');
insert into public.reels (id, title, author_name, text, status, author_user_id, submitted_at, reviewed_at)
values ('f4000000-0000-4000-8000-0000000000b1', 'Грустное', 'Поэт Фасетов', E'строка один\nстрока два\nстрока три\nстрока четыре', 'published', 'f4000000-0000-4000-8000-000000000001', now(), now());
do $$
declare
  v_error text;
  v_facets jsonb;
  v_bok uuid := 'f4000000-0000-4000-8000-0000000000b1';
begin
  insert into public.bok_facet_labels (bok_id, facet, facet_values, source, labeler, rubric_version, text_hash)
  select v_bok, 'mood', array['sad', 'think'], 'model', 'test', 1, public.boks_bok_text_hash(title, text)
  from public.reels where id = v_bok;
  insert into public.byline_facet_labels (byline, facet, facet_values, source, labeler, rubric_version)
  values ('Поэт Фасетов', 'author_group', array['contemporary'], 'editor', 'test', 1);

  select facets into v_facets from public.bok_reading_facets where bok_id = v_bok;
  perform public.boks_assert(v_facets -> 'mood' = '["sad", "think"]'::jsonb, 'a bok carries its mood in order');
  perform public.boks_assert(v_facets -> 'author_group' = '["contemporary"]'::jsonb, 'a bok carries its byline''s group');
  perform public.boks_assert(v_facets ? 'format', 'a bok with a known shape has a format');
  perform public.boks_assert(v_facets -> 'mood' ?| array['sad'] and not (v_facets -> 'mood' ?| array['fun']), 'a request matches by shared value');

  begin
    insert into public.bok_facet_labels (bok_id, facet, facet_values, source, labeler, rubric_version)
    values (v_bok, 'author_group', array['classics'], 'model', 'test', 1);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Facet author_group is not labelled per bok.', 'a byline facet is refused on a bok');
  begin
    update public.bok_facet_labels set facet_values = array['sad', 'angry'] where bok_id = v_bok;
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Facet mood has no value angry.', 'an unknown value is refused');
  begin
    update public.bok_facet_labels set facet_values = array['sad', 'sad'] where bok_id = v_bok;
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Facet mood lists a value twice.', 'a repeated value is refused');
  begin
    update public.byline_facet_labels set facet_values = array['classics', 'contemporary'] where byline = 'Поэт Фасетов';
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Facet author_group takes one value.', 'a single-valued facet holds one value');
  begin
    insert into public.bok_facet_labels (bok_id, facet, facet_values, source, labeler, rubric_version)
    values (v_bok, 'format', array['prose'], 'editor', 'test', 1);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Facet format is not labelled per bok.', 'a derived facet is never labelled');

  update public.reels set text = text || E'\nстрока пять' where id = v_bok;
  perform public.boks_test_login('f4000000-0000-4000-8000-000000000001');
  begin
    perform public.get_reading_facet_coverage();
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Only an admin can read facet coverage.', 'a reader cannot read coverage');
end $$;

set local role anon;
do $$
declare v_error text;
begin
  begin
    perform 1 from public.bok_facet_labels limit 1;
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error like 'permission denied%', 'anon cannot read labels');
  v_error := null;
  begin
    perform 1 from public.bok_reading_facets limit 1;
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error like 'permission denied%', 'anon cannot read the facets view');
end $$;
reset role;
rollback;

-- Reading requests (20261118130000): strict facets filter retrieval, the
-- preferred one only orders it, the bok on screen is excluded, availability
-- answers "none", and a served feed keeps the request it was served under.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('f5000000-0000-4000-8000-000000000001', 'request@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('f5000000-0000-4000-8000-000000000001', 'request_reader', 'reader', now(), 'v1');
insert into public.reels (id, title, author_name, text, status, author_user_id, submitted_at, reviewed_at) values
  ('f5000000-0000-4000-8000-0000000000a1', 'Стих грустный', 'Поэт Запросов', E'строка один\nстрока два\nстрока три\nстрока четыре\nстрока пять\nстрока шесть', 'published', 'f5000000-0000-4000-8000-000000000001', now(), now()),
  ('f5000000-0000-4000-8000-0000000000a2', 'Стих весёлый', 'Поэт Запросов', E'строка раз\nстрока два\nстрока три\nстрока четыре\nстрока пять\nстрока шесть', 'published', 'f5000000-0000-4000-8000-000000000001', now(), now());
insert into public.bok_facet_labels (bok_id, facet, facet_values, source, labeler, rubric_version) values
  ('f5000000-0000-4000-8000-0000000000a1', 'mood', array['sad'], 'editor', 'test', 1),
  ('f5000000-0000-4000-8000-0000000000a2', 'mood', array['fun'], 'editor', 'test', 1);
insert into public.byline_facet_labels (byline, facet, facet_values, source, labeler, rubric_version) values
  ('Поэт Запросов', 'author_group', array['contemporary'], 'editor', 'test', 1);
do $$
declare
  v_ids text[];
  v_error text;
  v_feed uuid;
  v_ours text[] := array['f5000000-0000-4000-8000-0000000000a1', 'f5000000-0000-4000-8000-0000000000a2'];
begin
  perform public.boks_test_login('f5000000-0000-4000-8000-000000000001');
  select array_agg(c ->> 'id') into v_ids
  from jsonb_array_elements(public.get_recommendation_candidates(400, null, '{"author_group": ["contemporary"]}'::jsonb)) c;
  perform public.boks_assert(v_ids @> v_ours, 'a strict facet keeps the boks that carry it');
  perform public.boks_assert(not exists (
    select 1 from jsonb_array_elements(public.get_recommendation_candidates(400, null, '{"author_group": ["contemporary"]}'::jsonb)) c
    where not (c -> 'facets' -> 'author_group' ? 'contemporary')
  ), 'a strict facet keeps nothing else, unlabelled included');
  select array_agg(c ->> 'id') into v_ids
  from jsonb_array_elements(public.get_recommendation_candidates(400, null, '{"author_group": ["contemporary"]}'::jsonb, '{"mood": ["sad"]}'::jsonb, 'f5000000-0000-4000-8000-0000000000a1')) c;
  perform public.boks_assert(not ('f5000000-0000-4000-8000-0000000000a1' = any (v_ids)), 'the bok on screen is excluded');
  perform public.boks_assert('f5000000-0000-4000-8000-0000000000a2' = any (v_ids), 'a preferred mood never removes a bok');
  perform public.boks_assert(
    (select c -> 'facets' -> 'mood' from jsonb_array_elements(public.get_recommendation_candidates(400)) c
     where c ->> 'id' = 'f5000000-0000-4000-8000-0000000000a2') = '["fun"]'::jsonb,
    'the old two-argument call still answers, now with facets');

  perform public.boks_assert(public.count_reading_request_matches(null, '{"author_group": ["contemporary"], "format": ["poetry"]}'::jsonb) >= 2, 'availability counts matches');
  perform public.boks_assert(public.count_reading_request_matches(null, '{"author_group": ["contemporary"], "format": ["prose"]}'::jsonb) = 0, 'availability says none');
  begin
    perform public.count_reading_request_matches(null, '{"genre": ["poem"]}'::jsonb);
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'The reading request facet genre is not valid.', 'an unknown facet is refused, not ignored');

  v_feed := public.record_served_feed(
    '{"sessionId": "s", "experimentKey": "k", "algorithmId": "recency", "readingRequest": {"mood": "sad", "format": "poetry", "authorGroups": []}}'::jsonb,
    '[]'::jsonb);
  perform public.boks_assert((select reading_request ->> 'mood' from public.served_feed where id = v_feed) = 'sad', 'a served feed keeps its reading request');
end $$;
rollback;

-- Series recorder (20261118140000): `ownName` is the caller's own name only.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('f6000000-0000-4000-8000-000000000001', 'own@boks.test', false),
  ('f6000000-0000-4000-8000-000000000002', 'catalogue@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('f6000000-0000-4000-8000-000000000001', 'own_poet', 'admin', now(), 'v1'),
  ('f6000000-0000-4000-8000-000000000002', 'own_catalogue', 'admin', now(), 'v1');
insert into public.reels (id, title, author_name, text, status, author_user_id, submitted_at, reviewed_at) values
  ('f6000000-0000-4000-8000-0000000000a1', 'Своё', 'Поэт Свой', 'строка', 'published', 'f6000000-0000-4000-8000-000000000001', now(), now()),
  ('f6000000-0000-4000-8000-0000000000a2', 'Чужое один', 'Классик Первый', 'строка', 'published', 'f6000000-0000-4000-8000-000000000002', now(), now()),
  ('f6000000-0000-4000-8000-0000000000a3', 'Чужое два', 'Классик Второй', 'строка', 'published', 'f6000000-0000-4000-8000-000000000002', now() + interval '1 minute', now());
do $$
begin
  perform public.boks_test_login('f6000000-0000-4000-8000-000000000001');
  perform public.boks_assert(public.get_my_series_access() ->> 'ownName' = 'Поэт Свой', 'one byline of one''s own is one''s own name');
  perform public.boks_test_login('f6000000-0000-4000-8000-000000000002');
  perform public.boks_assert(public.get_my_series_access() ->> 'ownName' is null, 'a catalogue''s bylines are no one''s own name');
  perform public.boks_assert(public.get_my_series_access() ->> 'authorName' is not null, 'authorName is unchanged');
end $$;
rollback;

-- Special projects: tokens of link-only pieces, readable by an admin only.
begin;
insert into public.boks_special_projects (project, title, author, token) values
  ('Проверка', 'Пьеса', 'Автор', 'AAAAAAAAAAAAAAAAAAAAAA');
do $$
declare
  v_rows jsonb;
begin
  perform public.boks_test_login('33333333-3333-4333-8333-333333333333');
  set local role authenticated;
  begin
    perform public.boks_admin_special_projects();
    perform public.boks_assert(false, 'a reader cannot list special projects');
  exception when sqlstate '42501' then
    perform public.boks_assert(true, 'a reader cannot list special projects');
  end;
  begin
    perform 1 from public.boks_special_projects;
    perform public.boks_assert(false, 'a reader cannot read special project tokens');
  exception when insufficient_privilege then
    perform public.boks_assert(true, 'a reader cannot read special project tokens');
  end;
  reset role;
  perform public.boks_test_login('22222222-2222-4222-8222-222222222222');
  set local role authenticated;
  v_rows := public.boks_admin_special_projects();
  perform public.boks_assert(v_rows -> 0 ->> 'token' = 'AAAAAAAAAAAAAAAAAAAAAA', 'an admin lists special projects with their links');
  reset role;
end $$;
rollback;

-- An author's own Series section (20261118170000): nothing on the shelf until
-- the owner publishes; then their Series in their order; hiding takes one off.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('5e5e0000-0000-4000-8000-000000000001', 'shelf-editor@boks.test', false),
  ('5e5e0000-0000-4000-8000-000000000002', 'shelf-poet@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('5e5e0000-0000-4000-8000-000000000001', 'shelf_editor', 'admin', now(), 'v1'),
  ('5e5e0000-0000-4000-8000-000000000002', 'shelf_mail', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_id uuid;
  v_one uuid;
  v_two uuid;
  v_token text;
  v_shelf jsonb;
  v_answer jsonb;
  v_bok uuid;
  v_error text;
begin
  perform public.boks_test_login('5e5e0000-0000-4000-8000-000000000001');
  v_id := (public.studio_save_author_space(null, 'author', 'Поэт Полки', 'shelf_poet', null, 0) ->> 'id')::uuid;
  -- Pages opened by other checks go onto the shelf too (20261124160000): this block looks at its own page only.
  update public.author_spaces set series_shelf = false where id <> v_id;
  perform public.studio_save_space_work(v_id, null, 'Первая', 'Первая строка.', 'text', null);
  perform public.studio_save_space_work(v_id, null, 'Вторая', 'Вторая строка.', 'text', null);
  v_one := (select id from public.author_space_works where space_id = v_id and title = 'Первая');
  v_two := (select id from public.author_space_works where space_id = v_id and title = 'Вторая');
  perform public.studio_set_space_work_series(v_one, 'AAAAAAAAAAAAAAAAAAAAAA', false);
  perform public.studio_set_space_work_series(v_two, 'BBBBBBBBBBBBBBBBBBBBBB', false);
  perform public.studio_set_space_work_status(v_one, 'ready', 'проверено');
  perform public.studio_set_space_work_status(v_two, 'ready', 'проверено');
  update public.author_spaces set series_shelf = true where id = v_id;
  update public.author_space_works set series_card = '{"seconds": 120, "scenes": 9}' where id = v_one;
  begin
    update public.author_space_works set series_card = '{"seconds": "long"}' where id = v_two;
    perform public.boks_assert(false, 'a card''s length is a number');
  exception when check_violation then
    perform public.boks_assert(true, 'a card''s length is a number');
  end;
  v_token := public.studio_issue_author_invite(v_id, 'shelf-poet@boks.test') ->> 'token';

  update public.author_spaces set invite_greeting = 'Уважаемый Поэт Полкович' where id = v_id;
  perform public.boks_test_logout();
  perform public.boks_assert(jsonb_array_length(public.get_boks_series_shelf_authors()) = 0, 'a closed page puts nothing on the shelf');
  perform public.boks_assert(public.author_invite_greeting(v_token) = 'Уважаемый Поэт Полкович', 'the link greets the author before sign-in');
  perform public.boks_assert(public.author_invite_greeting('not-a-token') is null, 'a wrong link greets nobody');

  perform public.boks_test_login('5e5e0000-0000-4000-8000-000000000002');
  perform public.note_author_invite_opened(v_token, null);
  perform public.boks_assert((select opened_at from public.author_space_invites where space_id = v_id) is not null, 'opening the invitation is noted for the team');
  perform public.boks_assert(public.accept_author_invite(v_token) ->> 'state' = 'accepted', 'the poet accepts the page');
  perform public.boks_assert(public.my_author_space_on_series_shelf(), 'the cabinet knows the Series go onto the shelf');
  perform public.boks_assert(public.author_invite_greeting(v_token) is null, 'a used link greets nobody');
  perform public.boks_assert(jsonb_array_length(public.get_boks_series_shelf_authors()) = 0, 'an accepted page still puts nothing on the shelf');

  -- The poet publishes only the second one: only it reaches the shelf.
  v_answer := public.publish_my_author_space(jsonb_build_array(jsonb_build_object('workId', v_two, 'revision', (select revision from public.author_space_works where id = v_two))), true, 'test-terms', gen_random_uuid());
  perform public.boks_test_logout();
  v_shelf := public.get_boks_series_shelf_authors();
  perform public.boks_assert(jsonb_array_length(v_shelf) = 1 and v_shelf -> 0 ->> 'handle' = 'shelf_poet' and v_shelf -> 0 ->> 'name' = 'Поэт Полки', 'publishing puts the section on the shelf at once');
  perform public.boks_assert(jsonb_array_length(v_shelf -> 0 -> 'pieces') = 1 and v_shelf -> 0 -> 'pieces' -> 0 ->> 'token' = 'BBBBBBBBBBBBBBBBBBBBBB', 'only what was published, never the unpublished token');
  perform public.boks_assert(public.get_boks_bok_series_piece((select bok_id from public.author_space_works where id = v_two)) = 'BBBBBBBBBBBBBBBBBBBBBB', 'a published bok names its Series folder for its link card');
  perform public.boks_assert((select bok_id from public.author_space_works where id = v_one) is null, 'an unpublished work has no bok to name');

  perform public.boks_test_login('5e5e0000-0000-4000-8000-000000000002');
  v_answer := public.publish_my_author_space(jsonb_build_array(jsonb_build_object('workId', v_one, 'revision', (select revision from public.author_space_works where id = v_one))), false, 'test-terms', gen_random_uuid());
  v_bok := (select bok_id from public.author_space_works where id = v_one);
  -- The poet puts the first one first.
  perform public.save_author_space_order(v_id, array['b:' || v_bok::text, 'b:' || (select bok_id from public.author_space_works where id = v_two)::text], (select order_version from public.author_spaces where id = v_id));
  perform public.boks_test_logout();
  v_shelf := public.get_boks_series_shelf_authors();
  perform public.boks_assert(v_shelf -> 0 -> 'pieces' -> 0 ->> 'title' = 'Первая' and v_shelf -> 0 -> 'pieces' -> 1 ->> 'title' = 'Вторая', 'the shelf keeps the order the poet gave the page');
  perform public.boks_assert((v_shelf -> 0 -> 'pieces' -> 0 -> 'card' ->> 'seconds')::integer = 120, 'the card the team wrote comes along');

  perform public.boks_test_login('5e5e0000-0000-4000-8000-000000000002');
  perform public.withdraw_my_bok(v_bok);
  perform public.boks_test_logout();
  v_shelf := public.get_boks_series_shelf_authors();
  perform public.boks_assert(jsonb_array_length(v_shelf -> 0 -> 'pieces') = 1 and v_shelf -> 0 -> 'pieces' -> 0 ->> 'title' = 'Вторая', 'a hidden work leaves the shelf at once');

  update public.author_spaces set series_shelf = false where id = v_id;
  perform public.boks_assert(jsonb_array_length(public.get_boks_series_shelf_authors()) = 0, 'a page not marked for the shelf stays off it');
end $$;
rollback;

-- The documents for authors (20261123095000, 20261123096000): anyone reads
-- the editions in force and each edition by its date; an edition is frozen.
begin;
do $$
declare
  v_doc jsonb;
  v_list jsonb;
  v_error text;
begin
  perform public.boks_test_logout();
  v_list := public.get_boks_legal_documents();
  perform public.boks_assert(jsonb_array_length(v_list) = 3 and v_list -> 0 ->> 'kind' = 'author_offer', 'the three documents are listed, the offer first');
  v_doc := public.get_boks_legal_document('author_offer');
  perform public.boks_assert(v_doc ->> 'body' like '# Оферта%' and (v_doc ->> 'current')::boolean and char_length(v_doc ->> 'sha256') = 64, 'a guest reads the offer in force with its checksum');
  perform public.boks_assert(public.get_boks_legal_document('author_offer', v_doc ->> 'version') ->> 'sha256' = v_doc ->> 'sha256', 'an edition opens by its date');
  perform public.boks_assert(public.get_boks_legal_document('author_offer', '2000-01-01') is null and public.get_boks_legal_document('nope') is null, 'an unknown edition or document is nothing');
  begin
    update public.boks_legal_documents set body = body || ' ' where kind = 'author_offer';
    perform public.boks_assert(false, 'a published edition is not changed');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'A published edition is not changed%', 'a published edition is frozen: ' || v_error);
  end;
  perform public.boks_assert(not has_table_privilege('anon', 'public.boks_legal_documents', 'SELECT'), 'the table itself is not open');
end $$;
rollback;

-- The author contract online (20261123100000): an invitation with a plan is
-- accepted only with the offer and both consents in force and a full name;
-- the contract gets its number and the request's address; nothing of the
-- author's opens to readers until the team marks the payment.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f0000-0000-4000-8000-000000000001', 'offer-editor@boks.test', false),
  ('0f0f0000-0000-4000-8000-000000000002', 'offer-poet@boks.test', false),
  ('0f0f0000-0000-4000-8000-000000000003', 'offer-other@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f0000-0000-4000-8000-000000000001', 'offer_editor', 'admin', now(), 'v1'),
  ('0f0f0000-0000-4000-8000-000000000002', 'offer_mail', 'reader', now(), 'v1'),
  ('0f0f0000-0000-4000-8000-000000000003', 'offer_other', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_id uuid;
  v_token text;
  v_terms jsonb;
  v_answer jsonb;
  v_agreement jsonb;
  v_ok jsonb := jsonb_build_object('legalName', 'Поэтова  Анна Сергеевна');
  v_error text;
  v_bok uuid;
begin
  select v_ok || jsonb_object_agg(d.kind, d.version) into v_ok
  from (values ('author_offer'), ('author_pd_processing'), ('author_pd_distribution')) k(kind)
  cross join lateral public.boks_legal_current(k.kind) d;
  perform public.boks_assert(v_ok ? 'author_offer' and v_ok ? 'author_pd_distribution', 'the offer and both consents are published');

  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000001');
  v_id := (public.studio_save_author_space(null, 'author', 'Поэт Оферты', 'offer_poet', null, 0) ->> 'id')::uuid;
  v_token := public.studio_issue_author_invite(v_id, 'offer-poet@boks.test', 'page', 'Поэтова Анна') ->> 'token';

  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000003');
  perform public.boks_assert(public.get_author_invite_terms(v_token) is null, 'another address is not shown the terms');

  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000002');
  v_terms := public.get_author_invite_terms(v_token);
  perform public.boks_assert(v_terms ->> 'plan' = 'page' and (v_terms ->> 'priceRub')::integer = 30000 and jsonb_array_length(v_terms -> 'documents') = 3 and v_terms ->> 'legalName' = 'Поэтова Анна', 'the invitation shows its plan, price, documents and the name the team wrote');
  begin
    perform public.accept_author_invite(v_token);
    perform public.boks_assert(false, 'an invitation with a plan is not accepted bare');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error = 'Accept the offer and the consents first.', 'the bare acceptance is refused: ' || v_error);
  end;
  begin
    perform public.accept_author_invite_with_terms(v_token, null, v_ok || '{"author_pd_processing": "2000-01-01"}');
    perform public.boks_assert(false, 'an old edition is not accepted');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'The terms have changed%', 'an old edition is refused: ' || v_error);
  end;
  begin
    perform public.accept_author_invite_with_terms(v_token, null, v_ok || '{"legalName": "Анна"}');
    perform public.boks_assert(false, 'a first name alone is not a full name');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Write your full name%', 'a first name alone is refused: ' || v_error);
  end;
  perform public.boks_assert((select accepted_at from public.author_space_invites where space_id = v_id and revoked_at is null) is null, 'refused attempts bind nothing');

  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.2", "user-agent": "CheckBrowser/1"}', true);
  v_answer := public.accept_author_invite_with_terms(v_token, null, v_ok);
  perform public.boks_assert(v_answer ->> 'state' = 'accepted' and v_answer -> 'agreement' ->> 'number' ~ '^[0-9]{4}/[0-9]{3}$', 'accepting makes a numbered contract');
  v_agreement := public.get_my_author_agreement();
  perform public.boks_assert(v_agreement ->> 'payState' = 'awaiting' and v_agreement ->> 'legalName' = 'Поэтова Анна Сергеевна' and v_agreement ->> 'payDue' is not null, 'the contract waits for payment, with the name as typed and a due day');
  perform public.boks_assert((select accepted_ip = '203.0.113.9' and accepted_agent = 'CheckBrowser/1' from public.author_agreements where id = (v_agreement ->> 'id')::uuid), 'the address and the browser of the acceptance are kept');
  begin
    perform public.accept_author_invite_with_terms(v_token, null, v_ok);
  exception when others then null;
  end;
  perform public.boks_assert((select count(*) from public.author_agreements where user_id = '0f0f0000-0000-4000-8000-000000000002') = 1, 'accepting twice makes no second contract');

  begin
    perform public.publish_my_author_space('[]'::jsonb, true, 'test-terms', gen_random_uuid());
    perform public.boks_assert(false, 'the page does not open before payment');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error = 'Your page opens to readers once the payment has come.', 'the page is held until payment: ' || v_error);
  end;
  insert into public.reels (id, title, text, status, author_user_id, author_name)
  values (gen_random_uuid(), 'Проба', 'Первая строка и вторая строка.', 'draft', '0f0f0000-0000-4000-8000-000000000002', 'Поэт')
  returning id into v_bok;
  begin
    update public.reels set status = 'published' where id = v_bok;
    perform public.boks_assert(false, 'a bok does not open before payment');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error = 'Your page opens to readers once the payment has come.', 'a bok is held until payment: ' || v_error);
  end;

  v_agreement := public.report_my_author_payment();
  perform public.boks_assert(v_agreement ->> 'payState' = 'reported', '«Я оплатил(а)» tells the team');

  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000003');
  begin
    perform public.studio_mark_author_payment((v_agreement ->> 'id')::uuid, current_date, 30000);
    perform public.boks_assert(false, 'a reader cannot mark a payment');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error not like 'This contract%', 'a reader is refused marking a payment: ' || v_error);
  end;
  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000001');
  v_agreement := public.studio_mark_author_payment((v_agreement ->> 'id')::uuid, (now() at time zone 'Europe/Moscow')::date, 30000, 'https://lknpd.nalog.ru/api/v1/receipt/1/print');
  perform public.boks_assert(v_agreement ->> 'payState' = 'paid' and (v_agreement ->> 'periodEnd')::date = (v_agreement ->> 'periodStart')::date + interval '1 year' - interval '1 day', 'the year runs from the day the money came');

  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000002');
  v_answer := public.publish_my_author_space('[]'::jsonb, true, 'test-terms', gen_random_uuid());
  perform public.boks_assert((v_answer ->> 'pagePublished')::boolean, 'once paid the author opens the page');
  perform public.boks_assert(public.get_my_author_agreement() -> 'payment' is null, 'a paid contract shows no payment details');

  -- An invitation without a plan works as before.
  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000001');
  v_id := (public.studio_save_author_space(null, 'author', 'Особый Проект', 'offer_special', null, 0) ->> 'id')::uuid;
  v_token := public.studio_issue_author_invite(v_id, 'offer-other@boks.test') ->> 'token';
  perform public.boks_test_login('0f0f0000-0000-4000-8000-000000000003');
  perform public.boks_assert(public.get_author_invite_terms(v_token) is null and public.accept_author_invite(v_token) ->> 'state' = 'accepted', 'an invitation without a plan needs no offer');
  perform public.boks_assert(public.get_my_author_agreement() is null, 'and makes no contract');

  begin
    update public.boks_legal_documents set body = body || ' ' where kind = 'author_offer';
    perform public.boks_assert(false, 'a published edition is not changed');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'A published edition is not changed%', 'a published edition is frozen: ' || v_error);
  end;
  perform public.boks_test_logout();
  perform public.boks_assert(public.get_boks_legal_document('author_offer') ->> 'version' = v_ok ->> 'author_offer', 'anyone reads the offer in force');
end $$;
rollback;

-- The way in for a paid author (20261123180000): the team's texts and
-- recordings wait on the page and become the author's drafts on acceptance
-- (after the site's terms); an account with a page of its own gets the
-- Workshop too; no Series work starts before the payment.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f1000-0000-4000-8000-000000000001', 'way-editor@boks.test', false),
  ('0f0f1000-0000-4000-8000-000000000002', 'way-new@boks.test', false),
  ('0f0f1000-0000-4000-8000-000000000003', 'way-old@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f1000-0000-4000-8000-000000000001', 'way_editor', 'admin', now(), 'v1'),
  ('0f0f1000-0000-4000-8000-000000000002', 'way_new', 'reader', null, null),
  ('0f0f1000-0000-4000-8000-000000000003', 'way_old', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
insert into public.author_spaces (kind, status, owner_user_id, name, created_by, published_at)
values ('author', 'published', '0f0f1000-0000-4000-8000-000000000003', 'Своя Страница', '0f0f1000-0000-4000-8000-000000000003', now());
do $$
declare
  v_editor uuid := '0f0f1000-0000-4000-8000-000000000001';
  v_new uuid := '0f0f1000-0000-4000-8000-000000000002';
  v_old uuid := '0f0f1000-0000-4000-8000-000000000003';
  v_space uuid;
  v_seed jsonb;
  v_seeds uuid[] := '{}';
  v_token text;
  v_answer jsonb;
  v_error text;
  v_terms jsonb := jsonb_build_object(
    'legalName', 'Путина Анна Сергеевна',
    'author_offer', (public.boks_legal_current('author_offer')).version,
    'author_pd_processing', (public.boks_legal_current('author_pd_processing')).version,
    'author_pd_distribution', (public.boks_legal_current('author_pd_distribution')).version);
begin
  perform public.boks_test_login(v_editor);
  v_space := (public.studio_save_author_space(null, 'author', 'Анна Путь', 'way_anna', null, 0) ->> 'id')::uuid;
  for i in 1..3 loop
    v_seed := public.studio_save_space_seed(v_space, null, 'Текст ' || i, 'Строка ' || i || E'\nи ещё строка', case when i = 3 then 'prose' else 'poem' end);
    v_seeds := v_seeds || (v_seed ->> 'id')::uuid;
  end loop;
  for i in 1..2 loop
    v_seed := public.studio_set_space_seed_voice(v_seeds[i], jsonb_build_object('file', 'take-1.mp3', 'durationMs', 61000, 'source', 'upload',
      'fingerprint', public.boks_voice_fingerprint('Строка ' || i || E'\nи ещё строка')));
  end loop;
  perform public.boks_assert((v_seed ->> 'voiceCurrent')::boolean and v_seed ->> 'handedAt' is null, 'a team recording waits on its text');
  v_token := public.studio_issue_author_invite(v_space, 'way-new@boks.test', 'page', 'Путина Анна Сергеевна') ->> 'token';

  perform public.boks_test_login(v_new);
  v_answer := public.accept_author_invite_with_terms(v_token, null, v_terms);
  perform public.boks_assert(v_answer ->> 'state' = 'accepted', 'a new author accepts the invitation with the offer');
  perform public.boks_assert(not (v_answer -> 'agreement' ? 'receiptUrl'), 'the author is not shown a receipt link');
  perform public.boks_assert((select count(*) from public.reels where author_user_id = v_new) = 0, 'before the site''s terms the texts wait with the page');
  update public.user_profiles set terms_accepted_at = now(), terms_version = 'v1' where user_id = v_new;
  perform public.boks_assert((select count(*) from public.reels where author_user_id = v_new and status = 'draft') = 3, 'with the terms the three texts are the author''s drafts');
  perform public.boks_assert((select count(*) from public.bok_voices where user_id = v_new) = 2, 'two of them come with the author''s recording');
  perform public.boks_assert((select form from public.bok_workshop where bok_id = v_seeds[3]) = 'prose', 'the form comes along');
  perform public.boks_assert(
    (select count(*) from jsonb_array_elements(public.get_my_workshop() -> 'pieces') p where (p -> 'voice' ->> 'current')::boolean) = 2,
    'the Workshop shows both recordings as current');
  perform public.save_my_bok(v_seeds[1], 'Текст 1', E'Строка 1\nи ещё строка', true, null, true);

  perform public.boks_test_login(v_editor);
  begin
    perform public.studio_accept_bok(v_seeds[1]);
    perform public.boks_assert(false, 'no Series work before the payment');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'The author has not paid yet%', 'no Series work before the payment: ' || v_error);
  end;
  perform public.boks_assert(public.studio_unpaid_authors() @> jsonb_build_array(jsonb_build_object('userId', v_new::text)), 'Moderation knows the author still has to pay');
  begin
    perform public.studio_save_space_seed(v_space, v_seeds[2], 'x', 'y', 'poem');
    perform public.boks_assert(false, 'a handed text is the author''s');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'The author has this text already%', 'a handed text is the author''s: ' || v_error);
  end;
  perform public.studio_mark_author_payment((select id from public.author_agreements where user_id = v_new), (now() at time zone 'Europe/Moscow')::date, 30000);
  perform public.boks_assert(public.studio_accept_bok(v_seeds[1]) ->> 'state' = 'accepted', 'after the payment the piece goes into work');
  v_seed := public.studio_save_space_seed(v_space, null, 'Поздний', 'Поздний текст', 'poem');
  perform public.boks_assert(v_seed ->> 'bokStatus' = 'draft', 'a text added once the page has its author goes to them at once');
  v_seed := public.studio_set_space_seed_voice((v_seed ->> 'id')::uuid, jsonb_build_object('file', 'take-1.m4a', 'durationMs', 30000, 'source', 'upload',
    'fingerprint', public.boks_voice_fingerprint('Поздний текст')));
  perform public.boks_assert((select user_id from public.bok_voices where bok_id = (v_seed ->> 'id')::uuid) = v_new, 'and its recording is the author''s');

  -- An account with a page of its own, never verified.
  v_space := (public.studio_save_author_space(null, 'author', 'Беата Путь', 'way_bea', null, 0) ->> 'id')::uuid;
  perform public.studio_save_space_seed(v_space, null, 'Её текст', 'Её строка', 'poem');
  v_token := public.studio_issue_author_invite(v_space, 'way-old@boks.test', 'page', 'Путь Беата Ивановна') ->> 'token';
  perform public.boks_test_login(v_old);
  perform public.boks_assert(not public.boks_publishes_directly(v_old), 'an own page is not verified');
  v_answer := public.accept_author_invite_with_terms(v_token, null, v_terms || jsonb_build_object('legalName', 'Путь Беата Ивановна'));
  perform public.boks_assert((v_answer ->> 'existingPage')::boolean and public.boks_publishes_directly(v_old), 'after the invitation the own page opens the Workshop');
  perform public.boks_assert(jsonb_array_length(public.get_my_workshop() -> 'pieces') = 1, 'with the team''s text in it');
  perform public.boks_test_logout();
end $$;
rollback;

-- Who pays (20261123190000): our authors (partners, special projects, all
-- from before) have no payment step and no yearly limit; a paid tariff makes
-- an author paid; the team switches either way in Studio.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f2000-0000-4000-8000-000000000001', 'pays-editor@boks.test', false),
  ('0f0f2000-0000-4000-8000-000000000002', 'pays-partner@boks.test', false),
  ('0f0f2000-0000-4000-8000-000000000003', 'pays-paid@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f2000-0000-4000-8000-000000000001', 'pays_editor', 'admin', now(), 'v1'),
  ('0f0f2000-0000-4000-8000-000000000002', 'pays_partner', 'reader', now(), 'v1'),
  ('0f0f2000-0000-4000-8000-000000000003', 'pays_paid', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_editor uuid := '0f0f2000-0000-4000-8000-000000000001';
  v_partner uuid := '0f0f2000-0000-4000-8000-000000000002';
  v_paid uuid := '0f0f2000-0000-4000-8000-000000000003';
  v_space uuid;
  v_paid_space uuid;
  v_seed jsonb;
  v_bok uuid;
  v_paid_bok uuid;
  v_token text;
  v_answer jsonb;
  v_error text;
  v_terms jsonb := jsonb_build_object(
    'legalName', 'Платная Анна Сергеевна',
    'author_offer', (public.boks_legal_current('author_offer')).version,
    'author_pd_processing', (public.boks_legal_current('author_pd_processing')).version,
    'author_pd_distribution', (public.boks_legal_current('author_pd_distribution')).version);
begin
  perform public.boks_assert(
    (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'author_spaces' and column_name = 'billing') like '''partner''%',
    'an author page is ours unless the team says otherwise');

  -- A partner: invitation without a tariff, a text with a recording, Series work at once.
  perform public.boks_test_login(v_editor);
  v_space := (public.studio_save_author_space(null, 'author', 'Партнёр Путь', 'pays_partner_page', null, 0) ->> 'id')::uuid;
  v_seed := public.studio_save_space_seed(v_space, null, 'Партнёрский', 'Строка партнёра', 'poem');
  v_bok := (v_seed ->> 'id')::uuid;
  perform public.studio_set_space_seed_voice(v_bok, jsonb_build_object('file', 'take-1.mp3', 'durationMs', 9000, 'source', 'upload',
    'fingerprint', public.boks_voice_fingerprint('Строка партнёра')));
  v_token := public.studio_issue_author_invite(v_space, 'pays-partner@boks.test') ->> 'token';
  perform public.boks_test_login(v_partner);
  perform public.boks_assert(public.accept_author_invite(v_token) ->> 'state' = 'accepted', 'a partner accepts an invitation without an offer');
  perform public.boks_assert((select billing from public.author_spaces where id = v_space) = 'partner' and public.get_my_author_agreement() is null, 'a partner is ours, with no contract');
  perform public.boks_assert(public.get_my_workshop() -> 'plan' -> 'perYear' = 'null'::jsonb and public.get_my_workshop() -> 'author' ->> 'billing' = 'partner', 'a partner has no yearly limit in the Workshop');
  perform public.save_my_bok(v_bok, 'Партнёрский', 'Строка партнёра', true, null, true);
  perform public.boks_test_login(v_editor);
  perform public.boks_assert(public.studio_accept_bok(v_bok) ->> 'state' = 'accepted', 'a partner''s piece goes into work with no payment');
  begin
    perform public.studio_set_space_billing(v_space, 'paid');
    perform public.boks_assert(false, 'a partner without a contract cannot be made paid');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'A paid author needs a contract%', 'a partner without a contract cannot be made paid: ' || v_error);
  end;

  -- A paid author: the tariff makes the page paid; the team waives and asks again.
  v_paid_space := (public.studio_save_author_space(null, 'author', 'Платная Путь', 'pays_paid_page', null, 0) ->> 'id')::uuid;
  v_seed := public.studio_save_space_seed(v_paid_space, null, 'Платный', 'Строка платная', 'poem');
  v_paid_bok := (v_seed ->> 'id')::uuid;
  perform public.studio_set_space_seed_voice(v_paid_bok, jsonb_build_object('file', 'take-1.mp3', 'durationMs', 9000, 'source', 'upload',
    'fingerprint', public.boks_voice_fingerprint('Строка платная')));
  -- Promised 30 a year before the tariff became 12 (2026-11-27): the invitation carries it.
  v_token := public.studio_issue_author_invite(v_paid_space, 'pays-paid@boks.test', 'page', null, 30) ->> 'token';
  perform public.boks_test_login(v_paid);
  perform public.accept_author_invite_with_terms(v_token, null, v_terms);
  perform public.boks_assert((select billing from public.author_spaces where id = v_paid_space) = 'paid', 'a paid tariff makes the author paid');
  perform public.boks_assert((public.get_my_workshop() -> 'plan' ->> 'perYear')::integer = 30, 'a paid author keeps the yearly number the invitation promised');
  perform public.save_my_bok(v_paid_bok, 'Платный', 'Строка платная', true, null, true);

  perform public.boks_test_login(v_editor);
  perform public.boks_assert(public.studio_set_space_billing(v_paid_space, 'partner') ->> 'billing' = 'partner', 'the team makes a paid author ours');
  perform public.boks_assert((select pay_state from public.author_agreements where user_id = v_paid) = 'waived' and not public.boks_author_unpaid(v_paid), 'and the contract''s payment is waived');
  perform public.boks_assert(public.studio_accept_bok(v_paid_bok) ->> 'state' = 'accepted', 'so their piece goes into work');
  perform public.boks_test_login(v_paid);
  perform public.boks_assert(public.get_my_author_agreement() ->> 'payState' = 'waived' and public.get_my_author_agreement() -> 'payment' is null, 'the author is not asked to pay');
  perform public.boks_test_login(v_editor);
  perform public.studio_set_space_billing(v_paid_space, 'paid');
  perform public.boks_assert((select pay_state = 'awaiting' and pay_due > current_date from public.author_agreements where user_id = v_paid), 'switching back asks for the payment again');
  perform public.boks_assert(public.boks_author_unpaid(v_paid), 'and holds the author until it comes');

  perform public.boks_test_login(v_partner);
  begin
    perform public.studio_set_space_billing(v_space, 'partner');
    perform public.boks_assert(false, 'an author cannot set their own terms');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error not like 'A paid author%', 'an author cannot set their own terms: ' || v_error);
  end;
  perform public.boks_test_logout();
end $$;
rollback;

-- One name, one owner (20261124120000): an account's @handle and a page's
-- address never coincide, a page cannot take a service name, and Studio can
-- ask while the address is typed.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f2100-0000-4000-8000-000000000001', 'name-editor@boks.test', false),
  ('0f0f2100-0000-4000-8000-000000000002', 'name-lead@boks.test', false),
  ('0f0f2100-0000-4000-8000-000000000003', 'name-other@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f2100-0000-4000-8000-000000000001', 'name_editor', 'admin', now(), 'v1'),
  ('0f0f2100-0000-4000-8000-000000000002', 'name_lead', 'reader', now(), 'v1'),
  ('0f0f2100-0000-4000-8000-000000000003', 'name_other', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_editor uuid := '0f0f2100-0000-4000-8000-000000000001';
  v_lead uuid := '0f0f2100-0000-4000-8000-000000000002';
  v_other uuid := '0f0f2100-0000-4000-8000-000000000003';
  v_space uuid;
  v_kept uuid;
  v_token text;
  v_error text;
begin
  perform public.boks_test_login(v_editor);
  perform public.boks_assert(public.studio_check_handle('name_lead', null) = 'account', 'Studio sees an account''s @handle as taken');
  perform public.boks_assert(public.studio_check_handle('Admin', null) = 'reserved', 'and a service name as reserved');
  perform public.boks_assert(public.studio_check_handle('1x', null) = 'invalid', 'and a malformed one as invalid');
  perform public.boks_assert(public.studio_check_handle('name_fresh', null) = 'free', 'and a fresh one as free');

  foreach v_error in array array['support', 'NAME_LEAD'] loop
    begin
      perform public.studio_save_author_space(null, 'author', 'Проба', v_error, null, 0);
      perform public.boks_assert(false, 'a page cannot take @' || v_error);
    exception when others then
      get stacked diagnostics v_error = message_text;
      perform public.boks_assert(v_error like 'The address @% is %', 'a page cannot take a taken or service name: ' || v_error);
    end;
  end loop;
  begin
    insert into public.author_spaces (kind, name, handle, created_by) values ('author', 'Мимо Studio', 'name_other', v_editor);
    perform public.boks_assert(false, 'a page written past Studio cannot take an account''s @handle');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'The address @name_other is already taken.', 'the table itself refuses it: ' || v_error);
  end;

  v_space := (public.studio_save_author_space(null, 'author', 'Свободная', 'name_fresh', null, 0) ->> 'id')::uuid;
  perform public.boks_assert(public.studio_check_handle('name_fresh', v_space) = 'free', 'a page''s own address is free to it');
  perform public.boks_assert(public.studio_check_handle('name_fresh', null) = 'page', 'and taken for any other page');
  perform public.boks_test_login(v_other);
  begin
    perform public.update_boks_user_profile('', 'name_fresh');
    perform public.boks_assert(false, 'an account cannot take a page''s address');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like '%taken%', 'an account cannot take a page''s address: ' || v_error);
  end;

  -- A page made from an application with no address of its own: the author keeps their @handle.
  perform public.boks_test_login(v_editor);
  v_kept := (public.studio_save_author_space(null, 'author', 'Лид', '', null, 0) ->> 'id')::uuid;
  v_token := public.studio_issue_author_invite(v_kept, 'name-lead@boks.test', null) ->> 'token';
  perform public.boks_test_login(v_lead);
  perform public.accept_author_invite(v_token, null);
  perform public.boks_assert((select handle from public.user_profiles where user_id = v_lead) = 'name_lead', 'accepting a page without an address keeps the author''s @handle');
  perform public.boks_assert((select owner_user_id from public.author_spaces where id = v_kept) = v_lead, 'and the page is theirs');
  perform public.boks_test_logout();
end $$;
rollback;

-- An application remembers its page (20261124130000): page made, invited, in.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f2200-0000-4000-8000-000000000001', 'appl-editor@boks.test', false),
  ('0f0f2200-0000-4000-8000-000000000002', 'appl-author@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f2200-0000-4000-8000-000000000001', 'appl_editor', 'admin', now(), 'v1'),
  ('0f0f2200-0000-4000-8000-000000000002', 'appl_author', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_editor uuid := '0f0f2200-0000-4000-8000-000000000001';
  v_author uuid := '0f0f2200-0000-4000-8000-000000000002';
  v_app bigint;
  v_space uuid;
  v_token text;
  v_row jsonb;
begin
  perform public.boks_test_login(v_author);
  v_app := (public.submit_author_application('page', 'Заявитель', 'https://vk.com/x', null, 'appl-author@boks.test', null) ->> 'id')::bigint;
  perform public.boks_test_login(v_editor);
  select r into v_row from jsonb_array_elements(public.list_author_applications(500)) r where (r ->> 'id')::bigint = v_app;
  perform public.boks_assert(v_row ->> 'pageStage' is null and v_row ->> 'spaceId' is null, 'a fresh application has no page');
  v_space := (public.studio_save_author_space(null, 'author', 'Заявитель', '', null, 0) ->> 'id')::uuid;
  perform public.studio_link_application(v_app, v_space);
  select r into v_row from jsonb_array_elements(public.list_author_applications(500)) r where (r ->> 'id')::bigint = v_app;
  perform public.boks_assert(v_row ->> 'pageStage' = 'page' and (v_row ->> 'spaceId')::uuid = v_space and v_row ->> 'status' = 'contacted', 'the application shows its page, not invited yet');
  v_token := public.studio_issue_author_invite(v_space, 'appl-author@boks.test', null) ->> 'token';
  select r into v_row from jsonb_array_elements(public.list_author_applications(500)) r where (r ->> 'id')::bigint = v_app;
  perform public.boks_assert(v_row ->> 'pageStage' = 'invited' and v_row ->> 'invitedEmail' = 'appl-author@boks.test', 'then invited');
  perform public.boks_test_login(v_author);
  perform public.accept_author_invite(v_token, null);
  perform public.boks_test_login(v_editor);
  select r into v_row from jsonb_array_elements(public.list_author_applications(500)) r where (r ->> 'id')::bigint = v_app;
  perform public.boks_assert(v_row ->> 'pageStage' = 'in', 'then the author is in');
  perform public.boks_test_login(v_author);
  begin
    perform public.studio_link_application(v_app, v_space);
    perform public.boks_assert(false, 'only the team links an application');
  exception when others then
    perform public.boks_assert(sqlerrm like 'Admin access%', 'only the team links an application');
  end;
  perform public.boks_test_logout();
end $$;
rollback;

-- Applications as a small CRM (20261125090000): a stage with its status, the
-- «что уточнить» line, a journal of notes and changes; only the team.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f2250-0000-4000-8000-000000000001', 'crm-editor@boks.test', false),
  ('0f0f2250-0000-4000-8000-000000000002', 'crm-author@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f2250-0000-4000-8000-000000000001', 'crm_editor', 'admin', now(), 'v1'),
  ('0f0f2250-0000-4000-8000-000000000002', 'crm_author', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_editor uuid := '0f0f2250-0000-4000-8000-000000000001';
  v_author uuid := '0f0f2250-0000-4000-8000-000000000002';
  v_app bigint;
  v_row jsonb;
  v_events jsonb;
  v_space uuid;
  v_error text;
begin
  perform public.boks_test_login(v_author);
  v_app := (public.submit_author_application('launch', 'Вера', 'https://t.me/vera', '900', 'crm-author@boks.test', 'Стихи') ->> 'id')::bigint;
  perform public.submit_author_application('page', 'Вера', 'https://t.me/vera', null, 'crm-author@boks.test', null);
  begin
    perform public.studio_application_set_stage(v_app, 'written', null);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error like 'Admin access%', 'only the team moves an application');
  begin
    perform public.studio_application_events(v_app);
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error like 'Admin access%', 'only the team reads the journal');
  perform public.boks_assert(not has_table_privilege('authenticated', 'public.author_application_events', 'SELECT'), 'the journal is reached only through its functions');

  perform public.boks_test_login(v_editor);
  select r into v_row from jsonb_array_elements(public.list_author_applications(500)) r where (r ->> 'id')::bigint = v_app;
  perform public.boks_assert(v_row ->> 'stage' = 'new' and (v_row ->> 'others')::integer = 1 and not (v_row ->> 'guest')::boolean, 'a fresh application is new and knows the other one from the same person');

  perform public.studio_application_set_stage(v_app, 'written', 'Написали в Telegram');
  perform public.boks_assert((select status from public.author_applications where id = v_app) = 'contacted', 'written to means contacted for the applicant');
  perform public.studio_application_set_stage(v_app, 'replied', null);
  perform public.studio_application_set_focus(v_app, 'Уточнить права на сборник');
  perform public.studio_application_set_focus(v_app, 'Уточнить права на сборник');
  perform public.studio_application_add_note(v_app, 'Готова прислать пять текстов');
  begin
    perform public.studio_application_add_note(v_app, '   ');
    v_error := null;
  exception when others then v_error := sqlerrm;
  end;
  perform public.boks_assert(v_error = 'Write the note first.', 'an empty note is refused');
  v_events := public.studio_application_events(v_app);
  perform public.boks_assert(jsonb_array_length(v_events) = 4, 'two stage moves, one line and one note in the journal (an unchanged line is not repeated)');
  perform public.boks_assert(v_events -> 0 ->> 'kind' = 'note' and v_events -> 0 ->> 'by' = 'crm_editor', 'newest first, with who wrote it');
  perform public.boks_assert(v_events -> 3 ->> 'stageFrom' = 'new' and v_events -> 3 ->> 'stageTo' = 'written' and v_events -> 3 ->> 'body' = 'Написали в Telegram', 'a stage move keeps its from, to and why');
  select r into v_row from jsonb_array_elements(public.list_author_applications(500)) r where (r ->> 'id')::bigint = v_app;
  perform public.boks_assert(v_row ->> 'focus' = 'Уточнить права на сборник' and (v_row ->> 'notes')::integer = 1 and v_row -> 'lastNote' ->> 'body' = 'Готова прислать пять текстов',
    'the list carries the line and the last note');
  perform public.boks_assert(exists (select 1 from jsonb_array_elements(public.studio_author_pipeline()) r where r ->> 'applicationId' = v_app::text and r ->> 'applicationStage' = 'replied'),
    '«Ведение авторов» sees the stage');

  v_space := (public.studio_save_author_space(null, 'author', 'Вера', '', null, 0) ->> 'id')::uuid;
  perform public.studio_link_application(v_app, v_space);
  perform public.boks_assert((select stage from public.author_applications where id = v_app) = 'agreed', 'making the page means we agreed');

  perform public.set_author_application_status(v_app, 'closed');
  perform public.boks_assert((select (stage, status) = ('declined', 'closed') from public.author_applications where id = v_app), 'the old close button keeps the stage in step');
  perform public.studio_application_set_stage(v_app, 'silent', null);
  perform public.boks_test_login(v_author);
  perform public.boks_assert(public.get_my_author_access() -> 'application' ->> 'status' in ('new', 'closed'), 'the applicant still sees one of the three statuses');
  perform public.boks_test_logout();
end $$;
rollback;

-- Contract and payments (20261124140000): a paid contract has its payment row,
-- the row follows the contract, the author reads their own on «Договор и
-- оплаты» with the receipt, and nobody reads the table directly.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f2300-0000-4000-8000-000000000001', 'bill-editor@boks.test', false),
  ('0f0f2300-0000-4000-8000-000000000002', 'bill-author@boks.test', false),
  ('0f0f2300-0000-4000-8000-000000000003', 'bill-other@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f2300-0000-4000-8000-000000000001', 'bill_editor', 'admin', now(), 'v1'),
  ('0f0f2300-0000-4000-8000-000000000002', 'bill_author', 'reader', now(), 'v1'),
  ('0f0f2300-0000-4000-8000-000000000003', 'bill_other', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_editor uuid := '0f0f2300-0000-4000-8000-000000000001';
  v_author uuid := '0f0f2300-0000-4000-8000-000000000002';
  v_other uuid := '0f0f2300-0000-4000-8000-000000000003';
  v_space uuid;
  v_token text;
  v_agreement uuid;
  v_bill jsonb;
  v_terms jsonb := jsonb_build_object(
    'legalName', 'Счётова Анна Сергеевна',
    'author_offer', (public.boks_legal_current('author_offer')).version,
    'author_pd_processing', (public.boks_legal_current('author_pd_processing')).version,
    'author_pd_distribution', (public.boks_legal_current('author_pd_distribution')).version);
begin
  perform public.boks_test_login(v_editor);
  v_space := (public.studio_save_author_space(null, 'author', 'Счётова', '', null, 0) ->> 'id')::uuid;
  v_token := public.studio_issue_author_invite(v_space, 'bill-author@boks.test', 'page') ->> 'token';
  perform public.boks_test_login(v_author);
  perform public.accept_author_invite_with_terms(v_token, null, v_terms);
  select id into v_agreement from public.author_agreements where user_id = v_author;
  perform public.boks_assert((select count(*) from public.author_payments where agreement_id = v_agreement and kind = 'tariff' and state = 'awaiting' and amount_rub = 30000) = 1, 'a paid contract has its payment, awaiting');
  v_bill := public.get_my_billing();
  perform public.boks_assert(v_bill ->> 'billing' = 'paid' and jsonb_array_length(v_bill -> 'agreements') = 1, 'the author sees their contract');
  perform public.boks_assert((v_bill -> 'agreements' -> 0 ->> 'seriesPerYear')::integer = 12 and (v_bill -> 'agreements' -> 0 ->> 'seriesUsed')::integer = 0, 'with the tariff''s yearly number (12) and none used');
  perform public.boks_assert(v_bill -> 'agreements' -> 0 -> 'payments' -> 0 ->> 'state' = 'awaiting', 'and the payment awaiting');
  perform public.report_my_author_payment();
  perform public.boks_assert((select state from public.author_payments where agreement_id = v_agreement) = 'reported', 'the payment follows «Я оплатил(а)»');
  perform public.boks_test_login(v_editor);
  perform public.studio_mark_author_payment(v_agreement, current_date, 30000, 'https://lknpd.nalog.ru/api/v1/receipt/1/x/print', null);
  perform public.boks_assert((public.studio_agreement_payments(v_agreement) -> 0 ->> 'state') = 'paid', 'Studio lists it paid');
  perform public.boks_test_login(v_author);
  v_bill := public.get_my_billing();
  perform public.boks_assert(v_bill -> 'agreements' -> 0 -> 'payments' -> 0 ->> 'receiptUrl' like 'https://lknpd%', 'the author sees the receipt on «Договор и оплаты»');
  perform public.boks_assert(v_bill -> 'agreements' -> 0 -> 'payments' -> 0 ->> 'note' is null, 'but not the team''s note');
  perform public.boks_test_login(v_other);
  perform public.boks_assert(jsonb_array_length(public.get_my_billing() -> 'agreements') = 0, 'nobody else sees it');
  begin
    perform public.studio_agreement_payments(v_agreement);
    perform public.boks_assert(false, 'only the team lists a contract''s payments');
  exception when others then
    perform public.boks_assert(sqlerrm like 'Admin access%', 'only the team lists a contract''s payments');
  end;
  perform public.boks_test_logout();
end $$;
rollback;

-- Keeping track (20261124150000): one row per author for the team only.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('0f0f2400-0000-4000-8000-000000000001', 'pipe-editor@boks.test', false),
  ('0f0f2400-0000-4000-8000-000000000002', 'pipe-author@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values
  ('0f0f2400-0000-4000-8000-000000000001', 'pipe_editor', 'admin', now(), 'v1'),
  ('0f0f2400-0000-4000-8000-000000000002', 'pipe_author', 'reader', now(), 'v1')
on conflict (user_id) do update set handle = excluded.handle, role = excluded.role, terms_accepted_at = excluded.terms_accepted_at;
do $$
declare
  v_editor uuid := '0f0f2400-0000-4000-8000-000000000001';
  v_author uuid := '0f0f2400-0000-4000-8000-000000000002';
  v_app bigint;
  v_space uuid;
  v_row jsonb;
begin
  perform public.boks_test_login(v_author);
  v_app := (public.submit_author_application('page', 'Ведомая', 'https://vk.com/x', null, 'pipe-author@boks.test', null) ->> 'id')::bigint;
  begin
    perform public.studio_author_pipeline();
    perform public.boks_assert(false, 'only the team sees the pipeline');
  exception when others then
    perform public.boks_assert(sqlerrm like 'Admin access%', 'only the team sees the pipeline');
  end;
  perform public.boks_test_login(v_editor);
  select r into v_row from jsonb_array_elements(public.studio_author_pipeline()) r where r ->> 'key' = 'a' || v_app;
  perform public.boks_assert(v_row ->> 'kind' = 'application' and v_row ->> 'email' = 'pipe-author@boks.test', 'an application without a page is a row');
  v_space := (public.studio_save_author_space(null, 'author', 'Ведомая', '', null, 0) ->> 'id')::uuid;
  perform public.studio_link_application(v_app, v_space);
  perform public.boks_assert(not exists (select 1 from jsonb_array_elements(public.studio_author_pipeline()) r where r ->> 'key' = 'a' || v_app), 'once it has a page, the application is not a row of its own');
  select r into v_row from jsonb_array_elements(public.studio_author_pipeline()) r where r ->> 'key' = 's' || v_space;
  perform public.boks_assert(v_row ->> 'kind' = 'page' and (v_row ->> 'applicationId')::bigint = v_app and v_row -> 'invite' = 'null'::jsonb, 'the page is, with its application and no invite');
  perform public.studio_issue_author_invite(v_space, 'pipe-author@boks.test', 'page');
  select r into v_row from jsonb_array_elements(public.studio_author_pipeline()) r where r ->> 'key' = 's' || v_space;
  perform public.boks_assert(v_row -> 'invite' ->> 'email' = 'pipe-author@boks.test' and v_row -> 'invite' ->> 'acceptedAt' is null, 'then with the invite waiting');
  perform public.boks_test_logout();
end $$;
rollback;

-- Every page that opens goes onto the Series shelf (20261124160000).
begin;
insert into auth.users (id, email, is_anonymous) values ('0f0f2500-0000-4000-8000-000000000001', 'shelf-editor@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values ('0f0f2500-0000-4000-8000-000000000001', 'shelf_editor', 'admin', now(), 'v1')
on conflict (user_id) do update set role = excluded.role;
do $$
declare
  v_space uuid;
begin
  perform public.boks_test_login('0f0f2500-0000-4000-8000-000000000001');
  v_space := (public.studio_save_author_space(null, 'author', 'Полочная', 'shelf_page', null, 0) ->> 'id')::uuid;
  update public.author_spaces set series_shelf = false where id = v_space;
  perform public.boks_assert(not (select series_shelf from public.author_spaces where id = v_space), 'a closed page can be off the shelf');
  update public.author_spaces set status = 'published', published_at = now() where id = v_space;
  perform public.boks_assert((select series_shelf from public.author_spaces where id = v_space), 'opening the page puts it on the Series shelf');
  perform public.boks_test_logout();
end $$;
rollback;

-- Payment details for any recipient (20261124170000).
begin;
insert into auth.users (id, email, is_anonymous) values ('0f0f2600-0000-4000-8000-000000000001', 'paydet-editor@boks.test', false);
insert into public.user_profiles (user_id, handle, role, terms_accepted_at, terms_version) values ('0f0f2600-0000-4000-8000-000000000001', 'paydet_editor', 'admin', now(), 'v1')
on conflict (user_id) do update set role = excluded.role;
do $$
declare
  v jsonb;
begin
  perform public.boks_test_login('0f0f2600-0000-4000-8000-000000000001');
  v := public.studio_save_payment_details(jsonb_build_object('recipient', 'Проба Получатель', 'recipientKind', 'person', 'inn', '123456789012', 'kpp', '770801001',
    'account', '40817810000000000001', 'bank', 'Банк', 'bic', '044525000', 'corrAccount', '30101810000000000000', 'bankInn', '7700000000', 'bankKpp', '770801001'));
  perform public.boks_assert(v ->> 'recipientKind' = 'person' and v ->> 'kpp' is null and v ->> 'bankInn' = '7700000000', 'a person keeps no KPP; the bank''s INN is kept');
  v := public.studio_save_payment_details(v || jsonb_build_object('recipientKind', 'company', 'inn', '7700000001', 'kpp', '770801001'));
  perform public.boks_assert(v ->> 'recipientKind' = 'company' and v ->> 'kpp' = '770801001', 'a company keeps its KPP');
  begin
    perform public.studio_save_payment_details(v || jsonb_build_object('bankInn', '12'));
    perform public.boks_assert(false, 'a malformed bank INN is refused');
  exception when others then
    perform public.boks_assert(sqlerrm like 'Check the details%', 'a malformed bank INN is refused');
  end;
  perform public.boks_test_logout();
end $$;
rollback;

-- Author search (20261125100000): only authors with their own public page and
-- a published bok; publishers' writers (the classics) are not results.
begin;
insert into auth.users (id, email, is_anonymous) values
  ('5ea70000-0000-4000-8000-000000000001', 'search-publisher@boks.test', false),
  ('5ea70000-0000-4000-8000-000000000002', 'search-poet@boks.test', false),
  ('5ea70000-0000-4000-8000-000000000003', 'search-guest@boks.test', true),
  ('5ea70000-0000-4000-8000-000000000004', 'search-empty@boks.test', false),
  ('5ea70000-0000-4000-8000-000000000005', 'search-draft@boks.test', false);
insert into public.user_profiles (user_id, handle) values
  ('5ea70000-0000-4000-8000-000000000001', 'srch_pub'),
  ('5ea70000-0000-4000-8000-000000000002', 'srch_poet'),
  ('5ea70000-0000-4000-8000-000000000004', 'srch_empty'),
  ('5ea70000-0000-4000-8000-000000000005', 'srch_draft')
on conflict (user_id) do update set handle = excluded.handle;
do $$
declare
  v jsonb;
  v_hidden uuid;
begin
  perform public.boks_test_login('22222222-2222-4222-8222-222222222222');
  perform public.set_boks_publisher('srch_pub', true);
  perform public.set_boks_publisher('srch_poet', true);
  perform public.set_boks_publisher('srch_draft', true);
  perform public.import_boks_batch('srch_pub', jsonb_build_array(
    jsonb_build_object('importKey', 's-1', 'title', 'Палата', 'text', 'Текст.', 'authorName', 'Антон Чехов'),
    jsonb_build_object('importKey', 's-2', 'title', 'Метель', 'text', 'Текст.', 'authorName', 'Александр Пушкин')
  ), true, true, 'Public domain');
  perform public.import_boks_batch('srch_poet', jsonb_build_array(
    jsonb_build_object('importKey', 'p-1', 'title', 'Стих', 'text', 'Строка.', 'authorName', 'Мира Поэтова'),
    jsonb_build_object('importKey', 'p-2', 'title', 'Другой стих', 'text', 'Строка.', 'authorName', 'Мира Поэтова')
  ), true, true, 'Own work');
  perform public.import_boks_batch('srch_draft', jsonb_build_array(
    jsonb_build_object('importKey', 'd-1', 'title', 'Скрытый', 'text', 'Строка.', 'authorName', 'Зоя Черновикова')
  ), true, true, 'Own work');
  insert into public.author_spaces (kind, status, name, owner_user_id, published_at) values
    ('author', 'published', 'Мира Поэтова, поэт', '5ea70000-0000-4000-8000-000000000002', now()),
    ('author', 'published', 'Пустая Страница', '5ea70000-0000-4000-8000-000000000004', now()),
    ('author', 'draft', 'Зоя Черновикова', '5ea70000-0000-4000-8000-000000000005', null);

  -- What a guest sees, through the anonymous session.
  perform public.boks_test_login('5ea70000-0000-4000-8000-000000000003', true);

  v := public.search_boks_authors('поэтова', 20);
  perform public.boks_assert(
    jsonb_array_length(v -> 'results') = 1 and v #>> '{results,0,kind}' = 'account'
      and v #>> '{results,0,handle}' = 'srch_poet' and v #>> '{results,0,name}' = 'Мира Поэтова, поэт',
    'an author with a public page is found as the account, under the page''s name');
  perform public.boks_assert(not (v -> 'results' -> 0) ? 'title' and not (v -> 'results' -> 0) ? 'boks',
    'a search row names the author and nothing they wrote');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('  ПОЭТ   мира ', 20) -> 'results') = 1, 'words in any order, any case, any spacing');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('poetova', 20) -> 'results') = 1, 'a Latin spelling finds a Cyrillic name');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('@srch_poet', 20) -> 'results') = 1, 'an @handle finds its author');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('поэ', 20) -> 'results') >= 1, 'part of a name is enough');

  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('чехов', 20) -> 'results') = 0
      and jsonb_array_length(public.search_boks_authors('srch_pub', 20) -> 'results') = 0,
    'a publisher and its writers without a page of their own are not results');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('пустая', 20) -> 'results') = 0, 'a page with nothing published is not a result');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('черновикова', 20) -> 'results') = 0, 'a page that is not public is not a result');

  -- A new author published with a photo is found at once: no list to register in.
  perform public.boks_test_login('22222222-2222-4222-8222-222222222222');
  update public.author_spaces
  set status = 'published', published_at = now(),
      photo = '\xffd8ffe0'::bytea || convert_to(repeat('x', 200), 'UTF8'), photo_version = 1
  where owner_user_id = '5ea70000-0000-4000-8000-000000000005';
  perform public.boks_test_login('5ea70000-0000-4000-8000-000000000003', true);
  v := public.search_boks_authors('черновикова', 20);
  perform public.boks_assert(
    jsonb_array_length(v -> 'results') = 1 and v #>> '{results,0,handle}' = 'srch_draft' and (v #>> '{results,0,photoVersion}')::int = 1,
    'a page published with a photo appears in search straight away, with its photo');
  perform public.boks_assert(exists (
      select 1 from jsonb_array_elements(public.search_boks_authors('', 30) -> 'results') r where r ->> 'handle' = 'srch_draft'),
    'and on the first page, before anything is typed');
  perform public.boks_assert(not exists (
      select 1 from jsonb_array_elements(public.search_boks_authors('', 30) -> 'results') r where r ->> 'handle' in ('srch_pub', 'srch_empty')),
    'the first page holds only authors with a public page');

  perform public.boks_test_login('22222222-2222-4222-8222-222222222222');
  update public.reels set status = 'pending_review'
  where id in (select id from public.boks_reels where author_handle = 'srch_poet');
  perform public.boks_test_login('5ea70000-0000-4000-8000-000000000003', true);
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('поэтова', 20) -> 'results') = 0,
    'an author whose boks are all unpublished drops out');
  perform public.boks_assert((
      select bool_and(a <= b) from (
        select public.boks_author_search_text(r ->> 'name') as a,
               lead(public.boks_author_search_text(r ->> 'name')) over (order by n) as b
        from jsonb_array_elements(public.search_boks_authors('', 30) -> 'results') with ordinality x(r, n)
      ) pairs where b is not null) is not false,
    'the panel opens on the authors in alphabetical order');
  perform public.boks_assert((public.search_boks_authors('nobody-like-this', 20) ->> 'hasMore')::boolean = false
      and jsonb_array_length(public.search_boks_authors('nobody-like-this', 20) -> 'results') = 0,
    'nothing found is an empty page, not an error');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors('', 100000) -> 'results') <= 30, 'the server caps the page whatever is asked');
  perform public.boks_assert(jsonb_array_length(public.search_boks_authors(repeat('а', 5000), 20) -> 'results') = 0, 'a huge query is cut, not refused');
  perform public.boks_test_logout();

  perform public.boks_assert(has_function_privilege('anon', 'public.search_boks_authors(text, integer)', 'execute'), 'a guest may search');
  perform public.boks_assert(not has_function_privilege('anon', 'public.boks_author_search_key(text)', 'execute')
      and not has_function_privilege('authenticated', 'public.boks_author_search_key(text)', 'execute'),
    'the key helper is not part of the Data API');
end $$;
rollback;
