-- Special projects: link-only pieces the team is preparing, gathered in Studio.
--
-- A link-only piece is reachable only by its token (`docs/link-only-pieces.md`),
-- and the token must never reach the public repository. Studio still needs to
-- list a project's pieces with their links, so the rows live here: written by
-- the team from a scratch SQL file, read only by an admin through the RPC.
-- Nothing here makes a piece public; the feed, shelf and catalogue never read it.

create table if not exists public.boks_special_projects (
  id uuid primary key default gen_random_uuid(),
  project text not null,
  title text not null,
  author text not null default '',
  token text not null unique,
  note text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint boks_special_project_token_shape check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
  constraint boks_special_project_text check (
    btrim(project) <> '' and char_length(project) <= 120
    and btrim(title) <> '' and char_length(title) <= 200
    and char_length(author) <= 200 and char_length(note) <= 2000
  )
);

comment on table public.boks_special_projects is
  'Link-only pieces grouped into special projects for Studio. Holds tokens: admin-only, through boks_admin_special_projects().';

alter table public.boks_special_projects enable row level security;
revoke all on table public.boks_special_projects from public, anon, authenticated;

create or replace function public.boks_admin_special_projects()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'project', p.project,
      'title', p.title,
      'author', p.author,
      'token', p.token,
      'note', p.note,
      'createdAt', p.created_at
    ) order by p.project, p.position, p.created_at)
    from public.boks_special_projects p
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.boks_admin_special_projects() from public, anon;
grant execute on function public.boks_admin_special_projects() to authenticated;
