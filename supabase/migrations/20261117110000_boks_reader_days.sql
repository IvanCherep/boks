-- My days (2026-11-17).
--
-- The days an account came to boks, in its own time zone (the same day the
-- letter keys on, `boks_reader_today`). Today's letter state comes with the
-- day, so the reader asks one question on arrival. The first request of a day records it; the reader's day
-- card - "A new day: you are here for the 3rd day, two in a row", with the
-- week, today's letter and the game - is shown once per day across devices
-- (`card_seen_at`). You → Settings → My days shows any month.

create table public.reader_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  first_seen_at timestamptz not null default now(),
  card_seen_at timestamptz,
  primary key (user_id, day)
);
alter table public.reader_days enable row level security;
revoke all on public.reader_days from public, anon, authenticated;

-- Days in a row up to and including `p_day`.
create or replace function public.boks_reader_streak(p_user_id uuid, p_day date)
returns integer
language sql
stable
set search_path = ''
as $$
  with recursive run(day) as (
    select d.day from public.reader_days d where d.user_id = p_user_id and d.day = p_day
    union all
    select d.day from run r join public.reader_days d on d.user_id = p_user_id and d.day = r.day - 1
  )
  select count(*)::integer from run;
$$;
revoke all on function public.boks_reader_streak(uuid, date) from public, anon, authenticated;

-- Today is a day the account came. Returns what the day card needs.
create or replace function public.get_daily_arrival(p_time_zone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_today record;
  v_monday date;
  v_row public.reader_days;
begin
  select * into v_today from public.boks_reader_today(v_uid, p_time_zone);
  insert into public.reader_days (user_id, day) values (v_uid, v_today.day)
  on conflict (user_id, day) do nothing;
  select * into v_row from public.reader_days d where d.user_id = v_uid and d.day = v_today.day;
  v_monday := v_today.day - (extract(isodow from v_today.day)::integer - 1);
  return jsonb_build_object(
    'date', v_today.day,
    'cardSeen', v_row.card_seen_at is not null,
    'total', (select count(*) from public.reader_days d where d.user_id = v_uid),
    'streak', public.boks_reader_streak(v_uid, v_today.day),
    'week', (
      select jsonb_agg(jsonb_build_object(
        'date', w.day,
        'visited', exists (select 1 from public.reader_days d where d.user_id = v_uid and d.day = w.day),
        'letter', exists (select 1 from public.daily_letters l where l.recipient_user_id = v_uid and l.letter_date = w.day)
      ) order by w.day)
      from (select (v_monday + n)::date as day from generate_series(0, 6) n) w
    ),
    'letterOpened', exists (select 1 from public.daily_letters l where l.recipient_user_id = v_uid and l.letter_date = v_today.day)
  );
end;
$$;
revoke all on function public.get_daily_arrival(text) from public, anon, authenticated;
grant execute on function public.get_daily_arrival(text) to authenticated;

-- The day card was shown: not again today, on any device.
create or replace function public.mark_daily_card_seen(p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
begin
  update public.reader_days d set card_seen_at = coalesce(d.card_seen_at, now())
  where d.user_id = v_uid and d.day = p_day;
end;
$$;
revoke all on function public.mark_daily_card_seen(date) from public, anon, authenticated;
grant execute on function public.mark_daily_card_seen(date) to authenticated;

-- One month of the account's days, for You → Settings → My days.
create or replace function public.get_my_days(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_first date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_last date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month - 1 day')::date;
  v_today date;
begin
  select max(d.day) into v_today from public.reader_days d where d.user_id = v_uid;
  return jsonb_build_object(
    'month', v_first,
    'total', (select count(*) from public.reader_days d where d.user_id = v_uid),
    'streak', case when v_today is null then 0 else public.boks_reader_streak(v_uid, v_today) end,
    'since', (select min(d.day) from public.reader_days d where d.user_id = v_uid),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'letter', exists (select 1 from public.daily_letters l where l.recipient_user_id = v_uid and l.letter_date = d.day)
      ) order by d.day)
      from public.reader_days d where d.user_id = v_uid and d.day between v_first and v_last
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_days(date) from public, anon, authenticated;
grant execute on function public.get_my_days(date) to authenticated;
