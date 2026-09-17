-- Copyright: an attestation on the way in, and a way to complain afterwards.
--
-- Two halves:
--
--   1. Every bok now carries a rights record - the author confirming they may
--      publish it, plus optional free text saying why (a Project Gutenberg
--      identifier, a licence, an estate's permission). Required to publish.
--   2. Any reader can report a bok, with a reason, and an admin sees the
--      reports and can take the piece down.
--
-- Why a separate table and not columns on `reels`:
--
--   `authenticated` holds table-wide SELECT on `public.reels`, and the row
--   policy admits every published row. So a column on `reels` is readable by
--   any signed-in reader through PostgREST - including one nobody thought to
--   query, because `select *` returns it. Rights text is not public: it can
--   name a person, an estate, a contract. Putting it in its own table makes
--   the privacy a row policy on a table whose whole purpose is to be
--   admin-only, rather than a promise that no query ever selects too much.
--
-- The cost of that choice is that a bok could exist with no rights row, which
-- a NOT NULL column would have made impossible. `checks.sql` asserts the
-- invariant instead.

-- ------------------------------------------------------------- the attestation

create table if not exists public.bok_rights (
  reel_id uuid primary key references public.reels(id) on delete cascade,
  -- The author's statement that they may publish this. Stored as given: an
  -- unconfirmed row is a real state, not a missing one.
  confirmed boolean not null default false,
  -- Free text, admin-only. "Project Gutenberg #1342, public domain",
  -- "translated by the author", "licensed from the estate, see contract".
  note text,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bok_rights is
  'Per-boks copyright attestation and notes. Admin-readable only - it may name people, estates or contracts. Written through submit_bok_for_review and import_boks_batch.';

alter table public.bok_rights enable row level security;

drop policy if exists "Admins can read rights records" on public.bok_rights;
create policy "Admins can read rights records"
  on public.bok_rights for select
  to authenticated
  using (public.is_boks_admin());

-- No insert, update or delete policy: every write goes through a
-- security-definer RPC, so the rules live in one place.

create index if not exists bok_rights_unconfirmed_idx
  on public.bok_rights (confirmed, confirmed_at desc)
  where not confirmed;

-- Everything published before this migration existed has no attestation, and
-- saying so is more useful than inventing one. They show up in the console as
-- needing attention.
insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at)
select r.id, false, 'Published before boks recorded rights. Not yet attested.', r.author_user_id, r.created_at
from public.reels r
where not exists (select 1 from public.bok_rights br where br.reel_id = r.id)
on conflict (reel_id) do nothing;

-- ---------------------------------------------------------------- the reports

create table if not exists public.bok_reports (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  -- Null once the reporter deletes their account; the complaint survives it.
  reporter_user_id uuid references auth.users(id) on delete set null,
  kind text not null default 'copyright' check (kind in ('copyright', 'other')),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text
);

comment on table public.bok_reports is
  'Reader complaints about a boks, copyright first among them. Admin-readable only: a complaint names a grievance and sometimes a person.';

alter table public.bok_reports enable row level security;

drop policy if exists "Admins can read reports" on public.bok_reports;
create policy "Admins can read reports"
  on public.bok_reports for select
  to authenticated
  using (public.is_boks_admin());

-- One open complaint per person per boks. A second press of the button should
-- say "already reported" rather than pile up rows an admin has to read twice.
create unique index if not exists bok_reports_one_open_per_reporter_idx
  on public.bok_reports (reel_id, reporter_user_id)
  where status = 'open' and reporter_user_id is not null;

create index if not exists bok_reports_open_idx
  on public.bok_reports (status, created_at desc);

-- --------------------------------------------------------------- publishing

/**
 * The author path, now with the attestation.
 *
 * `p_rights_confirmed` defaults to false and publishing without it is refused,
 * so an older client cannot submit a boks that skips the question - it gets an
 * error naming what is missing rather than silently writing an unattested row.
 */
create or replace function public.submit_bok_for_review(
  p_title text,
  p_hook text,
  p_text text,
  p_genre text default '',
  p_mood text default '',
  p_minutes integer default 0,
  p_author_name text default '',
  p_rights_confirmed boolean default false,
  p_rights_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_text text := nullif(trim(coalesce(p_text, '')), '');
  v_hook text := trim(coalesce(p_hook, ''));
  v_genre text := coalesce(nullif(trim(coalesce(p_genre, '')), ''), 'literary');
  v_mood text := coalesce(nullif(trim(coalesce(p_mood, '')), ''), 'quiet');
  v_words integer;
  v_limit integer := public.boks_daily_submission_limit();
  v_used integer;
  v_author_name text;
  v_author_handle text;
  v_bok public.reels;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required to submit a bok.' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'Title is required.' using errcode = '22023';
  end if;

  if v_text is null then
    raise exception 'Story text is required.' using errcode = '22023';
  end if;

  if coalesce(p_rights_confirmed, false) is not true then
    raise exception 'Confirm you hold the rights to publish this bok.' using errcode = '22023';
  end if;

  v_words := public.boks_word_count(v_text);

  if char_length(v_text) > public.boks_max_text_characters() then
    raise exception 'A bok must fit inside 15 minutes. This one is % characters; the limit is %.',
      char_length(v_text), public.boks_max_text_characters() using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

  -- Held for the duration so the daily-limit check below is serialised per
  -- author.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  -- The byline for this piece. Optional: empty means the reader sees only the
  -- @handle, which is the attribution every boks already has.
  v_author_name := left(nullif(btrim(coalesce(p_author_name, '')), ''), 120);

  v_used := public.count_my_boks_submitted_today();

  if v_used >= v_limit then
    raise exception 'Daily limit reached. You can submit % boks a day.', v_limit using errcode = '54023';
  end if;

  insert into public.reels (
    title, author_name, hook, text, genre, mood, minutes,
    status, author_user_id, submitted_at, updated_at
  )
  values (
    v_title, v_author_name, left(v_hook, 500), v_text,
    left(v_genre, 30), left(v_mood, 30), public.boks_reading_minutes(v_words),
    'pending_review', v_uid, now(), now()
  )
  returning * into v_bok;

  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
  values (v_bok.id, true, nullif(btrim(coalesce(p_rights_note, '')), ''), v_uid, now(), now())
  on conflict (reel_id) do update
  set confirmed = true,
      note = excluded.note,
      confirmed_by = excluded.confirmed_by,
      confirmed_at = now(),
      updated_at = now();

  select author_handle into v_author_handle from public.boks_reels where id = v_bok.id;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'authorName', v_author_name,
    'authorHandle', v_author_handle,
    'minutes', v_bok.minutes,
    'wordCount', v_bok.word_count,
    'submittedAt', v_bok.submitted_at,
    'quota', public.get_my_bok_quota()
  );
end;
$$;

/**
 * The catalogue path. The admin loading a batch attests for it once rather
 * than per file, because a Project Gutenberg load is 500 files with the same
 * answer; a row may still carry its own `rightsNote` when a piece needs one.
 */
create or replace function public.import_boks_batch(
  p_publisher_handle text,
  p_rows jsonb,
  p_publish boolean default true,
  p_rights_confirmed boolean default false,
  p_rights_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := (select auth.uid());
  v_handle text := nullif(lower(trim(leading '@' from btrim(coalesce(p_publisher_handle, '')))), '');
  v_publisher uuid;
  v_status text := case when coalesce(p_publish, true) then 'published' else 'pending_review' end;
  v_limit integer := public.boks_max_text_characters();
  v_batch_note text := nullif(btrim(coalesce(p_rights_note, '')), '');
  v_results jsonb := '[]'::jsonb;
  v_row jsonb;
  v_index integer := 0;
  v_key text;
  v_title text;
  v_text text;
  v_hook text;
  v_author_name text;
  v_note text;
  v_created timestamptz;
  v_id uuid;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_handle is null then
    raise exception 'A publisher nickname is required.' using errcode = '22023';
  end if;

  if coalesce(p_rights_confirmed, false) is not true then
    raise exception 'Confirm the rights for this batch before importing it.' using errcode = '22023';
  end if;

  select user_id into v_publisher
  from public.user_profiles
  where lower(handle) = v_handle and is_publisher;

  if v_publisher is null then
    raise exception '@% is not a publisher account. An admin has to mark it as one first.', v_handle
      using errcode = '22023';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be a JSON array.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_rows) > 100 then
    raise exception 'Import at most 100 boks per call; this batch has %.', jsonb_array_length(p_rows)
      using errcode = '22023';
  end if;

  -- Indexed rather than `for ... in select`: the position is reported back, so
  -- a rejected row can be found in the file it came from.
  while v_index < jsonb_array_length(p_rows) loop
    v_row := p_rows -> v_index;
    v_index := v_index + 1;
    v_key := nullif(btrim(coalesce(v_row ->> 'importKey', '')), '');
    v_title := nullif(btrim(coalesce(v_row ->> 'title', '')), '');
    v_text := nullif(btrim(coalesce(v_row ->> 'text', '')), '');
    v_hook := btrim(coalesce(v_row ->> 'hook', ''));
    v_author_name := left(nullif(btrim(coalesce(v_row ->> 'authorName', '')), ''), 120);
    v_note := coalesce(nullif(btrim(coalesce(v_row ->> 'rightsNote', '')), ''), v_batch_note);

    if v_key is null then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', null, 'status', 'rejected',
        'reason', 'An import key is required, so the load can be repeated safely.'
      );
      continue;
    end if;

    if v_title is null then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected', 'reason', 'Title is required.'
      );
      continue;
    end if;

    if v_text is null then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected', 'reason', 'Story text is required.'
      );
      continue;
    end if;

    if char_length(v_text) > v_limit then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected',
        'reason', format('A bok must fit inside 15 minutes. This one is %s characters; the limit is %s.',
                         char_length(v_text), v_limit)
      );
      continue;
    end if;

    if exists (
      select 1 from public.reels
      where author_user_id = v_publisher and import_key = v_key
    ) then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'skipped', 'reason', 'Already imported.'
      );
      continue;
    end if;

    begin
      v_created := coalesce((v_row ->> 'createdAt')::timestamptz, now());
    exception when others then
      v_created := now();
    end;

    -- Its own subtransaction: a row that trips a constraint is reported and
    -- the rest of the batch continues.
    begin
      insert into public.reels (
        title, author_name, hook, text, status, author_user_id,
        import_key, is_seed, created_at, submitted_at, reviewed_at, reviewed_by, updated_at
      )
      values (
        v_title, v_author_name, left(v_hook, 500), v_text, v_status, v_publisher,
        v_key, false, v_created, v_created,
        case when v_status = 'published' then now() else null end,
        case when v_status = 'published' then v_admin else null end,
        now()
      )
      returning id into v_id;

      insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
      values (v_id, true, v_note, v_admin, now(), now());

      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'imported', 'id', v_id::text
      );
    exception when others then
      v_results := v_results || jsonb_build_object(
        'index', v_index, 'importKey', v_key, 'status', 'rejected', 'reason', sqlerrm
      );
    end;
  end loop;

  return jsonb_build_object(
    'publisher', v_handle,
    'status', v_status,
    'results', v_results,
    'imported', (select count(*) from jsonb_array_elements(v_results) r where r.value ->> 'status' = 'imported'),
    'skipped', (select count(*) from jsonb_array_elements(v_results) r where r.value ->> 'status' = 'skipped'),
    'rejected', (select count(*) from jsonb_array_elements(v_results) r where r.value ->> 'status' = 'rejected')
  );
end;
$$;

-- ------------------------------------------------------------------ reporting

/**
 * A reader reports a boks.
 *
 * Open to anonymous readers as well as signed-in ones: the person whose work
 * was taken does not necessarily have a boks account, and asking them to make
 * one before they can complain is the wrong order. The reason is required and
 * has to say something - a report an admin cannot act on wastes the one
 * person who reads it.
 */
create or replace function public.report_bok(
  p_reel_id uuid,
  p_reason text,
  p_kind text default 'copyright'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kind text := lower(trim(coalesce(p_kind, 'copyright')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_existing uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Sign in required to report a bok.' using errcode = '42501';
  end if;

  if v_kind not in ('copyright', 'other') then
    v_kind := 'other';
  end if;

  if v_reason is null or char_length(v_reason) < 10 then
    raise exception 'Say what is wrong in a sentence or two, so an admin can act on it.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.reels where id = p_reel_id) then
    raise exception 'That bok does not exist.' using errcode = '22023';
  end if;

  select id into v_existing
  from public.bok_reports
  where reel_id = p_reel_id and reporter_user_id = v_uid and status = 'open';

  if v_existing is not null then
    return jsonb_build_object('status', 'already', 'id', v_existing::text);
  end if;

  insert into public.bok_reports (reel_id, reporter_user_id, kind, reason)
  values (p_reel_id, v_uid, v_kind, left(v_reason, 2000))
  returning id into v_id;

  return jsonb_build_object('status', 'received', 'id', v_id::text);
end;
$$;

/**
 * Everything an admin needs on one screen: the open complaints, and the boks
 * whose rights nobody has attested. Both are reasons to look at a piece, so
 * they are answered by one call rather than two panels that disagree.
 */
create or replace function public.get_boks_rights_review(
  p_status text default 'open',
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'open')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'openReports', (select count(*)::integer from public.bok_reports where status = 'open'),
    'unattested', (select count(*)::integer from public.bok_rights where not confirmed),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rep.id::text,
        'reelId', rep.reel_id::text,
        'title', r.title,
        'authorHandle', v.author_handle,
        'authorName', r.author_name,
        'bokStatus', r.status,
        'kind', rep.kind,
        'reason', rep.reason,
        'status', rep.status,
        'createdAt', rep.created_at,
        'reviewedAt', rep.reviewed_at,
        'reviewNote', rep.review_note,
        'reporterHandle', (select i.handle from public.boks_public_identity i where i.user_id = rep.reporter_user_id),
        'rightsConfirmed', br.confirmed,
        'rightsNote', br.note
      ) order by rep.created_at desc)
      from public.bok_reports rep
      join public.reels r on r.id = rep.reel_id
      left join public.boks_reels v on v.id = rep.reel_id
      left join public.bok_rights br on br.reel_id = rep.reel_id
      where (v_status = 'all' or rep.status = v_status)
      limit v_limit
    ), '[]'::jsonb),
    'unattestedBoks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reelId', r.id::text,
        'title', r.title,
        'authorHandle', v.author_handle,
        'bokStatus', r.status,
        'note', br.note,
        'createdAt', r.created_at
      ) order by r.created_at desc)
      from public.bok_rights br
      join public.reels r on r.id = br.reel_id
      left join public.boks_reels v on v.id = r.id
      where not br.confirmed
      limit v_limit
    ), '[]'::jsonb)
  );
end;
$$;

/**
 * Resolves a complaint.
 *
 * `actioned` also takes the piece out of the feed, because that is what acting
 * on a valid copyright complaint means, and `review_bok_submission` cannot do
 * it - that one only touches boks that are not published yet. The author sees
 * the note as the reason their piece was withdrawn, so it is required.
 */
create or replace function public.review_bok_report(
  p_report_id uuid,
  p_decision text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_report public.bok_reports;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if v_decision not in ('actioned', 'dismissed') then
    raise exception 'Decision must be actioned or dismissed.' using errcode = '22023';
  end if;

  if v_decision = 'actioned' and v_note is null then
    raise exception 'Say why the bok is being taken down. The author sees it.' using errcode = '22023';
  end if;

  update public.bok_reports
  set status = v_decision,
      reviewed_at = now(),
      reviewed_by = v_caller,
      review_note = left(coalesce(v_note, ''), 1000)
  where id = p_report_id and status = 'open'
  returning * into v_report;

  if v_report.id is null then
    raise exception 'That report is not open.' using errcode = '22023';
  end if;

  if v_decision = 'actioned' then
    update public.reels
    set status = 'rejected',
        review_note = left(v_note, 1000),
        reviewed_at = now(),
        reviewed_by = v_caller,
        updated_at = now()
    where id = v_report.reel_id;

    -- The attestation was wrong, whoever made it. Saying so keeps the piece
    -- in the unattested list if anyone tries to put it back.
    --
    -- Built by joining the parts that exist, so a piece whose author left no
    -- note does not end up with a note that starts with a separator.
    update public.bok_rights
    set confirmed = false,
        note = left(
          array_to_string(
            array_remove(array[nullif(btrim(coalesce(note, '')), ''), 'Withdrawn after a report: ' || v_note], null),
            ' | '
          ),
          2000
        ),
        updated_at = now()
    where reel_id = v_report.reel_id;
  end if;

  return jsonb_build_object(
    'id', v_report.id::text,
    'reelId', v_report.reel_id::text,
    'status', v_report.status,
    'bokStatus', (select status from public.reels where id = v_report.reel_id)
  );
end;
$$;

/** Lets an admin record or correct a rights note without republishing. */
create or replace function public.set_bok_rights(
  p_reel_id uuid,
  p_confirmed boolean,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.reels where id = p_reel_id) then
    raise exception 'That bok does not exist.' using errcode = '22023';
  end if;

  insert into public.bok_rights (reel_id, confirmed, note, confirmed_by, confirmed_at, updated_at)
  values (p_reel_id, coalesce(p_confirmed, false), nullif(btrim(coalesce(p_note, '')), ''), v_caller, now(), now())
  on conflict (reel_id) do update
  set confirmed = coalesce(p_confirmed, false),
      note = nullif(btrim(coalesce(p_note, '')), ''),
      confirmed_by = v_caller,
      confirmed_at = now(),
      updated_at = now();

  return jsonb_build_object('reelId', p_reel_id::text, 'confirmed', coalesce(p_confirmed, false));
end;
$$;

-- ------------------------------------------------------------------- access

grant select on public.bok_rights to authenticated;
grant select on public.bok_reports to authenticated;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer, text, boolean, text) to authenticated;

revoke all on function public.import_boks_batch(text, jsonb, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.import_boks_batch(text, jsonb, boolean, boolean, text) to authenticated;

revoke all on function public.report_bok(uuid, text, text) from public, anon, authenticated;
grant execute on function public.report_bok(uuid, text, text) to authenticated;

revoke all on function public.get_boks_rights_review(text, integer) from public, anon, authenticated;
grant execute on function public.get_boks_rights_review(text, integer) to authenticated;

revoke all on function public.review_bok_report(uuid, text, text) from public, anon, authenticated;
grant execute on function public.review_bok_report(uuid, text, text) to authenticated;

revoke all on function public.set_bok_rights(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_bok_rights(uuid, boolean, text) to authenticated;

-- The old four- and two-argument shapes would let a client publish without
-- answering the rights question, so they go.
drop function if exists public.submit_bok_for_review(text, text, text, text, text, integer, text);
drop function if exists public.import_boks_batch(text, jsonb, boolean);
