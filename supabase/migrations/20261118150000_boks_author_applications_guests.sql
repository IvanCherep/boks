-- A guest can apply to become an author (`docs/author-applications.md`).
--
-- The page for authors at /author is open to everyone, and the application
-- no longer asks to sign in first: the team answers through the contact the
-- person leaves anyway. A guest's application has no account, so `user_id`
-- may be null; the device id (the same key the rest of the guest experience
-- uses) keeps one device from filling the list.

alter table public.author_applications alter column user_id drop not null;
alter table public.author_applications add column visitor_id text;
alter table public.author_applications add constraint author_applications_visitor
  check (visitor_id is null or char_length(visitor_id) <= 120);
create index author_applications_visitor_idx on public.author_applications (visitor_id, created_at desc)
  where visitor_id is not null;

drop function if exists public.submit_author_application(text, text, text, text, text, text);

-- One application. Three a day per account or per device is plenty for a
-- person; guests together get at most sixty an hour, so a script cannot
-- bury the real ones.
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

  if v_offer not in ('page', 'series', 'launch', 'unsure') then v_offer := 'unsure'; end if;
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
