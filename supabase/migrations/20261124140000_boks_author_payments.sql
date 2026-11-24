-- «Договор и оплаты» (`docs/author-agreements.md`, "Contract and payments"):
-- one quiet page for the author with the contract, every payment with its
-- receipt, and the documents they accepted, instead of a contract card that
-- hangs in the Workshop. The Workshop shows the contract only while a payment
-- is asked for.
--
-- Payments get their own table, so a contract can have more than one (a
-- renewal, an instalment, a change of tariff) and a year can hold more than
-- one contract. Today's payment of a tariff still lives on the contract row,
-- where Studio and the guards read it; a trigger keeps its payment row the
-- same, so nothing that works now changes.

create table public.author_payments (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.author_agreements (id) on delete cascade,
  kind text not null default 'tariff' check (kind in ('tariff', 'renewal', 'extra')),
  amount_rub integer not null check (amount_rub >= 0),
  state text not null check (state in ('awaiting', 'reported', 'paid', 'waived', 'cancelled')),
  due_on date,
  reported_at timestamptz,
  paid_at timestamptz,
  paid_amount_rub integer,
  receipt_url text,
  note text,
  marked_by uuid,
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index author_payments_one_tariff on public.author_payments (agreement_id) where kind = 'tariff';
create index author_payments_agreement on public.author_payments (agreement_id, created_at);
alter table public.author_payments enable row level security;
revoke all on public.author_payments from public, anon, authenticated;

/** The contract's own payment (its tariff) follows the contract row. A free contract has none. */
create or replace function public.boks_sync_tariff_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.price_rub, 0) = 0 or new.pay_state = 'free' then
    delete from public.author_payments where agreement_id = new.id and kind = 'tariff';
    return new;
  end if;
  insert into public.author_payments (agreement_id, kind, amount_rub, state, due_on, reported_at, paid_at, paid_amount_rub, receipt_url, note, marked_by, marked_at, created_at, updated_at)
  values (new.id, 'tariff', new.price_rub, new.pay_state, new.pay_due, new.pay_reported_at, new.paid_at, new.paid_amount_rub, new.receipt_url, new.pay_note, new.paid_marked_by, new.paid_marked_at, new.accepted_at, now())
  on conflict (agreement_id) where kind = 'tariff' do update set
    amount_rub = excluded.amount_rub,
    state = excluded.state,
    due_on = excluded.due_on,
    reported_at = excluded.reported_at,
    paid_at = excluded.paid_at,
    paid_amount_rub = excluded.paid_amount_rub,
    receipt_url = excluded.receipt_url,
    note = excluded.note,
    marked_by = excluded.marked_by,
    marked_at = excluded.marked_at,
    updated_at = now();
  return new;
end;
$$;
revoke all on function public.boks_sync_tariff_payment() from public, anon, authenticated;

create trigger author_agreements_sync_payment
  after insert or update on public.author_agreements
  for each row execute function public.boks_sync_tariff_payment();

-- The contracts there are now get their payment rows (written here, so no other trigger runs).
insert into public.author_payments (agreement_id, kind, amount_rub, state, due_on, reported_at, paid_at, paid_amount_rub, receipt_url, note, marked_by, marked_at, created_at)
select a.id, 'tariff', a.price_rub, a.pay_state, a.pay_due, a.pay_reported_at, a.paid_at, a.paid_amount_rub, a.receipt_url, a.pay_note, a.paid_marked_by, a.paid_marked_at, a.accepted_at
from public.author_agreements a
where coalesce(a.price_rub, 0) > 0 and a.pay_state <> 'free';

create or replace function public.boks_payment_json(p public.author_payments, p_for_team boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id::text,
    'agreementId', p.agreement_id::text,
    'kind', p.kind,
    'amountRub', p.amount_rub,
    'state', p.state,
    'dueOn', p.due_on,
    'reportedAt', p.reported_at,
    'paidAt', p.paid_at,
    'paidAmountRub', p.paid_amount_rub,
    -- The author sees the receipt on «Договор и оплаты»; it also goes by email (offer, 5.3).
    'receiptUrl', p.receipt_url,
    'createdAt', p.created_at
  ) || case when p_for_team then jsonb_build_object('note', p.note, 'markedAt', p.marked_at) else '{}'::jsonb end;
$$;
revoke all on function public.boks_payment_json(public.author_payments, boolean) from public, anon, authenticated;

/**
 * «Договор и оплаты»: the author's contracts, newest first, each with its
 * payments, the Series made in its period against its yearly number, and
 * whether the author is ours (no payments asked).
 */
create or replace function public.get_my_billing()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'billing', coalesce((
      select s.billing from public.author_spaces s
      where s.owner_user_id = v_uid and s.status <> 'merged' limit 1
    ), 'partner'),
    'agreements', coalesce((
      select jsonb_agg(
        public.boks_agreement_json(a)
        || jsonb_build_object(
          'seriesPerYear', a.series_per_year,
          'seriesUsed', (
            select count(*)::integer from public.bok_series_work w
            where w.author_id = v_uid and w.state in ('accepted', 'sent', 'published')
              and w.accepted_at >= coalesce(a.period_start, date_trunc('year', a.accepted_at)::date)
              and (a.period_end is null or w.accepted_at < a.period_end + 1)
          ),
          'payments', coalesce((
            select jsonb_agg(public.boks_payment_json(p) order by p.created_at desc)
            from public.author_payments p where p.agreement_id = a.id and p.state <> 'cancelled'
          ), '[]'::jsonb)
        )
        order by a.accepted_at desc)
      from public.author_agreements a
      where a.user_id = v_uid
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_billing() from public, anon, authenticated;
grant execute on function public.get_my_billing() to authenticated;

/** Studio: a contract's payments, for the list under it. */
create or replace function public.studio_agreement_payments(p_agreement_id uuid)
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
    select jsonb_agg(public.boks_payment_json(p, true) order by p.created_at desc)
    from public.author_payments p where p.agreement_id = p_agreement_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.studio_agreement_payments(uuid) from public, anon, authenticated;
grant execute on function public.studio_agreement_payments(uuid) to authenticated;
