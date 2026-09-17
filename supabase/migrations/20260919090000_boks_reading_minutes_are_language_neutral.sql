-- The fifteen-minute promise, in a catalogue with more than one language.
--
-- `minutes` was `ceil(words / 238)`, and the 20,000-character ceiling was
-- derived from it: 3,570 words at 5.7 characters each. Both numbers are
-- English. A Russian word is longer, so the same word count is more reading,
-- and the same ceiling is more than fifteen minutes.
--
-- The fix is not a per-language table of reading rates. Across alphabetic
-- languages, reading rate varies far less measured in characters per minute
-- than in words per minute - longer words are read proportionally faster in
-- word terms - so one character-paced constant serves every language better
-- than one word-paced constant serves any but English.
--
-- The constant comes from the catalogue rather than from a citation. Measured
-- over the 457 published English pieces: 5.44 characters per word on average,
-- so 238 words per minute is 1,295 characters per minute. That is the number
-- below, which means the English estimate is reproduced by construction.
--
-- What it does to the existing catalogue, measured before writing this: of 457
-- pieces, 398 keep exactly the same `minutes` and 59 move by one. Nothing
-- moves by more. So this is not a re-labelling of English literature; it is
-- the same answer for English, arrived at in a way that also answers Russian.
--
-- And it makes the edge check honest: 20,000 characters is now exactly 15
-- minutes in any language, where before it was 15 minutes in English and
-- nearly 17 in Russian.

create or replace function public.boks_reading_minutes(p_text text)
returns integer
language sql
immutable
as $$
  -- 1295 characters per minute: 238 words per minute at the 5.44 characters
  -- per word measured across the English catalogue. Characters rather than
  -- words because the catalogue is no longer in one language.
  select greatest(1, least(15, ceil(char_length(coalesce(p_text, '')) / 1295.0)::integer));
$$;

comment on function public.boks_reading_minutes(text) is
  'Reading time for a text, paced by characters so the estimate holds in every language. The authority for reels.minutes.';

-- The word-count overload stays, because four applied RPCs call it and
-- rewriting them from memory is how aggregates get corrupted. It is no longer
-- the authority for anything: every value it produces for an insert is
-- overwritten by the trigger below, and `boks_reading_shape` uses it only to
-- ask "is this short".
comment on function public.boks_reading_minutes(integer) is
  'A word-paced approximation, kept for boks_reading_shape and for RPC inserts the reels_word_count trigger overwrites. Not the authority for reels.minutes - boks_reading_minutes(text) is.';

grant execute on function public.boks_reading_minutes(text) to anon, authenticated;

-- The body below is the deployed one, with a single line changed: `minutes`
-- now comes from the text instead of from the word count. Retyping the rest
-- from memory would have dropped `reading_shape`, `line_break_count` and the
-- language derivation, and the schema checks caught exactly that on the first
-- attempt at this migration.
create or replace function public.boks_set_reel_word_count()
returns trigger
language plpgsql
as $$
begin
  new.word_count := public.boks_word_count(new.text);
  new.minutes := public.boks_reading_minutes(new.text);
  new.reading_shape := public.boks_reading_shape(new.text);
  new.line_break_count := length(coalesce(new.text, '')) - length(replace(coalesce(new.text, ''), E'\n', ''));
  -- An admin may correct a language; a rewrite of the text re-derives it.
  if new.language is null or (tg_op = 'UPDATE' and new.text is distinct from old.text) then
    new.language := public.boks_detect_language(new.text);
  end if;
  -- Handles are stored bare; the '@' belongs to the presentation.
  new.author_handle := nullif(ltrim(coalesce(new.author_handle, ''), '@'), '');
  return new;
end;
$$;

-- Bring the catalogue onto the new pacing. The 59 pieces that move do so by
-- one minute; `word_count` is untouched, because it was never wrong.
update public.reels
set minutes = public.boks_reading_minutes(text)
where minutes <> public.boks_reading_minutes(text);

comment on function public.boks_max_text_characters() is
  'The 15-minute promise as a character ceiling. 20000 characters is 15 minutes at 1295 characters per minute - see boks_reading_minutes(text) - which holds in every language rather than only in English.';
