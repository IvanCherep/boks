-- The reader introduction's answers (docs/onboarding.md): a reader's explicit
-- starting preferences, kept and used by the feed.
--
-- 1. `reader_starting_preferences`: one row per account - a guest's
--    anonymous one or a permanent one - with the introduction's version, how
--    it ended (completed or skipped), the reading languages it chose, the
--    preferred form (prose, poetry, either) and the classics the reader picked
--    on the shelf (the introduction's stable ids and their bylines). A choice
--    is a starting preference: not a follow, a like or a read.
-- 2. `save_my_starting_preferences(p_answers, p_adopt)`: the reader saves their
--    own answers. With `p_adopt` - a guest's answers carried into the account
--    they just signed in to - an account that already has answers keeps them:
--    signing in never overwrites what a person chose before.
-- 3. `get_my_starting_preferences()`: the feed reads them as the reader
--    (lib/boks/feed-service.ts), the introduction to resume.
-- Only these functions reach the table; nobody reads another person's answers.

create table if not exists public.reader_starting_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  version integer not null default 1 check (version between 1 and 100),
  status text not null check (status in ('completed', 'skipped')),
  form text not null default 'any' check (form in ('any', 'prose', 'poetry')),
  reading_languages text[] not null default '{}'
    check (reading_languages <@ array['ru', 'en']::text[]),
  classic_ids text[] not null default '{}'
    check (cardinality(classic_ids) <= 60),
  classic_names text[] not null default '{}'
    check (cardinality(classic_names) <= 120),
  visitor_id text check (visitor_id is null or char_length(visitor_id) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reader_starting_preferences enable row level security;
revoke all on table public.reader_starting_preferences from public, anon, authenticated;

create or replace function public.boks_starting_preferences_json(p_row public.reader_starting_preferences)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_row.user_id is null then null else jsonb_build_object(
    'version', p_row.version,
    'status', p_row.status,
    'form', p_row.form,
    'readingLanguages', to_jsonb(p_row.reading_languages),
    'classicIds', to_jsonb(p_row.classic_ids),
    'classicNames', to_jsonb(p_row.classic_names),
    'updatedAt', p_row.updated_at
  ) end;
$$;

create or replace function public.save_my_starting_preferences(p_answers jsonb, p_adopt boolean default false, p_visitor_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status text := p_answers ->> 'status';
  v_form text := coalesce(p_answers ->> 'form', 'any');
  v_languages text[];
  v_ids text[];
  v_names text[];
  v_row public.reader_starting_preferences;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if v_status not in ('completed', 'skipped') then
    raise exception 'How did the introduction end?' using errcode = '22023';
  end if;
  if v_form not in ('any', 'prose', 'poetry') then v_form := 'any'; end if;

  select coalesce(array_agg(distinct value), '{}') into v_languages
  from jsonb_array_elements_text(coalesce(p_answers -> 'readingLanguages', '[]'::jsonb)) as value
  where value in ('ru', 'en');

  -- The shelf's own ids (lowercase, digits, dashes) and the bylines they stand for.
  select coalesce(array_agg(id order by ord), '{}'), coalesce(array_agg(name order by ord) filter (where name is not null), '{}')
  into v_ids, v_names
  from (
    select left(item ->> 'id', 40) as id, nullif(left(btrim(coalesce(item -> 'name' ->> 'ru', item ->> 'name', '')), 120), '') as name, ord
    from jsonb_array_elements(coalesce(p_answers -> 'classics', '[]'::jsonb)) with ordinality as t(item, ord)
    where (item ->> 'id') ~ '^[a-z0-9-]{1,40}$'
    limit 60
  ) chosen;
  -- Both languages of a byline, so a Russian or an English catalogue entry matches.
  select coalesce(array_agg(distinct name), '{}') into v_names
  from (
    select nullif(left(btrim(item -> 'name' ->> 'ru'), 120), '') as name from jsonb_array_elements(coalesce(p_answers -> 'classics', '[]'::jsonb)) item
    union all
    select nullif(left(btrim(item -> 'name' ->> 'en'), 120), '') from jsonb_array_elements(coalesce(p_answers -> 'classics', '[]'::jsonb)) item
  ) names where name is not null;

  select * into v_row from public.reader_starting_preferences where user_id = v_uid for update;
  if v_row.user_id is not null and coalesce(p_adopt, false) then
    return public.boks_starting_preferences_json(v_row);
  end if;

  insert into public.reader_starting_preferences (user_id, version, status, form, reading_languages, classic_ids, classic_names, visitor_id, updated_at)
  values (
    v_uid,
    least(greatest(coalesce((p_answers ->> 'version')::integer, 1), 1), 100),
    v_status, v_form, v_languages, v_ids, v_names,
    nullif(left(coalesce(p_visitor_id, ''), 120), ''),
    now()
  )
  on conflict (user_id) do update
    set version = excluded.version, status = excluded.status, form = excluded.form,
        reading_languages = excluded.reading_languages, classic_ids = excluded.classic_ids,
        classic_names = excluded.classic_names, visitor_id = coalesce(excluded.visitor_id, public.reader_starting_preferences.visitor_id),
        updated_at = now()
  returning * into v_row;

  return public.boks_starting_preferences_json(v_row);
end;
$$;

create or replace function public.get_my_starting_preferences()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.boks_starting_preferences_json(r)
  from public.reader_starting_preferences r
  where r.user_id = (select auth.uid());
$$;

revoke all on function public.boks_starting_preferences_json(public.reader_starting_preferences) from public, anon, authenticated;
revoke all on function public.save_my_starting_preferences(jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.get_my_starting_preferences() from public, anon, authenticated;
grant execute on function public.save_my_starting_preferences(jsonb, boolean, text) to authenticated;
grant execute on function public.get_my_starting_preferences() to authenticated;
