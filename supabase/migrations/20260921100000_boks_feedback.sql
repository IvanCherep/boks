-- Somewhere for a reader to say what they think.
--
-- The product opens to its first real readers this week, and the one thing it
-- cannot get from the event stream is the sentence a reader would have said
-- out loud. So: a text box, reachable from Settings at any time and offered
-- after the third, tenth and thirtieth bok actually read, and an inbox for it
-- in the admin console.
--
-- **A guest can write.** That is the point of the feature: the readers most
-- likely to be lost are the ones who have not signed up, and asking them to
-- register first is asking them to leave. So `submit_boks_feedback` is granted
-- to `anon` as well as `authenticated`, and `user_id` is nullable. What is
-- stored instead is the device's visitor id, which groups one person's notes
-- without identifying them.
--
-- Nothing else can read the table: no row-level policy grants a select, and
-- the only reader is `get_boks_feedback`, which checks `is_boks_admin()`. A
-- reader's complaint about another reader, or about the founder, must not be
-- visible to anyone but an admin.

create table if not exists public.boks_feedback (
  id bigint generated always as identity primary key,
  -- Null for a reader with no session at all; an anonymous session has a real
  -- uid, and that is worth keeping - it is how a guest's note can later be
  -- tied to the account they created.
  user_id uuid references auth.users(id) on delete set null,
  visitor_id text,
  /** The @handle at the time of writing, so a later rename does not rewrite history. */
  handle text,
  is_anonymous boolean not null default true,
  message text not null,
  /** Where the box was opened: Settings, or which milestone offered it. */
  surface text not null default 'settings',
  /** Boks actually read on this device when they wrote, for reading the note in context. */
  boks_read integer,
  created_at timestamptz not null default now(),
  constraint boks_feedback_message_length
    check (char_length(btrim(message)) between 2 and 4000),
  constraint boks_feedback_surface
    check (surface in ('settings', 'after_3', 'after_10', 'after_30', 'other'))
);

comment on table public.boks_feedback is
  'What readers write in the feedback box. Insert-only through submit_boks_feedback (guests included); readable only by an admin through get_boks_feedback.';

create index if not exists boks_feedback_created_at_idx
  on public.boks_feedback (created_at desc);

alter table public.boks_feedback enable row level security;

-- No policies at all: the table is reached only through the two functions
-- below, which decide who may write and who may read.
revoke all on table public.boks_feedback from anon, authenticated;


create or replace function public.submit_boks_feedback(
  p_message text,
  p_surface text default 'settings',
  p_boks_read integer default null,
  p_visitor_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true);
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_surface text := lower(btrim(coalesce(p_surface, 'settings')));
  v_visitor text := left(nullif(btrim(coalesce(p_visitor_id, '')), ''), 120);
  v_handle text;
  v_recent integer;
  v_id bigint;
begin
  if v_message is null or char_length(v_message) < 2 then
    raise exception 'Write a line or two first.' using errcode = '22023';
  end if;

  -- Longer than this is not feedback any more, and the column refuses it
  -- anyway; cutting is friendlier than an error on a long, sincere note.
  v_message := left(v_message, 4000);

  if v_surface not in ('settings', 'after_3', 'after_10', 'after_30') then
    v_surface := 'other';
  end if;

  if v_uid is not null and public.is_boks_user_blocked(v_uid) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  -- One person cannot fill the inbox. Keyed on the account when there is one
  -- and on the device otherwise, which is the same key the rest of the guest
  -- experience uses.
  select count(*)
  into v_recent
  from public.boks_feedback f
  where f.created_at > now() - interval '1 hour'
    and (
      (v_uid is not null and f.user_id = v_uid)
      or (v_uid is null and v_visitor is not null and f.visitor_id = v_visitor)
    );

  if v_recent >= 5 then
    raise exception 'That is five notes in an hour - thank you, genuinely. Send more a little later.'
      using errcode = '54023';
  end if;

  if v_uid is not null then
    select p.handle into v_handle from public.user_profiles p where p.user_id = v_uid;
  end if;

  insert into public.boks_feedback (user_id, visitor_id, handle, is_anonymous, message, surface, boks_read)
  values (
    v_uid,
    v_visitor,
    v_handle,
    coalesce(v_is_anonymous, v_uid is null),
    v_message,
    v_surface,
    greatest(0, coalesce(p_boks_read, 0))
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

comment on function public.submit_boks_feedback(text, text, integer, text) is
  'Stores one note from a reader. Open to guests on purpose: the readers most worth hearing from are the ones who have not signed up.';

revoke all on function public.submit_boks_feedback(text, text, integer, text) from public;
grant execute on function public.submit_boks_feedback(text, text, integer, text) to anon, authenticated;


create or replace function public.get_boks_feedback(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'total', (select count(*) from public.boks_feedback),
    'newToday', (
      select count(*) from public.boks_feedback where created_at > now() - interval '24 hours'
    ),
    'bySurface', coalesce((
      select jsonb_object_agg(surface, n)
      from (select surface, count(*) as n from public.boks_feedback group by surface) s
    ), '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'message', f.message,
        'surface', f.surface,
        'boksRead', coalesce(f.boks_read, 0),
        'handle', f.handle,
        'isAnonymous', f.is_anonymous,
        'userId', coalesce(f.user_id::text, ''),
        'visitorId', coalesce(f.visitor_id, ''),
        'createdAt', f.created_at
      ) order by f.created_at desc)
      from (
        select * from public.boks_feedback order by created_at desc limit v_limit offset v_offset
      ) f
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.get_boks_feedback(integer, integer) is
  'The feedback inbox for the admin console. Admin-only: a note may be about another reader, or about whoever runs this.';

revoke all on function public.get_boks_feedback(integer, integer) from public, anon, authenticated;
grant execute on function public.get_boks_feedback(integer, integer) to authenticated;
