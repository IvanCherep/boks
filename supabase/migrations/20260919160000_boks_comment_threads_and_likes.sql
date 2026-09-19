-- Instagram-style comment conversations without turning boks into a forum.
--
-- Replies are deliberately one level deep. A reply may point only at a root
-- comment on the same published boks. The database, not the browser, enforces
-- that invariant. Comment likes are private rows; readers receive only totals
-- and whether their own account liked a comment through a bounded RPC.

alter table public.comments
  add column if not exists parent_comment_id bigint
  references public.comments(id) on delete cascade;

create index if not exists comments_reel_parent_created_idx
  on public.comments (reel_id, parent_comment_id, created_at, id);

create or replace function public.boks_validate_comment_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_reel_id uuid;
  v_parent_parent_id bigint;
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  select c.reel_id, c.parent_comment_id
  into v_parent_reel_id, v_parent_parent_id
  from public.comments c
  where c.id = new.parent_comment_id;

  if not found then
    raise exception 'That comment is no longer available.' using errcode = '23503';
  end if;
  if v_parent_reel_id <> new.reel_id then
    raise exception 'A reply must belong to the same boks.' using errcode = '23514';
  end if;
  if v_parent_parent_id is not null then
    raise exception 'Replies can be one level deep.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists boks_validate_comment_parent_trigger on public.comments;
create trigger boks_validate_comment_parent_trigger
before insert or update of reel_id, parent_comment_id on public.comments
for each row execute function public.boks_validate_comment_parent();

create table if not exists public.comment_likes (
  comment_id bigint not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- The primary key starts with comment_id. RLS and account cleanup also search
-- by user_id, so it needs its own leading index.
create index if not exists comment_likes_user_created_idx
  on public.comment_likes (user_id, created_at desc);

alter table public.comment_likes enable row level security;

revoke all on table public.comment_likes from public, anon, authenticated;
grant select, insert, delete on table public.comment_likes to authenticated;

drop policy if exists "Readers can see their own comment likes" on public.comment_likes;
create policy "Readers can see their own comment likes"
on public.comment_likes for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Permanent readers can like comments" on public.comment_likes;
create policy "Permanent readers can like comments"
on public.comment_likes for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
  and exists (
    select 1
    from public.comments c
    join public.reels r on r.id = c.reel_id
    where c.id = comment_likes.comment_id
      and r.status = 'published'
  )
);

drop policy if exists "Permanent readers can remove their comment likes" on public.comment_likes;
create policy "Permanent readers can remove their comment likes"
on public.comment_likes for delete to authenticated
using (
  (select auth.uid()) = user_id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

-- Public read model for one boks. The cap protects the browser if a boks ever
-- attracts a very large conversation; pagination can replace it without
-- changing the stored model.
create or replace function public.get_bok_comments(p_reel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'storyId', q.reel_id::text,
    'visitorName', q.visitor_handle,
    'visitorHandle', q.visitor_handle,
    'body', q.body,
    'createdAt', q.created_at,
    'parentCommentId', q.parent_comment_id,
    'likesCount', q.likes_count,
    'likedByMe', q.liked_by_me
  ) order by q.created_at asc, q.id asc), '[]'::jsonb)
  from (
    select
      c.id,
      c.reel_id,
      c.body,
      c.created_at,
      c.parent_comment_id,
      coalesce(i.handle, 'reader') as visitor_handle,
      (select count(*)::integer from public.comment_likes cl where cl.comment_id = c.id) as likes_count,
      exists (
        select 1
        from public.comment_likes mine
        where mine.comment_id = c.id
          and mine.user_id = (select auth.uid())
      ) as liked_by_me
    from public.comments c
    join public.reels r on r.id = c.reel_id and r.status = 'published'
    left join public.boks_public_identity i on i.user_id = c.user_id
    where c.reel_id = p_reel_id
    order by c.created_at desc, c.id desc
    limit 1000
  ) q;
$$;

comment on function public.get_bok_comments(uuid) is
  'Public comments for one published boks, including one-level reply links, aggregate like totals, and only the caller own like state.';

revoke all on function public.get_bok_comments(uuid) from public, anon, authenticated;
grant execute on function public.get_bok_comments(uuid) to anon, authenticated;

-- Replace the two-argument writer with a backwards-compatible optional parent.
drop function if exists public.create_bok_comment(uuid, text);
create function public.create_bok_comment(
  p_reel_id uuid,
  p_body text,
  p_parent_comment_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_body text := btrim(coalesce(p_body, ''));
  v_handle text;
  v_row public.comments;
begin
  if v_uid is null or v_anonymous then
    raise exception 'Create a free account to join the conversation.' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1200 then
    raise exception 'A comment must be between 1 and 1200 characters.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.reels where id = p_reel_id and status = 'published'
  ) then
    raise exception 'That boks is not available.' using errcode = '22023';
  end if;

  if p_parent_comment_id is not null and not exists (
    select 1
    from public.comments
    where id = p_parent_comment_id
      and reel_id = p_reel_id
      and parent_comment_id is null
  ) then
    raise exception 'That conversation is no longer available.' using errcode = '22023';
  end if;

  select handle into v_handle
  from public.user_profiles
  where user_id = v_uid;

  if v_handle is null then
    raise exception 'Choose your @nickname before commenting.' using errcode = '42501';
  end if;

  insert into public.comments (user_id, reel_id, body, parent_comment_id)
  values (v_uid, p_reel_id, v_body, p_parent_comment_id)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'storyId', v_row.reel_id::text,
    'visitorName', v_handle,
    'visitorHandle', v_handle,
    'body', v_row.body,
    'createdAt', v_row.created_at,
    'parentCommentId', v_row.parent_comment_id,
    'likesCount', 0,
    'likedByMe', false
  );
end;
$$;

revoke all on function public.create_bok_comment(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.create_bok_comment(uuid, text, bigint) to authenticated;

create or replace function public.set_bok_comment_like(p_comment_id bigint, p_liked boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_count integer;
begin
  if v_uid is null or v_anonymous then
    raise exception 'Create a free account to like comments.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.comments c
    join public.reels r on r.id = c.reel_id
    where c.id = p_comment_id and r.status = 'published'
  ) then
    raise exception 'That comment is no longer available.' using errcode = '22023';
  end if;

  if coalesce(p_liked, false) then
    insert into public.comment_likes (comment_id, user_id)
    values (p_comment_id, v_uid)
    on conflict (comment_id, user_id) do nothing;
  else
    delete from public.comment_likes
    where comment_id = p_comment_id and user_id = v_uid;
  end if;

  select count(*)::integer into v_count
  from public.comment_likes where comment_id = p_comment_id;

  return jsonb_build_object(
    'commentId', p_comment_id,
    'likedByMe', coalesce(p_liked, false),
    'likesCount', v_count
  );
end;
$$;

revoke all on function public.set_bok_comment_like(bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_bok_comment_like(bigint, boolean) to authenticated;
