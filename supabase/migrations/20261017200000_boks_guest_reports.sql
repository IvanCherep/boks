-- A rights complaint is available to any reader, including an anonymous
-- Supabase session without accepted terms (docs/copyright.md, section 2).
-- Keep reports behind their RPC and keep the suspension/self-erasure checks;
-- only social and author writes require a permanent, terms-accepted account.
create or replace function public.reject_blocked_boks_user_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  -- Set only by `delete_my_boks_account`, transaction-local, and only ever to
  -- the caller's own id: the erasure of one's own account is the one write a
  -- deleted or suspended account must still be able to make.
  if v_uid is not null
     and current_setting('boks.erasing_account', true) = v_uid::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_uid is not null and public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  if v_uid is not null and tg_op <> 'DELETE' and tg_table_name in
    ('likes', 'comments', 'comment_likes', 'author_follows', 'reels')
     and (
       v_is_anonymous
       or not exists (
         select 1 from public.user_profiles p
         where p.user_id = v_uid and p.terms_accepted_at is not null
       )
     ) then
    raise exception 'Accept the boks terms before using this feature.' using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.reject_blocked_boks_user_mutation()
  from public, anon, authenticated;
