-- boks author pages
--
-- A byline was a dead end: the reader could see who wrote a boks and could
-- follow them, but could not open them. There was no way to ask "what else has
-- this person written", which is the first thing anyone asks after finishing
-- something they liked.
--
-- The lookup key is the @handle, not the account id, for two reasons: it is the
-- identity the product already uses everywhere, and it is the only one the
-- seeded catalog has - those boks carry a byline but no account. An author
-- without an account can therefore still be read; they just cannot be followed.

create or replace function public.get_boks_author(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_handle text := lower(btrim(ltrim(coalesce(p_handle, ''), '@')));
  v_author_user_id uuid;
  v_name text;
begin
  if v_handle = '' then
    return null;
  end if;

  -- Account-backed authors first; the seeded catalog has no profile to find.
  select i.user_id, i.display_name
  into v_author_user_id, v_name
  from public.boks_public_identity i
  where lower(i.handle) = v_handle;

  if v_author_user_id is null then
    select b.author_name into v_name
    from public.published_boks b
    where lower(b.author_handle) = v_handle
    limit 1;
  end if;

  if v_name is null then
    return null;
  end if;

  return jsonb_build_object(
    'authorUserId', coalesce(v_author_user_id::text, ''),
    'authorName', v_name,
    'authorHandle', v_handle,
    'followers', (
      select count(*)::integer from public.author_follows f
      where v_author_user_id is not null and f.author_user_id = v_author_user_id
    ),
    -- Whether the caller follows them, so the sheet opens in the right state
    -- instead of flickering into it.
    'following', v_author_user_id is not null and exists (
      select 1 from public.author_follows f
      where f.author_user_id = v_author_user_id and f.follower_user_id = v_uid
    ),
    'boks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id::text,
        'title', b.title,
        'hook', b.hook,
        'minutes', b.minutes,
        'readingShape', b.reading_shape,
        'createdAt', b.created_at
      ) order by b.created_at desc)
      from public.published_boks b
      where lower(b.author_handle) = v_handle
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_boks_author(text) from public;
grant execute on function public.get_boks_author(text) to anon, authenticated;
