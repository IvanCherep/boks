-- The plan «Сотрудничество» (`partner`): authors the team invites through
-- people it knows. No money and no views target; the only duty is a post with
-- a link to each Series (its own offer, `author_partner_offer`, at
-- /author/terms/partner, by link only: the list of documents does not show it).
-- An invitation with this plan is accepted like the others: three boxes, the
-- partner offer instead of the paid one, and the same two consents. The
-- agreement keeps the offer's version in offer_version; its plan says which
-- offer that is.

-- ------------------------------------------------------------------ the new kind of document

alter table public.boks_legal_documents drop constraint if exists boks_legal_documents_kind_check;
alter table public.boks_legal_documents add constraint boks_legal_documents_kind_check
  check (kind in ('author_offer', 'author_pd_processing', 'author_pd_distribution', 'author_partner_offer'));

-- ------------------------------------------------------------------ the plan

alter table public.author_space_invites drop constraint if exists author_space_invites_plan_check;
alter table public.author_space_invites add constraint author_space_invites_plan_check
  check (plan is null or plan in ('launch', 'page', 'page_no_promotion', 'partner'));
alter table public.author_agreements drop constraint if exists author_agreements_plan_check;
alter table public.author_agreements add constraint author_agreements_plan_check
  check (plan in ('launch', 'page', 'page_no_promotion', 'partner'));

create or replace function public.boks_plan_price(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'launch' then 0 when 'partner' then 0 when 'page' then 30000 when 'page_no_promotion' then 500000 end;
$$;
revoke all on function public.boks_plan_price(text) from public, anon, authenticated;

-- The offer a plan is accepted under.
create or replace function public.boks_plan_offer_kind(p_plan text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_plan = 'partner' then 'author_partner_offer' else 'author_offer' end;
$$;
revoke all on function public.boks_plan_offer_kind(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the invitation's terms

-- As in 20261123190000, with the plan's own offer.
create or replace function public.get_author_invite_terms(p_token text default null, p_invite_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_invite public.author_space_invites;
  v_email text;
begin
  if v_uid is null then
    return null;
  end if;
  if p_invite_id is not null then
    select * into v_invite from public.author_space_invites where id = p_invite_id;
  else
    select * into v_invite from public.author_space_invites
    where token_hash = sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8'));
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_invite.id is null or v_invite.plan is null or v_email is distinct from v_invite.email then
    return null;
  end if;
  return jsonb_build_object(
    'plan', v_invite.plan,
    'priceRub', public.boks_plan_price(v_invite.plan),
    'payDays', public.boks_agreement_pay_days(),
    'seriesPerYear', public.boks_plan_series_per_year(v_invite.plan),
    'legalName', v_invite.legal_name,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'version', d.version, 'title', d.title) order by k.n)
      from (values (public.boks_plan_offer_kind(v_invite.plan), 1), ('author_pd_processing', 2), ('author_pd_distribution', 3)) k(kind, n)
      cross join lateral public.boks_legal_current(k.kind) d
      where d.kind is not null
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_author_invite_terms(text, uuid) from public, anon, authenticated;
grant execute on function public.get_author_invite_terms(text, uuid) to authenticated;

-- As in 20261123100000, with the plan's own offer: p_terms carries
-- "author_partner_offer" instead of "author_offer" for the plan «Сотрудничество».
create or replace function public.accept_author_invite_with_terms(p_token text, p_invite_id uuid, p_terms jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_invite public.author_space_invites;
  v_email text;
  v_name text := regexp_replace(btrim(coalesce(p_terms ->> 'legalName', '')), '\s+', ' ', 'g');
  v_offer_kind text;
  v_kind text;
  v_doc public.boks_legal_documents;
  v_versions jsonb := '{}'::jsonb;
  v_answer jsonb;
  v_year text := to_char(now() at time zone 'Europe/Moscow', 'YYYY');
  v_seq integer;
  v_agreement public.author_agreements;
  v_price integer;
  v_ip text;
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'Sign in with the invited email first.' using errcode = '42501';
  end if;

  if p_invite_id is not null then
    select * into v_invite from public.author_space_invites where id = p_invite_id;
  else
    select * into v_invite from public.author_space_invites
    where token_hash = sha256(convert_to(btrim(coalesce(p_token, '')), 'UTF8'));
  end if;
  -- An invitation without a plan, or one that is not this account's: the usual answer.
  if v_invite.id is null or v_invite.plan is null then
    return public.accept_author_invite(p_token, p_invite_id);
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is distinct from v_invite.email or v_invite.accepted_at is not null then
    return public.accept_author_invite(p_token, p_invite_id);
  end if;

  if char_length(v_name) < 5 or v_name !~ '^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .''-]*[A-Za-zА-Яа-яЁё.]$' or v_name !~ ' ' then
    raise exception 'Write your full name as in your passport.' using errcode = '22023';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'The name is too long.' using errcode = '22023';
  end if;
  v_offer_kind := public.boks_plan_offer_kind(v_invite.plan);
  foreach v_kind in array array[v_offer_kind, 'author_pd_processing', 'author_pd_distribution'] loop
    v_doc := public.boks_legal_current(v_kind);
    if v_doc.kind is null then
      raise exception 'The terms are not published yet.' using errcode = '55000';
    end if;
    if coalesce(p_terms ->> v_kind, '') <> v_doc.version then
      raise exception 'The terms have changed since the page opened. Reload it and read them again.' using errcode = '40001', hint = 'terms_changed';
    end if;
    v_versions := v_versions || jsonb_build_object(v_kind, v_doc.version);
  end loop;
  if exists (select 1 from public.author_agreements a where a.user_id = v_uid and a.pay_state <> 'cancelled') then
    raise exception 'You already have a contract with boks.' using errcode = '23505';
  end if;

  perform set_config('boks.accepting_terms', v_invite.id::text, true);
  v_answer := public.accept_author_invite(p_token, p_invite_id);
  perform set_config('boks.accepting_terms', '', true);
  if v_answer ->> 'state' <> 'accepted' then
    return v_answer;
  end if;

  -- Numbers run within a year: 2026/001, 2026/002, …
  perform pg_advisory_xact_lock(hashtext('boks.author_agreement_number'));
  select coalesce(max(split_part(a.number, '/', 2)::integer), 0) + 1 into v_seq
  from public.author_agreements a where split_part(a.number, '/', 1) = v_year;

  v_price := public.boks_plan_price(v_invite.plan);
  v_ip := btrim(split_part(coalesce(public.boks_request_header('x-forwarded-for'), public.boks_request_header('x-real-ip'), ''), ',', 1));

  insert into public.author_agreements (
    number, user_id, invite_id, space_id, plan, price_rub, legal_name, email,
    offer_version, processing_version, distribution_version,
    accepted_ip, accepted_agent, pay_state, pay_due, period_start, period_end
  )
  values (
    v_year || '/' || lpad(v_seq::text, 3, '0'), v_uid, v_invite.id, (v_answer ->> 'spaceId')::uuid,
    v_invite.plan, v_price, v_name, v_email,
    v_versions ->> v_offer_kind, v_versions ->> 'author_pd_processing', v_versions ->> 'author_pd_distribution',
    nullif(v_ip, ''), public.boks_request_header('user-agent'),
    case when v_price = 0 then 'free' else 'awaiting' end,
    case when v_price = 0 then null else (now() at time zone 'Europe/Moscow')::date + public.boks_agreement_pay_days() end,
    case when v_price = 0 then (now() at time zone 'Europe/Moscow')::date end,
    case when v_price = 0 then ((now() at time zone 'Europe/Moscow')::date + interval '1 year' - interval '1 day')::date end
  )
  returning * into v_agreement;

  return v_answer || jsonb_build_object('agreement', public.boks_agreement_json(v_agreement));
end;
$$;
revoke all on function public.accept_author_invite_with_terms(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.accept_author_invite_with_terms(text, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------ Studio issues it

-- As in 20261123100000, with the plan «Сотрудничество».
create or replace function public.studio_issue_author_invite(
  p_space_id uuid,
  p_email text,
  -- Null: an invitation without an offer, as before (Studio always says which).
  p_plan text default null,
  p_legal_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_plan text := nullif(btrim(coalesce(p_plan, '')), '');
  v_name text := nullif(regexp_replace(btrim(coalesce(p_legal_name, '')), '\s+', ' ', 'g'), '');
  v_space public.author_spaces;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_invite public.author_space_invites;
begin
  select * into v_space from public.author_spaces where id = p_space_id for update;
  if v_space.id is null or v_space.status = 'merged' then
    raise exception 'This page does not exist.' using errcode = 'P0002';
  end if;
  if v_space.kind <> 'author' then
    raise exception 'An editorial page is not handed over: the team publishes it.' using errcode = '22023';
  end if;
  if v_space.owner_user_id is not null then
    raise exception 'The author already has this page.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 320 then
    raise exception 'Enter the author''s email address.' using errcode = '22023';
  end if;
  if v_plan is not null and v_plan not in ('launch', 'page', 'page_no_promotion', 'partner') then
    raise exception 'Choose the plan.' using errcode = '22023';
  end if;
  if v_name is not null and (char_length(v_name) not between 3 and 200 or v_name ~ '[<>[:cntrl:]]') then
    raise exception 'Write the author''s full name.' using errcode = '22023';
  end if;

  update public.author_space_invites
  set revoked_at = now()
  where space_id = v_space.id and accepted_at is null and revoked_at is null;

  insert into public.author_space_invites (space_id, email, token_hash, created_by, expires_at, plan, legal_name)
  values (v_space.id, v_email, sha256(convert_to(v_token, 'UTF8')), v_uid, now() + interval '14 days', v_plan, v_name)
  returning * into v_invite;

  update public.author_spaces set updated_at = now() where id = v_space.id;

  return jsonb_build_object(
    'token', v_token,
    'invite', jsonb_build_object(
      'id', v_invite.id::text, 'email', v_invite.email, 'state', 'pending',
      'createdAt', v_invite.created_at, 'expiresAt', v_invite.expires_at, 'plan', v_invite.plan
    )
  );
end;
$$;
revoke all on function public.studio_issue_author_invite(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.studio_issue_author_invite(uuid, text, text, text) to authenticated;
