-- Keep only the editions in force: offer 2026-11-24.2, processing 2026-11-24.2,
-- distribution 2026-11-24. The earlier rows (offer 2026-11-23 and 2026-11-24,
-- processing 2026-11-23 and 2026-11-24, distribution 2026-11-23) were accepted
-- by no one: no author_agreements row existed when the owner asked to remove
-- them (2026-11-24). Editions are frozen otherwise; like 20261123170000 this is
-- a deliberate exception, and it refuses to run if any contract names one of them.
do $$
begin
  if exists (
    select 1 from public.author_agreements
    where offer_version in ('2026-11-23', '2026-11-24')
       or processing_version in ('2026-11-23', '2026-11-24')
       or distribution_version = '2026-11-23'
  ) then
    raise exception 'an author accepted an edition this migration would remove';
  end if;
end $$;

alter table public.boks_legal_documents disable trigger boks_legal_documents_frozen;
delete from public.boks_legal_documents
where (kind = 'author_offer' and version in ('2026-11-23', '2026-11-24'))
   or (kind = 'author_pd_processing' and version in ('2026-11-23', '2026-11-24'))
   or (kind = 'author_pd_distribution' and version = '2026-11-23');
alter table public.boks_legal_documents enable trigger boks_legal_documents_frozen;
