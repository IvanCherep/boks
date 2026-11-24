-- Payment details for any recipient (`docs/author-agreements.md`, "Paying"):
-- today a private person, later a sole trader or a company. Who receives
-- (`recipient_kind`), the recipient's KPP (a company has one), and the bank's
-- INN and KPP, which some banks ask for in a transfer by details. The values
-- live in the database only, never in the repository.

alter table public.author_payment_details
  add column if not exists recipient_kind text not null default 'person'
    check (recipient_kind in ('person', 'self_employed', 'sole_trader', 'company')),
  add column if not exists kpp text check (kpp is null or kpp ~ '^[0-9]{9}$'),
  add column if not exists bank_inn text check (bank_inn is null or bank_inn ~ '^[0-9]{10}$'),
  add column if not exists bank_kpp text check (bank_kpp is null or bank_kpp ~ '^[0-9]{9}$');

create or replace function public.boks_payment_details_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when d.id is null then null else jsonb_build_object(
    'recipient', d.recipient, 'recipientKind', d.recipient_kind, 'inn', d.inn, 'kpp', d.kpp,
    'account', d.account, 'bank', d.bank, 'bic', d.bic, 'corrAccount', d.corr_account,
    'bankInn', d.bank_inn, 'bankKpp', d.bank_kpp,
    'sbpPhone', d.sbp_phone, 'sbpBank', d.sbp_bank, 'payLink', d.pay_link,
    'updatedAt', d.updated_at
  ) end
  from (select 1) one left join public.author_payment_details d on d.id;
$$;
revoke all on function public.boks_payment_details_json() from public, anon, authenticated;

create or replace function public.studio_save_payment_details(p_details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_editor();
  v_phone text := nullif(regexp_replace(coalesce(p_details ->> 'sbpPhone', ''), '[^0-9+]', '', 'g'), '');
  v_kind text := coalesce(nullif(btrim(coalesce(p_details ->> 'recipientKind', '')), ''), 'person');
begin
  if v_phone ~ '^8[0-9]{10}$' then v_phone := '+7' || substr(v_phone, 2); end if;
  if v_phone ~ '^7[0-9]{10}$' then v_phone := '+' || v_phone; end if;
  insert into public.author_payment_details as d (
    id, recipient, recipient_kind, inn, kpp, account, bank, bic, corr_account, bank_inn, bank_kpp,
    sbp_phone, sbp_bank, pay_link, updated_at, updated_by)
  values (
    true,
    nullif(btrim(coalesce(p_details ->> 'recipient', '')), ''),
    v_kind,
    nullif(regexp_replace(coalesce(p_details ->> 'inn', ''), '\s', '', 'g'), ''),
    case when v_kind = 'company' then nullif(regexp_replace(coalesce(p_details ->> 'kpp', ''), '\s', '', 'g'), '') end,
    nullif(regexp_replace(coalesce(p_details ->> 'account', ''), '\s', '', 'g'), ''),
    nullif(btrim(coalesce(p_details ->> 'bank', '')), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'bic', ''), '\s', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'corrAccount', ''), '\s', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'bankInn', ''), '\s', '', 'g'), ''),
    nullif(regexp_replace(coalesce(p_details ->> 'bankKpp', ''), '\s', '', 'g'), ''),
    v_phone,
    nullif(btrim(coalesce(p_details ->> 'sbpBank', '')), ''),
    nullif(btrim(coalesce(p_details ->> 'payLink', '')), ''),
    now(), v_uid
  )
  on conflict (id) do update set
    recipient = excluded.recipient, recipient_kind = excluded.recipient_kind, inn = excluded.inn, kpp = excluded.kpp,
    account = excluded.account, bank = excluded.bank, bic = excluded.bic, corr_account = excluded.corr_account,
    bank_inn = excluded.bank_inn, bank_kpp = excluded.bank_kpp, sbp_phone = excluded.sbp_phone,
    sbp_bank = excluded.sbp_bank, pay_link = excluded.pay_link, updated_at = now(), updated_by = v_uid;
  return public.boks_payment_details_json();
exception
  when check_violation then
    raise exception 'Check the details: account and correspondent account 20 digits, BIC 9, INN 10 or 12, KPP 9, bank INN 10, phone +7 and 10 digits, link https://.' using errcode = '22023';
end;
$$;
revoke all on function public.studio_save_payment_details(jsonb) from public, anon, authenticated;
grant execute on function public.studio_save_payment_details(jsonb) to authenticated;
