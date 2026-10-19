-- Rights review used LIMIT after jsonb_agg, which capped one aggregate row
-- instead of the catalogue rows. Page before aggregation and keep the old RPC
-- as a bounded compatibility wrapper for already-open admin sessions.
create or replace function public.get_boks_rights_review_page(
  p_status text default 'open',
  p_limit integer default 50,
  p_reports_offset integer default 0,
  p_unattested_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'open')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_reports_offset integer := greatest(coalesce(p_reports_offset, 0), 0);
  v_unattested_offset integer := greatest(coalesce(p_unattested_offset, 0), 0);
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if v_status not in ('open', 'all', 'actioned', 'dismissed') then
    raise exception 'Unknown report status.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'openReports', (select count(*)::integer from public.bok_reports where status = 'open'),
    'reportsTotal', (select count(*)::integer from public.bok_reports where v_status = 'all' or status = v_status),
    'unattested', (select count(*)::integer from public.bok_rights where not confirmed),
    'limit', v_limit,
    'reportsOffset', v_reports_offset,
    'unattestedOffset', v_unattested_offset,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rep.id::text,
        'reelId', rep.reel_id::text,
        'title', r.title,
        'authorHandle', author_profile.handle,
        'authorName', r.author_name,
        'bokStatus', r.status,
        'kind', rep.kind,
        'reason', rep.reason,
        'status', rep.status,
        'createdAt', rep.created_at,
        'reviewedAt', rep.reviewed_at,
        'reviewNote', rep.review_note,
        'reporterHandle', reporter_profile.handle,
        'rightsConfirmed', br.confirmed,
        'rightsNote', br.note
      ) order by rep.created_at desc, rep.id desc)
      from (
        select * from public.bok_reports
        where v_status = 'all' or status = v_status
        order by created_at desc, id desc
        limit v_limit offset v_reports_offset
      ) rep
      join public.reels r on r.id = rep.reel_id
      left join public.user_profiles author_profile on author_profile.user_id = r.author_user_id
      left join public.user_profiles reporter_profile on reporter_profile.user_id = rep.reporter_user_id
      left join public.bok_rights br on br.reel_id = rep.reel_id
    ), '[]'::jsonb),
    'unattestedBoks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reelId', page.id::text,
        'title', page.title,
        'authorHandle', author_profile.handle,
        'bokStatus', page.status,
        'note', page.note,
        'createdAt', page.created_at
      ) order by page.created_at desc, page.id desc)
      from (
        select r.id, r.title, r.author_user_id, r.status, br.note, r.created_at
        from public.bok_rights br
        join public.reels r on r.id = br.reel_id
        where not br.confirmed
        order by r.created_at desc, r.id desc
        limit v_limit offset v_unattested_offset
      ) page
      left join public.user_profiles author_profile on author_profile.user_id = page.author_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_boks_rights_review_page(text, integer, integer, integer) from public, anon;
grant execute on function public.get_boks_rights_review_page(text, integer, integer, integer) to authenticated;

create or replace function public.get_boks_rights_review(
  p_status text default 'open',
  p_limit integer default 50
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select public.get_boks_rights_review_page(p_status, p_limit, 0, 0);
$$;

revoke all on function public.get_boks_rights_review(text, integer) from public, anon;
grant execute on function public.get_boks_rights_review(text, integer) to authenticated;
