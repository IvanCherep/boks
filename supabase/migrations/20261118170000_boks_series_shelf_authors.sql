-- An author's own section on the Series shelf, live the moment they publish.
--
-- Until now an author's Series reached the shelf through code: the team
-- registered the published boks in `series-catalogue.ts` and released
-- (Алексей Прохоров, Дарья Мальо-Субботина). An author who publishes at night
-- waited for the team. Now the team marks a prepared page for the shelf
-- (`series_shelf`), and when its owner publishes, the shelf reads the section
-- from here: the page's published works that carry a Series, in the order the
-- author gave the page, newest section first, above the sections in code.
--
-- Only what readers may already open is returned: a published page, a bok
-- that is published (hiding a work takes it off the shelf at once), and a
-- work the author published with its Series. A Series token is a key to the
-- author's files (`docs/link-only-pieces.md`); once the author has published
-- the piece it is public, and the author page already hands it out.

alter table public.author_spaces
  add column if not exists series_shelf boolean not null default false;

comment on column public.author_spaces.series_shelf is
  'The team''s choice: once the owner publishes, the page''s Series form its own section on the Series shelf (get_boks_series_shelf_authors).';

-- What the shelf card says before the piece is opened: length, pictures,
-- interactive moments, where the cover's subject sits. Written by the team
-- with the Series; a card without it simply leaves those out.
alter table public.author_space_works
  add column if not exists series_card jsonb
    check (series_card is null or (
      jsonb_typeof(series_card) = 'object'
      and coalesce(jsonb_typeof(series_card -> 'seconds'), 'number') = 'number'
      and coalesce(jsonb_typeof(series_card -> 'scenes'), 'number') = 'number'
      and coalesce(jsonb_typeof(series_card -> 'moments'), 'number') = 'number'
      and coalesce(jsonb_typeof(series_card -> 'focus'), 'string') = 'string'
      and char_length(series_card::text) <= 400
    ));

create or replace function public.get_boks_series_shelf_authors()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(section order by section ->> 'publishedAt' desc, section ->> 'handle'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'handle', p.handle,
      'name', coalesce(nullif(btrim(s.name), ''), p.handle),
      'photoVersion', case when s.photo is null then null else s.photo_version end,
      'publishedAt', s.published_at,
      'pieces', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'bokId', b.id::text,
          'title', b.title,
          'author', coalesce(nullif(btrim(b.author_name), ''), s.name, p.handle),
          'language', coalesce(nullif(b.language, ''), 'ru'),
          'token', w.series_piece,
          'publishedOn', to_char(coalesce(w.published_at, b.created_at) at time zone 'UTC', 'YYYY-MM-DD'),
          'card', coalesce(w.series_card, '{}'::jsonb)
        ) order by o.position nulls last, b.created_at desc, b.id), '[]'::jsonb)
        from public.published_boks b
        join public.author_space_works w
          on w.space_id = s.id and w.bok_id = b.id
         and w.status = 'published' and w.series_piece is not null
        left join public.author_space_order o on o.space_id = s.id and o.bok_id = b.id
        where b.author_user_id = s.owner_user_id
      )
    ) as section
    from public.author_spaces s
    join public.user_profiles p on p.user_id = s.owner_user_id and p.banned_at is null
    where s.series_shelf and s.status = 'published' and s.kind = 'author' and p.handle is not null
  ) sections
  where jsonb_array_length(section -> 'pieces') > 0;
$$;

revoke all on function public.get_boks_series_shelf_authors() from public;
grant execute on function public.get_boks_series_shelf_authors() to anon, authenticated;

-- The cabinet says where a published Series goes: at once onto the shelf, or
-- once the team adds it. True only for the caller's own page.
create or replace function public.my_author_space_on_series_shelf()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.series_shelf from public.author_spaces s
    where s.owner_user_id = auth.uid() and s.status <> 'merged'
    limit 1
  ), false);
$$;

revoke all on function public.my_author_space_on_series_shelf() from public, anon;
grant execute on function public.my_author_space_on_series_shelf() to authenticated;
