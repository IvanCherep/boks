-- Author search: the magnifier on the reader's cover (2026-11-25).
--
-- A reader asked "where is your page? I couldn't find it to follow you. How
-- do you search for authors at all?" There was no way: an author was reached
-- only by tapping a byline on a bok that happened to be on screen.
--
-- `search_boks_authors` answers one bounded page of the authors who have
-- their own public page (`author_spaces`, kind author, published) and at
-- least one published bok (`published_boks`): a draft, a bok in review or an
-- archived one never makes an author appear, and neither does an empty page.
-- The classics under @boks are deliberately not searched for now (the
-- owner's decision, 2026-11-25). A row opens the account
-- (`get_boks_author(handle)`), which is where Follow is.
--
-- A row carries the name, the handle and the page photo's version, nothing
-- else: no titles, texts, counts, emails or account ids. The browser never
-- reads `boks_public_identity` (its SELECT stays revoked); this function reads
-- it as its owner.
--
-- Matching: every word of the query must occur in the name (case, ё,
-- punctuation and hyphens aside), in its Latin spelling ("chekhov" finds
-- «Антон Чехов») or in its @handle. A whole-word match ranks first, then a
-- word start, then a match inside a word; then the larger shelf, then the
-- name. The query is cut to 100 characters and the page to 30 rows
-- here, whatever the caller asks for.

-- A name as the search reads it: lower case, е for ё, every run of
-- punctuation, hyphens and spaces one space. The query goes through the same.
create or replace function public.boks_author_search_text(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(replace(lower(coalesce(p_text, '')), 'ё', 'е'), '[^0-9a-zа-я]+', ' ', 'g'));
$$;

-- What a name can be found by: itself and its Latin spelling, both the usual
-- one and with a word-initial е as ye (Есенин is found as esenin and yesenin).
create or replace function public.boks_author_search_key(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := public.boks_author_search_text(p_text);
  v_latin text;
  v_ye text;
begin
  v_latin := regexp_replace(v, '(ий|ый)\M', 'y', 'g');
  v_latin := regexp_replace(v_latin, 'ой\M', 'oy', 'g');
  v_latin := replace(replace(replace(replace(replace(replace(replace(replace(replace(v_latin,
    'щ', 'shch'), 'ш', 'sh'), 'ч', 'ch'), 'ж', 'zh'), 'х', 'kh'), 'ц', 'ts'), 'ю', 'yu'), 'я', 'ya'), 'ъ', '');
  v_ye := regexp_replace(v_latin, '\mе', 'ye', 'g');
  v_latin := replace(translate(v_latin, 'абвгдезийклмнопрстуфыьэ', 'abvgdeziyklmnoprstufy_e'), '_', '');
  v_ye := replace(translate(v_ye, 'абвгдезийклмнопрстуфыьэ', 'abvgdeziyklmnoprstufy_e'), '_', '');
  return concat_ws(' ', v, nullif(v_latin, v), nullif(v_ye, v_latin));
end;
$$;

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
    order by m.rank, m.has_page desc, m.boks desc, lower(m.name), m.handle, m.byline nulls first
    limit v_limit + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'kind', p.kind,
      'handle', p.handle,
      'byline', p.byline,
      'name', p.name,
      'photoVersion', p.photo_version
    ) order by p.rank, p.has_page desc, p.boks desc, lower(p.name), p.handle, p.byline nulls first), '[]'::jsonb),
    count(*)::integer
  into v_rows, v_count
  from page p;

  if v_count > v_limit then
    v_rows := v_rows - v_limit;
  end if;

  return jsonb_build_object('results', v_rows, 'hasMore', v_count > v_limit);
end;
$$;

revoke all on function public.boks_author_search_text(text) from public, anon, authenticated;
revoke all on function public.boks_author_search_key(text) from public, anon, authenticated;
revoke all on function public.search_boks_authors(text, integer) from public, anon, authenticated;
-- Guests read with their anonymous session, the same as the author page itself.
grant execute on function public.search_boks_authors(text, integer) to anon, authenticated;
