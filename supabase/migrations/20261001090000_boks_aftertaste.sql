-- Aftertaste: what a reader says a boks left them with.
--
-- One more event type rather than a table of its own. The signal is "this
-- reader, this boks, these words", which is exactly the shape of a
-- recommendation event, and a separate table would need its own policies, its
-- own grants and its own place in every rollup that already reads this one.
--
-- The words themselves live in `metadata.tags`, because they are a vocabulary
-- that will change - four today, probably six once we have watched people use
-- them - and a vocabulary that changes does not belong in a column.
--
-- Nothing reads this yet. It is recorded now so that when the recommender is
-- ready there is a month of it to read rather than a month to wait.

alter table public.recommendation_events
  drop constraint if exists recommendation_events_event_type_check;

alter table public.recommendation_events
  add constraint recommendation_events_event_type_check
  check (event_type in (
    'impression', 'start', 'complete', 'like', 'share', 'skip',
    'comment', 'publish', 'preference', 'heartbeat', 'aftertaste'
  ));

-- Reading "what did this boks leave people with" means finding the aftertaste
-- rows for one reel, which is a different question from the ones the existing
-- (session, reel, type) index answers.
create index if not exists recommendation_events_aftertaste_idx
  on public.recommendation_events (reel_id, created_at desc)
  where event_type = 'aftertaste';
