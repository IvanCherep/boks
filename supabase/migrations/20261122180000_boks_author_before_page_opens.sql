-- An invited author works before their page opens to readers (owner, 2026-11-22).
--
-- `boks_publishes_directly` gave the author's tools (My page's «Новый бок»
-- with the voice, sending to the editors) only to the owner of a *published*
-- verified page. The team makes every author's page, so the author it invited
-- has already been chosen when they accept it; they should be able to write,
-- record and send before deciding to open the page, and a team test account
-- must be able to try the cabinet without appearing to readers at all.
--
-- Now any verified `author` page the person owns counts, whatever its state
-- for readers: `draft` (accepted, not opened), `published`, or `unpublished`
-- (closed again by its owner). A merged page does not. Nothing about what
-- readers see changes: a closed page stays closed, and the Series shelf still
-- shows only pages the team marked for it (`series_shelf`).
-- Same signature, so every caller keeps working.

create or replace function public.boks_publishes_directly(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and not exists (select 1 from public.user_profiles p where p.user_id = p_user_id and p.banned_at is not null)
    and exists (
      select 1 from public.author_spaces s
      where s.owner_user_id = p_user_id and s.kind = 'author'
        and s.status in ('draft', 'published', 'unpublished') and s.verified
    );
$$;
