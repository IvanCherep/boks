-- No bok reaches the editors without its author's voice (owner, 2026-11-22).
--
-- Since 20261122120000 the My page composer sends a piece to the editors only
-- with a current reading (`save_my_bok`, `p_cover_by_team`, which also marks
-- `cover_requested`). The older way in, «Мои тексты» → «Написать текст» /
-- «Загрузить файлы» (`submit_bok_for_review`), still put a text into review
-- with no voice: an account without its own author page (an admin trying the
-- cabinet, or anyone the team has not invited) took it. Every author today is
-- one the team invited, so that way is closed.
--
-- Rather than redefine `submit_bok_for_review`, a trigger on `reels` refuses a
-- move into `pending_review` unless it is the voiced way (`cover_requested`),
-- or the caller is Studio, or there is no caller at all (the service role:
-- imports and server jobs). Edits of a piece already in review are untouched.

create or replace function public.reels_review_needs_voice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.status <> 'pending_review' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'pending_review' then
    return new;
  end if;
  if coalesce(new.cover_requested, false) then
    return new;
  end if;
  if v_uid is null or public.is_boks_admin(v_uid) then
    return new;
  end if;
  raise exception 'A bok goes to the editors with the author''s voice, from My page. Publishing is open to authors the editors invited.'
    using errcode = '42501';
end;
$$;

revoke all on function public.reels_review_needs_voice() from public, anon, authenticated;

drop trigger if exists reels_review_needs_voice on public.reels;
create trigger reels_review_needs_voice
  before insert or update of status on public.reels
  for each row execute function public.reels_review_needs_voice();
