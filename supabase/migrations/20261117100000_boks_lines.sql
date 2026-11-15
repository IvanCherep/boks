-- Lines (2026-11-17): the line of the day, a line sent by link, a saved line.
--
-- A reader selects words of a published bok - a passage - and does one of
-- three things with it (always signed with their @handle):
--
-- 1. Shares it with the world (`share_line` -> `shared_lines`). Each account
--    opens one letter per calendar day of its own time zone
--    (`open_daily_letter` -> `daily_letters`); the account + date key fixes it,
--    on every device. A letter carries a line someone else shared before the
--    reader's day began (shared today, received from tomorrow) within the
--    week, or an editorial line signed as such when nothing is left for that
--    account. The hand-out, under one lock per date so simultaneous openings
--    cannot all take the same line: never your own line; a line you received
--    in the last 60 days only if nothing else is left; lines nobody received
--    today first; then senders with fewer letters today; then the
--    least-delivered line; random among equals.
-- 2. Sends it to one person (`create_line_link` -> `line_links`): a link
--    `/b/<bok>?line=<code>` that opens as a letter from the sender
--    (`get_line_link`, open to anyone holding it). Never joins the letters.
-- 3. Keeps it (`save_line` -> `saved_lines`), private to the reader.
--
-- Only words of the bok itself, at most 280 characters, are accepted
-- (`boks_checked_passage`). A passage's words are shown only while its bok is
-- published; an erased bok leaves no copy of its words in anyone's letters.
-- Every table is reached only through these functions (ADR 0011).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The form two passages are compared in: lower case, ё as е, every run of
-- white space one space, no white space at the ends. A selection across
-- stanzas arrives with newlines where the stored text may have others, and
-- the reader shows no-break and narrow spaces (imported texts are full of
-- them) as plain ones, which a selection then copies.
create or replace function public.boks_passage_key(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(lower(btrim(regexp_replace(
    translate(coalesce(p_text, ''), U&'\00A0\202F\2007\2009\200A', '     '),
    '\s+', ' ', 'g'))), 'ё', 'е');
$$;
revoke all on function public.boks_passage_key(text) from public, anon, authenticated;

-- A permanent, not suspended account, or an exception a reader can read.
create or replace function public.boks_require_reader_account()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
begin
  if v_uid is null or v_is_anonymous then
    raise exception 'A permanent user account is required.' using errcode = '42501';
  end if;
  if exists (select 1 from public.user_profiles p where p.user_id = v_uid and p.banned_at is not null) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function public.boks_require_reader_account() from public, anon, authenticated;

-- A passage as stored, after the one check every action makes: words of this
-- published bok, 2 to 280 characters. `p_saving` only picks the message.
create or replace function public.boks_checked_passage(p_bok_id uuid, p_passage text, p_saving boolean default false, out passage text, out passage_key text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_text text;
begin
  passage := btrim(coalesce(p_passage, ''));
  passage_key := public.boks_passage_key(passage);
  if char_length(passage) < 2 or char_length(passage) > 280 then
    raise exception 'Choose a line of at most 280 characters.' using errcode = '22023';
  end if;
  select b.text into v_text from public.reels b where b.id = p_bok_id and b.status = 'published';
  if v_text is null then
    raise exception 'This bok is no longer available.' using errcode = 'P0002';
  end if;
  if position(passage_key in public.boks_passage_key(v_text)) = 0 then
    if p_saving then
      raise exception 'Only words from the bok itself can be saved.' using errcode = '22023';
    end if;
    raise exception 'Only words from the bok itself can be sent.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.boks_checked_passage(uuid, text, boolean) from public, anon, authenticated;

-- The account's day. A valid zone from the device is remembered for the
-- account; an invalid or missing one falls back to the remembered zone, then
-- Moscow. A remembered zone changes at most once a day and never on a day
-- whose letter is already open, so moving the clock cannot open tomorrow's
-- letter early or a second letter today (a traveller's day follows the next
-- morning).
create table public.reader_time_zones (
  user_id uuid primary key references auth.users(id) on delete cascade,
  time_zone text not null,
  updated_at timestamptz not null default now()
);
alter table public.reader_time_zones enable row level security;
revoke all on public.reader_time_zones from public, anon, authenticated;

create or replace function public.boks_reader_today(p_user_id uuid, p_time_zone text, out day date, out time_zone text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_zone text := nullif(btrim(coalesce(p_time_zone, '')), '');
  v_saved public.reader_time_zones;
begin
  select * into v_saved from public.reader_time_zones z where z.user_id = p_user_id;
  if v_zone is not null and v_zone is distinct from v_saved.time_zone
    and (v_saved.user_id is null or (
      v_saved.updated_at < now() - interval '1 day'
      and not exists (
        select 1 from public.daily_letters l
        where l.recipient_user_id = p_user_id and l.letter_date = (now() at time zone v_saved.time_zone)::date
      )
    ))
    -- Checked only when it changes: the catalogue of zones is not free to scan.
    and char_length(v_zone) <= 64 and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_zone)
  then
    insert into public.reader_time_zones (user_id, time_zone) values (p_user_id, v_zone)
    on conflict (user_id) do update set time_zone = excluded.time_zone, updated_at = now();
  else
    v_zone := v_saved.time_zone;
  end if;
  time_zone := coalesce(v_zone, 'Europe/Moscow');
  day := (now() at time zone time_zone)::date;
end;
$$;
revoke all on function public.boks_reader_today(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.shared_lines (
  id uuid primary key default gen_random_uuid(),
  -- The sender's lines leave with their account.
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  bok_id uuid not null references public.reels(id) on delete cascade,
  passage text not null,
  passage_key text not null,
  created_at timestamptz not null default now(),
  constraint shared_lines_length check (char_length(passage) between 2 and 280),
  constraint shared_lines_once unique (sender_user_id, bok_id, passage_key)
);
create index shared_lines_recent_idx on public.shared_lines (created_at desc);
create index shared_lines_bok_idx on public.shared_lines (bok_id);

-- One letter per account and day, fixed once opened. The words are copied:
-- a sender who deletes their account takes their lines, not the letters
-- already opened (those are then signed "a boks reader").
create table public.daily_letters (
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  letter_date date not null,
  source text not null,
  shared_line_id uuid references public.shared_lines(id) on delete set null,
  sender_user_id uuid references auth.users(id) on delete set null,
  bok_id uuid references public.reels(id) on delete set null,
  passage text not null,
  passage_key text not null,
  opened_at timestamptz not null default now(),
  primary key (recipient_user_id, letter_date),
  constraint daily_letters_source check (source in ('reader', 'editorial')),
  constraint daily_letters_editorial_unsigned check (source = 'reader' or (sender_user_id is null and shared_line_id is null))
);
create index daily_letters_date_line_idx on public.daily_letters (letter_date, shared_line_id);
create index daily_letters_date_sender_idx on public.daily_letters (letter_date, sender_user_id);
create index daily_letters_bok_idx on public.daily_letters (bok_id);
create index daily_letters_sender_idx on public.daily_letters (sender_user_id);
create index daily_letters_line_idx on public.daily_letters (shared_line_id);

create table public.line_links (
  code text primary key,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  bok_id uuid not null references public.reels(id) on delete cascade,
  passage text not null,
  passage_key text not null,
  created_at timestamptz not null default now(),
  constraint line_links_code_shape check (code ~ '^[0-9a-f]{16}$'),
  constraint line_links_length check (char_length(passage) between 2 and 280),
  constraint line_links_once unique (sender_user_id, bok_id, passage_key)
);
create index line_links_bok_idx on public.line_links (bok_id);

create table public.saved_lines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bok_id uuid not null references public.reels(id) on delete cascade,
  passage text not null,
  passage_key text not null,
  created_at timestamptz not null default now(),
  constraint saved_lines_length check (char_length(passage) between 2 and 280),
  constraint saved_lines_once unique (user_id, bok_id, passage_key)
);
create index saved_lines_user_idx on public.saved_lines (user_id, created_at desc);
create index saved_lines_bok_idx on public.saved_lines (bok_id);

alter table public.shared_lines enable row level security;
alter table public.daily_letters enable row level security;
alter table public.line_links enable row level security;
alter table public.saved_lines enable row level security;
revoke all on public.shared_lines, public.daily_letters, public.line_links, public.saved_lines from public, anon, authenticated;

-- An erased bok leaves no copy of its words in anyone's letters; the letter
-- stays in the history, marked unavailable.
create or replace function public.boks_forget_letter_words()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.daily_letters set passage = '', passage_key = '' where bok_id = old.id;
  return old;
end;
$$;
revoke all on function public.boks_forget_letter_words() from public, anon, authenticated;
create trigger reels_forget_letter_words before delete on public.reels
  for each row execute function public.boks_forget_letter_words();

-- ---------------------------------------------------------------------------
-- How a letter reads
-- ---------------------------------------------------------------------------

-- The words only while their bok is published; the sender's handle while
-- their account stands. Editorial letters carry no handle.
create or replace function public.boks_letter_json(
  p_date date, p_opened_at timestamptz, p_source text, p_sender uuid, p_bok_id uuid, p_passage text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'date', p_date,
    'openedAt', p_opened_at,
    'source', p_source,
    'senderHandle', case when p_source = 'reader' then (
      select s.handle from public.user_profiles s where s.user_id = p_sender and s.banned_at is null
    ) end,
    'available', b.id is not null,
    'passage', case when b.id is not null then p_passage end,
    'bokId', b.id::text,
    'title', b.title,
    'authorName', b.author_name
  )
  from (select 1) one
  left join public.reels b on b.id = p_bok_id and b.status = 'published';
$$;
revoke all on function public.boks_letter_json(date, timestamptz, text, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.boks_daily_letter_json(p_letter public.daily_letters)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.boks_letter_json(p_letter.letter_date, p_letter.opened_at, p_letter.source, p_letter.sender_user_id, p_letter.bok_id, p_letter.passage);
$$;
revoke all on function public.boks_daily_letter_json(public.daily_letters) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. The line of the day
-- ---------------------------------------------------------------------------

create or replace function public.share_line(p_bok_id uuid, p_passage text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_line record;
  v_id uuid;
begin
  select * into v_line from public.boks_checked_passage(p_bok_id, p_passage);
  select l.id into v_id from public.shared_lines l
  where l.sender_user_id = v_uid and l.bok_id = p_bok_id and l.passage_key = v_line.passage_key;
  if v_id is not null then
    return jsonb_build_object('id', v_id::text, 'created', false);
  end if;
  -- Not a quota: a ceiling against a script filling the pool.
  if (select count(*) from public.shared_lines l where l.sender_user_id = v_uid and l.created_at > now() - interval '1 day') >= 100 then
    raise exception 'That is a lot of lines for one day. Send more tomorrow.' using errcode = '54000';
  end if;
  insert into public.shared_lines (sender_user_id, bok_id, passage, passage_key)
  values (v_uid, p_bok_id, v_line.passage, v_line.passage_key)
  on conflict (sender_user_id, bok_id, passage_key) do nothing
  returning id into v_id;
  return jsonb_build_object('id', coalesce(v_id, (
    select l.id from public.shared_lines l where l.sender_user_id = v_uid and l.bok_id = p_bok_id and l.passage_key = v_line.passage_key
  ))::text, 'created', v_id is not null);
end;
$$;
revoke all on function public.share_line(uuid, text) from public, anon, authenticated;
grant execute on function public.share_line(uuid, text) to authenticated;

-- Without a reader's line: one line of a short published catalogue poem (or
-- the first sentence of a short story), the same for everyone that day,
-- avoiding what this account received recently.
create or replace function public.boks_editorial_line(p_user_id uuid, p_date date, p_languages text[], out bok_id uuid, out passage text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_lines text[];
  v_line text;
begin
  for v_row in
    select b.id, b.text, b.title
    from public.reels b
    left join public.user_profiles a on a.user_id = b.author_user_id
    where b.status = 'published'
      and b.reading_shape in ('verse', 'short_prose')
      and (b.author_user_id is null or a.is_publisher)
      and b.author_name is not null
      and (p_languages is null or b.language = any (p_languages))
    order by
      b.reading_shape <> 'verse',
      exists (
        select 1 from public.daily_letters l
        where l.recipient_user_id = p_user_id and l.bok_id = b.id and l.letter_date > p_date - 60
      ),
      md5(b.id::text || p_date::text)
    limit 20
  loop
    v_lines := array(
      select btrim(x) from unnest(regexp_split_to_array(v_row.text, '\n')) x
      where btrim(x) <> '' and btrim(x) ~ '[[:alpha:]]'
    );
    -- A text that opens with its own title: the reader does not show it as a line.
    if coalesce(array_length(v_lines, 1), 0) > 0 and public.boks_passage_key(v_lines[1]) = public.boks_passage_key(v_row.title) then
      v_lines := v_lines[2:];
    end if;
    if coalesce(array_length(v_lines, 1), 0) = 0 then continue; end if;
    v_line := v_lines[1];
    -- Prose: its first sentence.
    if char_length(v_line) > 160 then
      v_line := coalesce(substring(v_line from '^(.{20,200}?[.!?…])(\s|$)'), '');
    end if;
    -- A very short first line reads as a fragment; take the next one with it.
    if char_length(v_line) between 1 and 23 and array_length(v_lines, 1) > 1 then
      v_line := v_line || E'\n' || v_lines[2];
    end if;
    if char_length(v_line) between 2 and 280 then
      bok_id := v_row.id;
      passage := v_line;
      return;
    end if;
  end loop;
end;
$$;
revoke all on function public.boks_editorial_line(uuid, date, text[]) from public, anon, authenticated;

-- Today's letter: the one already opened, or a new one chosen now. Null only
-- with an empty catalogue.
create or replace function public.open_daily_letter(p_time_zone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_today record;
  v_day_start timestamptz;
  v_letter public.daily_letters;
  v_pick record;
  v_editorial record;
  -- The reader's own languages, as the feed honours them; none chosen is every language.
  v_languages text[] := (select nullif(p.reading_languages, '{}') from public.user_profiles p where p.user_id = v_uid);
begin
  select * into v_today from public.boks_reader_today(v_uid, p_time_zone);
  v_day_start := v_today.day::timestamp at time zone v_today.time_zone;

  select * into v_letter from public.daily_letters l where l.recipient_user_id = v_uid and l.letter_date = v_today.day;
  if v_letter.recipient_user_id is not null then
    return public.boks_daily_letter_json(v_letter);
  end if;

  -- One chooser per date at a time: the counts below must include the letter
  -- a parallel opening is about to take.
  perform pg_advisory_xact_lock(hashtextextended('boks-daily-letter:' || v_today.day::text, 0));
  select * into v_letter from public.daily_letters l where l.recipient_user_id = v_uid and l.letter_date = v_today.day;
  if v_letter.recipient_user_id is not null then
    return public.boks_daily_letter_json(v_letter);
  end if;

  select c.* into v_pick
  from (
    select
      l.id, l.sender_user_id, l.bok_id, l.passage, l.passage_key,
      exists (
        select 1 from public.daily_letters r
        where r.recipient_user_id = v_uid and r.bok_id = l.bok_id and r.passage_key = l.passage_key
          and r.letter_date > v_today.day - 60
      ) as repeat_for_me,
      (select count(*) from public.daily_letters t where t.letter_date = v_today.day and t.shared_line_id = l.id) as given_today,
      (select count(*) from public.daily_letters t where t.letter_date = v_today.day and t.sender_user_id = l.sender_user_id) as sender_today
    from public.shared_lines l
    join public.reels b on b.id = l.bok_id and b.status = 'published' and (v_languages is null or b.language = any (v_languages))
    join public.user_profiles s on s.user_id = l.sender_user_id and s.banned_at is null
    where l.sender_user_id <> v_uid
      and l.created_at < v_day_start
      and l.created_at > v_day_start - interval '7 days'
  ) c
  order by c.repeat_for_me, c.given_today, c.sender_today, random()
  limit 1;

  if v_pick.id is not null then
    insert into public.daily_letters (recipient_user_id, letter_date, source, shared_line_id, sender_user_id, bok_id, passage, passage_key)
    values (v_uid, v_today.day, 'reader', v_pick.id, v_pick.sender_user_id, v_pick.bok_id, v_pick.passage, v_pick.passage_key);
  else
    select * into v_editorial from public.boks_editorial_line(v_uid, v_today.day, v_languages);
    if v_editorial.bok_id is null and v_languages is not null then
      -- No short catalogue text in the reader's languages: any, rather than no letter.
      select * into v_editorial from public.boks_editorial_line(v_uid, v_today.day, null);
    end if;
    if v_editorial.bok_id is null then
      return null;
    end if;
    insert into public.daily_letters (recipient_user_id, letter_date, source, bok_id, passage, passage_key)
    values (v_uid, v_today.day, 'editorial', v_editorial.bok_id, v_editorial.passage, public.boks_passage_key(v_editorial.passage));
  end if;

  select * into v_letter from public.daily_letters l where l.recipient_user_id = v_uid and l.letter_date = v_today.day;
  return public.boks_daily_letter_json(v_letter);
end;
$$;
revoke all on function public.open_daily_letter(text) from public, anon, authenticated;
grant execute on function public.open_daily_letter(text) to authenticated;

-- Letters this account has opened, newest first, a page at a time.
create or replace function public.get_my_daily_letters(p_before date default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
begin
  return coalesce((
    select jsonb_agg(public.boks_daily_letter_json(l) order by l.letter_date desc)
    from (
      select * from public.daily_letters l
      where l.recipient_user_id = v_uid and (p_before is null or l.letter_date < p_before)
      order by l.letter_date desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) l
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_my_daily_letters(date, integer) from public, anon, authenticated;
grant execute on function public.get_my_daily_letters(date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A line sent by link
-- ---------------------------------------------------------------------------

-- The same line from the same reader keeps its one link.
create or replace function public.create_line_link(p_bok_id uuid, p_passage text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_line record;
  v_code text;
begin
  select * into v_line from public.boks_checked_passage(p_bok_id, p_passage);
  select l.code into v_code from public.line_links l
  where l.sender_user_id = v_uid and l.bok_id = p_bok_id and l.passage_key = v_line.passage_key;
  if v_code is not null then
    return jsonb_build_object('code', v_code, 'created', false);
  end if;
  if (select count(*) from public.line_links l where l.sender_user_id = v_uid and l.created_at > now() - interval '1 day') >= 100 then
    raise exception 'That is a lot of lines for one day. Send more tomorrow.' using errcode = '54000';
  end if;
  v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  insert into public.line_links (code, sender_user_id, bok_id, passage, passage_key)
  values (v_code, v_uid, p_bok_id, v_line.passage, v_line.passage_key);
  return jsonb_build_object('code', v_code, 'created', true);
end;
$$;
revoke all on function public.create_line_link(uuid, text) from public, anon, authenticated;
grant execute on function public.create_line_link(uuid, text) to authenticated;

-- A line link as its recipient sees it: a letter from the sender.
create or replace function public.get_line_link(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.boks_letter_json(l.created_at::date, l.created_at, 'reader', l.sender_user_id, l.bok_id, l.passage)
    || jsonb_build_object('code', l.code)
  from public.line_links l
  where p_code ~ '^[0-9a-f]{16}$' and l.code = p_code;
$$;
revoke all on function public.get_line_link(text) from public, anon, authenticated;
grant execute on function public.get_line_link(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A saved line
-- ---------------------------------------------------------------------------

create or replace function public.save_line(p_bok_id uuid, p_passage text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
  v_line record;
  v_id uuid;
begin
  select * into v_line from public.boks_checked_passage(p_bok_id, p_passage, true);
  select s.id into v_id from public.saved_lines s
  where s.user_id = v_uid and s.bok_id = p_bok_id and s.passage_key = v_line.passage_key;
  if v_id is not null then
    return jsonb_build_object('id', v_id::text, 'created', false);
  end if;
  if (select count(*) from public.saved_lines s where s.user_id = v_uid) >= 2000 then
    raise exception 'Your saved lines are full. Remove a few first.' using errcode = '54000';
  end if;
  insert into public.saved_lines (user_id, bok_id, passage, passage_key)
  values (v_uid, p_bok_id, v_line.passage, v_line.passage_key)
  returning id into v_id;
  return jsonb_build_object('id', v_id::text, 'created', true);
end;
$$;
revoke all on function public.save_line(uuid, text) from public, anon, authenticated;
grant execute on function public.save_line(uuid, text) to authenticated;

create or replace function public.delete_saved_line(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
begin
  delete from public.saved_lines s where s.id = p_id and s.user_id = v_uid;
end;
$$;
revoke all on function public.delete_saved_line(uuid) from public, anon, authenticated;
grant execute on function public.delete_saved_line(uuid) to authenticated;

create or replace function public.get_saved_lines(p_before timestamptz default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.boks_require_reader_account();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id::text,
      'savedAt', s.created_at,
      'available', b.id is not null,
      'passage', case when b.id is not null then s.passage end,
      'bokId', b.id::text,
      'title', b.title,
      'authorName', b.author_name
    ) order by s.created_at desc)
    from (
      select * from public.saved_lines s
      where s.user_id = v_uid and (p_before is null or s.created_at < p_before)
      order by s.created_at desc
      limit least(greatest(coalesce(p_limit, 30), 1), 100)
    ) s
    left join public.reels b on b.id = s.bok_id and b.status = 'published'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_saved_lines(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_saved_lines(timestamptz, integer) to authenticated;
