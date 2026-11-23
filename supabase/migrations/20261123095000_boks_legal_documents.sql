-- The documents for authors, published edition by edition (`docs/author-agreements.md`):
-- the offer and the two consents on personal data, word for word, each
-- edition at its own address (`/author/terms/<doc>/<version>`). A stored
-- edition is never changed; a new text for new authors is a new version.
-- The online contract that refers to them comes in a later migration.

-- ------------------------------------------------------------------ texts

-- Every published edition of the offer and the consents, word for word. A row
-- is never changed: a new edition is a new version. What an author accepted is
-- the row their agreement names.
create table if not exists public.boks_legal_documents (
  kind text not null check (kind in ('author_offer', 'author_pd_processing', 'author_pd_distribution')),
  version text not null check (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]+)?$'),
  title text not null check (char_length(title) between 3 and 300),
  body text not null check (char_length(body) between 100 and 300000),
  sha256 bytea not null default ''::bytea, -- of the body as UTF-8, set on insert
  published_at timestamptz not null default now(),
  primary key (kind, version)
);
alter table public.boks_legal_documents enable row level security;
revoke all on table public.boks_legal_documents from public, anon, authenticated;

create or replace function public.boks_legal_documents_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sha256 := sha256(convert_to(new.body, 'UTF8'));
  return new;
end;
$$;
drop trigger if exists boks_legal_documents_hash on public.boks_legal_documents;
create trigger boks_legal_documents_hash
  before insert on public.boks_legal_documents
  for each row execute function public.boks_legal_documents_hash();
revoke all on function public.boks_legal_documents_hash() from public, anon, authenticated;

create or replace function public.boks_legal_documents_frozen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A published edition is not changed: publish a new version.' using errcode = '42501';
end;
$$;
drop trigger if exists boks_legal_documents_frozen on public.boks_legal_documents;
create trigger boks_legal_documents_frozen
  before update or delete on public.boks_legal_documents
  for each row execute function public.boks_legal_documents_frozen();
revoke all on function public.boks_legal_documents_frozen() from public, anon, authenticated;

-- The edition in force: the latest published.
create or replace function public.boks_legal_current(p_kind text)
returns public.boks_legal_documents
language sql
stable
security definer
set search_path = ''
as $$
  select d.* from public.boks_legal_documents d
  where d.kind = p_kind and d.published_at <= now()
  order by d.published_at desc, d.version desc
  limit 1;
$$;
revoke all on function public.boks_legal_current(text) from public, anon, authenticated;

-- A document for the page that shows it (`/author/terms/<doc>`): the edition
-- asked for, else the one in force, with the list of all editions.
create or replace function public.get_boks_legal_document(p_kind text, p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_doc public.boks_legal_documents;
  v_current public.boks_legal_documents := public.boks_legal_current(p_kind);
begin
  if nullif(btrim(coalesce(p_version, '')), '') is null then
    v_doc := v_current;
  else
    select * into v_doc from public.boks_legal_documents d
    where d.kind = p_kind and d.version = btrim(p_version) and d.published_at <= now();
  end if;
  if v_doc.kind is null then
    return null;
  end if;
  return jsonb_build_object(
    'kind', v_doc.kind,
    'version', v_doc.version,
    'title', v_doc.title,
    'body', v_doc.body,
    'sha256', encode(v_doc.sha256, 'hex'),
    'publishedAt', v_doc.published_at,
    'current', v_doc.version = v_current.version,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('version', d.version, 'publishedAt', d.published_at) order by d.published_at desc)
      from public.boks_legal_documents d where d.kind = p_kind and d.published_at <= now()
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_boks_legal_document(text, text) from public, anon, authenticated;
grant execute on function public.get_boks_legal_document(text, text) to anon, authenticated;

-- Every document with its editions, for `/author/terms`.
create or replace function public.get_boks_legal_documents()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', k.kind,
    'title', (public.boks_legal_current(k.kind)).title,
    'version', (public.boks_legal_current(k.kind)).version,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('version', d.version, 'publishedAt', d.published_at) order by d.published_at desc)
      from public.boks_legal_documents d where d.kind = k.kind and d.published_at <= now()
    ), '[]'::jsonb)
  ) order by k.n), '[]'::jsonb)
  from (values ('author_offer', 1), ('author_pd_processing', 2), ('author_pd_distribution', 3)) k(kind, n)
  where (public.boks_legal_current(k.kind)).kind is not null;
$$;
revoke all on function public.get_boks_legal_documents() from public, anon, authenticated;
grant execute on function public.get_boks_legal_documents() to anon, authenticated;
