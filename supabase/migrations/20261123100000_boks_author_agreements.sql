-- The author contract online (`docs/author-agreements.md`).
--
-- The team still talks to every author first, prepares the page in Studio and
-- invites the author by email. What changes: the invitation names the plan,
-- and accepting it is accepting the public offer for that plan and the two
-- consents on personal data, each with its own box. The acceptance is the
-- contract (an `author_agreements` row with its number, the versions of the
-- three texts, the time, the address and the browser).
--
-- The cabinet opens at once, before payment: the author adds texts and records
-- the voice. Until the team marks the money as received, nothing the author
-- owns opens to readers (page, works, boks): the triggers at the end refuse it.
-- The author pays by QR code or СБП with the details the team keeps here, and
-- presses «Я оплатил(а)»; the team checks the bank and marks it in Studio.

-- The texts themselves (public.boks_legal_documents, boks_legal_current,
-- get_boks_legal_document) come from 20261123095000_boks_legal_documents.sql.

-- ------------------------------------------------------------------ plans

-- The price of a plan is the offer's, the same for everyone (ст. 426 ГК).
create or replace function public.boks_plan_price(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan when 'launch' then 0 when 'page' then 30000 when 'page_no_promotion' then 500000 end;
$$;
revoke all on function public.boks_plan_price(text) from public, anon, authenticated;

-- The plan an invitation offers. Null: no offer to accept (a special project,
-- arranged with the author separately), the invitation works as before.
alter table public.author_space_invites
  add column if not exists plan text check (plan is null or plan in ('launch', 'page', 'page_no_promotion')),
  -- The full name for the contract as the team wrote it down; the author checks it.
  add column if not exists legal_name text check (legal_name is null or (char_length(legal_name) between 3 and 200 and legal_name !~ '[<>[:cntrl:]]'));

-- ------------------------------------------------------------------ agreements

create table if not exists public.author_agreements (
  id uuid primary key default gen_random_uuid(),
  number text not null unique check (number ~ '^[0-9]{4}/[0-9]{3,}$'),
  -- Kept after an account is deleted: the record of the contract outlives it.
  user_id uuid references auth.users (id) on delete set null,
  invite_id uuid references public.author_space_invites (id) on delete set null,
  space_id uuid references public.author_spaces (id) on delete set null,
  plan text not null check (plan in ('launch', 'page', 'page_no_promotion')),
  price_rub integer not null check (price_rub >= 0),
  legal_name text not null check (char_length(legal_name) between 3 and 200),
  email text not null,
  offer_version text not null,
  processing_version text not null,
  distribution_version text not null,
  accepted_at timestamptz not null default now(),
  accepted_ip text,
  accepted_agent text,
  pay_state text not null check (pay_state in ('free', 'awaiting', 'reported', 'paid', 'cancelled')),
  pay_due date,
  pay_reported_at timestamptz,
  paid_at timestamptz,
  paid_amount_rub integer check (paid_amount_rub is null or paid_amount_rub > 0),
  receipt_url text check (receipt_url is null or (char_length(receipt_url) <= 500 and receipt_url ~ '^https?://[^[:space:]]+$')),
  pay_note text check (pay_note is null or char_length(pay_note) <= 1000),
  paid_marked_by uuid references auth.users (id) on delete set null,
  paid_marked_at timestamptz,
  period_start date,
  period_end date,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  updated_at timestamptz not null default now()
);
-- One contract in force per account.
create unique index if not exists author_agreements_live_idx
  on public.author_agreements (user_id) where pay_state <> 'cancelled' and user_id is not null;
create index if not exists author_agreements_accepted_idx on public.author_agreements (accepted_at desc);
alter table public.author_agreements enable row level security;
revoke all on table public.author_agreements from public, anon, authenticated;

-- The details the author pays to (one row, set by the team in Studio).
create table if not exists public.author_payment_details (
  id boolean primary key default true check (id),
  recipient text check (recipient is null or char_length(recipient) <= 200),
  inn text check (inn is null or inn ~ '^[0-9]{10,12}$'),
  account text check (account is null or account ~ '^[0-9]{20}$'),
  bank text check (bank is null or char_length(bank) <= 200),
  bic text check (bic is null or bic ~ '^[0-9]{9}$'),
  corr_account text check (corr_account is null or corr_account ~ '^[0-9]{20}$'),
  sbp_phone text check (sbp_phone is null or sbp_phone ~ '^\+7[0-9]{10}$'),
  sbp_bank text check (sbp_bank is null or char_length(sbp_bank) <= 100),
  -- A ready payment link (a bank's СБП link): shown as the QR code when set.
  pay_link text check (pay_link is null or (char_length(pay_link) <= 500 and pay_link ~ '^https://[^[:space:]]+$')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.author_payment_details enable row level security;
revoke all on table public.author_payment_details from public, anon, authenticated;

-- Days to pay after acceptance (the offer, section 5).
create or replace function public.boks_agreement_pay_days()
returns integer language sql immutable set search_path = '' as $$ select 30 $$;
revoke all on function public.boks_agreement_pay_days() from public, anon, authenticated;

create or replace function public.boks_payment_details_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when d.id is null then null else jsonb_build_object(
    'recipient', d.recipient, 'inn', d.inn, 'account', d.account, 'bank', d.bank, 'bic', d.bic,
    'corrAccount', d.corr_account, 'sbpPhone', d.sbp_phone, 'sbpBank', d.sbp_bank, 'payLink', d.pay_link,
    'updatedAt', d.updated_at
  ) end
  from (select 1) one left join public.author_payment_details d on d.id;
$$;
revoke all on function public.boks_payment_details_json() from public, anon, authenticated;

create or replace function public.boks_agreement_json(p_agreement public.author_agreements, p_for_team boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_json jsonb;
begin
  if p_agreement.id is null then
    return null;
  end if;
  v_json := jsonb_build_object(
    'id', p_agreement.id::text,
    'number', p_agreement.number,
    'plan', p_agreement.plan,
    'priceRub', p_agreement.price_rub,
    'legalName', p_agreement.legal_name,
    'email', p_agreement.email,
    'acceptedAt', p_agreement.accepted_at,
    'documents', jsonb_build_object(
      'author_offer', p_agreement.offer_version,
      'author_pd_processing', p_agreement.processing_version,
      'author_pd_distribution', p_agreement.distribution_version
    ),
    'payState', p_agreement.pay_state,
    'payDue', p_agreement.pay_due,
    'reportedAt', p_agreement.pay_reported_at,
    'paidAt', p_agreement.paid_at,
    'paidAmountRub', p_agreement.paid_amount_rub,
    'periodStart', p_agreement.period_start,
    'periodEnd', p_agreement.period_end,
    'cancelledAt', p_agreement.cancelled_at
  );
  if p_for_team then
    v_json := v_json || jsonb_build_object(
      'userId', p_agreement.user_id::text,
      'spaceId', p_agreement.space_id::text,
      'acceptedIp', p_agreement.accepted_ip,
      'acceptedAgent', p_agreement.accepted_agent,
      'payNote', p_agreement.pay_note,
      -- The receipt is not on the site: the team sends it in a personal message.
      'receiptUrl', p_agreement.receipt_url,
      'cancelReason', p_agreement.cancel_reason,
      'handle', (select p.handle from public.user_profiles p where p.user_id = p_agreement.user_id),
      'name', (select s.name from public.author_spaces s where s.id = p_agreement.space_id)
    );
  elsif p_agreement.pay_state in ('awaiting', 'reported') then
    v_json := v_json || jsonb_build_object('payment', public.boks_payment_details_json());
  end if;
  return v_json;
end;
$$;
revoke all on function public.boks_agreement_json(public.author_agreements, boolean) from public, anon, authenticated;

-- Whether this account's contract waits for its payment: nothing of theirs opens to readers.
create or replace function public.boks_author_unpaid(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.author_agreements a
    where a.user_id = p_user_id and a.pay_state in ('awaiting', 'reported')
  );
$$;
revoke all on function public.boks_author_unpaid(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ the invitation's terms

-- What the invitation asks the author to accept, for the screen with the
-- boxes. Only for the address it was sent to, like accepting it.
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
    'legalName', v_invite.legal_name,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'version', d.version, 'title', d.title) order by k.n)
      from (values ('author_offer', 1), ('author_pd_processing', 2), ('author_pd_distribution', 3)) k(kind, n)
      cross join lateral public.boks_legal_current(k.kind) d
      where d.kind is not null
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_author_invite_terms(text, uuid) from public, anon, authenticated;
grant execute on function public.get_author_invite_terms(text, uuid) to authenticated;

-- An invitation with a plan is accepted only together with its terms
-- (`accept_author_invite_with_terms`), never by the bare call.
create or replace function public.boks_invite_needs_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.accepted_at is not null and old.accepted_at is null and new.plan is not null
     and coalesce(current_setting('boks.accepting_terms', true), '') <> new.id::text then
    raise exception 'Accept the offer and the consents first.' using errcode = '22023', hint = 'terms_required';
  end if;
  return new;
end;
$$;
drop trigger if exists boks_invite_needs_terms on public.author_space_invites;
create trigger boks_invite_needs_terms
  before update of accepted_at on public.author_space_invites
  for each row execute function public.boks_invite_needs_terms();
revoke all on function public.boks_invite_needs_terms() from public, anon, authenticated;

-- The request's address and browser, as the API passed them on.
create or replace function public.boks_request_header(p_name text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers jsonb;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  return left(v_headers ->> p_name, 500);
end;
$$;
revoke all on function public.boks_request_header(text) from public, anon, authenticated;

-- «Принять и открыть кабинет»: the offer of the invitation's plan and both
-- consents, in the editions in force, and the full name for the contract.
-- p_terms: { "author_offer": "<version>", "author_pd_processing": "<version>",
--            "author_pd_distribution": "<version>", "legalName": "<ФИО>" }
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
  foreach v_kind in array array['author_offer', 'author_pd_processing', 'author_pd_distribution'] loop
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
    v_versions ->> 'author_offer', v_versions ->> 'author_pd_processing', v_versions ->> 'author_pd_distribution',
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

-- ------------------------------------------------------------------ the author

create or replace function public.get_my_author_agreement()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_agreement public.author_agreements;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_agreement from public.author_agreements a
  where a.user_id = v_uid and a.pay_state <> 'cancelled'
  order by a.accepted_at desc limit 1;
  return public.boks_agreement_json(v_agreement);
end;
$$;
revoke all on function public.get_my_author_agreement() from public, anon, authenticated;
grant execute on function public.get_my_author_agreement() to authenticated;

-- «Я оплатил(а)»: the team checks the bank and marks the payment in Studio.
create or replace function public.report_my_author_payment()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_agreement public.author_agreements;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  select * into v_agreement from public.author_agreements a
  where a.user_id = v_uid and a.pay_state <> 'cancelled'
  for update;
  if v_agreement.id is null then
    raise exception 'You have no contract waiting for payment.' using errcode = 'P0002';
  end if;
  if v_agreement.pay_state = 'awaiting' then
    update public.author_agreements
    set pay_state = 'reported', pay_reported_at = now(), updated_at = now()
    where id = v_agreement.id
    returning * into v_agreement;
  elsif v_agreement.pay_state = 'reported' then
    -- Pressed again: once more to the team, after a quiet hour.
    if v_agreement.pay_reported_at < now() - interval '1 hour' then
      update public.author_agreements set pay_reported_at = now(), updated_at = now()
      where id = v_agreement.id returning * into v_agreement;
    end if;
  end if;
  return public.boks_agreement_json(v_agreement);
end;
$$;
revoke all on function public.report_my_author_payment() from public, anon, authenticated;
grant execute on function public.report_my_author_payment() to authenticated;

-- ------------------------------------------------------------------ Studio

create or replace function public.studio_author_agreements(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.boks_require_editor();
  return coalesce((
    select jsonb_agg(public.boks_agreement_json(a, true) order by
      (a.pay_state = 'reported') desc, (a.pay_state = 'awaiting') desc, a.accepted_at desc)
    from (select * from public.author_agreements order by accepted_at desc limit greatest(1, least(coalesce(p_limit, 100), 500))) a
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_author_agreements(integer) from public, anon, authenticated;
grant execute on function public.studio_author_agreements(integer) to authenticated;

-- The contract of the author who holds this page (Studio → Authors → the page).
create or replace function public.studio_space_agreement(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agreement public.author_agreements;
begin
  perform public.boks_require_editor();
  select a.* into v_agreement from public.author_agreements a
  left join public.author_spaces s on s.id = p_space_id
  where a.pay_state <> 'cancelled' and (a.space_id = p_space_id or (s.owner_user_id is not null and a.user_id = s.owner_user_id))
  order by a.accepted_at desc limit 1;
  return public.boks_agreement_json(v_agreement, true);
end;
$$;
revoke all on function public.studio_space_agreement(uuid) from public, anon, authenticated;
grant execute on function public.studio_space_agreement(uuid) to authenticated;

-- «Оплата получена»: the year starts on the day the money came.
create or replace function public.studio_mark_author_payment(
  p_agreement_id uuid,
  p_paid_on date,
  p_amount_rub integer,
  p_receipt_url text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_agreement public.author_agreements;
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_today date := (now() at time zone 'Europe/Moscow')::date;
begin
  select * into v_agreement from public.author_agreements where id = p_agreement_id for update;
  if v_agreement.id is null then
    raise exception 'This contract does not exist.' using errcode = 'P0002';
  end if;
  if v_agreement.pay_state not in ('awaiting', 'reported') then
    raise exception 'This contract is not waiting for payment.' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > v_today or p_paid_on < (v_agreement.accepted_at at time zone 'Europe/Moscow')::date - 30 then
    raise exception 'Give the day the money came.' using errcode = '22023';
  end if;
  if coalesce(p_amount_rub, 0) <= 0 then
    raise exception 'Give the amount that came.' using errcode = '22023';
  end if;
  if v_receipt is not null and v_receipt !~ '^https?://[^[:space:]]+$' then
    raise exception 'The receipt is a link from «Мой налог».' using errcode = '22023';
  end if;
  update public.author_agreements
  set pay_state = 'paid',
      paid_at = (p_paid_on::timestamp at time zone 'Europe/Moscow') + interval '12 hours',
      paid_amount_rub = p_amount_rub,
      receipt_url = v_receipt,
      pay_note = nullif(btrim(coalesce(p_note, '')), ''),
      paid_marked_by = v_uid,
      paid_marked_at = now(),
      period_start = p_paid_on,
      period_end = (p_paid_on + interval '1 year' - interval '1 day')::date,
      updated_at = now()
  where id = v_agreement.id
  returning * into v_agreement;
  return public.boks_agreement_json(v_agreement, true);
end;
$$;
revoke all on function public.studio_mark_author_payment(uuid, date, integer, text, text) from public, anon, authenticated;
grant execute on function public.studio_mark_author_payment(uuid, date, integer, text, text) to authenticated;

-- A payment marked by mistake goes back to waiting; a receipt link can be added later.
create or replace function public.studio_update_author_payment(p_agreement_id uuid, p_action text, p_receipt_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agreement public.author_agreements;
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
begin
  perform public.boks_require_editor();
  select * into v_agreement from public.author_agreements where id = p_agreement_id for update;
  if v_agreement.id is null then
    raise exception 'This contract does not exist.' using errcode = 'P0002';
  end if;
  if p_action = 'unmark' then
    if v_agreement.pay_state <> 'paid' then
      raise exception 'This contract is not marked as paid.' using errcode = '22023';
    end if;
    update public.author_agreements
    set pay_state = case when pay_reported_at is null then 'awaiting' else 'reported' end,
        paid_at = null, paid_amount_rub = null, receipt_url = null, paid_marked_by = null, paid_marked_at = null,
        period_start = null, period_end = null, updated_at = now()
    where id = v_agreement.id returning * into v_agreement;
  elsif p_action = 'receipt' then
    if v_receipt is not null and v_receipt !~ '^https?://[^[:space:]]+$' then
      raise exception 'The receipt is a link from «Мой налог».' using errcode = '22023';
    end if;
    update public.author_agreements set receipt_url = v_receipt, updated_at = now()
    where id = v_agreement.id returning * into v_agreement;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  return public.boks_agreement_json(v_agreement, true);
end;
$$;
revoke all on function public.studio_update_author_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.studio_update_author_payment(uuid, text, text) to authenticated;

create or replace function public.studio_payment_details()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.boks_require_editor();
  return public.boks_payment_details_json();
end;
$$;
revoke all on function public.studio_payment_details() from public, anon, authenticated;
grant execute on function public.studio_payment_details() to authenticated;

create or replace function public.studio_save_payment_details(p_details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_phone text := nullif(regexp_replace(coalesce(p_details ->> 'sbpPhone', ''), '[^0-9+]', '', 'g'), '');
begin
  if v_phone ~ '^8[0-9]{10}$' then v_phone := '+7' || substr(v_phone, 2); end if;
  if v_phone ~ '^7[0-9]{10}$' then v_phone := '+' || v_phone; end if;
  insert into public.author_payment_details as d (id, recipient, inn, account, bank, bic, corr_account, sbp_phone, sbp_bank, pay_link, updated_at, updated_by)
  values (
    true,
    nullif(btrim(coalesce(p_details ->> 'recipient', '')), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'inn', ''), '\s', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'account', ''), '\s', '', 'g'), ''),
    nullif(btrim(coalesce(p_details ->> 'bank', '')), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'bic', ''), '\s', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'corrAccount', ''), '\s', '', 'g'), ''),
    v_phone,
    nullif(btrim(coalesce(p_details ->> 'sbpBank', '')), ''),
    nullif(btrim(coalesce(p_details ->> 'payLink', '')), ''),
    now(), v_uid
  )
  on conflict (id) do update set
    recipient = excluded.recipient, inn = excluded.inn, account = excluded.account, bank = excluded.bank,
    bic = excluded.bic, corr_account = excluded.corr_account, sbp_phone = excluded.sbp_phone,
    sbp_bank = excluded.sbp_bank, pay_link = excluded.pay_link, updated_at = now(), updated_by = v_uid;
  return public.boks_payment_details_json();
exception
  when check_violation then
    raise exception 'Check the details: account and correspondent account 20 digits, BIC 9, INN 10 or 12, phone +7 and 10 digits, link https://.' using errcode = '22023';
end;
$$;
revoke all on function public.studio_save_payment_details(jsonb) from public, anon, authenticated;
grant execute on function public.studio_save_payment_details(jsonb) to authenticated;

-- The plan and the name go with the invitation.
drop function if exists public.studio_issue_author_invite(uuid, text);
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
  if v_plan is not null and v_plan not in ('launch', 'page', 'page_no_promotion') then
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

-- The plan of each invitation of a page, for Studio's list (the page's own
-- read, `studio_author_space`, is unchanged).
create or replace function public.studio_space_invite_plans(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.boks_require_editor();
  return coalesce((
    select jsonb_object_agg(i.id::text, jsonb_build_object('plan', i.plan, 'legalName', i.legal_name))
    from public.author_space_invites i where i.space_id = p_space_id
  ), '{}'::jsonb);
end;
$$;
revoke all on function public.studio_space_invite_plans(uuid) from public, anon, authenticated;
grant execute on function public.studio_space_invite_plans(uuid) to authenticated;

-- ------------------------------------------------------------------ nothing opens before payment

-- The author's own page, works and boks stay closed to readers until the
-- contract is paid. The team (Studio) is not held: it decides.
create or replace function public.boks_guard_unpaid_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_uid is null or coalesce(public.is_boks_admin(v_uid), false) then
    return new;
  end if;
  if tg_table_name = 'author_spaces' then
    if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return new; end if;
    v_owner := new.owner_user_id;
  elsif tg_table_name = 'author_space_works' then
    if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return new; end if;
    select s.owner_user_id into v_owner from public.author_spaces s where s.id = new.space_id;
  else
    if new.status <> 'published' or (tg_op = 'UPDATE' and old.status = 'published') then return new; end if;
    v_owner := new.author_user_id;
  end if;
  if v_owner = v_uid and public.boks_author_unpaid(v_owner) then
    raise exception 'Your page opens to readers once the payment has come.' using errcode = '42501', hint = 'payment_required';
  end if;
  return new;
end;
$$;
revoke all on function public.boks_guard_unpaid_publication() from public, anon, authenticated;

drop trigger if exists boks_guard_unpaid_page on public.author_spaces;
create trigger boks_guard_unpaid_page
  before insert or update of status on public.author_spaces
  for each row execute function public.boks_guard_unpaid_publication();
drop trigger if exists boks_guard_unpaid_work on public.author_space_works;
create trigger boks_guard_unpaid_work
  before insert or update of status on public.author_space_works
  for each row execute function public.boks_guard_unpaid_publication();
drop trigger if exists boks_guard_unpaid_bok on public.reels;
create trigger boks_guard_unpaid_bok
  before insert or update of status on public.reels
  for each row execute function public.boks_guard_unpaid_publication();
