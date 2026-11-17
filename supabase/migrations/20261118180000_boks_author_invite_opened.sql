-- The team hears when an invited author first opens their invitation
-- (`deploy/ops/inbox.py`, feed `authors`, with acceptance, messages, requests
-- for changes, publication and hiding).
--
-- Opening is the one step the database did not see: peeking at an invitation
-- reads only. The cabinet now marks it once, when the signed-in invited
-- address sees the invitation it may accept.

alter table public.author_space_invites
  add column if not exists opened_at timestamptz;

create or replace function public.note_author_invite_opened(p_token text default null, p_invite_id uuid default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.author_space_invites i
     set opened_at = now()
   where i.opened_at is null
     and public.boks_invite_state(i) = 'pending'
     and i.email = (select lower(u.email) from auth.users u where u.id = auth.uid())
     and (
       (p_token is not null and i.token_hash = sha256(convert_to(btrim(p_token), 'UTF8')))
       or (p_invite_id is not null and i.id = p_invite_id)
     );
$$;

revoke all on function public.note_author_invite_opened(text, uuid) from public, anon;
grant execute on function public.note_author_invite_opened(text, uuid) to authenticated;
