-- Numbers for one period [:'from', :'to') and the period before it, as key|now|before.
-- Read-only, bounded, every query on a created_at index. Team devices excluded.
set default_transaction_read_only = on;
set statement_timeout = '30s';

with p(name, s, e) as (
  values ('now',    :'from'::timestamptz, :'to'::timestamptz),
         ('before', :'from'::timestamptz - (:'to'::timestamptz - :'from'::timestamptz), :'from'::timestamptz)
),
team as (select visitor_id from boks_team_devices),
ev as (
  select p.name, e.* from p join recommendation_events e on e.created_at >= p.s and e.created_at < p.e
  where coalesce(e.visitor_id, '') not in (select visitor_id from team)
),
jo as (
  select p.name, j.* from p join boks_journey_events j on j.created_at >= p.s and j.created_at < p.e
  where coalesce(j.visitor_id, '') not in (select visitor_id from team)
),
reading as (
  select name, sum(secs) / 60.0 as minutes from (
    select name, visitor_id, reel_id, max(active_seconds) as secs from ev
    where event_type in ('heartbeat', 'complete', 'skip') and active_seconds is not null
    group by 1, 2, 3
  ) t group by 1
),
m as (
  select p.name,
    (select count(distinct visitor_id) from jo where jo.name = p.name and event = 'visit') as visitors,
    (select count(*) from jo where jo.name = p.name and event = 'visit') as visits,
    (select count(distinct visitor_id) from ev where ev.name = p.name and event_type = 'start') as readers,
    (select count(*) from ev where ev.name = p.name and event_type = 'start') as starts,
    (select count(*) from ev where ev.name = p.name and event_type = 'complete') as completes,
    (select count(*) from ev where ev.name = p.name and event_type = 'skip') as skips,
    (select coalesce(round(minutes), 0) from reading r where r.name = p.name) as minutes,
    (select count(*) from auth.users u where u.created_at >= p.s and u.created_at < p.e and not u.is_anonymous) as accounts,
    (select count(*) from likes l where l.created_at >= p.s and l.created_at < p.e) as likes,
    (select count(*) from comments c where c.created_at >= p.s and c.created_at < p.e) as comments,
    (select count(*) from ev where ev.name = p.name and event_type = 'share') as shares,
    (select count(*) from jo where jo.name = p.name and event = 'signup_prompt') as prompts
  from p
)
select key, max(case when name = 'now' then val end), max(case when name = 'before' then val end)
from m cross join lateral (values
  ('visitors', visitors), ('visits', visits), ('readers', readers), ('starts', starts),
  ('completes', completes), ('skips', skips), ('minutes', minutes), ('accounts', accounts),
  ('likes', likes), ('comments', comments), ('shares', shares), ('prompts', prompts)
) v(key, val)
group by key;

-- Top boks of the period by finished reads.
select '#top', r.title, count(*)
from recommendation_events e join reels r on r.id = e.reel_id
where e.event_type = 'complete' and e.created_at >= :'from' and e.created_at < :'to'
  and coalesce(e.visitor_id, '') not in (select visitor_id from boks_team_devices)
group by r.title order by 3 desc, 2 limit 3;

-- Where visitors came from (countries).
select '#country', coalesce(country, '??'), count(distinct visitor_id)
from boks_journey_events
where event = 'visit' and created_at >= :'from' and created_at < :'to'
  and coalesce(visitor_id, '') not in (select visitor_id from boks_team_devices)
group by 2 order by 3 desc limit 3;

select '#dbsize', pg_size_pretty(pg_database_size('postgres')), 0;
