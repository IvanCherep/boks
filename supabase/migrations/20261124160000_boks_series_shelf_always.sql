-- Every author page that opens goes onto the Series shelf (2026-11-24, the
-- team's decision): no switch to forget. The section takes its place after
-- the last author on the shelf (`seriesShelfOrder` in
-- `components/boks/series/series-catalogue.ts`: an author not listed there
-- follows the listed ones, in the order they published).
--
-- Pages already open keep what the team set for them; this is for every page
-- that opens from now on, and for new pages.

alter table public.author_spaces alter column series_shelf set default true;

create or replace function public.boks_shelf_on_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'author' and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    new.series_shelf := true;
  end if;
  return new;
end;
$$;
revoke all on function public.boks_shelf_on_publish() from public, anon, authenticated;

drop trigger if exists author_spaces_shelf_on_publish on public.author_spaces;
create trigger author_spaces_shelf_on_publish
  before insert or update of status on public.author_spaces
  for each row execute function public.boks_shelf_on_publish();
