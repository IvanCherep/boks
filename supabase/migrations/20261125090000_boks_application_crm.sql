-- Applications as a small CRM (`docs/author-applications.md`, "Working an
-- application"). Three states (new, written to, closed) did not say where a
-- conversation stood: whether we wrote and wait, whether the person answered
-- and the next move is ours, whether we agreed. Each application now has a
-- stage, a line «что уточнить» the team keeps current, and a journal of
-- notes and stage changes with who and when, so nothing said or decided is
-- lost. What the person filled in is never changed.
--
-- `status` stays: the applicant's page and the Telegram feed read it, and it
-- is derived from the stage (new → new; written, replied, agreed →
-- contacted; declined, silent → closed).

alter table public.author_applications
  add column if not exists stage text not null default 'new',
  add column if not exists stage_at timestamptz not null default now(),
  add column if not exists focus text;
alter table public.author_applications
  add constraint author_applications_stage check (stage in ('new', 'written', 'replied', 'agreed', 'declined', 'silent')),
  add constraint author_applications_focus check (focus is null or char_length(focus) <= 500);

update public.author_applications
set stage = case
      when space_id is not null then 'agreed'
      when status = 'contacted' then 'written'
      when status = 'closed' then 'declined'
      else 'new'
    end,
    stage_at = updated_at;

create or replace function public.boks_application_status(p_stage text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_stage = 'new' then 'new'
    when p_stage in ('declined', 'silent') then 'closed'
    else 'contacted'
  end;
$$;
revoke all on function public.boks_application_status(text) from public, anon, authenticated;

create table public.author_application_events (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.author_applications (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  kind text not null,
  body text,
  stage_from text,
  stage_to text,
  created_at timestamptz not null default now(),
  constraint author_application_events_kind check (kind in ('note', 'stage', 'focus')),
  constraint author_application_events_body check (body is null or char_length(body) <= 4000)
);
create index author_application_events_app_idx on public.author_application_events (application_id, created_at desc);
alter table public.author_application_events enable row level security;
revoke all on public.author_application_events from public, anon, authenticated;

-- The stage moves: the journal says from what to what, and an optional word why.
create or replace function public.studio_application_set_stage(p_id bigint, p_stage text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if p_stage not in ('new', 'written', 'replied', 'agreed', 'declined', 'silent') then
    raise exception 'Unknown stage.' using errcode = '22023';
  end if;
  select a.stage into v_from from public.author_applications a where a.id = p_id for update;
  if v_from is null then
    raise exception 'No such application.' using errcode = '22023';
  end if;
  if v_from = p_stage and v_note is null then return; end if;
  update public.author_applications
  set stage = p_stage,
      stage_at = case when v_from = p_stage then stage_at else now() end,
      status = public.boks_application_status(p_stage),
      updated_at = now()
  where id = p_id;
  insert into public.author_application_events (application_id, actor_user_id, kind, body, stage_from, stage_to)
  values (p_id, auth.uid(), case when v_from = p_stage then 'note' else 'stage' end, left(v_note, 4000),
          case when v_from = p_stage then null else v_from end, case when v_from = p_stage then null else p_stage end);
end;
$$;
revoke all on function public.studio_application_set_stage(bigint, text, text) from public, anon, authenticated;
grant execute on function public.studio_application_set_stage(bigint, text, text) to authenticated;

create or replace function public.studio_application_add_note(p_id bigint, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'Write the note first.' using errcode = '22023';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'A note is at most 4000 characters.' using errcode = '22023';
  end if;
  update public.author_applications set updated_at = now() where id = p_id;
  if not found then
    raise exception 'No such application.' using errcode = '22023';
  end if;
  insert into public.author_application_events (application_id, actor_user_id, kind, body)
  values (p_id, auth.uid(), 'note', v_body);
end;
$$;
revoke all on function public.studio_application_add_note(bigint, text) from public, anon, authenticated;
grant execute on function public.studio_application_add_note(bigint, text) to authenticated;

-- «Что уточнить»: one current line. Every edit goes to the journal too, so an
-- overwritten line is not lost.
create or replace function public.studio_application_set_focus(p_id bigint, p_focus text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_focus text := nullif(btrim(coalesce(p_focus, '')), '');
  v_old text;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if char_length(v_focus) > 500 then
    raise exception 'Keep it to 500 characters; longer goes into a note.' using errcode = '22023';
  end if;
  select a.focus into v_old from public.author_applications a where a.id = p_id for update;
  if not found then
    raise exception 'No such application.' using errcode = '22023';
  end if;
  if v_old is not distinct from v_focus then return; end if;
  update public.author_applications set focus = v_focus, updated_at = now() where id = p_id;
  insert into public.author_application_events (application_id, actor_user_id, kind, body)
  values (p_id, auth.uid(), 'focus', v_focus);
end;
$$;
revoke all on function public.studio_application_set_focus(bigint, text) from public, anon, authenticated;
grant execute on function public.studio_application_set_focus(bigint, text) to authenticated;

create or replace function public.studio_application_events(p_id bigint)
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
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'kind', e.kind, 'body', e.body, 'stageFrom', e.stage_from, 'stageTo', e.stage_to,
      'at', e.created_at, 'by', p.handle) order by e.created_at desc, e.id desc)
    from public.author_application_events e
    left join public.user_profiles p on p.user_id = e.actor_user_id
    where e.application_id = p_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_application_events(bigint) from public, anon, authenticated;
grant execute on function public.studio_application_events(bigint) to authenticated;

-- The old buttons still work and keep the stage in step.
create or replace function public.set_author_application_status(p_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if p_status not in ('new', 'contacted', 'closed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  select a.stage into v_stage from public.author_applications a where a.id = p_id;
  if v_stage is null or public.boks_application_status(v_stage) = p_status then return; end if;
  perform public.studio_application_set_stage(p_id, case p_status when 'new' then 'new' when 'contacted' then 'written' else 'declined' end, null);
end;
$$;
revoke all on function public.set_author_application_status(bigint, text) from public, anon, authenticated;
grant execute on function public.set_author_application_status(bigint, text) to authenticated;

/** Studio: the page made from this application. Making it means we agreed. */
create or replace function public.studio_link_application(p_id bigint, p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stage text;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.author_spaces s where s.id = p_space_id and s.kind = 'author') then
    raise exception 'No such author page.' using errcode = '22023';
  end if;
  update public.author_applications set space_id = p_space_id, updated_at = now() where id = p_id
  returning stage into v_stage;
  if v_stage in ('new', 'written', 'replied') then
    perform public.studio_application_set_stage(p_id, 'agreed', 'Создана страница автора.');
  end if;
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
             a.stage, a.stage_at as "stageAt", a.focus, a.updated_at as "updatedAt",
             a.created_at as "createdAt", p.handle, u.email, a.user_id is null as guest,
             (select count(*) from public.author_application_events e where e.application_id = a.id and e.kind = 'note') as notes,
             (select jsonb_build_object('body', e.body, 'at', e.created_at)
              from public.author_application_events e
              where e.application_id = a.id and e.kind = 'note' and e.body is not null
              order by e.created_at desc, e.id desc limit 1) as "lastNote",
             -- The same person's other applications: by account, device or contact.
             (select count(*) from public.author_applications o
              where o.id <> a.id
                and ((a.user_id is not null and o.user_id = a.user_id)
                  or (a.visitor_id is not null and o.visitor_id = a.visitor_id)
                  or lower(btrim(o.contact)) = lower(btrim(a.contact)))) as "others",
             coalesce(a.space_id, own.id) as "spaceId",
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

-- «Ведение авторов» reads the stage too: who moves next on an application.
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
        'applicationStage', a.stage,
        'applicationStageAt', a.stage_at,
        'applicationFocus', a.focus,
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
