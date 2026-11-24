-- «Ведение авторов» (`docs/author-agreements.md`, "Keeping track"): one row per
-- author from the application to the open page, so nobody is forgotten when
-- there are many. The database gathers the facts; the step, whose move it is
-- and what to do next are decided in `lib/boks/author/pipeline.ts`, where
-- they are tested.

create or replace function public.studio_author_pipeline()
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
    select jsonb_agg(row order by (row ->> 'sortAt') desc nulls last)
    from (
      -- Applications without a page yet.
      select jsonb_build_object(
        'key', 'a' || a.id,
        'kind', 'application',
        'applicationId', a.id,
        'applicationStatus', a.status,
        'applicationAt', a.created_at,
        'applicationUpdatedAt', a.updated_at,
        'offer', a.offer,
        'name', a.name,
        'handle', p.handle,
        'email', coalesce(u.email, case when a.contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then a.contact end),
        'sortAt', a.updated_at
      ) as row
      from public.author_applications a
      left join public.user_profiles p on p.user_id = a.user_id
      left join auth.users u on u.id = a.user_id
      where a.status <> 'closed'
        and a.space_id is null
        and not exists (
          select 1 from public.author_spaces o
          where a.user_id is not null and o.owner_user_id = a.user_id and o.status <> 'merged'
        )

      union all

      -- The pages, with or without their author.
      select jsonb_build_object(
        'key', 's' || s.id,
        'kind', 'page',
        'spaceId', s.id,
        'applicationId', (select a.id from public.author_applications a where a.space_id = s.id order by a.created_at desc limit 1),
        'name', coalesce(s.name, '@' || op.handle),
        -- Before the author accepts: the applicant's own @handle (the page keeps it), else the page's.
        'handle', coalesce(op.handle, s.handle, (
          select ap.handle from public.author_applications a2 join public.user_profiles ap on ap.user_id = a2.user_id
          where a2.space_id = s.id order by a2.created_at desc limit 1)),
        'offer', (select a3.offer from public.author_applications a3 where a3.space_id = s.id order by a3.created_at desc limit 1),
        'email', coalesce(ou.email, inv.email),
        'billing', s.billing,
        'pageStatus', s.status,
        'pageCreatedAt', s.created_at,
        'pagePublishedAt', s.published_at,
        'ownerId', s.owner_user_id,
        'invite', case when inv.id is null then null else jsonb_build_object(
          'createdAt', inv.created_at, 'expiresAt', inv.expires_at, 'openedAt', inv.opened_at,
          'acceptedAt', inv.accepted_at, 'email', inv.email, 'problem', inv.problem, 'plan', inv.plan) end,
        'seeds', (select count(*) from public.author_space_seeds sd where sd.space_id = s.id),
        'agreement', case when ag.id is null then null else jsonb_build_object(
          'number', ag.number, 'plan', ag.plan, 'priceRub', ag.price_rub, 'payState', ag.pay_state,
          'payDue', ag.pay_due, 'reportedAt', ag.pay_reported_at, 'paidAt', ag.paid_at, 'acceptedAt', ag.accepted_at) end,
        'drafts', w.drafts,
        'voicedDrafts', w.voiced,
        'lastAuthorAt', w.last_at,
        'sent', w.sent,
        'sentOldestAt', w.sent_oldest,
        'inWork', sw.in_work,
        'inWorkOldestAt', sw.in_work_oldest,
        'withAuthor', sw.with_author,
        'withAuthorOldestAt', sw.with_author_oldest,
        'returned', sw.returned,
        'published', sw.published,
        'unshared', sw.unshared,
        'unsharedOldestAt', sw.unshared_oldest,
        'sortAt', greatest(s.updated_at, w.last_at, sw.last_at, inv.created_at, ag.updated_at)
      ) as row
      from public.author_spaces s
      left join public.user_profiles op on op.user_id = s.owner_user_id
      left join auth.users ou on ou.id = s.owner_user_id
      left join lateral (
        select i.* from public.author_space_invites i
        where i.space_id = s.id and i.revoked_at is null
        order by i.created_at desc limit 1
      ) inv on true
      left join lateral (
        select g.* from public.author_agreements g
        where g.user_id = s.owner_user_id and g.pay_state <> 'cancelled'
        order by g.accepted_at desc limit 1
      ) ag on s.owner_user_id is not null
      left join lateral (
        select
          count(*) filter (where r.status = 'draft') as drafts,
          count(*) filter (where r.status = 'draft' and exists (select 1 from public.bok_voices v where v.bok_id = r.id)) as voiced,
          count(*) filter (where r.status = 'pending_review' and not exists (
            select 1 from public.bok_series_work x where x.bok_id = r.id and x.state in ('accepted', 'sent', 'published'))) as sent,
          min(coalesce(r.submitted_at, r.updated_at)) filter (where r.status = 'pending_review' and not exists (
            select 1 from public.bok_series_work x where x.bok_id = r.id and x.state in ('accepted', 'sent', 'published'))) as sent_oldest,
          max(r.updated_at) as last_at
        from public.reels r
        where s.owner_user_id is not null and r.author_user_id = s.owner_user_id and r.archived_at is null
      ) w on true
      left join lateral (
        select
          count(*) filter (where x.state = 'accepted') as in_work,
          min(x.accepted_at) filter (where x.state = 'accepted') as in_work_oldest,
          count(*) filter (where x.state = 'sent') as with_author,
          min(x.sent_at) filter (where x.state = 'sent') as with_author_oldest,
          count(*) filter (where x.state = 'returned') as returned,
          count(*) filter (where x.state = 'published') as published,
          count(*) filter (where x.state = 'published' and not exists (select 1 from public.bok_share_links l where l.bok_id = x.bok_id)) as unshared,
          min(x.published_at) filter (where x.state = 'published' and not exists (select 1 from public.bok_share_links l where l.bok_id = x.bok_id)) as unshared_oldest,
          max(x.updated_at) as last_at
        from public.bok_series_work x
        where s.owner_user_id is not null and x.author_id = s.owner_user_id
      ) sw on true
      where s.kind = 'author' and s.status <> 'merged'
    ) rows
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_author_pipeline() from public, anon, authenticated;
grant execute on function public.studio_author_pipeline() to authenticated;
