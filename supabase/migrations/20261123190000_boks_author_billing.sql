-- Who pays (2026-11-23). The way in (20261123180000) is the same for a paid
-- author and for "our" author, brought in through the team's contacts on a
-- mutual arrangement: the team prepares the page, the author records with the
-- teleprompter, the Series go out in a batch the team decides on. Only paid
-- authors have a payment step. The page says which (`author_spaces.billing`),
-- the team sets it in Studio, and every author page there is now is ours.
--
--   partner  наш автор: no payment, no yearly limit in the Workshop
--   paid     по договору: the online contract's tariff; until the money comes
--            nothing opens to readers and no Series work starts
--
-- Tariffs stay on the contract (`author_agreements.plan`, `price_rub`), so new
-- ones need no change here. Switching a paid author to ours waives the
-- payment on the contract (`pay_state = 'waived'`); switching back asks for it
-- again with a fresh 30 days.

alter table public.author_spaces
  add column if not exists billing text not null default 'partner' check (billing in ('partner', 'paid'));

-- Everyone there is now is ours, except a page whose author has a paid contract.
update public.author_spaces s
set billing = 'paid'
where s.kind = 'author' and s.status <> 'merged' and s.owner_user_id is not null
  and exists (
    select 1 from public.author_agreements a
    where a.user_id = s.owner_user_id and a.price_rub > 0 and a.pay_state <> 'cancelled'
  );

alter table public.author_agreements drop constraint if exists author_agreements_pay_state_check;
alter table public.author_agreements
  add constraint author_agreements_pay_state_check
  check (pay_state in ('free', 'awaiting', 'reported', 'paid', 'waived', 'cancelled'));

-- The page the author works from (their own, not a merged one).
create or replace function public.boks_author_page_of(p_user_id uuid)
returns public.author_spaces
language sql
stable
security definer
set search_path = ''
as $$
  select s.* from public.author_spaces s
  where s.owner_user_id = p_user_id and s.kind = 'author' and s.status <> 'merged'
  order by (s.status = 'published') desc, s.created_at
  limit 1;
$$;
revoke all on function public.boks_author_page_of(uuid) from public, anon, authenticated;

-- An accepted invitation: the page opens the Workshop, its terms follow the
-- invitation's tariff, and the team's texts go to the author.
create or replace function public.boks_after_invite_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.accepted_at is null or old.accepted_at is not null or new.accepted_by is null then
    return new;
  end if;
  update public.author_spaces
  set verified = true, updated_at = now()
  where owner_user_id = new.accepted_by and kind = 'author' and status <> 'merged' and not verified;
  -- The invitation's tariff decides: a paid one makes the author paid; any
  -- other makes them ours, unless they already have a paid contract.
  update public.author_spaces
  set billing = case
        when new.plan is not null and public.boks_plan_price(new.plan) > 0 then 'paid'
        when exists (select 1 from public.author_agreements a
                     where a.user_id = new.accepted_by and a.price_rub > 0 and a.pay_state <> 'cancelled') then 'paid'
        else 'partner'
      end,
      updated_at = now()
  where owner_user_id = new.accepted_by and kind = 'author' and status <> 'merged';
  perform public.boks_hand_space_seeds(new.space_id, new.accepted_by);
  return new;
end;
$$;

-- Studio: the page's terms and what they mean now.
create or replace function public.studio_space_billing(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_space public.author_spaces;
  v_agreement public.author_agreements;
begin
  perform public.boks_require_editor();
  select * into v_space from public.author_spaces where id = p_space_id;
  if v_space.id is null then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  if v_space.owner_user_id is not null then
    select * into v_agreement from public.author_agreements
    where user_id = v_space.owner_user_id and pay_state <> 'cancelled';
  end if;
  return jsonb_build_object(
    'billing', v_space.billing,
    'owned', v_space.owner_user_id is not null,
    'agreement', case when v_agreement.id is null then null else jsonb_build_object(
      'number', v_agreement.number, 'plan', v_agreement.plan, 'priceRub', v_agreement.price_rub, 'payState', v_agreement.pay_state
    ) end
  );
end;
$$;
revoke all on function public.studio_space_billing(uuid) from public, anon, authenticated;
grant execute on function public.studio_space_billing(uuid) to authenticated;

create or replace function public.studio_set_space_billing(p_space_id uuid, p_billing text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_space public.author_spaces;
  v_agreement public.author_agreements;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if coalesce(p_billing, '') not in ('partner', 'paid') then
    raise exception 'Ours or paid?' using errcode = '22023';
  end if;
  select * into v_space from public.author_spaces where id = p_space_id for update;
  if v_space.id is null or v_space.status = 'merged' or v_space.kind <> 'author' then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  if v_space.owner_user_id is not null then
    select * into v_agreement from public.author_agreements
    where user_id = v_space.owner_user_id and pay_state <> 'cancelled' for update;
  end if;

  if p_billing = 'partner' then
    -- A contract still waiting for its money: the team waives it.
    if v_agreement.pay_state in ('awaiting', 'reported') then
      update public.author_agreements
      set pay_state = 'waived', pay_due = null,
          period_start = v_today, period_end = (v_today + interval '1 year' - interval '1 day')::date,
          pay_note = coalesce(v_note, pay_note), paid_marked_by = v_uid, paid_marked_at = now(), updated_at = now()
      where id = v_agreement.id;
    end if;
  else
    if v_space.owner_user_id is not null and (v_agreement.id is null or v_agreement.price_rub = 0) then
      raise exception 'A paid author needs a contract on a paid tariff: the author has none yet.' using errcode = '22023', hint = 'needs_contract';
    end if;
    -- Waived earlier: the payment is asked for again, with a fresh 30 days.
    if v_agreement.pay_state = 'waived' then
      update public.author_agreements
      set pay_state = 'awaiting', pay_due = v_today + public.boks_agreement_pay_days(),
          period_start = null, period_end = null, paid_marked_by = null, paid_marked_at = null,
          pay_note = coalesce(v_note, pay_note), updated_at = now()
      where id = v_agreement.id;
    end if;
  end if;

  update public.author_spaces set billing = p_billing, updated_at = now() where id = v_space.id;
  return public.studio_space_billing(v_space.id);
end;
$$;
revoke all on function public.studio_set_space_billing(uuid, text, text) from public, anon, authenticated;
grant execute on function public.studio_set_space_billing(uuid, text, text) to authenticated;

-- get_my_workshop as in 20261123090000, with the page's terms and no yearly limit for our authors.
create or replace function public.get_my_workshop()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_workshop_author();
  v_space public.author_spaces;
  v_handle text;
begin
  select * into v_space from public.author_spaces s
  where s.owner_user_id = v_uid and s.kind = 'author' and s.status in ('draft', 'published', 'unpublished') and s.verified
  order by (s.status = 'published') desc, s.created_at
  limit 1;
  select p.handle into v_handle from public.user_profiles p where p.user_id = v_uid;

  return jsonb_build_object(
    'author', jsonb_build_object(
      'userId', v_uid::text,
      'handle', v_handle,
      'name', coalesce(v_space.name, case when v_handle is not null then '@' || v_handle end),
      'pageId', v_space.id::text,
      'pageStatus', v_space.status,
      'billing', coalesce(v_space.billing, 'partner')
    ),
    'plan', jsonb_build_object(
      -- Our authors have no yearly limit: the team decides the batches.
      'perYear', case when v_space.billing = 'partner' then null else 30 end,
      'perWeek', 1,
      'usedThisYear', (
        select count(*)::integer from public.bok_series_work w
        where w.author_id = v_uid and w.state in ('accepted', 'sent', 'published')
          and w.accepted_at >= date_trunc('year', now())
      )
    ),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id::text,
        'title', r.title,
        'text', r.text,
        'status', r.status,
        'coverRequested', r.cover_requested,
        'coverVersion', r.cover_version,
        'createdAt', r.created_at,
        'updatedAt', r.updated_at,
        'form', coalesce(bw.form, 'poem'),
        'shelvedAt', bw.shelved_at,
        'queuePos', bw.queue_pos,
        'notes', coalesce(bw.notes, '{}'::jsonb),
        'voice', case when v.bok_id is null then null else jsonb_build_object(
          'file', v.file, 'durationMs', v.duration_ms, 'source', v.source, 'name', v.name,
          'at', v.recorded_at, 'current', v.fingerprint = public.boks_voice_fingerprint(r.text)
        ) end,
        'decision', case when d.bok_id is null then null else jsonb_build_object(
          'decision', d.decision, 'kind', d.kind, 'note', d.note, 'at', d.decided_at
        ) end,
        'series', case when sw.bok_id is null then null else jsonb_build_object(
          'state', sw.state, 'acceptedAt', sw.accepted_at, 'sentAt', sw.sent_at, 'publishedAt', sw.published_at,
          'workId', sw.work_id::text, 'revision', aw.revision, 'workStatus', aw.status,
          -- The Series sent to the author, to watch before publishing; null before it is sent.
          'seriesPiece', case when sw.state in ('sent', 'published') then coalesce(aw.series_piece, sw.series_piece) end
        ) end,
        'importedFrom', null
      ) order by r.created_at desc, r.id)
      from (
        select * from public.reels
        where author_user_id = v_uid and status <> 'archived'
        order by created_at desc, id
        limit 200
      ) r
      left join public.bok_workshop bw on bw.bok_id = r.id
      left join public.bok_voices v on v.bok_id = r.id and v.user_id = v_uid
      left join public.bok_editor_decisions d on d.bok_id = r.id
        and ((d.decision = 'changes' and r.status = 'draft') or (d.decision = 'refused' and r.status = 'rejected'))
      left join public.bok_series_work sw on sw.bok_id = r.id and sw.state in ('accepted', 'sent', 'published')
      left join public.author_space_works aw on aw.id = sw.work_id
    ), '[]'::jsonb),
    'ready', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workId', w.id::text, 'revision', w.revision, 'title', w.title, 'format', w.format, 'bokId', w.bok_id::text
      ) order by w.position nulls last, w.ready_at)
      from public.author_space_works w
      where v_space.id is not null and w.space_id = v_space.id and w.status = 'ready'
        and not exists (select 1 from public.bok_series_work s where s.work_id = w.id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_workshop() from public, anon, authenticated;
grant execute on function public.get_my_workshop() to authenticated;
