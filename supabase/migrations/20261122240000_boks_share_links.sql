-- Links to the author's own posts about a published Boks Series
-- (`docs/workshop-server.md`, "Links to the author's posts").
--
-- The author contract (v9, section 6) asks an author on a plan with the
-- sharing condition to post a link to every published Series in an open
-- social account within 30 days and to send the team the link to that post
-- through the cabinet. The Workshop takes the link here; the team sees it in
-- Studio → Authors and in Telegram (deploy/ops/inbox.py, feed `shares`).

create table if not exists public.bok_share_links (
  id bigint generated always as identity primary key,
  bok_id uuid not null references public.reels (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  url text not null check (char_length(url) between 10 and 500 and url ~ '^https?://[^[:space:]]+$'),
  created_at timestamptz not null default now(),
  unique (bok_id, url)
);
create index if not exists bok_share_links_author_idx on public.bok_share_links (author_id, created_at desc);
create index if not exists bok_share_links_created_idx on public.bok_share_links (created_at desc);

alter table public.bok_share_links enable row level security;
-- Read and written only through the functions below (ADR 0011).
revoke all on table public.bok_share_links from public, anon, authenticated;

-- The author's published Series with the links already sent: what the Workshop shows.
create or replace function public.get_my_share_links()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_workshop_author();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'bokId', r.id::text,
      'slug', r.slug,
      'title', r.title,
      'publishedAt', w.published_at,
      'links', coalesce((
        select jsonb_agg(jsonb_build_object('url', l.url, 'at', l.created_at) order by l.created_at)
        from public.bok_share_links l where l.bok_id = r.id
      ), '[]'::jsonb)
    ) order by w.published_at desc nulls last)
    from public.bok_series_work w
    join public.reels r on r.id = w.bok_id
    where w.author_id = v_uid and w.state = 'published' and r.author_user_id = v_uid
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_share_links() from public, anon, authenticated;
grant execute on function public.get_my_share_links() to authenticated;

-- «Отправить в редакцию»: one link to the author's post about one of their published Series.
create or replace function public.submit_my_share_link(p_bok_id uuid, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_workshop_author();
  v_url text := btrim(coalesce(p_url, ''));
  v_host text;
begin
  if not exists (
    select 1 from public.bok_series_work w join public.reels r on r.id = w.bok_id
    where w.bok_id = p_bok_id and w.author_id = v_uid and w.state = 'published' and r.author_user_id = v_uid
  ) then
    raise exception 'Links are sent for your own published Series.' using errcode = '42501';
  end if;

  if v_url !~* '^https?://' then v_url := 'https://' || v_url; end if;
  if char_length(v_url) > 500 then
    raise exception 'The link is too long.' using errcode = '22023';
  end if;
  if v_url !~* '^https?://[^[:space:]/?#]+\.[^[:space:]/?#]+([/?#][^[:space:]]*)?$' then
    raise exception 'This does not look like a link to a post.' using errcode = '22023';
  end if;
  v_host := lower(substring(v_url from '^https?://(?:[^@/?#]*@)?([^/?#:]+)'));
  if v_host ~ '(^|\.)tryboks\.(com|ru)$' then
    raise exception 'Send the link to your own post about the Series, not the Series itself.' using errcode = '22023';
  end if;

  if exists (select 1 from public.bok_share_links l where l.bok_id = p_bok_id and l.url = v_url) then
    return public.get_my_share_links();
  end if;
  if (select count(*) from public.bok_share_links l where l.bok_id = p_bok_id) >= 10 then
    raise exception 'Ten links for one Series is the most.' using errcode = '54023';
  end if;
  if (select count(*) from public.bok_share_links l where l.author_id = v_uid and l.created_at > now() - interval '1 day') >= 30 then
    raise exception 'Thirty links a day is the most. Try again tomorrow.' using errcode = '54023';
  end if;

  insert into public.bok_share_links (bok_id, author_id, url) values (p_bok_id, v_uid, v_url);
  return public.get_my_share_links();
end;
$$;
revoke all on function public.submit_my_share_link(uuid, text) from public, anon, authenticated;
grant execute on function public.submit_my_share_link(uuid, text) to authenticated;

-- Studio → Authors: the latest links, newest first.
create or replace function public.list_share_links(p_limit integer default 100)
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
      select l.id, l.url, l.created_at as "createdAt", l.bok_id::text as "bokId", r.title, r.slug,
             w.published_at as "publishedAt", p.handle,
             (select s.name from public.author_spaces s
               where s.owner_user_id = l.author_id and s.kind = 'author' and s.status <> 'merged'
               order by (s.status = 'published') desc, s.created_at limit 1) as name
      from public.bok_share_links l
      join public.reels r on r.id = l.bok_id
      left join public.bok_series_work w on w.bok_id = l.bok_id
      left join public.user_profiles p on p.user_id = l.author_id
      order by l.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_share_links(integer) from public, anon, authenticated;
grant execute on function public.list_share_links(integer) to authenticated;
