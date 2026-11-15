-- Reading facets: what a reader can ask the feed for ("Что почитать").
--
-- A facet is one question the reader can answer for the next bok: its mood,
-- its form, its author's group. Each facet has a fixed set of values and one
-- of three subjects:
--
--   bok      a label per bok, read from its text (mood);
--   byline   a label per byline, the author name printed on a bok
--            (author_group: classics / contemporary). Never the publishing
--            account: the catalogue account publishes every classic;
--   derived  computed from columns the bok already has (format, from
--            reels.reading_shape), so it is never labelled by hand.
--
-- A label records who set it (a model or an editor), under which version of
-- the rubric, and for bok labels the hash of the title and text it was read
-- from. That is what keeps the labels honest over time:
--
--   * an editor's label is final: a model never overwrites it;
--   * raising a facet's rubric_version marks every older label as due;
--   * an edited text marks its bok's labels as due (the hash no longer matches);
--   * a bok nobody has labelled yet simply has no label: unknown stays unknown,
--     and a reader's filter never matches it.
--
-- The rubric text itself lives in `lib/boks/facets/rubric.ts`; the design in
-- `docs/reading-facets.md`. Adding a facet later is a new forward migration
-- with a row in each registry table, and nothing else in the schema changes:
-- `bok_reading_facets` builds one jsonb object from whatever facets exist.
--
-- Nothing here is readable through the Data API yet: the tables and the view
-- have row security / no grants. The feed reads facets inside its own
-- security definer function (next step), the admin console through
-- `get_reading_facet_coverage`.

create table if not exists public.reading_facets (
  key text primary key check (key ~ '^[a-z][a-z_]{0,30}$'),
  subject text not null check (subject in ('bok', 'byline', 'derived')),
  multiple boolean not null default true,
  rubric_version integer not null default 1 check (rubric_version > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.reading_facet_values (
  facet text not null references public.reading_facets (key) on delete cascade,
  value text not null check (value ~ '^[a-z][a-z_]{0,30}$'),
  position smallint not null default 0,
  primary key (facet, value)
);

insert into public.reading_facets (key, subject, multiple, rubric_version) values
  ('mood', 'bok', true, 1),
  ('author_group', 'byline', false, 1),
  ('format', 'derived', false, 1)
on conflict (key) do nothing;

insert into public.reading_facet_values (facet, value, position) values
  ('mood', 'sad', 1), ('mood', 'fun', 2), ('mood', 'think', 3),
  ('author_group', 'classics', 1), ('author_group', 'contemporary', 2),
  ('format', 'prose', 1), ('format', 'poetry', 2)
on conflict (facet, value) do nothing;

-- The text a bok label was read from, as one hash.
create or replace function public.boks_bok_text_hash(p_title text, p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select md5(coalesce(p_title, '') || chr(10) || coalesce(p_text, ''));
$$;

-- An empty list is an answer ("none of these"), different from no row
-- ("nobody has looked yet"). Values are ordered: the strongest first.
create table if not exists public.bok_facet_labels (
  bok_id uuid not null references public.reels (id) on delete cascade,
  facet text not null references public.reading_facets (key),
  facet_values text[] not null default '{}',
  source text not null check (source in ('model', 'editor')),
  labeler text not null check (char_length(labeler) between 1 and 80),
  rubric_version integer not null check (rubric_version > 0),
  text_hash text check (text_hash ~ '^[0-9a-f]{32}$'),
  note text not null default '' check (char_length(note) <= 300),
  labeled_at timestamptz not null default now(),
  primary key (bok_id, facet)
);

create index if not exists bok_facet_labels_facet_values
  on public.bok_facet_labels using gin (facet_values);

-- Keyed by the byline exactly as printed, trimmed. Two spellings of one
-- author are two rows; that is the honest cost of not guessing identities.
create table if not exists public.byline_facet_labels (
  byline text not null check (byline = btrim(byline) and char_length(byline) between 1 and 120),
  facet text not null references public.reading_facets (key),
  facet_values text[] not null default '{}',
  source text not null check (source in ('model', 'editor')),
  labeler text not null check (char_length(labeler) between 1 and 80),
  rubric_version integer not null check (rubric_version > 0),
  note text not null default '' check (char_length(note) <= 300),
  labeled_at timestamptz not null default now(),
  primary key (byline, facet)
);

-- One check for both label tables: the facet carries this kind of subject,
-- every value is registered for it, none repeats, and a single-valued facet
-- holds at most one.
create or replace function public.boks_check_facet_label()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_subject text := case tg_table_name when 'bok_facet_labels' then 'bok' else 'byline' end;
  v_facet public.reading_facets%rowtype;
  v_unknown text;
begin
  select * into v_facet from public.reading_facets where key = new.facet;
  if v_facet.subject is distinct from v_subject then
    raise exception 'Facet % is not labelled per %.', new.facet, v_subject using errcode = '23514';
  end if;
  if array_position(new.facet_values, null) is not null then
    raise exception 'A facet value cannot be empty.' using errcode = '23514';
  end if;
  select v into v_unknown
  from unnest(new.facet_values) v
  where not exists (select 1 from public.reading_facet_values fv where fv.facet = new.facet and fv.value = v)
  limit 1;
  if v_unknown is not null then
    raise exception 'Facet % has no value %.', new.facet, v_unknown using errcode = '23514';
  end if;
  if cardinality(new.facet_values) <> (select count(distinct v) from unnest(new.facet_values) v) then
    raise exception 'Facet % lists a value twice.', new.facet using errcode = '23514';
  end if;
  if not v_facet.multiple and cardinality(new.facet_values) > 1 then
    raise exception 'Facet % takes one value.', new.facet using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists bok_facet_labels_check on public.bok_facet_labels;
create trigger bok_facet_labels_check
  before insert or update on public.bok_facet_labels
  for each row execute function public.boks_check_facet_label();

drop trigger if exists byline_facet_labels_check on public.byline_facet_labels;
create trigger byline_facet_labels_check
  before insert or update on public.byline_facet_labels
  for each row execute function public.boks_check_facet_label();

alter table public.reading_facets enable row level security;
alter table public.reading_facet_values enable row level security;
alter table public.bok_facet_labels enable row level security;
alter table public.byline_facet_labels enable row level security;
revoke all on table public.reading_facets, public.reading_facet_values,
  public.bok_facet_labels, public.byline_facet_labels from public, anon, authenticated;
revoke all on function public.boks_check_facet_label() from public, anon, authenticated;

-- Every bok with its facets as one object, e.g.
--   {"mood": ["sad", "think"], "format": ["poetry"], "author_group": ["classics"]}
-- A facet nobody has labelled for this bok is absent; a facet labelled "none"
-- is an empty list. A reader's request matches when, for every facet it names,
-- the bok's list shares a value with it (`facets -> key ?| values`).
create or replace view public.bok_reading_facets
with (security_invoker = true) as
select
  r.id as bok_id,
  coalesce(b.facets, '{}'::jsonb)
    || coalesce(y.facets, '{}'::jsonb)
    || case r.reading_shape
         when 'verse' then '{"format": ["poetry"]}'::jsonb
         when 'short_prose' then '{"format": ["prose"]}'::jsonb
         when 'long_prose' then '{"format": ["prose"]}'::jsonb
         else '{}'::jsonb
       end as facets
from public.reels r
left join lateral (
  select jsonb_object_agg(l.facet, to_jsonb(l.facet_values)) as facets
  from public.bok_facet_labels l
  where l.bok_id = r.id
) b on true
left join lateral (
  select jsonb_object_agg(l.facet, to_jsonb(l.facet_values)) as facets
  from public.byline_facet_labels l
  where l.byline = btrim(r.author_name)
) y on true;

revoke all on public.bok_reading_facets from public, anon, authenticated;

comment on table public.reading_facets is
  'What a reader can ask the feed for (mood, format, author_group). Rubrics in lib/boks/facets/rubric.ts; design in docs/reading-facets.md.';
comment on table public.bok_facet_labels is
  'One label per bok and facet. An editor''s label is final; a model''s is redone when the rubric version or the text hash moves.';
comment on table public.byline_facet_labels is
  'One label per byline (as printed, trimmed) and facet, e.g. author_group. Never keyed by the publishing account.';

-- What the labels cover, for Studio and for the labelling job: per facet, how
-- many published boks have each value, how many have none of them, how many
-- nobody has labelled, and how many labels are due again.
create or replace function public.get_reading_facet_coverage()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Only an admin can read facet coverage.' using errcode = '42501';
  end if;

  return (
    select jsonb_agg(jsonb_build_object(
      'facet', f.key,
      'subject', f.subject,
      'rubricVersion', f.rubric_version,
      'published', (select count(*) from public.reels r where r.status = 'published'),
      'values', (
        select jsonb_object_agg(v.value, (
          select count(*) from public.reels r
          join public.bok_reading_facets bf on bf.bok_id = r.id
          where r.status = 'published' and bf.facets -> f.key ? v.value
        ))
        from public.reading_facet_values v where v.facet = f.key
      ),
      'none', (
        select count(*) from public.reels r
        join public.bok_reading_facets bf on bf.bok_id = r.id
        where r.status = 'published' and bf.facets -> f.key = '[]'::jsonb
      ),
      'unlabelled', (
        select count(*) from public.reels r
        join public.bok_reading_facets bf on bf.bok_id = r.id
        where r.status = 'published' and not bf.facets ? f.key
      ),
      'due', case f.subject
        when 'bok' then (
          select count(*) from public.bok_facet_labels l
          join public.reels r on r.id = l.bok_id
          where l.facet = f.key and r.status = 'published' and l.source = 'model'
            and (l.rubric_version < f.rubric_version
              or l.text_hash is distinct from public.boks_bok_text_hash(r.title, r.text))
        )
        when 'byline' then (
          select count(*) from public.byline_facet_labels l
          where l.facet = f.key and l.source = 'model' and l.rubric_version < f.rubric_version
        )
        else 0
      end
    ) order by f.key)
    from public.reading_facets f
  );
end;
$$;

revoke all on function public.get_reading_facet_coverage() from public, anon;
grant execute on function public.get_reading_facet_coverage() to authenticated;
