-- The third offer on the page for authors: «Кабинет автора без продвижения»
-- (docs/author-applications.md). The offers now follow the author contract
-- (v7, 2026-11-22): «Совместный запуск» (free, `launch`), «Кабинет автора»
-- (`page`) and «Кабинет автора без продвижения» (`page_no_promotion`).
-- `series` stays for the applications that chose the old five-Series pack.

alter table public.author_applications drop constraint author_applications_offer;
alter table public.author_applications add constraint author_applications_offer
  check (offer in ('page', 'page_no_promotion', 'series', 'launch', 'unsure'));

create or replace function public.submit_author_application(
  p_offer text,
  p_name text,
  p_links text,
  p_audience text,
  p_contact text,
  p_message text,
  p_visitor_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_anonymous boolean := coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false);
  v_visitor text := left(nullif(btrim(coalesce(p_visitor_id, '')), ''), 120);
  v_offer text := lower(btrim(coalesce(p_offer, 'unsure')));
  v_name text := btrim(coalesce(p_name, ''));
  v_links text := btrim(coalesce(p_links, ''));
  v_audience text := nullif(btrim(coalesce(p_audience, '')), '');
  v_contact text := btrim(coalesce(p_contact, ''));
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_id bigint;
begin
  -- An anonymous session is a guest too: only a permanent account is kept.
  if v_is_anonymous then v_uid := null; end if;
  if v_uid is not null and exists (select 1 from public.user_profiles p where p.user_id = v_uid and p.banned_at is not null) then
    raise exception 'This boks account is suspended.' using errcode = '42501';
  end if;

  if v_offer not in ('page', 'page_no_promotion', 'series', 'launch', 'unsure') then v_offer := 'unsure'; end if;
  if char_length(v_name) < 1 then
    raise exception 'Write your name or pen name.' using errcode = '22023';
  end if;
  if char_length(v_links) < 3 then
    raise exception 'Add at least one link: where your readers are.' using errcode = '22023';
  end if;
  if char_length(v_contact) < 3 then
    raise exception 'Leave a way to reach you.' using errcode = '22023';
  end if;

  if v_uid is not null then
    if (select count(*) from public.author_applications a where a.user_id = v_uid and a.created_at > now() - interval '1 day') >= 3 then
      raise exception 'Three applications a day is the most. We will write to you.' using errcode = '54023';
    end if;
  else
    if v_visitor is not null and (select count(*) from public.author_applications a
        where a.visitor_id = v_visitor and a.created_at > now() - interval '1 day') >= 3 then
      raise exception 'Three applications a day is the most. We will write to you.' using errcode = '54023';
    end if;
    if (select count(*) from public.author_applications a
        where a.user_id is null and a.created_at > now() - interval '1 hour') >= 60 then
      raise exception 'Too many applications right now. Try again in an hour.' using errcode = '54023';
    end if;
  end if;

  insert into public.author_applications (user_id, visitor_id, offer, name, links, audience, contact, message)
  values (v_uid, v_visitor, v_offer, left(v_name, 120), left(v_links, 1500), left(v_audience, 120), left(v_contact, 200), left(v_message, 3000))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.submit_author_application(text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_author_application(text, text, text, text, text, text, text) to anon, authenticated;
