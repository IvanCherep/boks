-- Keep the comments read model compatible after boks moved to handle-only
-- identity. `visitor_name` is retained only as a legacy alias for clients and
-- tests that have not yet dropped the old field; it is deliberately the same
-- value as `visitor_handle`, not a separate display name.

create or replace view public.boks_comments as
select
  c.id,
  c.reel_id,
  c.user_id,
  c.body,
  c.created_at,
  coalesce(i.handle, '') as visitor_handle,
  coalesce(i.handle, '') as visitor_name
from public.comments c
join public.reels r on r.id = c.reel_id and r.status = 'published'
left join public.boks_public_identity i on i.user_id = c.user_id;

revoke all on public.boks_comments from public;
grant select on public.boks_comments to anon, authenticated;

create or replace function public.create_bok_comment(p_reel_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_anonymous boolean := coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false);
  v_body text := btrim(coalesce(p_body, ''));
  v_handle text;
  v_row public.comments;
begin
  if v_uid is null or v_anonymous then
    raise exception 'Sign in to comment.' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1200 then
    raise exception 'A comment must be between 1 and 1200 characters.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.reels where id = p_reel_id and status = 'published') then
    raise exception 'That boks is not available.' using errcode = '22023';
  end if;

  select handle
  into v_handle
  from public.user_profiles
  where user_id = v_uid;

  if v_handle is null then
    raise exception 'Create your reading profile before commenting.' using errcode = '42501';
  end if;

  insert into public.comments (user_id, reel_id, body)
  values (v_uid, p_reel_id, v_body)
  returning * into v_row;

  return (
    select jsonb_build_object(
      'id', c.id,
      'storyId', c.reel_id::text,
      'visitorName', c.visitor_handle,
      'visitorHandle', c.visitor_handle,
      'body', c.body,
      'createdAt', c.created_at
    )
    from public.boks_comments c
    where c.id = v_row.id
  );
end;
$function$;

revoke all on function public.create_bok_comment(uuid, text) from public, anon, authenticated;
grant execute on function public.create_bok_comment(uuid, text) to authenticated;
