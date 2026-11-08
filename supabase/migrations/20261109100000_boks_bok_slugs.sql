-- A bok's own readable address: `/b/neznakomka-blok` instead of `/b/<uuid>`.
--
-- The slug is the title and the author's surname in Latin letters, given once,
-- when the bok is first published, and never changed after - a link already
-- sent keeps working whatever is later done to the title. Two boks that would
-- get the same slug (the same title by the same surname) are told apart by the
-- start of the second one's id: `osen-blok`, then `osen-blok-3f9a`. The uuid
-- link keeps working too; the slug is an address, not an identity.

alter table public.reels
  add column if not exists slug text;

create unique index if not exists reels_slug_unique on public.reels (slug) where slug is not null;

alter table public.reels
  drop constraint if exists reels_slug_shape;
alter table public.reels
  add constraint reels_slug_shape check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80);

-- Russian to Latin, the way a Russian reader would type it: Незнакомка -> neznakomka.
create or replace function public.boks_slug_words(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
    replace(replace(replace(replace(replace(replace(
      translate(lower(coalesce(p_text, '')),
        'абвгдезийклмнопрстуфыэàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
        'abvgdeziiklmnoprstufyeaaaaaaceeeeiiiinooooouuuuyy'),
      'ё', 'e'), 'ж', 'zh'), 'х', 'kh'), 'ц', 'ts'), 'ч', 'ch'), 'ш', 'sh'), 'щ', 'shch'),
      'ъ', ''), 'ь', ''), 'ю', 'yu'), 'я', 'ya'), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), '''', ''), '’', ''),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- `title-surname`, the title cut at a word to keep the address short.
create or replace function public.boks_slug_base(p_title text, p_author text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_title text := public.boks_slug_words(p_title);
  v_author text := public.boks_slug_words(
    (regexp_split_to_array(btrim(coalesce(p_author, '')), '\s+'))[
      array_length(regexp_split_to_array(btrim(coalesce(p_author, '')), '\s+'), 1)]);
begin
  if char_length(v_title) > 48 then
    v_title := left(v_title, 48);
    if v_title ~ '-' then v_title := regexp_replace(v_title, '-[^-]*$', ''); end if;
  end if;
  if v_author = 'boks' then v_author := ''; end if;
  return nullif(concat_ws('-', nullif(v_title, ''), nullif(v_author, '')), '');
end;
$$;

-- The first free slug for a bok: the base, then the base and more and more of its id.
create or replace function public.boks_free_slug(p_id uuid, p_title text, p_author text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_base text := coalesce(public.boks_slug_base(p_title, p_author), 'bok');
  v_hex text := replace(p_id::text, '-', '');
  v_candidate text := v_base;
  v_length integer := 4;
begin
  while exists (select 1 from public.reels r where r.slug = v_candidate and r.id <> p_id) loop
    v_candidate := v_base || '-' || left(v_hex, v_length);
    v_length := v_length + 2;
  end loop;
  return v_candidate;
end;
$$;

-- Security definer: the slug must be free among every bok, also the ones the
-- publishing role cannot see.
create or replace function public.boks_reels_slug()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slug is null and new.status = 'published' then
    new.slug := public.boks_free_slug(new.id, new.title, new.author_name);
  end if;
  return new;
end;
$$;

drop trigger if exists reels_slug on public.reels;
create trigger reels_slug
  before insert or update of status, slug on public.reels
  for each row execute function public.boks_reels_slug();

-- Everything already published, oldest first: the first «Осень» keeps the plain slug.
do $$
declare
  v_row record;
begin
  for v_row in select id, title, author_name from public.reels where status = 'published' and slug is null order by created_at, id loop
    update public.reels set slug = public.boks_free_slug(v_row.id, v_row.title, v_row.author_name) where id = v_row.id;
  end loop;
end;
$$;

-- Both views gain the column at the end, which `create or replace view`
-- allows without dropping them or their grants.
create or replace view public.boks_reels as
select r.id, r.title, r.hook, r.text, r.genre, r.mood, r.minutes, r.status,
       r.is_seed, r.created_at, r.updated_at, r.author_user_id, r.submitted_at,
       r.reviewed_at, r.reviewed_by, r.review_note, r.word_count,
       r.reading_shape, r.line_break_count, r.author_name,
       coalesce(i.handle, r.author_handle, '') as author_handle,
       r.language,
       r.summary,
       r.slug
from public.reels r
left join public.boks_public_identity i on i.user_id = r.author_user_id;

create or replace view public.published_boks as
select id, title, author_name, author_handle, author_user_id, hook, text,
       genre, mood, minutes, word_count, reading_shape, line_break_count,
       created_at, language, summary, slug
from public.boks_reels b
where status = 'published';

revoke all on function public.boks_free_slug(uuid, text, text) from public, anon, authenticated;
revoke all on function public.boks_reels_slug() from public, anon, authenticated;
