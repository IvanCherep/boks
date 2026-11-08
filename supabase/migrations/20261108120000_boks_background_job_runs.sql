-- A log of the server's background jobs, read in the admin console.
--
-- The first job is the embedder (`deploy/embedder`): every 15 minutes it gives
-- each newly published bok its `multilingual-e5-small` vector. A job that runs
-- out of sight is only trustworthy if someone can see that it ran, what it did
-- and why it failed, so every run writes one row here - including the runs
-- that found nothing to do, which are the proof the schedule is alive.
--
-- Written only by the job itself, as the database owner over the private
-- network. Read only through `get_background_job_runs`, admins only: the table
-- has row security and no policy, so the Data API reaches nothing directly.

create table if not exists public.background_job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  -- What the run did, and what it left for the next one.
  processed integer not null default 0,
  remaining integer,
  duration_ms integer,
  -- Job-specific detail: the model, the titles it handled.
  details jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists background_job_runs_job_started
  on public.background_job_runs (job, started_at desc);

alter table public.background_job_runs enable row level security;
revoke all on table public.background_job_runs from public, anon, authenticated;
revoke all on sequence public.background_job_runs_id_seq from public, anon, authenticated;

comment on table public.background_job_runs is
  'One row per run of a server background job (deploy/embedder). Admin console reads it through get_background_job_runs.';

create or replace function public.get_background_job_runs(p_job text default 'embedder', p_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null or not public.is_boks_admin(v_caller) then
    raise exception 'Only an admin can read background jobs.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) - 'job' order by r.started_at desc)
      from (
        select *
        from public.background_job_runs
        where job = p_job
        order by started_at desc
        limit least(greatest(coalesce(p_limit, 20), 1), 100)
      ) r
    ), '[]'::jsonb),
    'lastOk', (
      select max(started_at) from public.background_job_runs where job = p_job and status = 'ok'
    ),
    'failedLastDay', (
      select count(*) from public.background_job_runs
      where job = p_job and status = 'failed' and started_at > now() - interval '1 day'
    ),
    'processedLastWeek', (
      select coalesce(sum(processed), 0) from public.background_job_runs
      where job = p_job and started_at > now() - interval '7 days'
    )
  );
end;
$$;

revoke all on function public.get_background_job_runs(text, integer) from public, anon;
grant execute on function public.get_background_job_runs(text, integer) to authenticated;
