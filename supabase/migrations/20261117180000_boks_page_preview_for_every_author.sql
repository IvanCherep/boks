-- The page preview for every author (`docs/author-applications.md`, `docs/series-recorder.md`).
--
-- The cabinet now shows the reader's page beside the order of works
-- (my-page.tsx), for every author who can order them - and ordering never
-- needed a prepared page (`save_author_space_order` makes one). So the preview
-- no longer needs one either: an author without a space is previewed from
-- their published boks. And a published bok's own recording (`series_piece`,
-- what the Series recorder publishes) now travels with it, so the preview
-- plays it as the page does.

create or replace function public.get_author_space_preview(p_space_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_space public.author_spaces;
  v_access text;
begin
  if p_space_id is null then
    select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';
  else
    select * into v_space from public.author_spaces where id = p_space_id;
  end if;
  -- An author who never had a page prepared still has one: their published
  -- boks, newest first, under their byline - the page readers see. Ordering
  -- it (`save_author_space_order`) gives it a space; until then it is previewed as it is.
  if p_space_id is null and v_space.id is null and v_uid is not null
     and exists (select 1 from public.reels r where r.author_user_id = v_uid and r.status = 'published') then
    return jsonb_build_object(
      'id', null,
      'kind', 'author',
      'status', 'published',
      'access', 'owner',
      'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
      'name', (select r.author_name from public.reels r where r.author_user_id = v_uid and btrim(coalesce(r.author_name, '')) <> '' order by coalesce(r.submitted_at, r.created_at) desc limit 1),
      'photo', null,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
            'key', 'b:' || b.id::text, 'bokId', b.id::text, 'title', b.title, 'published', true,
            'format', 'text', 'seriesHeld', false, 'body', b.text
          ) order by b.created_at desc)
        from public.published_boks b where b.author_user_id = v_uid
      ), '[]'::jsonb)
    );
  end if;

  v_access := public.boks_space_access(v_space.id);
  if v_space.id is null or v_access is null then
    raise exception 'This page is not available.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_space.id::text,
    'kind', v_space.kind,
    'status', v_space.status,
    'access', v_access,
    'handle', public.boks_space_handle(v_space),
    'name', v_space.name,
    'photo', case when v_space.photo is null then null else encode(v_space.photo, 'base64') end,
    'items', coalesce((
      with published as (
        select x.bok_id, x.sort_position as position, x.created_at from public.boks_space_public_boks(v_space) x
      ),
      rows as (
        select p.position, p.created_at,
          jsonb_build_object(
            'key', 'b:' || b.id::text, 'bokId', b.id::text, 'title', b.title, 'published', true,
            'format', coalesce(public.boks_space_bok_format(v_space.id, b.id) ->> 'format', 'text'),
            'seriesHeld', coalesce((public.boks_space_bok_format(v_space.id, b.id) ->> 'seriesHeld')::boolean, false),
            -- Its own recording (the Series recorder, or one the team attached): played on the page.
            'seriesPiece', public.boks_space_bok_format(v_space.id, b.id) ->> 'seriesPiece',
            'body', b.text
          ) as item
        from published p join public.published_boks b on b.id = p.bok_id
        union all
        select w.position, w.created_at,
          jsonb_build_object(
            'key', 'w:' || w.id::text, 'workId', w.id::text, 'bokId', w.bok_id::text, 'title', w.title,
            'published', false, 'format', w.format, 'status', w.status, 'revision', w.revision,
            'seriesPiece', w.series_piece,
            'body', coalesce(w.body, r.text)
          )
        from public.author_space_works w
        left join public.reels r on r.id = w.bok_id
        where w.space_id = v_space.id and w.status not in ('published', 'withdrawn')
          and not (w.bok_id is not null and exists (select 1 from published p where p.bok_id = w.bok_id))
      )
      select jsonb_agg(r.item order by r.position nulls last, r.created_at desc) from rows r
    ), '[]'::jsonb)
  );
end;
$$;
