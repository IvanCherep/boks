-- Author search in alphabetical order (2026-11-25, the owner's request).
--
-- The panel opens on every author in alphabetical order of the name it shows
-- (the page's name: «Алексей Прохоров, поэт» under А), ё read as е, case
-- aside. A typed query still puts the closer match first (a whole word, then a
-- word start, then inside a word) and orders alphabetically within each. The
-- number of boks no longer orders anything. Same signature, same answer shape,
-- same grants: only the order changes, so live code and old tabs are unaffected.

create or replace function public.search_boks_authors(
  p_query text default '',
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 30);
  v_query text := public.boks_author_search_text(left(coalesce(p_query, ''), 100));
  v_words text[];
  v_rows jsonb;
  v_count integer;
begin
  v_words := case when v_query = '' then array[]::text[] else string_to_array(v_query, ' ') end;

  with accounts as (
    select lower(b.author_handle) as handle, count(*)::integer as boks, min(b.author_name) as only_byline
    from public.published_boks b
    where nullif(btrim(coalesce(b.author_handle, '')), '') is not null
    group by 1
  ),
  pages as (
    select lower(i.handle) as handle, s.name, case when s.photo is null then null else s.photo_version end as photo_version
    from public.author_spaces s
    join public.boks_public_identity i on i.user_id = s.owner_user_id
    where s.kind = 'author' and s.status = 'published'
  ),
  candidates as (
    select 'account'::text as kind, p.handle, null::text as byline,
      coalesce(nullif(btrim(p.name), ''), a.only_byline, p.handle) as name,
      p.photo_version, true as has_page, a.boks
    from pages p
    join accounts a on a.handle = p.handle
  ),
  keyed as (
    select c.*,
      ' ' || public.boks_author_search_key(c.name || ' ' || c.handle) || ' ' as search_key
    from candidates c
  ),
  matched as (
    select k.*,
      case
        when v_query = '' then 0
        when position(' ' || v_words[1] || ' ' in k.search_key) > 0 then 0
        when position(' ' || v_words[1] in k.search_key) > 0 then 1
        else 2
      end as rank
    from keyed k
    where not exists (
      select 1 from unnest(v_words) w(word) where position(w.word in k.search_key) = 0
    )
  ),
  page as (
    select m.* from matched m
    order by m.rank, public.boks_author_search_text(m.name), m.handle, m.byline nulls first
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'kind', p.kind,
      'handle', p.handle,
      'byline', p.byline,
      'name', p.name,
      'photoVersion', p.photo_version
    ) order by p.rank, public.boks_author_search_text(p.name), p.handle, p.byline nulls first), '[]'::jsonb),
    count(*)::integer
  into v_rows, v_count
  from page p;

  if v_count > v_limit then
    v_rows := v_rows - v_limit;
  end if;

  return jsonb_build_object('results', v_rows, 'hasMore', v_count > v_limit);
end;
$$;

revoke all on function public.search_boks_authors(text, integer) from public, anon, authenticated;
grant execute on function public.search_boks_authors(text, integer) to anon, authenticated;
