-- Studies brought in line with the presentation of 28 October 2026.
--
-- б2 is a different study now: background music and the enjoyment of plain
-- reading. Everyone reads two comparable sets for five minutes each, one with
-- the quiet boks reading music and one in silence; the condition names the
-- first block's mode and set, and the second block gets the other of both, as
-- in a2. The primary outcome is «Насколько вам понравился сам процесс
-- чтения?», 1-7, after each block: the share answering 6 or 7, music minus
-- silence, paired, at least +10 pp.
--
-- The old b2 (Series as a way into an author) never ran: its switch was off
-- and its materials have a shape the new protocol cannot read, so both are
-- reset. Б1's change (one immersion question instead of two intensity
-- questions) is in the participant page only.

update public.boks_studies
set enabled = false, materials = '{}'::jsonb
where key = 'b2';

-- The conditions each study assigns. One list, read by enrolment and asserted
-- against `lib/boks/studies/protocol.ts` by the unit tests reading this file.
create or replace function public.boks_study_conditions(p_key text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_key
    when 'rg1' then array['series', 'text']
    when 'rg2' then array['feed_first', 'catalogue_first']
    when 'a1' then array['whole_first', 'fragment_first']
    when 'a2' then array['inline_a', 'inline_b', 'cards_a', 'cards_b']
    when 'a3' then array['profile']
    when 'b1' then array['yoked']
    when 'b2' then array['music_a', 'music_b', 'silence_a', 'silence_b']
    when 'b3' then array['rater']
    else array[]::text[]
  end;
$$;

revoke all on function public.boks_study_conditions(text) from public, anon, authenticated;
