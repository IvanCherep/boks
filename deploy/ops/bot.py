#!/usr/bin/env python3
"""Commands from the team's Telegram group, answered from here (alerts.sh, every minute).

Telegram cannot reach this server and the server cannot reach Telegram, so the
relay Worker (deploy/telegram-relay) takes the group's commands and, for each,
calls https://tryboks.com/api/ops/bot with a key derived from RELAY_KEY. Caddy
hands that one path to this script (`--serve`, on the Docker network's gateway
address, port 8787, opened by the firewall to the containers only), which
answers from the database and the machine itself; the Worker sends the answer
to the group. Nothing runs between commands, and no command waits for a poll.

alerts.sh keeps one `--serve` running (a lock; restarted within a minute if it
stops), and it exits by itself when this file changes, so a release takes effect.

  /stats            today and yesterday
  /stats week       seven days, a row a day (also /stats 14, up to 31)
  /stats authors    our authors (published author pages): fourteen days each, a row a day
  /stats <handle>   one author, fourteen days (/stats komarov)
  /online           people on the site now
  /server           load, memory, disk, services, errors, the site's answer
  /help             this list

Days are Belgrade days, as in the table the team sends to analytics; the
people counted are the daily report's (ops/report.sql): devices, the team's
marked devices left out. Likes and comments also leave out the team's accounts.

Locally: BOKS_BOT_PSQL="psql -h 127.0.0.1 -p 54322 -U postgres" and
BOKS_BOT_COMMANDS="/stats week;/server" python3 ops/bot.py prints the answers.
"""
import hashlib
import hmac
import html
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PSQL = shlex.split(os.environ.get("BOKS_BOT_PSQL", "docker compose exec -T db psql -U postgres -h localhost"))
TZ = "Europe/Belgrade"
COUNTRIES = {"RU": "Россия", "RS": "Сербия", "US": "США", "NL": "Нидерланды", "GB": "Великобритания", "CA": "Канада",
             "BY": "Беларусь", "DE": "Германия", "PL": "Польша", "FI": "Финляндия", "FR": "Франция", "KZ": "Казахстан",
             "UA": "Украина", "AM": "Армения", "GE": "Грузия", "TR": "Турция", "IL": "Израиль", "LV": "Латвия", "??": "не определена"}

# The team, wherever a count is about people: the marked devices (as the daily
# report), and for likes, comments and accounts also the team's own accounts.
TEAM_SQL = """
create temp table team_devices as select visitor_id from public.boks_team_devices;
create temp table team_users as select id from auth.users
  where public.is_boks_admin(id) or email like '%@authors.tryboks.com';
"""


def env(name):
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip()
    return ""


def rows(sql):
    script = "set statement_timeout = '20s';\n" + TEAM_SQL + sql
    done = subprocess.run([*PSQL, "-v", "ON_ERROR_STOP=1", "-qAt", "-F", "|"], input=script, capture_output=True, text=True, cwd=ROOT, timeout=60)
    if done.returncode != 0:
        raise RuntimeError(done.stderr.strip()[:300])
    return [line.split("|") for line in done.stdout.splitlines() if line.strip()]


def sh(command):
    done = subprocess.run(command, shell=True, capture_output=True, text=True, cwd=ROOT, timeout=30)
    return done.stdout.strip()


# ------------------------------------------------------------------- numbers

def day_rows(first_offset, last_offset):
    """One row a Belgrade day, `first_offset` .. `last_offset` days back from today."""
    return rows(f"""
with days as (
  select generate_series((now() at time zone '{TZ}')::date - {first_offset}, (now() at time zone '{TZ}')::date - {last_offset}, '1 day')::date as d
),
lo as (select (min(d)::timestamp at time zone '{TZ}') as t from days),
jo as (select (created_at at time zone '{TZ}')::date as d, visitor_id, event, country from public.boks_journey_events
       where created_at >= (select t from lo) and coalesce(visitor_id, '') not in (select visitor_id from team_devices)),
ev as (select (created_at at time zone '{TZ}')::date as d, visitor_id, reel_id, event_type, active_seconds from public.recommendation_events
       where created_at >= (select t from lo) and coalesce(visitor_id, '') not in (select visitor_id from team_devices)),
reading as (select d, sum(secs) / 60.0 as minutes from (
              select d, visitor_id, reel_id, max(active_seconds) as secs from ev
              where event_type in ('heartbeat', 'complete', 'skip') and active_seconds is not null group by 1, 2, 3) t group by 1)
select to_char(days.d, 'DD.MM'),
  (select count(distinct visitor_id) from jo where jo.d = days.d and event = 'visit'),
  (select count(distinct visitor_id) from jo where jo.d = days.d and event = 'visit' and upper(country) = 'RU'),
  (select count(*) from jo where jo.d = days.d and event = 'visit'),
  (select count(distinct visitor_id) from ev where ev.d = days.d and event_type = 'start'),
  (select count(*) from ev where ev.d = days.d and event_type = 'complete'),
  coalesce((select round(minutes) from reading where reading.d = days.d), 0),
  (select count(*) from ev where ev.d = days.d and event_type = 'share'),
  (select count(*) from auth.users u where not u.is_anonymous and u.id not in (select id from team_users)
     and (u.created_at at time zone '{TZ}')::date = days.d),
  (select count(*) from public.likes l where l.user_id not in (select id from team_users) and (l.created_at at time zone '{TZ}')::date = days.d),
  (select count(*) from public.comments c where c.user_id not in (select id from team_users) and (c.created_at at time zone '{TZ}')::date = days.d)
from days order by days.d;
""")


def period_extras(days_back):
    return rows(f"""
with lo as (select (((now() at time zone '{TZ}')::date - {days_back})::timestamp at time zone '{TZ}') as t)
select 'people', count(distinct visitor_id)::text from public.boks_journey_events
  where event = 'visit' and created_at >= (select t from lo) and coalesce(visitor_id, '') not in (select visitor_id from team_devices)
union all
select * from (select 'country:' || upper(coalesce(country, '??')), count(distinct visitor_id)::text from public.boks_journey_events
  where event = 'visit' and created_at >= (select t from lo) and coalesce(visitor_id, '') not in (select visitor_id from team_devices)
  group by 1 order by count(distinct visitor_id) desc limit 8) c;
""")


def now_belgrade():
    return rows(f"select to_char(now() at time zone '{TZ}', 'DD.MM HH24:MI');")[0][0]


def stats_today():
    today, yesterday = day_rows(0, 0)[0], day_rows(1, 1)[0]
    names = ["Людей", "из России", "Визитов", "Читали", "Дочитали", "Минут чтения", "Репосты", "Новые аккаунты", "Лайки", "Комментарии"]

    def line(i, name):
        now, was = int(today[i + 1]), int(yesterday[i + 1])
        delta = now - was
        return f"{name}: <b>{now}</b>" + (f" (вчера {was})" if delta else " (как вчера)")

    extras = period_extras(0)
    countries = ", ".join(f"{COUNTRIES.get(k.split(':')[1], k.split(':')[1])} {v}" for k, v in extras if k.startswith("country:"))
    body = "\n".join(line(i, name) for i, name in enumerate(names))
    return (f"📊 <b>boks · сегодня</b> (по Белграду, на {now_belgrade()})\n\n{body}\n\n"
            f"Страны сегодня: {html.escape(countries) or '—'}\n"
            f"<i>Устройства команды и её аккаунты не учитываются. Вчера — за весь день.</i>")


def stats_days(n):
    data = day_rows(n - 1, 0)
    head = f"{'Дата':<5} {'Люд':>4} {'РФ':>3} {'Чит':>4} {'Доч':>4} {'Мин':>4} {'Акк':>3} {'♥':>3}"
    lines = [head]
    for r in data:
        lines.append(f"{r[0]:<5} {r[1]:>4} {r[2]:>3} {r[4]:>4} {r[5]:>4} {r[6]:>4} {r[8]:>3} {r[9]:>3}")
    total = lambda i: sum(int(r[i]) for r in data)
    extras = period_extras(n - 1)
    people = next((v for k, v in extras if k == "people"), "0")
    countries = ", ".join(f"{COUNTRIES.get(k.split(':')[1], k.split(':')[1])} {v}" for k, v in extras if k.startswith("country:"))
    table = html.escape("\n".join(lines))
    return (f"📊 <b>boks · {n} дн.</b> (по Белграду, на {now_belgrade()}, сегодня — неполный день)\n"
            f"<pre>{table}</pre>\n"
            f"За период: людей <b>{people}</b> · визитов {total(3)} · дочитано {total(5)} · минут {total(6)} · "
            f"аккаунтов {total(8)} · лайков {total(9)} · комментариев {total(10)} · репостов {total(7)}\n"
            f"Страны: {html.escape(countries) or '—'}\n"
            f"<i>Люд — люди (устройства), РФ — из России, Чит — начали читать, Доч — дочитано, Мин — минуты чтения "
            f"(в них шум от открытых вкладок), Акк — новые аккаунты, ♥ — лайки. Команда не учитывается.</i>")


# ------------------------------------------------------------------- authors

# Our authors are the published author pages. A page's boks are the boks its
# owner wrote and the works attached to it. The author's own account and the
# team are left out. People: devices that met one of the author's boks (a card
# shown, read, anything); RU: those of them whose visit came from Russia;
# accounts: new accounts whose device had started one of the author's boks by
# the end of the day the account was made (one reader can count for several).
AUTHORS_SQL = """
create temp table author_boks as
  select s.id as space_id, r.id as reel_id from public.author_spaces s join public.reels r on r.author_user_id = s.owner_user_id
    where s.status = 'published'
  union
  select s.id, w.bok_id from public.author_spaces s join public.author_space_works w on w.space_id = s.id
    where s.status = 'published' and w.bok_id is not null;
create temp table authors as
  select s.id as space_id, s.owner_user_id, coalesce(p.handle, s.handle, '') as handle, coalesce(s.name, '?') as name
  from public.author_spaces s left join public.user_profiles p on p.user_id = s.owner_user_id
  where s.status = 'published' and exists (select 1 from author_boks b where b.space_id = s.id);
"""


def author_rows(n, handle=None):
    only = "" if handle is None else "where lower(a.handle) = lower('" + re.sub(r"[^A-Za-z0-9_]", "", handle) + "')"
    return rows(AUTHORS_SQL + f"""
with days as (
  select generate_series((now() at time zone '{TZ}')::date - {n - 1}, (now() at time zone '{TZ}')::date, '1 day')::date as d
),
lo as (select (min(d)::timestamp at time zone '{TZ}') as t from days),
picked as (select a.* from authors a {only}),
ev as (select (e.created_at at time zone '{TZ}')::date as d, b.space_id, e.visitor_id, e.reel_id, e.event_type, e.active_seconds, e.created_at
       from public.recommendation_events e join author_boks b on b.reel_id = e.reel_id join picked a on a.space_id = b.space_id
       where e.created_at >= (select t from lo) and e.user_id is distinct from a.owner_user_id
         and e.visitor_id <> '' and e.visitor_id not in (select visitor_id from team_devices)
         and e.user_id not in (select id from team_users)),
ru as (select distinct visitor_id from public.boks_journey_events
       where event = 'visit' and upper(country) = 'RU' and created_at >= (select t from lo) - interval '30 days'),
reading as (select d, space_id, sum(secs) / 60.0 as minutes from (
              select d, space_id, visitor_id, reel_id, max(active_seconds) as secs from ev
              where event_type in ('heartbeat', 'complete', 'skip') and active_seconds is not null group by 1, 2, 3, 4) t group by 1, 2),
acc as (select u.id, u.created_at, (u.created_at at time zone '{TZ}')::date as d from auth.users u
        where not u.is_anonymous and u.id not in (select id from team_users) and u.created_at >= (select t from lo)),
acc_dev as (select distinct acc.id, acc.d, e.visitor_id from acc join public.recommendation_events e on e.user_id = acc.id where e.visitor_id <> ''
            union select distinct acc.id, acc.d, j.visitor_id from acc join public.boks_journey_events j on j.user_id = acc.id where coalesce(j.visitor_id, '') <> ''),
acc_author as (select distinct acc_dev.d, b.space_id, acc_dev.id from acc_dev
               join public.recommendation_events e on e.visitor_id = acc_dev.visitor_id and e.event_type = 'start'
                 and e.created_at < ((acc_dev.d + 1)::timestamp at time zone '{TZ}')
               join author_boks b on b.reel_id = e.reel_id join picked a on a.space_id = b.space_id
               where acc_dev.id is distinct from a.owner_user_id),
-- Each figure is counted once per author and day: subqueries over ev for every
-- author x day ran past the 20 s limit once there were several authors.
per_day as (select ev.space_id, ev.d,
              count(distinct ev.visitor_id) as people,
              count(distinct ru.visitor_id) as ru_people,
              count(distinct ev.visitor_id) filter (where ev.event_type = 'start') as starts,
              count(*) filter (where ev.event_type = 'complete') as completes
            from ev left join ru on ru.visitor_id = ev.visitor_id group by 1, 2),
per_period as (select space_id, count(distinct visitor_id) as people from ev group by 1),
acc_day as (select space_id, d, count(*) as n from acc_author group by 1, 2),
likes_day as (select b.space_id, (l.created_at at time zone '{TZ}')::date as d, count(*) as n
              from public.likes l join author_boks b on b.reel_id = l.reel_id join picked a on a.space_id = b.space_id
              where l.created_at >= (select t from lo) and l.user_id not in (select id from team_users)
                and l.user_id is distinct from a.owner_user_id group by 1, 2)
select a.handle, a.name, to_char(days.d, 'DD.MM'),
  coalesce(pd.people, 0), coalesce(pd.ru_people, 0), coalesce(pd.starts, 0), coalesce(pd.completes, 0),
  coalesce(round(r.minutes), 0), coalesce(ad.n, 0), coalesce(ld.n, 0), coalesce(pp.people, 0)
from picked a cross join days
left join per_day pd on pd.space_id = a.space_id and pd.d = days.d
left join reading r on r.space_id = a.space_id and r.d = days.d
left join acc_day ad on ad.space_id = a.space_id and ad.d = days.d
left join likes_day ld on ld.space_id = a.space_id and ld.d = days.d
left join per_period pp on pp.space_id = a.space_id
order by coalesce(pp.people, 0) desc, a.name, days.d;
""")


AUTHOR_HEAD = f"{'Дата':<5} {'Люд':>4} {'РФ':>3} {'Чит':>4} {'Доч':>4} {'Мин':>4} {'Акк':>3} {'♥':>3}"
AUTHOR_LEGEND = ("<i>Люд — люди (устройства), которым попались его боки, РФ — из них из России, Чит — начали читать, "
                 "Доч — дочитано, Мин — минуты чтения, Акк — новые аккаунты, читавшие его до регистрации, ♥ — лайки. "
                 "Команда и сам автор не учитываются.</i>")


def author_tables(data):
    """Rows grouped by author: (handle, name, period people, [day rows])."""
    grouped = {}
    for r in data:
        grouped.setdefault((r[0], r[1]), {"people": r[10], "days": []})["days"].append(r)
    return [(h, name, g["people"], g["days"]) for (h, name), g in grouped.items()]


def author_table(days):
    # The days before the author's boks met anyone say nothing: left out.
    while len(days) > 1 and all(int(v) == 0 for v in days[0][3:10]):
        days = days[1:]
    lines = [AUTHOR_HEAD]
    for r in days:
        lines.append(f"{r[2]:<5} {r[3]:>4} {r[4]:>3} {r[5]:>4} {r[6]:>4} {r[7]:>4} {r[8]:>3} {r[9]:>3}")
    total = lambda i: sum(int(r[i]) for r in days)
    lines.append(f"{'Итого':<5} {'':>4} {'':>3} {'':>4} {total(6):>4} {total(7):>4} {total(8):>3} {total(9):>3}")
    return "<pre>" + html.escape("\n".join(lines)) + "</pre>"


def stats_authors(n=14):
    blocks = author_tables(author_rows(n))
    if not blocks:
        return "Опубликованных страниц авторов с боками пока нет."

    def render(keep):
        parts = [f"👩‍🎨 <b>boks · авторы, {keep} дн.</b> (по Белграду, на {now_belgrade_text}, сегодня — неполный день)"]
        for handle, name, people, days in blocks:
            parts.append(f"<b>{html.escape(name)}</b>{' @' + html.escape(handle) if handle else ''} · людей за {n} дн.: {people}\n"
                         + author_table(days[-keep:]))
        parts.append(AUTHOR_LEGEND + "\nОдин автор за 14 дней: /stats " + html.escape(blocks[0][0] or "handle"))
        return "\n".join(parts)

    now_belgrade_text = now_belgrade()
    # Telegram takes about 4000 characters; with many authors, fewer days.
    keep = n
    while keep > 1 and len(re.sub(r"<[^>]+>", "", render(keep))) > 3900:
        keep -= 1
    return render(keep)


def stats_author(handle, n=14):
    blocks = author_tables(author_rows(n, handle))
    if not blocks:
        return None
    h, name, people, days = blocks[0]
    return (f"👩‍🎨 <b>{html.escape(name)}</b>{' @' + html.escape(h) if h else ''} · {n} дн. "
            f"(по Белграду, на {now_belgrade()}, сегодня — неполный день)\n"
            f"{author_table(days)}\nЗа период людей: <b>{people}</b>\n{AUTHOR_LEGEND}")


# -------------------------------------------------------------------- server

def online_numbers():
    return rows("""
with ev as (
  select created_at, visitor_id from public.boks_journey_events where created_at > now() - interval '60 minutes'
  union all select created_at, visitor_id from public.recommendation_events where created_at > now() - interval '60 minutes'
)
select count(distinct visitor_id) filter (where created_at > now() - interval '5 minutes'),
       count(distinct visitor_id) filter (where created_at > now() - interval '15 minutes'),
       count(distinct visitor_id)
from ev where coalesce(visitor_id, '') not in (select visitor_id from team_devices);
""")[0]


def online():
    m5, m15, m60 = online_numbers()
    return (f"🟢 <b>Сейчас на boks</b> ({now_belgrade()} по Белграду)\n"
            f"за 5 минут: <b>{m5}</b> · за 15 минут: {m15} · за час: {m60}\n"
            f"<i>Люди — устройства с любым действием на сайте, без команды.</i>")


def server():
    cores = sh("nproc") or "?"
    load = sh("cut -d' ' -f1-3 /proc/loadavg")
    mem = sh("free -m | awk '/Mem:/{printf \"%d из %d МБ свободно\", $7, $2}'")
    disk = sh("df -h --output=pcent,avail / | tail -1 | awk '{print $1\" занято, свободно \"$2}'")
    states = sh("docker compose ps --all --format '{{.Service}} {{.State}} {{.Health}}'")
    services = []
    bad = []
    for line in states.splitlines():
        parts = line.split()
        if not parts:
            continue
        name, state = parts[0], parts[1] if len(parts) > 1 else "?"
        if name in ("mail", "embedder"):  # run on demand, stopped otherwise (as in alerts.sh)
            continue
        health = parts[2] if len(parts) > 2 else ""
        services.append(name)
        if state != "running" or health == "unhealthy":
            bad.append(f"{name} ({state}{' ' + health if health else ''})")
    errors = sh("docker compose logs --since 15m app-blue app-green rest auth db 2>&1 | grep -ciE ' error|exception|fatal|panic' || true") or "0"
    site = sh("curl -s -o /dev/null -m 10 -w '%{http_code} %{time_total}' https://tryboks.com/api/geo || true")
    try:
        code, seconds = site.split()
        site = f"{code} за {float(seconds):.2f} с"
    except ValueError:
        site = "не отвечает"
    dbsize = rows("select pg_size_pretty(pg_database_size('postgres'));")[0][0]
    release = sh("readlink releases/CURRENT 2>/dev/null || cat releases/CURRENT 2>/dev/null") or "?"
    m5, m15, m60 = online_numbers()
    try:
        heavy = float(load.split()[0]) / max(1, int(cores)) >= 1
    except ValueError:
        heavy = False
    status = "🔴" if bad or not site.startswith("200") else ("🟠" if heavy else "🟢")
    return (f"{status} <b>Сервер boks</b> ({now_belgrade()} по Белграду)\n\n"
            f"Нагрузка: <b>{load}</b> на {cores} ядра (1, 5, 15 мин)\n"
            f"Память: {mem}\n"
            f"Диск: {disk} · база {dbsize}\n"
            f"Сервисы: {'все работают (' + str(len(services)) + ')' if not bad else '<b>не работают: ' + html.escape(', '.join(bad)) + '</b>'}\n"
            f"Ошибок в журналах за 15 минут: {errors}\n"
            f"Сайт: {html.escape(site)}\n"
            f"Релиз: {html.escape(release)}\n"
            f"Онлайн: {m5} за 5 мин · {m15} за 15 мин · {m60} за час")


HELP = ("🤖 <b>Команды boks</b>\n"
        "/stats — сегодня и вчера\n"
        "/stats week — неделя по дням (или /stats 14, до 31 дня)\n"
        "/stats authors — наши авторы, каждый по дням за 14 дней\n"
        "/stats komarov — один автор (его @handle) за 14 дней\n"
        "/online — кто на сайте сейчас\n"
        "/server — нагрузка, память, диск, сервисы, ошибки\n"
        "Ответ приходит в течение минуты. Время — по Белграду.")


def answer(text):
    words = text.strip().split()
    if not words:
        return None
    command = words[0].split("@")[0].lower()
    arg = words[1].lower() if len(words) > 1 else ""
    if command in ("/stats", "/stat", "/статистика"):
        if arg in ("", "today", "сегодня"):
            return stats_today()
        if arg in ("week", "неделя", "7"):
            return stats_days(7)
        if re.fullmatch(r"\d{1,2}", arg):
            return stats_days(max(1, min(31, int(arg))))
        if arg in ("authors", "author", "авторы", "автор"):
            return stats_authors()
        if re.fullmatch(r"@?[a-z][a-z0-9_]{2,23}", arg):
            found = stats_author(arg.lstrip("@"))
            if found:
                return found
        return "Не понял. Например: /stats, /stats week, /stats 14, /stats authors, /stats komarov"
    if command in ("/server", "/status", "/сервер"):
        return server()
    if command in ("/online", "/онлайн"):
        return online()
    if command in ("/help", "/start"):
        return HELP
    return None


# --------------------------------------------------------------------- serve

def serve(address="172.18.0.1", port=8787):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    key = hashlib.sha256(("bot-call:" + env("TG_RELAY_KEY")).encode()).hexdigest()
    started = Path(__file__).stat().st_mtime

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            given = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            if self.path != "/api/ops/bot" or not hmac.compare_digest(given.encode(), key.encode()):
                self.send_error(404)
                return
            try:
                length = min(int(self.headers.get("Content-Length", "0")), 2000)
                text = str(json.loads(self.rfile.read(length) or b"{}").get("text", ""))[:100]
                reply = answer(text) or HELP
            except Exception as error:  # an answer that failed is still an answer
                reply = f"⚠️ Не получилось ответить: {html.escape(str(error)[:200])}"
            body = json.dumps({"reply": reply}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            print(f"bot: {time.strftime('%H:%M:%S')} {text[:40]!r} answered", flush=True)

        def do_GET(self):
            self.send_error(404)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer((address, port), Handler)
    server.timeout = 5
    # A new ops/bot.py (a release): stop, and alerts.sh starts the new one within a minute.
    while Path(__file__).stat().st_mtime == started:
        server.handle_request()
    return 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--serve":
        return serve(*(sys.argv[2:3] or []))
    # Locally, or to see an answer on the server: BOKS_BOT_COMMANDS="/stats week;/server" ops/bot.py
    for text in os.environ.get("BOKS_BOT_COMMANDS", "/help").split(";"):
        print(answer(text) or HELP, end="\n\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
