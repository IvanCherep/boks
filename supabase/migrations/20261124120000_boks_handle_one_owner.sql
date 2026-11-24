-- One @name, one owner (`docs/author-agreements.md`, "One name"). An account's
-- @handle and an author page's address share one space: the page becomes the
-- account's when the author accepts. Accounts are unique among accounts and
-- pages among pages by index; across the two the check was in code, on each
-- side, without a lock. Now both sides take the same lock on the name, and a
-- page cannot take a service name (@admin, @support…) either.

create or replace function public.boks_lock_handle(p_handle text)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('boks-handle:' || lower(p_handle), 0));
$$;
revoke all on function public.boks_lock_handle(text) from public, anon, authenticated;

/**
 * What stands in the way of a name: 'invalid', 'reserved', 'account' (some
 * account has it), 'page' (another page has it), 'moved' (an author's former
 * address, kept so old links lead to them) or 'free'. `p_space_id` is the page
 * asking, so its own address is free to it.
 */
create or replace function public.boks_handle_status(p_handle text, p_space_id uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select lower(btrim(ltrim(btrim(coalesce(p_handle, '')), '@'))) as v)
  select case
    when not public.boks_handle_is_valid(h.v) then 'invalid'
    when h.v = any (public.boks_reserved_handles()) then 'reserved'
    when exists (select 1 from public.user_profiles p where lower(p.handle) = h.v) then 'account'
    when exists (select 1 from public.author_spaces s where lower(s.handle) = h.v and s.status <> 'merged' and s.id is distinct from p_space_id) then 'page'
    when exists (select 1 from public.author_handle_moves m where m.handle = h.v) then 'moved'
    else 'free'
  end
  from h;
$$;
revoke all on function public.boks_handle_status(text, uuid) from public, anon, authenticated;

/** Studio, while the address is typed: is it free for this page? */
create or replace function public.studio_check_handle(p_handle text, p_space_id uuid default null)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_boks_admin() then
    raise exception 'Only the team can do this.' using errcode = '42501';
  end if;
  return public.boks_handle_status(p_handle, p_space_id);
end;
$$;
revoke all on function public.studio_check_handle(text, uuid) from public, anon, authenticated;
grant execute on function public.studio_check_handle(text, uuid) to authenticated;

-- The page side: whatever writes an address (Studio, a merge) meets the same rules.
create or replace function public.boks_guard_space_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.handle is null or new.status = 'merged'
     or (tg_op = 'UPDATE' and lower(new.handle) is not distinct from lower(old.handle) and old.status <> 'merged') then
    return new;
  end if;
  perform public.boks_lock_handle(new.handle);
  if lower(new.handle) = any (public.boks_reserved_handles()) then
    raise exception 'The address @% is reserved for the platform.', lower(new.handle) using errcode = '23505';
  end if;
  if exists (select 1 from public.user_profiles p where lower(p.handle) = lower(new.handle))
     or exists (select 1 from public.author_handle_moves m where m.handle = lower(new.handle)) then
    raise exception 'The address @% is already taken.', lower(new.handle) using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function public.boks_guard_space_handle() from public, anon, authenticated;

drop trigger if exists author_spaces_guard_handle on public.author_spaces;
create trigger author_spaces_guard_handle
  before insert or update of handle, status on public.author_spaces
  for each row execute function public.boks_guard_space_handle();

-- The account side: the same lock before it looks at the pages.
create or replace function public.boks_guard_reserved_handle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.handle is null or (tg_op = 'UPDATE' and new.handle is not distinct from old.handle) then
    return new;
  end if;
  perform public.boks_lock_handle(new.handle);
  -- The page's own author taking its handle is the point of reserving it.
  if current_setting('boks.claiming_space_handle', true) = new.handle then
    return new;
  end if;
  if public.boks_handle_reserved_by_space(new.handle) or public.boks_handle_moved_from(new.handle, new.user_id) then
    if tg_op = 'INSERT' then
      new.handle := left(new.handle, 19) || (1000 + floor(random() * 8999))::integer::text;
      perform public.boks_lock_handle(new.handle);
    else
      raise exception 'That nickname is already taken.' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;
