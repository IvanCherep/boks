-- Studies: the controlled tests behind the thesis hypotheses.
--
-- The recommendation lab compares algorithms on the live feed by attributed
-- behaviour. The hypotheses of the third research semester need something
-- else: a participant who opens a study link, is assigned a condition, reads
-- what the protocol gives them and answers a few questions. Seven protocols
-- (`docs/studies.md`):
--
--   rg1  Series against the same text read plainly: «тронуло», «заставило задуматься»
--   rg2  the personal feed against a catalogue of the same texts with search and filters
--   a1   a complete short work against a comparable fragment: what is chosen next
--   a2   text in the feed against a card with a separate reading screen
--   b1   an active Series scene against a passive one replaying the same events
--   b2   Series as a way into an unknown author: is another of their texts chosen
--   b3   are algorithmically cut fragments understandable and complete on their own
--
-- Every study starts switched off. An admin turns one on in Studio when its
-- materials are ready; until then the participant page says no study is
-- running and nothing can be written. Switching off stops new participants
-- and new answers, and keeps everything already collected.
--
-- Three tables, none reachable from the Data API: everything goes through the
-- functions below, which check the switch, the caller and the sizes.

create table if not exists public.boks_studies (
  key text primary key,
  enabled boolean not null default false,
  -- Which boks a protocol uses (pairs, sets, showcases). Validated by the
  -- Studio editor (`lib/boks/studies/materials.ts`); here only shape and size.
  materials jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint boks_study_key_known check (key in ('rg1', 'rg2', 'a1', 'a2', 'b1', 'b2', 'b3')),
  constraint boks_study_materials_object check (jsonb_typeof(materials) = 'object'),
  constraint boks_study_materials_size check (pg_column_size(materials) <= 65536)
);

comment on table public.boks_studies is
  'One row per research protocol, with the admin switch and its materials. Off by default. Admin-only through RPCs; participants read it through get_boks_study.';

insert into public.boks_studies (key) values
  ('rg1'), ('rg2'), ('a1'), ('a2'), ('b1'), ('b2'), ('b3')
on conflict (key) do nothing;

create table if not exists public.boks_study_participants (
  id uuid primary key default gen_random_uuid(),
  study_key text not null references public.boks_studies(key) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visitor_id text,
  -- Assigned by the server, balanced across the study's conditions.
  condition text not null,
  -- Drives every random order in the protocol, so a participant's plan can be
  -- rebuilt exactly from the seed and the materials of the day.
  seed integer not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (study_key, user_id)
);

comment on table public.boks_study_participants is
  'A person in one study: the condition the server assigned and the seed of their plan. One row per study per Supabase user.';

create index if not exists boks_study_participants_user_idx on public.boks_study_participants (user_id);
create index if not exists boks_study_participants_condition_idx on public.boks_study_participants (study_key, condition);

-- b3: fragments cut from large works, each rated by three readers. `method`
-- says whether the algorithm chose it or a same-length window did (the
-- comparison); raters never see it.
create table if not exists public.boks_study_fragments (
  id uuid primary key default gen_random_uuid(),
  batch text not null,
  method text not null,
  source_title text not null,
  source_author text not null default '',
  language text not null default 'ru',
  body text not null,
  candidate_rank integer,
  word_count integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint boks_study_fragment_method check (method in ('algorithm', 'window')),
  constraint boks_study_fragment_batch_shape check (batch ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  constraint boks_study_fragment_body_present check (btrim(body) <> '' and char_length(body) <= 20000)
);

comment on table public.boks_study_fragments is
  'Fragments imported for study b3. The method (algorithm or same-length window) is never shown to a rater.';

create index if not exists boks_study_fragments_batch_idx on public.boks_study_fragments (batch);

create table if not exists public.boks_study_responses (
  id bigint generated always as identity primary key,
  participant_id uuid not null references public.boks_study_participants(id) on delete cascade,
  study_key text not null references public.boks_studies(key) on delete cascade,
  -- Which form or measurement this is: `after_reading`, `choice`, `session`,
  -- `reading`, `trace`, `fragment_rating`, ... (`lib/boks/studies/protocol.ts`).
  step text not null,
  reel_id uuid references public.reels(id) on delete set null,
  fragment_id uuid references public.boks_study_fragments(id) on delete set null,
  -- The condition the answer was given under: within-subject protocols change
  -- it from step to step.
  condition text,
  answers jsonb not null default '{}'::jsonb,
  client_seconds numeric,
  created_at timestamptz not null default now(),
  constraint boks_study_step_shape check (step ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint boks_study_answers_object check (jsonb_typeof(answers) = 'object'),
  -- A gesture trace is the largest thing written: a few hundred samples.
  constraint boks_study_answers_size check (pg_column_size(answers) <= 131072)
);

comment on table public.boks_study_responses is
  'Every answer and measurement a study participant left, one row per form or reading. Written only by record_boks_study_response while the study is switched on.';

create index if not exists boks_study_responses_participant_idx on public.boks_study_responses (participant_id);
create index if not exists boks_study_responses_study_idx on public.boks_study_responses (study_key, created_at);
create index if not exists boks_study_responses_reel_idx on public.boks_study_responses (reel_id) where reel_id is not null;
create index if not exists boks_study_responses_fragment_idx on public.boks_study_responses (fragment_id) where fragment_id is not null;
create index if not exists boks_study_responses_trace_idx on public.boks_study_responses (reel_id, created_at) where step = 'trace';

-- b1: a passive participant replays exactly one active participant's trace.
create table if not exists public.boks_study_yokes (
  trace_response_id bigint primary key references public.boks_study_responses(id) on delete cascade,
  passive_participant_id uuid not null references public.boks_study_participants(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

comment on table public.boks_study_yokes is
  'Study b1: which passive participant replayed which recorded gesture trace. A trace is replayed once.';

create index if not exists boks_study_yokes_passive_idx on public.boks_study_yokes (passive_participant_id);

alter table public.boks_studies enable row level security;
alter table public.boks_study_participants enable row level security;
alter table public.boks_study_responses enable row level security;
alter table public.boks_study_fragments enable row level security;
alter table public.boks_study_yokes enable row level security;
revoke all on table public.boks_studies from public, anon, authenticated;
revoke all on table public.boks_study_participants from public, anon, authenticated;
revoke all on table public.boks_study_responses from public, anon, authenticated;
revoke all on table public.boks_study_fragments from public, anon, authenticated;
revoke all on table public.boks_study_yokes from public, anon, authenticated;


-- The conditions each study assigns. One list, read by enrolment and asserted
-- against `lib/boks/studies/protocol.ts` by the unit tests reading this file.
create or replace function public.boks_study_conditions(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'rg1' then array['series', 'text']
    when 'rg2' then array['feed', 'catalogue']
    when 'a1' then array['whole_first', 'fragment_first']
    when 'a2' then array['inline_a', 'inline_b', 'cards_a', 'cards_b']
    when 'b1' then array['yoked']
    when 'b2' then array['series', 'text']
    when 'b3' then array['rater']
    else array[]::text[]
  end;
$$;

revoke all on function public.boks_study_conditions(text) from public, anon, authenticated;


-- A study as a participant sees it: whether it is running, its materials, and
-- their own place in it (so a reload continues where they were).
create or replace function public.get_boks_study(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_study public.boks_studies%rowtype;
  v_participant public.boks_study_participants%rowtype;
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  select * into v_study from public.boks_studies s where s.key = lower(btrim(coalesce(p_key, '')));
  if not found then
    return null;
  end if;

  select * into v_participant from public.boks_study_participants p
  where p.study_key = v_study.key and p.user_id = v_uid;

  return jsonb_build_object(
    'key', v_study.key,
    'enabled', v_study.enabled,
    'materials', case when v_study.enabled or public.is_boks_admin(v_uid) then v_study.materials else '{}'::jsonb end,
    'participant', case when v_participant.id is null then null else jsonb_build_object(
      'id', v_participant.id,
      'condition', v_participant.condition,
      'seed', v_participant.seed,
      'createdAt', v_participant.created_at,
      'completedAt', v_participant.completed_at,
      'steps', coalesce((
        select jsonb_agg(jsonb_build_object(
          'step', r.step,
          'reelId', r.reel_id,
          'fragmentId', r.fragment_id,
          'condition', r.condition
        ) order by r.id)
        from public.boks_study_responses r
        where r.participant_id = v_participant.id and r.step <> 'trace'
      ), '[]'::jsonb)
    ) end
  );
end;
$$;

comment on function public.get_boks_study(text) is
  'A study as a participant sees it: switched on or not, its materials while it runs, and the caller''s own assignment and finished steps.';

revoke all on function public.get_boks_study(text) from public, anon;
grant execute on function public.get_boks_study(text) to authenticated;


-- Joining a study. The condition with the fewest participants so far, ties
-- broken at random: balanced arms at pilot sizes, where simple randomisation
-- can leave 15 against 9. A second call returns the same assignment.
create or replace function public.enroll_in_boks_study(p_key text, p_visitor_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_study public.boks_studies%rowtype;
  v_participant public.boks_study_participants%rowtype;
  v_condition text;
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  -- Locks the study row: two people joining at once must not both take the
  -- same "least used" condition.
  select * into v_study from public.boks_studies s where s.key = v_key for update;
  if not found then
    raise exception 'There is no such study.' using errcode = '22023';
  end if;
  if not v_study.enabled then
    raise exception 'This study is not running.' using errcode = '55000';
  end if;

  select * into v_participant from public.boks_study_participants p
  where p.study_key = v_key and p.user_id = v_uid;

  if v_participant.id is null then
    select c.condition into v_condition
    from unnest(public.boks_study_conditions(v_key)) as c(condition)
    left join public.boks_study_participants p
      on p.study_key = v_key and p.condition = c.condition
    group by c.condition
    order by count(p.id), random()
    limit 1;

    insert into public.boks_study_participants (study_key, user_id, visitor_id, condition, seed)
    values (
      v_key,
      v_uid,
      left(nullif(btrim(coalesce(p_visitor_id, '')), ''), 120),
      v_condition,
      floor(random() * 2147483647)::integer
    )
    returning * into v_participant;
  end if;

  return jsonb_build_object(
    'id', v_participant.id,
    'condition', v_participant.condition,
    'seed', v_participant.seed,
    'createdAt', v_participant.created_at,
    'completedAt', v_participant.completed_at,
    'steps', '[]'::jsonb
  );
end;
$$;

comment on function public.enroll_in_boks_study(text, text) is
  'Joins the caller to a running study with a balanced condition and a plan seed; returns the existing assignment on a second call.';

revoke all on function public.enroll_in_boks_study(text, text) from public, anon;
grant execute on function public.enroll_in_boks_study(text, text) to authenticated;


-- One answer or measurement. Only the participant's own, only while the
-- study runs, at most 300 per participant.
create or replace function public.record_boks_study_response(
  p_participant_id uuid,
  p_step text,
  p_answers jsonb,
  p_reel_id uuid default null,
  p_fragment_id uuid default null,
  p_condition text default null,
  p_client_seconds numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_participant public.boks_study_participants%rowtype;
  v_enabled boolean;
  v_count integer;
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  select * into v_participant from public.boks_study_participants p
  where p.id = p_participant_id and p.user_id = v_uid;
  if not found then
    raise exception 'Not a participant of this study.' using errcode = '42501';
  end if;

  select s.enabled into v_enabled from public.boks_studies s where s.key = v_participant.study_key;
  if not coalesce(v_enabled, false) then
    raise exception 'This study is not running.' using errcode = '55000';
  end if;

  if jsonb_typeof(coalesce(p_answers, 'null'::jsonb)) <> 'object' then
    raise exception 'Answers must be a JSON object.' using errcode = '22023';
  end if;

  select count(*) into v_count from public.boks_study_responses r where r.participant_id = v_participant.id;
  if v_count >= 300 then
    raise exception 'This participant has already answered everything.' using errcode = '54000';
  end if;

  if p_fragment_id is not null and not exists (
    select 1 from public.boks_study_fragments f where f.id = p_fragment_id
  ) then
    raise exception 'There is no such fragment.' using errcode = '22023';
  end if;

  insert into public.boks_study_responses (
    participant_id, study_key, step, reel_id, fragment_id, condition, answers, client_seconds
  )
  values (
    v_participant.id,
    v_participant.study_key,
    lower(btrim(coalesce(p_step, ''))),
    (select r.id from public.reels r where r.id = p_reel_id),
    p_fragment_id,
    left(nullif(btrim(coalesce(p_condition, '')), ''), 40),
    p_answers,
    least(greatest(coalesce(p_client_seconds, 0), 0), 86400)
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_boks_study_response(uuid, text, jsonb, uuid, uuid, text, numeric) is
  'Stores one answer or measurement of the caller in a running study.';

revoke all on function public.record_boks_study_response(uuid, text, jsonb, uuid, uuid, text, numeric) from public, anon;
grant execute on function public.record_boks_study_response(uuid, text, jsonb, uuid, uuid, text, numeric) to authenticated;


create or replace function public.complete_boks_study(p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  update public.boks_study_participants p
  set completed_at = coalesce(p.completed_at, now())
  where p.id = p_participant_id and p.user_id = v_uid;
end;
$$;

revoke all on function public.complete_boks_study(uuid) from public, anon;
grant execute on function public.complete_boks_study(uuid) to authenticated;


-- b3: the next fragment for this rater. Fewest ratings first, never one they
-- rated, never one that already has three; the method is not returned.
create or replace function public.next_boks_study_fragment(p_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_participant public.boks_study_participants%rowtype;
  v_fragment public.boks_study_fragments%rowtype;
  v_batch text;
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  select * into v_participant from public.boks_study_participants p
  where p.id = p_participant_id and p.user_id = v_uid and p.study_key = 'b3';
  if not found then
    raise exception 'Not a participant of this study.' using errcode = '42501';
  end if;

  if not (select s.enabled from public.boks_studies s where s.key = 'b3') then
    raise exception 'This study is not running.' using errcode = '55000';
  end if;

  -- The batch to rate is part of the study materials; no batch, every fragment.
  select nullif(btrim(s.materials ->> 'batch'), '') into v_batch from public.boks_studies s where s.key = 'b3';

  select f.* into v_fragment
  from public.boks_study_fragments f
  left join public.boks_study_responses r
    on r.fragment_id = f.id and r.step = 'fragment_rating'
  where (v_batch is null or f.batch = v_batch)
    and not exists (
      select 1 from public.boks_study_responses mine
      where mine.fragment_id = f.id and mine.participant_id = v_participant.id
    )
  group by f.id
  having count(r.id) < 3
  order by count(r.id), random()
  limit 1;

  if v_fragment.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_fragment.id,
    'sourceTitle', v_fragment.source_title,
    'sourceAuthor', v_fragment.source_author,
    'language', v_fragment.language,
    'body', v_fragment.body,
    'wordCount', v_fragment.word_count
  );
end;
$$;

revoke all on function public.next_boks_study_fragment(uuid) from public, anon;
grant execute on function public.next_boks_study_fragment(uuid) to authenticated;


-- b1: a recorded active trace for this bok that nobody has replayed yet, now
-- claimed by the caller. Null when there is none: the caller is then active.
create or replace function public.claim_boks_study_trace(p_participant_id uuid, p_reel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_participant public.boks_study_participants%rowtype;
  v_trace public.boks_study_responses%rowtype;
begin
  if v_uid is null then
    raise exception 'A boks session is required.' using errcode = '42501';
  end if;

  select * into v_participant from public.boks_study_participants p
  where p.id = p_participant_id and p.user_id = v_uid and p.study_key = 'b1';
  if not found then
    raise exception 'Not a participant of this study.' using errcode = '42501';
  end if;

  if not (select s.enabled from public.boks_studies s where s.key = 'b1') then
    raise exception 'This study is not running.' using errcode = '55000';
  end if;

  -- Already claimed one for this bok (a reload): the same one again.
  select r.* into v_trace
  from public.boks_study_yokes y
  join public.boks_study_responses r on r.id = y.trace_response_id
  where y.passive_participant_id = v_participant.id and r.reel_id = p_reel_id;

  if v_trace.id is null then
    select r.* into v_trace
    from public.boks_study_responses r
    where r.step = 'trace'
      and r.study_key = 'b1'
      and r.reel_id = p_reel_id
      and r.participant_id <> v_participant.id
      and not exists (select 1 from public.boks_study_yokes y where y.trace_response_id = r.id)
    order by r.created_at
    limit 1
    for update skip locked;

    if v_trace.id is null then
      return null;
    end if;

    insert into public.boks_study_yokes (trace_response_id, passive_participant_id)
    values (v_trace.id, v_participant.id);
  end if;

  return jsonb_build_object('traceId', v_trace.id, 'trace', v_trace.answers);
end;
$$;

revoke all on function public.claim_boks_study_trace(uuid, uuid) from public, anon;
grant execute on function public.claim_boks_study_trace(uuid, uuid) to authenticated;


-- Studio ------------------------------------------------------------------

create or replace function public.list_boks_studies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', s.key,
      'enabled', s.enabled,
      'materials', s.materials,
      'updatedAt', s.updated_at,
      'participants', (select count(*) from public.boks_study_participants p where p.study_key = s.key),
      'completed', (select count(*) from public.boks_study_participants p where p.study_key = s.key and p.completed_at is not null),
      'byCondition', coalesce((
        select jsonb_object_agg(c.condition, c.n)
        from (
          select p.condition, count(*) as n from public.boks_study_participants p
          where p.study_key = s.key group by p.condition
        ) c
      ), '{}'::jsonb),
      'responses', (select count(*) from public.boks_study_responses r where r.study_key = s.key),
      'lastResponseAt', (select max(r.created_at) from public.boks_study_responses r where r.study_key = s.key),
      'fragments', case when s.key = 'b3' then (select count(*) from public.boks_study_fragments) else null end
    ) order by array_position(array['rg1', 'rg2', 'a1', 'a2', 'b1', 'b2', 'b3'], s.key))
    from public.boks_studies s
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_boks_studies() from public, anon;
grant execute on function public.list_boks_studies() to authenticated;


create or replace function public.set_boks_study_enabled(p_key text, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  update public.boks_studies s
  set enabled = coalesce(p_enabled, false), updated_at = now(), updated_by = (select auth.uid())
  where s.key = lower(btrim(coalesce(p_key, '')));
  if not found then
    raise exception 'There is no such study.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_boks_study_enabled(text, boolean) from public, anon;
grant execute on function public.set_boks_study_enabled(text, boolean) to authenticated;


create or replace function public.set_boks_study_materials(p_key text, p_materials jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_materials, 'null'::jsonb)) <> 'object' then
    raise exception 'Materials must be a JSON object.' using errcode = '22023';
  end if;

  update public.boks_studies s
  set materials = p_materials, updated_at = now(), updated_by = (select auth.uid())
  where s.key = lower(btrim(coalesce(p_key, '')));
  if not found then
    raise exception 'There is no such study.' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_boks_study_materials(text, jsonb) from public, anon;
grant execute on function public.set_boks_study_materials(text, jsonb) to authenticated;


-- Raw responses for analysis and export, oldest first, a page at a time.
-- `team` marks admins' own runs so the analysis can leave them out.
create or replace function public.get_boks_study_responses(p_key text, p_limit integer default 1000, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := lower(btrim(coalesce(p_key, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total', (select count(*) from public.boks_study_responses r where r.study_key = v_key),
    'rows', coalesce((
      select jsonb_agg(row_data order by row_id)
      from (
        select r.id as row_id, jsonb_build_object(
          'id', r.id,
          'participantId', r.participant_id,
          'participantCondition', p.condition,
          'participantSeed', p.seed,
          'participantCompletedAt', p.completed_at,
          'team', exists (select 1 from public.user_profiles u where u.user_id = p.user_id and u.role = 'admin'),
          'step', r.step,
          'reelId', r.reel_id,
          'fragmentId', r.fragment_id,
          'condition', r.condition,
          'answers', r.answers,
          'clientSeconds', r.client_seconds,
          'createdAt', r.created_at
        ) as row_data
        from public.boks_study_responses r
        join public.boks_study_participants p on p.id = r.participant_id
        where r.study_key = v_key
        order by r.id
        limit v_limit offset v_offset
      ) page
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_boks_study_responses(text, integer, integer) from public, anon;
grant execute on function public.get_boks_study_responses(text, integer, integer) to authenticated;


create or replace function public.import_boks_study_fragments(p_batch text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch text := lower(btrim(coalesce(p_batch, '')));
  v_count integer;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Fragments must be a JSON array of at most 500.' using errcode = '22023';
  end if;

  insert into public.boks_study_fragments (
    batch, method, source_title, source_author, language, body, candidate_rank, word_count, created_by
  )
  select
    v_batch,
    lower(btrim(row ->> 'method')),
    left(btrim(coalesce(row ->> 'sourceTitle', '')), 200),
    left(btrim(coalesce(row ->> 'sourceAuthor', '')), 200),
    left(lower(btrim(coalesce(nullif(row ->> 'language', ''), 'ru'))), 8),
    row ->> 'body',
    nullif(row ->> 'rank', '')::integer,
    coalesce(array_length(regexp_split_to_array(btrim(row ->> 'body'), '\s+'), 1), 0),
    (select auth.uid())
  from jsonb_array_elements(p_rows) as row;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.import_boks_study_fragments(text, jsonb) from public, anon;
grant execute on function public.import_boks_study_fragments(text, jsonb) to authenticated;


create or replace function public.list_boks_study_fragments(p_batch text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_batch text := nullif(lower(btrim(coalesce(p_batch, ''))), '');
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'batch', f.batch,
      'method', f.method,
      'sourceTitle', f.source_title,
      'sourceAuthor', f.source_author,
      'language', f.language,
      'rank', f.candidate_rank,
      'wordCount', f.word_count,
      'createdAt', f.created_at
    ) order by f.batch, f.source_title, f.candidate_rank nulls last, f.created_at)
    from public.boks_study_fragments f
    where v_batch is null or f.batch = v_batch
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_boks_study_fragments(text) from public, anon;
grant execute on function public.list_boks_study_fragments(text) to authenticated;


create or replace function public.delete_boks_study_fragment_batch(p_batch text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  -- Rated fragments stay: their answers are data.
  delete from public.boks_study_fragments f
  where f.batch = lower(btrim(coalesce(p_batch, '')))
    and not exists (select 1 from public.boks_study_responses r where r.fragment_id = f.id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.delete_boks_study_fragment_batch(text) from public, anon;
grant execute on function public.delete_boks_study_fragment_batch(text) to authenticated;
