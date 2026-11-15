-- Applications to become a boks author (`docs/author-applications.md`).
--
-- An account with nothing published sees, at /author, the page for authors
-- in place of the cabinet: what boks offers (an author page for a year, three
-- Boks Series, a joint launch) and a form to apply. An application is a few
-- lines for the team to answer by hand: who, where their readers are, how to
-- reach them, which offer. The team reads them in Studio → Authors.

create table public.author_applications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  offer text not null default 'unsure',
  name text not null,
  links text not null,
  audience text,
  contact text not null,
  message text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint author_applications_offer check (offer in ('page', 'series', 'launch', 'unsure')),
  constraint author_applications_status check (status in ('new', 'contacted', 'closed')),
  constraint author_applications_name check (char_length(name) between 1 and 120),
  constraint author_applications_links check (char_length(links) between 3 and 1500),
  constraint author_applications_audience check (audience is null or char_length(audience) <= 120),
  constraint author_applications_contact check (char_length(contact) between 3 and 200),
  constraint author_applications_message check (message is null or char_length(message) <= 3000)
);
create index author_applications_user_idx on public.author_applications (user_id, created_at desc);
create index author_applications_new_idx on public.author_applications (created_at desc) where status = 'new';
alter table public.author_applications enable row level security;
revoke all on public.author_applications from public, anon, authenticated;

-- Whether this account has a cabinet yet: anything published under its name,
-- an author page it holds, or Studio. Without any of them /author shows the
-- page for authors. The latest application is returned so the page can say
-- it was sent.
create or replace function public.get_my_author_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_published integer;
  v_application jsonb;
begin
  select count(*)::integer into v_published
  from public.reels r
  where r.author_user_id = v_uid and r.status = 'published';

  select jsonb_build_object('id', a.id, 'offer', a.offer, 'status', a.status, 'createdAt', a.created_at)
  into v_application
  from public.author_applications a
  where a.user_id = v_uid
  order by a.created_at desc
  limit 1;

  return jsonb_build_object(
    'published', v_published,
    'admin', public.is_boks_admin(v_uid),
    'hasPage', exists (select 1 from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged'),
    'application', v_application
  );
end;
$$;
revoke all on function public.get_my_author_access() from public, anon, authenticated;
grant execute on function public.get_my_author_access() to authenticated;

-- One application. Three a day per account is plenty for a person and too
-- few for a script.
create or replace function public.submit_author_application(
  p_offer text,
  p_name text,
  p_links text,
  p_audience text,
  p_contact text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_offer text := lower(btrim(coalesce(p_offer, 'unsure')));
  v_name text := btrim(coalesce(p_name, ''));
  v_links text := btrim(coalesce(p_links, ''));
  v_audience text := nullif(btrim(coalesce(p_audience, '')), '');
  v_contact text := btrim(coalesce(p_contact, ''));
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id bigint;
begin
  if v_offer not in ('page', 'series', 'launch', 'unsure') then v_offer := 'unsure'; end if;
  if char_length(v_name) < 1 then
    raise exception 'Write your name or pen name.' using errcode = '22023';
  end if;
  if char_length(v_links) < 3 then
    raise exception 'Add at least one link: where your readers are.' using errcode = '22023';
  end if;
  if char_length(v_contact) < 3 then
    raise exception 'Leave a way to reach you.' using errcode = '22023';
  end if;
  if (select count(*) from public.author_applications a where a.user_id = v_uid and a.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Three applications a day is the most. We will write to you.' using errcode = '54023';
  end if;

  insert into public.author_applications (user_id, offer, name, links, audience, contact, message)
  values (v_uid, v_offer, left(v_name, 120), left(v_links, 1500), left(v_audience, 120), left(v_contact, 200), left(v_message, 3000))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.submit_author_application(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_author_application(text, text, text, text, text, text) to authenticated;

-- Studio → Authors: the applications, newest first, with the applicant's
-- @name and email so the team can answer.
create or replace function public.list_author_applications(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x."createdAt" desc)
    from (
      select a.id, a.offer, a.name, a.links, a.audience, a.contact, a.message, a.status,
             a.created_at as "createdAt", p.handle, u.email
      from public.author_applications a
      left join public.user_profiles p on p.user_id = a.user_id
      left join auth.users u on u.id = a.user_id
      order by a.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_author_applications(integer) from public, anon, authenticated;
grant execute on function public.list_author_applications(integer) to authenticated;

create or replace function public.set_author_application_status(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if p_status not in ('new', 'contacted', 'closed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update public.author_applications set status = p_status, updated_at = now() where id = p_id;
end;
$$;
revoke all on function public.set_author_application_status(bigint, text) from public, anon, authenticated;
grant execute on function public.set_author_application_status(bigint, text) to authenticated;
