-- Clearing the demo catalogue, once real literature is ready to replace it.
--
-- The boks on the platform until now came from migrations - eight hand-written
-- demo pieces and an expanded set built to calibrate the divergence gate. They
-- are marked `is_seed`. Real content arrives through the author form or the
-- catalogue import, and neither sets that flag.
--
-- Why an RPC and not a `delete from public.reels` in this migration:
--
--   A migration runs on every database, including a developer's local one and
--   the throwaway container `verify:schema` builds. Deleting the seed rows
--   there would empty the catalogue every local reset, and the divergence
--   calibration set exists precisely so that gate has something to measure.
--   Production wants the demo gone; local wants it. So it is an operation an
--   admin performs, not a change to the schema.
--
-- The flag is also the safety: this can only ever remove seeded rows. An
-- author's published work has `is_seed = false` and is unreachable from here,
-- however the confirmation is typed.

create or replace function public.delete_seed_boks(p_confirm text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seeds integer;
  v_authored integer;
  v_deleted integer := 0;
begin
  if not public.is_boks_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;

  select count(*) into v_seeds from public.reels where is_seed;
  select count(*) into v_authored from public.reels where not is_seed;

  -- Called without the phrase, this only reports. Removing a boks cascades to
  -- its views, likes, comments and recommendation events, so the count is
  -- worth reading before the deletion, not after.
  if p_confirm is null or p_confirm <> 'delete the demo catalogue' then
    return jsonb_build_object(
      'seeds', v_seeds,
      'authored', v_authored,
      'deleted', 0,
      'note', 'Nothing deleted. Repeat with p_confirm = ''delete the demo catalogue''.'
    );
  end if;

  delete from public.reels where is_seed;
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'seeds', v_seeds,
    'authored', v_authored,
    'deleted', v_deleted
  );
end;
$$;

revoke all on function public.delete_seed_boks(text) from public, anon, authenticated;
grant execute on function public.delete_seed_boks(text) to authenticated;
