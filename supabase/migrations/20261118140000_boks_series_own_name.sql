-- The Series recorder's teleprompter: a new draft starts signed with the
-- recorder's own name, because people mostly record their own work.
--
-- An author's draft already is (`authorName`, fixed). Studio's started empty.
-- `authorName` cannot be its default: for the catalogue account it falls
-- back to the byline of its latest import ("Thomas Hardy"). `ownName` is the
-- caller's own name only: their author page's name, else their byline when
-- every one of their boks carries the same one, else null (nothing is
-- prefilled). Studio still edits it freely. The body is otherwise verbatim
-- from 20261117160000.

create or replace function public.get_my_series_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_admin boolean := public.is_boks_admin(v_uid);
  v_granted integer := 0;
  v_used integer := 0;
begin
  select c.granted, c.used into v_granted, v_used from public.series_credits c where c.user_id = v_uid;
  return jsonb_build_object(
    'userId', v_uid,
    'handle', (select p.handle from public.user_profiles p where p.user_id = v_uid),
    -- The name a Series is signed with: the author's page, else the byline of
    -- their latest work, else their @name. An author does not choose it per Series.
    'authorName', coalesce(
      (select s.name from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged' and btrim(coalesce(s.name, '')) <> '' order by s.created_at limit 1),
      (select r.author_name from public.reels r where r.author_user_id = v_uid and btrim(coalesce(r.author_name, '')) <> '' order by coalesce(r.submitted_at, r.created_at) desc limit 1),
      (select '@' || p.handle from public.user_profiles p where p.user_id = v_uid)),
    -- The caller's own name, for prefilling: never a byline borrowed from a catalogue.
    'ownName', coalesce(
      (select s.name from public.author_spaces s where s.owner_user_id = v_uid and s.status <> 'merged' and btrim(coalesce(s.name, '')) <> '' order by s.created_at limit 1),
      (select min(btrim(r.author_name)) from public.reels r
       where r.author_user_id = v_uid and btrim(coalesce(r.author_name, '')) <> ''
       having count(distinct btrim(r.author_name)) = 1)),
    'admin', v_admin,
    'granted', coalesce(v_granted, 0),
    'used', coalesce(v_used, 0),
    'left', greatest(0, coalesce(v_granted, 0) - coalesce(v_used, 0)),
    'allowed', v_admin or coalesce(v_granted, 0) > 0
  );
end;
$$;
