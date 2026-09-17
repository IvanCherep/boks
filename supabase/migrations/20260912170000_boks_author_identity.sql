-- boks author identity
--
-- A bok's byline is the author's profile identity, not free text.
--
-- `submit_bok_for_review` used to accept `p_author_name` and `p_author_handle`
-- straight from the browser, so an author could publish under any name,
-- including another author's. That contradicts the product rule that public
-- identity is the signed-in user's unique @nickname. The RPC now derives both
-- from `public.user_profiles` and the two parameters are gone, so a locked
-- field in the cabinet is an actual guarantee rather than a UI convention.

drop function if exists public.submit_bok_for_review(text, text, text, text, text, text, text, integer);

create or replace function public.submit_bok_for_review(
  p_title text,
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
  v_hook text := trim(coalesce(p_hook, ''));
  v_genre text := coalesce(nullif(trim(coalesce(p_genre, '')), ''), 'literary');
  v_mood text := coalesce(nullif(trim(coalesce(p_mood, '')), ''), 'quiet');
  v_minutes integer := coalesce(p_minutes, 5);
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

  if v_minutes < 1 or v_minutes > 15 then
    raise exception 'A bok must fit inside 15 minutes.' using errcode = '22023';
  end if;

  perform public.ensure_boks_user_profile('');

  -- Serialize this author's submissions on their own profile row so two
  -- parallel requests cannot both read a stale count and slip past the limit.
  select
    coalesce(nullif(btrim(display_name), ''), 'boks author'),
    coalesce(handle, '')
  into v_author_name, v_author_handle
  from public.user_profiles
  where user_id = v_uid
  for update;

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
    'authorName', v_bok.author_name,
    'authorHandle', v_bok.author_handle,
    'submittedAt', v_bok.submitted_at,
    'quota', public.get_my_bok_quota()
  );
end;
$$;

revoke all on function public.submit_bok_for_review(text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.submit_bok_for_review(text, text, text, text, text, integer) to authenticated;

-- Existing author-submitted boks carry whatever was typed into the old free
-- text fields. Realign them with the profile that owns them.
update public.reels r
set
  author_name = coalesce(nullif(btrim(up.display_name), ''), r.author_name),
  author_handle = coalesce(up.handle, r.author_handle),
  updated_at = now()
from public.user_profiles up
where up.user_id = r.author_user_id
  and r.author_user_id is not null;
