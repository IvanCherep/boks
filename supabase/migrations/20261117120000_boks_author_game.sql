-- Guess the author (2026-11-17).
--
-- One short text a day, the same for everyone, published at 00:00 Moscow
-- time. The reader sees only the text and three names; the title, the bok id
-- and the author come back only with their answer (`get_author_game` /
-- `answer_author_game`). One confirmed answer per account per issue;
-- revealing without answering is allowed and is not counted in the shares.
--
-- Scheduling without a cron: Studio and the day's first reader request keep
-- the next seven dates stocked with three different candidates
-- (`boks_game_fill`). An issue is published on the first request of its day,
-- under a row lock and a unique date, so it is published exactly once: the
-- editor's valid choice, else the first available candidate by stored
-- position, else the next, else a fresh one from the catalogue; with nothing
-- left the date is "needs stock" and readers are told there is no issue
-- today. Once published the text and the order of the names never change.
--
-- Every table is reached only through these functions (ADR 0011). Needs
-- `boks_require_reader_account` and `boks_require_editor` from earlier files.

-- ---------------------------------------------------------------------------
-- Guess the author: tables
-- ---------------------------------------------------------------------------

create table public.author_game_issues (
  game_date date primary key,
  -- The editor's choice, a position 1..3; null means "the first available".
  chosen_position smallint,
  chosen_at timestamptz,
  chosen_by uuid references auth.users(id) on delete set null,
  -- Fixed at publication; never changed afterwards.
  published_at timestamptz,
  published_position smallint,
  published_bok_id uuid references public.reels(id) on delete set null,
  published_options text[],
  published_correct smallint,
  -- The last failed try to publish (nothing to publish): readers' requests
  -- wait ten minutes before trying again, rather than each taking the lock.
  publish_tried_at timestamptz,
  constraint author_game_issues_chosen check (chosen_position is null or chosen_position between 1 and 3),
  constraint author_game_issues_published_whole check (
    (published_at is null and published_options is null and published_correct is null and published_position is null)
    or (published_at is not null and array_length(published_options, 1) = 3 and published_correct between 0 and 2 and published_position between 1 and 3)
  )
);

create table public.author_game_candidates (
  id uuid primary key default gen_random_uuid(),
  game_date date not null,
  position smallint not null,
  bok_id uuid references public.reels(id) on delete set null,
  -- The three names readers choose from, in the order they are shown.
  options text[] not null,
  correct smallint not null,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,
  replaced_by uuid references auth.users(id) on delete set null,
  constraint author_game_candidates_position check (position between 1 and 3),
  constraint author_game_candidates_options check (array_length(options, 1) = 3 and correct between 0 and 2),
  constraint author_game_candidates_one_per_position unique (game_date, position)
);
create index author_game_candidates_bok_idx on public.author_game_candidates (bok_id);

create table public.author_game_answers (
  game_date date not null references public.author_game_issues(game_date) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Null: the reader revealed the answer without choosing.
  choice smallint,
  correct boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (game_date, user_id),
  constraint author_game_answers_choice check (choice is null or choice between 0 and 2)
);
create index author_game_answers_user_idx on public.author_game_answers (user_id);

alter table public.author_game_issues enable row level security;
alter table public.author_game_candidates enable row level security;
alter table public.author_game_answers enable row level security;
revoke all on public.author_game_issues, public.author_game_candidates, public.author_game_answers
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guess the author: functions
-- ---------------------------------------------------------------------------

-- The game's day: Moscow, for everyone.
create or replace function public.boks_game_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Moscow')::date;
$$;
revoke all on function public.boks_game_today() from public, anon, authenticated;

-- Catalogue authors the game names: published Russian catalogue texts with
-- a named author. Called only from the functions below (no security definer,
-- so the planner can inline it).
create or replace function public.boks_game_authors()
returns table (bok_id uuid, author_name text, verse boolean, word_count integer, minutes integer)
language sql
stable
set search_path = ''
as $$
  select b.id, btrim(b.author_name), b.reading_shape = 'verse', b.word_count, b.minutes
  from public.reels b
  left join public.user_profiles a on a.user_id = b.author_user_id
  where b.status = 'published'
    and b.language = 'ru'
    and (b.author_user_id is null or a.is_publisher)
    and b.author_name is not null
    and btrim(b.author_name) <> ''
    and b.author_name !~* '(народн|неизвестн|аноним|anonymous|unknown|folk)';
$$;
revoke all on function public.boks_game_authors() from public, anon, authenticated;

-- Texts the game may use: those, two minutes of reading or less.
create or replace function public.boks_game_pool()
returns table (bok_id uuid, author_name text, verse boolean)
language sql
stable
set search_path = ''
as $$
  select a.bok_id, a.author_name, a.verse
  from public.boks_game_authors() a
  where a.word_count between 20 and 360 and a.minutes <= 2;
$$;
revoke all on function public.boks_game_pool() from public, anon, authenticated;

-- The last word of a name, which is what two different authors must not share
-- among one question's options (Лев and Алексей Толстой).
create or replace function public.boks_surname(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)], ''));
$$;
revoke all on function public.boks_surname(text) from public, anon, authenticated;

-- One candidate for a date: a text, its author and two other catalogue
-- authors with other surnames (the same kind of writing first: poets for a
-- poem), shuffled once. Never a text another date of the coming fortnight
-- holds; texts never published in the game first, then the longest ago.
create or replace function public.boks_game_candidate(p_date date, p_exclude_authors text[], p_exclude_boks uuid[])
returns table (bok_id uuid, options text[], correct smallint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_bok record;
  v_others text[];
  v_options text[];
  v_order integer[];
begin
  select p.bok_id, p.author_name, p.verse into v_bok
  from public.boks_game_pool() p
  left join lateral (
    select max(i.game_date) as last_published from public.author_game_issues i where i.published_bok_id = p.bok_id
  ) lp on true
  where not (p.bok_id = any (coalesce(p_exclude_boks, '{}')))
    and not (public.boks_surname(p.author_name) = any (coalesce(p_exclude_authors, '{}')))
    and not exists (
      select 1 from public.author_game_candidates c
      where c.bok_id = p.bok_id and c.game_date between p_date - 7 and p_date + 14
    )
  order by lp.last_published nulls first, random()
  limit 1;
  if v_bok.bok_id is null then
    return;
  end if;

  select array_agg(n.author_name) into v_others
  from (
    select s.author_name
    from (
      select distinct on (public.boks_surname(a.author_name)) a.author_name, a.verse = v_bok.verse as same_kind
      from public.boks_game_authors() a
      where public.boks_surname(a.author_name) <> public.boks_surname(v_bok.author_name)
      order by public.boks_surname(a.author_name), (a.verse = v_bok.verse) desc, random()
    ) s
    order by s.same_kind desc, random()
    limit 2
  ) n;
  if coalesce(array_length(v_others, 1), 0) < 2 then
    return;
  end if;

  v_options := array[v_bok.author_name, v_others[1], v_others[2]];
  select array_agg(i order by random()) into v_order from generate_series(1, 3) i;
  bok_id := v_bok.bok_id;
  options := array[v_options[v_order[1]], v_options[v_order[2]], v_options[v_order[3]]];
  correct := (array_position(v_order, 1) - 1)::smallint;
  return next;
end;
$$;
revoke all on function public.boks_game_candidate(date, text[], uuid[]) from public, anon, authenticated;

-- Is a candidate still usable? Its text must still be in the pool.
create or replace function public.boks_game_candidate_valid(p_bok_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_bok_id is not null and exists (select 1 from public.boks_game_pool() p where p.bok_id = p_bok_id);
$$;
revoke all on function public.boks_game_candidate_valid(uuid) from public, anon, authenticated;

-- Fills one date's empty or unusable positions. Published dates are left alone.
create or replace function public.boks_game_fill_date(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position smallint;
  v_candidate record;
  v_authors text[];
  v_boks uuid[];
begin
  insert into public.author_game_issues (game_date) values (p_date) on conflict (game_date) do nothing;
  perform 1 from public.author_game_issues i where i.game_date = p_date for update;
  if exists (select 1 from public.author_game_issues i where i.game_date = p_date and i.published_at is not null) then
    return;
  end if;

  for v_position in 1..3 loop
    if exists (
      select 1 from public.author_game_candidates c
      where c.game_date = p_date and c.position = v_position and public.boks_game_candidate_valid(c.bok_id)
    ) then
      continue;
    end if;
    select coalesce(array_agg(public.boks_surname(b.author_name)), '{}'), coalesce(array_agg(c.bok_id), '{}')
      into v_authors, v_boks
    from public.author_game_candidates c
    join public.reels b on b.id = c.bok_id
    where c.game_date = p_date and c.position <> v_position;
    select * into v_candidate from public.boks_game_candidate(p_date, v_authors, v_boks);
    if v_candidate.bok_id is null then
      continue;
    end if;
    update public.author_game_issues i set publish_tried_at = null where i.game_date = p_date;
    insert into public.author_game_candidates (game_date, position, bok_id, options, correct)
    values (p_date, v_position, v_candidate.bok_id, v_candidate.options, v_candidate.correct)
    on conflict (game_date, position) do update
      set bok_id = excluded.bok_id, options = excluded.options, correct = excluded.correct, created_at = now(),
          replaced_at = null, replaced_by = null;
  end loop;
end;
$$;
revoke all on function public.boks_game_fill_date(date) from public, anon, authenticated;

-- Keeps the next `p_days` dates (today included) stocked.
create or replace function public.boks_game_fill(p_days integer default 7)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.boks_game_today();
  v_date date;
begin
  for v_date in select generate_series(v_today, v_today + greatest(1, least(coalesce(p_days, 7), 31)) - 1, interval '1 day')::date loop
    if (
      select count(*) from public.author_game_candidates c
      where c.game_date = v_date and public.boks_game_candidate_valid(c.bok_id)
    ) < 3 and not exists (
      select 1 from public.author_game_issues i where i.game_date = v_date and i.published_at is not null
    ) then
      perform public.boks_game_fill_date(v_date);
    end if;
  end loop;
end;
$$;
revoke all on function public.boks_game_fill(integer) from public, anon, authenticated;

-- Publishes a date's issue once. Returns the issue (published or not).
create or replace function public.boks_game_publish(p_date date)
returns public.author_game_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.author_game_issues;
  v_candidate public.author_game_candidates;
begin
  insert into public.author_game_issues (game_date) values (p_date) on conflict (game_date) do nothing;
  select * into v_issue from public.author_game_issues i where i.game_date = p_date for update;
  if v_issue.published_at is not null then
    return v_issue;
  end if;

  for attempt in 1..2 loop
    -- The editor's valid choice, else the first available by position.
    select c.* into v_candidate
    from public.author_game_candidates c
    where c.game_date = p_date and public.boks_game_candidate_valid(c.bok_id)
    order by (c.position = v_issue.chosen_position) desc nulls last, c.position
    limit 1;
    exit when v_candidate.id is not null;
    perform public.boks_game_fill_date(p_date);
  end loop;

  if v_candidate.id is null then
    return v_issue;
  end if;

  update public.author_game_issues i
  set published_at = now(), published_position = v_candidate.position, published_bok_id = v_candidate.bok_id,
      published_options = v_candidate.options, published_correct = v_candidate.correct
  where i.game_date = p_date
  returning * into v_issue;
  return v_issue;
end;
$$;
revoke all on function public.boks_game_publish(date) from public, anon, authenticated;

-- What a reader may know after answering.
create or replace function public.boks_game_result_json(p_issue public.author_game_issues, p_answer public.author_game_answers)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'choice', p_answer.choice,
    'revealed', p_answer.choice is null,
    'correct', p_answer.correct,
    'correctIndex', p_issue.published_correct,
    'authorName', p_issue.published_options[p_issue.published_correct + 1],
    'title', b.title,
    'bokId', b.id::text,
    'counts', jsonb_build_array(
      (select count(*) from public.author_game_answers a where a.game_date = p_issue.game_date and a.choice = 0),
      (select count(*) from public.author_game_answers a where a.game_date = p_issue.game_date and a.choice = 1),
      (select count(*) from public.author_game_answers a where a.game_date = p_issue.game_date and a.choice = 2)
    )
  )
  from (select 1) one
  left join public.reels b on b.id = p_issue.published_bok_id and b.status = 'published';
$$;
revoke all on function public.boks_game_result_json(public.author_game_issues, public.author_game_answers) from public, anon, authenticated;

-- Today's issue, published by the day's first request (which also restocks
-- the coming week). With nothing to publish, readers try again only every
-- ten minutes.
create or replace function public.boks_game_issue_today()
returns public.author_game_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.boks_game_today();
  v_issue public.author_game_issues;
begin
  select * into v_issue from public.author_game_issues i where i.game_date = v_today;
  if v_issue.published_at is null and (v_issue.publish_tried_at is null or v_issue.publish_tried_at < now() - interval '10 minutes') then
    v_issue := public.boks_game_publish(v_today);
    perform public.boks_game_fill(7);
    if v_issue.published_at is null then
      update public.author_game_issues i set publish_tried_at = now() where i.game_date = v_today returning * into v_issue;
    end if;
  end if;
  return v_issue;
end;
$$;
revoke all on function public.boks_game_issue_today() from public, anon, authenticated;

-- Today's issue for a reader. The text and the three names only; the rest
-- after their answer. A guest may read it; answering needs an account.
create or replace function public.get_author_game()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_issue public.author_game_issues := public.boks_game_issue_today();
  v_answer public.author_game_answers;
  v_text text;
  v_words integer;
begin
  if v_issue.published_at is null then
    return jsonb_build_object('date', public.boks_game_today(), 'status', 'none');
  end if;
  select b.text, b.word_count into v_text, v_words
  from public.reels b where b.id = v_issue.published_bok_id and b.status = 'published';
  if v_text is null then
    return jsonb_build_object('date', v_issue.game_date, 'status', 'none');
  end if;
  if v_uid is not null then
    select * into v_answer from public.author_game_answers a where a.game_date = v_issue.game_date and a.user_id = v_uid;
  end if;
  return jsonb_build_object(
    'date', v_issue.game_date,
    'status', case when v_answer.user_id is null then 'open' else 'answered' end,
    'text', v_text,
    'words', v_words,
    'options', to_jsonb(v_issue.published_options),
    'result', case when v_answer.user_id is null then null else public.boks_game_result_json(v_issue, v_answer) end
  );
end;
$$;
revoke all on function public.get_author_game() from public, anon, authenticated;
grant execute on function public.get_author_game() to authenticated;

-- Only whether today's text waits for this reader: the mark on Settings and
-- the day card, without sending the text on every page load.
create or replace function public.get_author_game_status()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_issue public.author_game_issues := public.boks_game_issue_today();
begin
  if v_issue.published_at is null or not exists (
    select 1 from public.reels b where b.id = v_issue.published_bok_id and b.status = 'published'
  ) then
    return 'none';
  end if;
  if v_uid is not null and exists (
    select 1 from public.author_game_answers a where a.game_date = v_issue.game_date and a.user_id = v_uid
  ) then
    return 'answered';
  end if;
  return 'open';
end;
$$;
revoke all on function public.get_author_game_status() from public, anon, authenticated;
grant execute on function public.get_author_game_status() to authenticated;

-- One confirmed answer per account and issue. `p_choice` null reveals the
-- answer without choosing; it is kept, so it cannot be followed by a guess.
create or replace function public.answer_author_game(p_date date, p_choice integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_issue public.author_game_issues;
  v_answer public.author_game_answers;
begin
  if p_choice is not null and (p_choice < 0 or p_choice > 2) then
    raise exception 'Choose one of the three names.' using errcode = '22023';
  end if;
  select * into v_issue from public.author_game_issues i where i.game_date = p_date;
  -- Today's, or yesterday's for a reader who opened it before midnight.
  if v_issue.published_at is null or p_date < public.boks_game_today() - 1 or p_date > public.boks_game_today() then
    raise exception 'This issue is closed.' using errcode = 'P0002';
  end if;
  insert into public.author_game_answers (game_date, user_id, choice, correct)
  values (p_date, v_uid, p_choice, coalesce(p_choice = v_issue.published_correct, false))
  on conflict (game_date, user_id) do nothing;
  select * into v_answer from public.author_game_answers a where a.game_date = p_date and a.user_id = v_uid;
  return public.boks_game_result_json(v_issue, v_answer);
end;
$$;
revoke all on function public.answer_author_game(date, integer) from public, anon, authenticated;
grant execute on function public.answer_author_game(date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Guess the author: Studio
-- ---------------------------------------------------------------------------

create or replace function public.boks_game_candidate_json(p_candidate public.author_game_candidates, p_with_text boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_candidate.id::text,
    'position', p_candidate.position,
    'bokId', p_candidate.bok_id::text,
    'title', b.title,
    'authorName', b.author_name,
    'available', public.boks_game_candidate_valid(p_candidate.bok_id),
    'options', to_jsonb(p_candidate.options),
    'correct', p_candidate.correct,
    'words', b.word_count,
    'replacedAt', p_candidate.replaced_at,
    'text', case when p_with_text then b.text end
  )
  from (select 1) one
  left join public.reels b on b.id = p_candidate.bok_id;
$$;
revoke all on function public.boks_game_candidate_json(public.author_game_candidates, boolean) from public, anon, authenticated;

create or replace function public.boks_game_day_json(p_date date, p_with_text boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'date', p_date,
    'today', p_date = public.boks_game_today(),
    'chosenPosition', i.chosen_position,
    'publishedAt', i.published_at,
    'publishedPosition', i.published_position,
    'published', case when i.published_at is null then null else jsonb_build_object(
      'bokId', b.id::text, 'title', b.title, 'authorName', i.published_options[i.published_correct + 1],
      'options', to_jsonb(i.published_options), 'correct', i.published_correct,
      'answers', (select count(*) from public.author_game_answers a where a.game_date = p_date and a.choice is not null),
      'correctAnswers', (select count(*) from public.author_game_answers a where a.game_date = p_date and a.correct)
    ) end,
    'available', (
      select count(*) from public.author_game_candidates c
      where c.game_date = p_date and public.boks_game_candidate_valid(c.bok_id)
    ),
    'candidates', coalesce((
      select jsonb_agg(public.boks_game_candidate_json(c, p_with_text) order by c.position)
      from public.author_game_candidates c where c.game_date = p_date
    ), '[]'::jsonb)
  )
  from (select 1) one
  left join public.author_game_issues i on i.game_date = p_date
  left join public.reels b on b.id = i.published_bok_id;
$$;
revoke all on function public.boks_game_day_json(date, boolean) from public, anon, authenticated;

-- The next `p_days` dates, stocked first.
create or replace function public.studio_author_game_calendar(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_days integer := greatest(1, least(coalesce(p_days, 7), 31));
begin
  perform public.boks_require_editor();
  v_today := public.boks_game_today();
  perform public.boks_game_fill(v_days);
  return jsonb_build_object(
    'today', v_today,
    'days', (
      select jsonb_agg(public.boks_game_day_json(d::date, false) order by d)
      from generate_series(v_today, v_today + v_days - 1, interval '1 day') d
    )
  );
end;
$$;
revoke all on function public.studio_author_game_calendar(integer) from public, anon, authenticated;
grant execute on function public.studio_author_game_calendar(integer) to authenticated;

create or replace function public.studio_author_game_day(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.boks_require_editor();
  if p_date >= public.boks_game_today() then
    perform public.boks_game_fill_date(p_date);
  end if;
  return public.boks_game_day_json(p_date, true);
end;
$$;
revoke all on function public.studio_author_game_day(date) from public, anon, authenticated;
grant execute on function public.studio_author_game_day(date) to authenticated;

-- A date the editor may still change: today or later, not yet published.
create or replace function public.boks_game_lock_editable(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_date is null or p_date < public.boks_game_today() then
    raise exception 'This date has passed.' using errcode = '22023';
  end if;
  insert into public.author_game_issues (game_date) values (p_date) on conflict (game_date) do nothing;
  perform 1 from public.author_game_issues i where i.game_date = p_date for update;
  if exists (select 1 from public.author_game_issues i where i.game_date = p_date and i.published_at is not null) then
    raise exception 'This issue is already published and can no longer change.' using errcode = '55000';
  end if;
end;
$$;
revoke all on function public.boks_game_lock_editable(date) from public, anon, authenticated;

-- Chooses a candidate for the date, or (null) returns the date to the
-- automatic choice. Opening a preview is never a choice.
create or replace function public.studio_author_game_choose(p_date date, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
begin
  perform public.boks_game_lock_editable(p_date);
  if p_position is not null and not exists (
    select 1 from public.author_game_candidates c
    where c.game_date = p_date and c.position = p_position and public.boks_game_candidate_valid(c.bok_id)
  ) then
    raise exception 'That text is no longer available. Replace it or choose another.' using errcode = '22023';
  end if;
  update public.author_game_issues i
  set chosen_position = p_position,
      chosen_at = case when p_position is null then null else now() end,
      chosen_by = case when p_position is null then null else v_uid end
  where i.game_date = p_date;
  return public.boks_game_day_json(p_date, true);
end;
$$;
revoke all on function public.studio_author_game_choose(date, integer) from public, anon, authenticated;
grant execute on function public.studio_author_game_choose(date, integer) to authenticated;

-- Replaces one candidate in its own position. A replaced chosen text clears
-- the choice: the editor confirms the new one or leaves the automatic rule.
create or replace function public.studio_author_game_replace(p_date date, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_candidate record;
  v_authors text[];
  v_boks uuid[];
  v_was_chosen boolean;
begin
  if p_position is null or p_position not between 1 and 3 then
    raise exception 'Choose one of the three texts.' using errcode = '22023';
  end if;
  perform public.boks_game_lock_editable(p_date);
  select coalesce(array_agg(public.boks_surname(b.author_name)), '{}'), coalesce(array_agg(c.bok_id), '{}')
    into v_authors, v_boks
  from public.author_game_candidates c
  join public.reels b on b.id = c.bok_id
  where c.game_date = p_date;
  select * into v_candidate from public.boks_game_candidate(p_date, v_authors, v_boks);
  if v_candidate.bok_id is null then
    raise exception 'The catalogue has no other short text to offer. Add short catalogue texts first.' using errcode = 'P0002';
  end if;
  insert into public.author_game_candidates (game_date, position, bok_id, options, correct, replaced_at, replaced_by)
  values (p_date, p_position, v_candidate.bok_id, v_candidate.options, v_candidate.correct, now(), v_uid)
  on conflict (game_date, position) do update
    set bok_id = excluded.bok_id, options = excluded.options, correct = excluded.correct,
        replaced_at = excluded.replaced_at, replaced_by = excluded.replaced_by;
  select i.chosen_position = p_position into v_was_chosen from public.author_game_issues i where i.game_date = p_date;
  if coalesce(v_was_chosen, false) then
    update public.author_game_issues i set chosen_position = null, chosen_at = null, chosen_by = null where i.game_date = p_date;
  end if;
  return public.boks_game_day_json(p_date, true) || jsonb_build_object('choiceCleared', coalesce(v_was_chosen, false));
end;
$$;
revoke all on function public.studio_author_game_replace(date, integer) from public, anon, authenticated;
grant execute on function public.studio_author_game_replace(date, integer) to authenticated;
