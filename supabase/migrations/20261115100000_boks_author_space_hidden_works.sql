-- Author pages, second step (2026-11-15).
--
-- 1. A work the author hides from the site stays on "My page", marked
--    hidden, and is put back from there (`get_my_author_space`).
-- 2. The author's own photo for their cabinet (`get_my_author_page.photo`):
--    the public photo address hides a page that is not open yet, which left
--    its own author looking at a broken image while reviewing it.
--
-- 3. A Series the author published with its text shows as Series on their
--    page at once (`boks_space_bok_format.seriesPiece`): its cover and its
--    player come from the link-only folder, so the page is whole from the
--    moment it opens. Before the author publishes, the token reaches nobody
--    but them and the team, as before. The feed and the Series shelf still
--    take a registration in code and a release (`series_published`).
--
-- All under the same signatures: every field the live client reads is still
-- there; the new ones are additions an older client ignores.

create or replace function public.get_my_author_space()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_space public.author_spaces;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_space from public.author_spaces where owner_user_id = v_uid and status <> 'merged';

  return jsonb_build_object(
    'space', case when v_space.id is null then null else jsonb_build_object(
      'id', v_space.id::text,
      'status', v_space.status,
      'orderVersion', v_space.order_version,
      'publishedAt', v_space.published_at
    ) end,
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    'name', coalesce((select a.page_name from public.author_pages a where a.user_id = v_uid), v_space.name),
    'shareCard', v_space.share_card,
    'shareVideo', v_space.share_video,
    'messages', case when v_space.id is null then '[]'::jsonb else public.boks_space_messages_json(v_space.id) end,
    'unread', case when v_space.id is null then 0 else (
      select count(*)::integer from public.author_space_messages m
      where m.space_id = v_space.id and not m.from_author and m.created_at > coalesce(v_space.author_seen_at, '-infinity'::timestamptz)
    ) end,
    'orderVersion', coalesce(v_space.order_version, 0),
    -- One list: what readers see (published boks) and what is prepared, in
    -- the page's order. Published boks of a page never ordered keep the
    -- order readers know (newest first), after anything placed by hand.
    'items', coalesce((
      with published as (
        select b.id, b.title, b.created_at, o.position
        from public.published_boks b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid
      ),
      -- Works the author took off the site themselves (withdraw_my_bok): kept
      -- on the list, marked hidden, so they can be put back from here.
      hidden as (
        select b.id, b.title, b.created_at, o.position
        from public.reels b
        left join public.author_space_order o on o.space_id = v_space.id and o.bok_id = b.id
        where b.author_user_id = v_uid and b.status = 'withdrawn' and b.withdrawn_from_status = 'published'
      ),
      prepared as (
        select w.* from public.author_space_works w
        where w.space_id = v_space.id and w.status not in ('published', 'withdrawn')
      ),
      rows as (
        select 'b:' || p.id::text as key, p.position, p.created_at, 1 as published_first,
          jsonb_build_object(
            'key', 'b:' || p.id::text,
            'bokId', p.id::text,
            'title', p.title,
            'published', true,
            'format', coalesce(public.boks_space_bok_format(v_space.id, p.id) ->> 'format', 'text'),
            'seriesHeld', coalesce((public.boks_space_bok_format(v_space.id, p.id) ->> 'seriesHeld')::boolean, false),
            'work', (
              select public.boks_space_work_json(w)
              from public.author_space_works w
              where w.space_id = v_space.id and w.bok_id = p.id and w.status <> 'withdrawn'
              order by (w.format = 'series') desc limit 1
            )
          ) as item
        from published p
        union all
        select 'b:' || h.id::text, h.position, h.created_at, 1,
          jsonb_build_object(
            'key', 'b:' || h.id::text,
            'bokId', h.id::text,
            'title', h.title,
            'published', false,
            'hidden', true,
            'format', 'text',
            'work', (
              select public.boks_space_work_json(w)
              from public.author_space_works w
              where w.space_id = v_space.id and w.bok_id = h.id and w.status <> 'withdrawn'
              order by (w.format = 'series') desc limit 1
            )
          )
        from hidden h
        union all
        select 'w:' || w.id::text, w.position, w.created_at, 0,
          jsonb_build_object(
            'key', 'w:' || w.id::text,
            'bokId', w.bok_id::text,
            'title', w.title,
            'published', false,
            'format', w.format,
            'work', public.boks_space_work_json(w)
          )
        from prepared w
        -- A Series version of a published bok shows on that bok's row.
        where not (w.bok_id is not null and (
          exists (select 1 from published p where p.id = w.bok_id)
          or exists (select 1 from hidden h where h.id = w.bok_id)
        ))
      )
      select jsonb_agg(r.item order by r.position nulls last, r.created_at desc)
      from rows r
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_my_author_page()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_page public.author_pages;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select * into v_page from public.author_pages where user_id = v_uid;

  return jsonb_build_object(
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    'name', v_page.page_name,
    'photoVersion', case when v_page.photo is null then null else v_page.version end,
    -- The photo itself, for its owner only: shown whether or not the page is open.
    'photo', case when v_page.photo is null then null else encode(v_page.photo, 'base64') end,
    'version', coalesce(v_page.version, 0)
  );
end;
$$;

create or replace function public.boks_space_bok_format(p_space_id uuid, p_bok_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'format', case when bool_or(
        (w.format = 'series' and (w.series_published or w.status = 'published'))
        or (w.series_piece is not null and (w.series_published or w.status = 'published'))
      ) then 'series' else 'text' end,
    'seriesHeld', coalesce(bool_or(
        (w.format = 'series' and not w.series_published and w.status <> 'published')
        or (w.series_piece is not null and not w.series_published and w.status <> 'published')
      ), false),
    -- Published by its author with the text: the page plays it from here.
    'seriesPiece', max(w.series_piece) filter (where w.series_piece is not null and w.status = 'published')
  )
  from public.author_space_works w
  where w.space_id = p_space_id and w.bok_id = p_bok_id and w.status <> 'withdrawn';
$$;
revoke all on function public.boks_space_bok_format(uuid, uuid) from public, anon, authenticated;
