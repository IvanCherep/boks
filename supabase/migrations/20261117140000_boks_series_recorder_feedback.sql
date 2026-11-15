-- The Series recorder asks for a word on every step (`docs/series-recorder.md`),
-- and the page for authors without a cabinet asks for one too (`author_landing`):
-- a note says which step it came from, so the inbox can tell "the
-- teleprompter confused me" from "the pictures were wrong". Only the list of
-- surfaces changes; the function is otherwise the one of 20260921100000.

alter table public.boks_feedback drop constraint boks_feedback_surface;
alter table public.boks_feedback add constraint boks_feedback_surface
  check (surface in ('settings', 'after_3', 'after_10', 'after_30', 'other',
                     'series_text', 'series_record', 'series_pictures', 'series_build', 'author_landing'));

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

  if v_surface not in ('settings', 'after_3', 'after_10', 'after_30', 'series_text', 'series_record', 'series_pictures', 'series_build', 'author_landing') then
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

