-- An application remembers the page made from it (`docs/author-agreements.md`,
-- "The way in"). «Оформить автора» made a new draft page on every press and
-- said nothing of the invitation, so the team took the draft for access: the
-- author could not come in, and pressing again made a second page. Now the
-- application shows its page and where it stands: page made, invited, or the
-- author is in.

alter table public.author_applications
  add column if not exists space_id uuid references public.author_spaces (id) on delete set null;

/** Studio: the page made from this application. */
create or replace function public.studio_link_application(p_id bigint, p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.author_spaces s where s.id = p_space_id and s.kind = 'author') then
    raise exception 'No such author page.' using errcode = '22023';
  end if;
  update public.author_applications
  set space_id = p_space_id,
      status = case when status = 'new' then 'contacted' else status end,
      updated_at = now()
  where id = p_id;
end;
$$;
revoke all on function public.studio_link_application(bigint, uuid) from public, anon, authenticated;
grant execute on function public.studio_link_application(bigint, uuid) to authenticated;

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
             a.created_at as "createdAt", p.handle, u.email,
             coalesce(a.space_id, own.id) as "spaceId",
             -- page: a draft, nobody invited; invited: an invitation waits; in: the author has the page.
             case
               when coalesce(s.owner_user_id, own.owner_user_id) is not null then 'in'
               when exists (
                 select 1 from public.author_space_invites i
                 where i.space_id = s.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
               ) then 'invited'
               when s.id is not null then 'page'
             end as "pageStage",
             (select i.email from public.author_space_invites i
              where i.space_id = s.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
              order by i.created_at desc limit 1) as "invitedEmail"
      from public.author_applications a
      left join public.user_profiles p on p.user_id = a.user_id
      left join auth.users u on u.id = a.user_id
      left join public.author_spaces s on s.id = a.space_id and s.status <> 'merged'
      left join lateral (
        select o.id, o.owner_user_id from public.author_spaces o
        where a.user_id is not null and o.owner_user_id = a.user_id and o.status <> 'merged'
        limit 1
      ) own on true
      order by a.created_at desc
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_author_applications(integer) from public, anon, authenticated;
grant execute on function public.list_author_applications(integer) to authenticated;
