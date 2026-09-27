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
  perform public.boks_assert((v_quota ->> 'limit')::int = 3, 'daily limit is three boks');
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
    'A short story body that is well under fifteen minutes.', 'literary', 'quiet', 4, 'Mira Vale',
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
    'A short story body that is well under fifteen minutes.', '', '', 0, '', true
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
      select 1 from public.reels where author_user_id is not null and author_handle is not null
    ),
    'a handle is never stored on the work - it is always joined from the profile'
  );

  v_quota := public.get_my_bok_quota();
  perform public.boks_assert((v_quota ->> 'usedToday')::int = 3, 'three submissions are counted');
  perform public.boks_assert((v_quota ->> 'exhausted')::boolean, 'quota reports exhausted at the limit');

  begin
    perform public.submit_bok_for_review(
      'Fourth bok', 'A hook.',
      'This one must be refused by the daily limit.', 'literary', 'quiet', 4, '', true
    );
    perform public.boks_assert(false, 'a fourth submission is refused');
  exception when others then
    get stacked diagnostics v_error = message_text;
    perform public.boks_assert(v_error like 'Daily limit reached%', 'a fourth submission is refused: ' || v_error);
  end;

  -- Yesterday's submissions must not consume today's quota.
  update public.reels
  set submitted_at = now() - interval '2 days'
  where author_user_id = v_author;

  v_quota := public.get_my_bok_quota();
  perform public.boks_assert((v_quota ->> 'usedToday')::int = 0, 'the quota resets for a new day');

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
    v_result ->> 'title' = 'Given title' and (select hook from public.reels where id = v_titled) = '',
    'a title the author gives is kept, and a hook sent by an old client is not stored'
  );

  update public.reels set hook = 'Sneaked in.' where id = v_titled;
  perform public.boks_assert(
    (select hook from public.reels where id = v_titled) = '',
    'no write path can store a hook'
  );
  update public.reels set title = '   ' where id = v_titled;
  perform public.boks_assert(
    (select title from public.reels where id = v_titled) = 'Body text.',
    'clearing a title falls back to the first line'
  );
  perform public.boks_assert(
    not exists (select 1 from public.reels where hook <> ''),
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
  insert into public.reels (title, author_name, hook, text, genre, mood, status, author_user_id)
  values (
    'Lifecycle test bok', null, 'Only for lifecycle checks.',
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

  -- A reader must not be able to review or grant admin.
  perform public.boks_test_login(v_reader);
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

  perform public.record_recommendation_assignment('boks-feed-v1', 'discovery', 'new_reader', 'visitor-x');
  perform public.boks_assert(
    exists (select 1 from public.recommendation_assignments where user_id = v_reader and algorithm_id = 'discovery'),
    'a reader assignment is recorded'
  );

  -- The arm must not be rewritten by a later page load, or every cohort and
  -- before/after reading would be based on history that had been overwritten.
  perform public.record_recommendation_assignment('boks-feed-v1', 'balanced', 'general', 'visitor-x');
  perform public.boks_assert(
    exists (select 1 from public.recommendation_assignments where user_id = v_reader and algorithm_id = 'discovery'),
    'a second assignment call does not silently move the reader to another arm'
  );

  v_result := public.get_my_recommendation_assignment('boks-feed-v1');
  perform public.boks_assert(v_result ->> 'algorithmId' = 'discovery', 'the stored assignment is readable by its owner');

  v_count := public.record_recommendation_events(jsonb_build_array(
    jsonb_build_object('eventType', 'impression', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'discovery',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 0, 'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'start', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'discovery',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 2, 'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'complete', 'storyId', v_reel::text, 'value', 180, 'algorithmId', 'discovery',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 180, 'activeSeconds', 180, 'progress', 0.91,
      'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'not_a_real_event', 'storyId', v_reel::text, 'algorithmId', 'discovery'),
    jsonb_build_object('eventType', 'start', 'storyId', 'not-a-uuid', 'algorithmId', 'discovery')
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
    jsonb_build_object('eventType', 'heartbeat', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'discovery',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 60, 'activeSeconds', 60, 'progress', 0.4,
      'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x'),
    jsonb_build_object('eventType', 'heartbeat', 'storyId', v_reel::text, 'value', 1, 'algorithmId', 'discovery',
      'experimentKey', 'boks-feed-v1', 'userSegment', 'new_reader', 'surface', 'reader', 'rank', 0,
      'clientElapsedSeconds', 120, 'activeSeconds', 120, 'progress', 0.7,
      'estimatedSeconds', 240, 'sessionId', 's1', 'visitorId', 'visitor-x')
  ));
  perform public.boks_assert(v_count = 2, 'heartbeat events are accepted');

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
    insert into public.reels (title, author_name, hook, text, genre, mood, minutes, status)
    values ('Direct and too long', 'Seed', 'A hook.', repeat('b', 20001), 'literary', 'quiet', 1, 'published');
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
    not exists (select 1 from public.published_boks where btrim(coalesce(author_handle, '')) = ''),
    'every published boks is attributed to someone'
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
    (select profile_snapshot -> 'genreAffinity' ->> 'literary' from public.served_feed where id = v_feed_id) = '3',
    'the reader profile the ranking saw is stored verbatim, so the serve can be replayed'
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
  insert into public.reels (title, hook, text, genre, mood, minutes, status, author_user_id, author_name, language)
  values ('Unplaceable', 'A hook.', 'Zzz qqq xxx vvv zzz qqq xxx vvv.', 'fiction', 'calm', 1, 'published', v_admin, 'Nobody', 'und');
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
  insert into public.reels (title, hook, text, genre, mood, minutes, status, author_user_id, author_name, language)
  values ('Counted', 'A hook.', 'A piece that people react to, long enough to be a piece.', 'literary', 'quiet', 1, 'published', v_admin, 'Counted Author', 'en')
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
    'likes and comments reach their account library even without a view row'
  );
  insert into public.views (user_id, reel_id) values (v_reader, v_counted);
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
  insert into public.reels (title, author_name, hook, text, genre, mood, status, author_user_id)
  values (
    'Inspector test bok', null, 'Only for inspector checks.',
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
    array['boks_comments', 'anon', 'SELECT'],
    array['boks_public_identity', 'anon', 'SELECT'],
    array['reels', 'authenticated', 'SELECT'],
    array['comments', 'authenticated', 'SELECT'],
    array['bok_rights', 'authenticated', 'SELECT'],
    array['bok_reports', 'authenticated', 'SELECT'],
    array['likes', 'authenticated', 'INSERT'],
    array['likes', 'authenticated', 'DELETE'],
    array['views', 'authenticated', 'INSERT'],
    array['user_profiles', 'authenticated', 'INSERT'],
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
      'public.record_boks_journey_event(text,text,text,text,text,text,text,text,text,text)',
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
      'public.record_boks_journey_event(text,text,text,text,text,text,text,text,text,text)',
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
  author_handle text,
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
  insert into public.boks_trigger_probe (text, author_handle)
  values (E'Two short lines here,\nand a second one after the break.', '@someone');
  perform public.boks_assert(
    (select word_count from public.boks_trigger_probe order by id desc limit 1) = 11
      and (select line_break_count from public.boks_trigger_probe order by id desc limit 1) = 1
      and (select author_handle from public.boks_trigger_probe order by id desc limit 1) = 'someone'
      and (select language from public.boks_trigger_probe order by id desc limit 1) = 'en',
    'the trigger still fires, and still derives, for a reader who cannot call it'
  );
end $$;
reset role;

drop table public.boks_trigger_probe;
