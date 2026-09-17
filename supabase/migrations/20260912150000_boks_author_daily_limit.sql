-- boks author submission limit
--
-- Every permanent user may submit at most three boks per UTC day. The limit is
-- enforced in the database because the author cabinet cannot be trusted to hold
-- it, and it is reported through `get_my_bok_quota` so the cabinet can explain
-- the rule before an author writes a fourth piece.

create index if not exists reels_author_submitted_idx
  on public.reels (author_user_id, submitted_at desc)
  where author_user_id is not null;

create or replace function public.boks_daily_submission_limit()
returns integer
language sql
immutable
as $$
  select 3;
$$;

grant execute on function public.boks_daily_submission_limit() to authenticated;

create or replace function public.count_my_boks_submitted_today()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.reels
  where author_user_id = (select auth.uid())
    and submitted_at >= date_trunc('day', timezone('utc', now()));
$$;

revoke all on function public.count_my_boks_submitted_today() from public, anon, authenticated;
grant execute on function public.count_my_boks_submitted_today() to authenticated;

create or replace function public.get_my_bok_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_limit integer := public.boks_daily_submission_limit();
  v_used integer := 0;
begin
  if v_uid is not null and v_is_anonymous is false then
    v_used := public.count_my_boks_submitted_today();
  end if;

  return jsonb_build_object(
    'limit', v_limit,
    'usedToday', v_used,
    'remaining', greatest(v_limit - v_used, 0),
    'exhausted', v_used >= v_limit,
    'resetsAt', (date_trunc('day', timezone('utc', now())) + interval '1 day')
  );
end;
$$;

revoke all on function public.get_my_bok_quota() from public, anon, authenticated;
grant execute on function public.get_my_bok_quota() to authenticated;

create or replace function public.submit_bok_for_review(
  p_title text,
  p_author_name text,
  p_author_handle text,
  p_hook text,
  p_text text,
  p_genre text,
  p_mood text,
  p_minutes integer
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
  v_author_name text := coalesce(nullif(trim(coalesce(p_author_name, '')), ''), 'boks author');
  v_author_handle text := trim(coalesce(p_author_handle, ''));
  v_hook text := trim(coalesce(p_hook, ''));
  v_genre text := coalesce(nullif(trim(coalesce(p_genre, '')), ''), 'literary');
  v_mood text := coalesce(nullif(trim(coalesce(p_mood, '')), ''), 'quiet');
  v_minutes integer := coalesce(p_minutes, 5);
  v_limit integer := public.boks_daily_submission_limit();
  v_used integer;
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

  if v_minutes < 1 or v_minutes > 15 then
    raise exception 'A bok must fit inside 15 minutes.' using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile(v_author_name);

  -- Serialize this author's submissions on their own profile row so two
  -- parallel requests cannot both read a stale count and slip past the limit.
  perform 1 from public.user_profiles where user_id = v_uid for update;

  v_used := public.count_my_boks_submitted_today();

  if v_used >= v_limit then
    raise exception 'Daily limit reached. You can submit % boks a day.', v_limit using errcode = '54023';
  end if;

  insert into public.reels (
    title,
    author_name,
    author_handle,
    hook,
    text,
    genre,
    mood,
    minutes,
    status,
    author_user_id,
    submitted_at,
    updated_at
  )
  values (
    v_title,
    left(v_author_name, 120),
    left(v_author_handle, 80),
    left(v_hook, 500),
    v_text,
    left(v_genre, 30),
    left(v_mood, 30),
    v_minutes,
    'pending_review',
    v_uid,
    now(),
    now()
  )
  returning * into v_bok;

  return jsonb_build_object(
    'id', v_bok.id::text,
    'title', v_bok.title,
    'status', v_bok.status,
    'submittedAt', v_bok.submitted_at,
    'quota', public.get_my_bok_quota()
  );
end;
$$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, text, text, integer) to authenticated;
