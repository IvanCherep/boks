#!/usr/bin/env python3
"""Commands from the team's Telegram group, answered from here (alerts.sh, every minute).

Telegram cannot reach this server and the server cannot reach Telegram, so the
relay Worker (deploy/telegram-relay) takes the group's commands and keeps them;
this script collects them every minute, answers each from the database and the
machine itself, and sends the answer back through the same relay
(ops/notify.sh). Nothing on the server is opened to the internet for it.

  /stats            today and yesterday
  /stats week       seven days, a row a day (also /stats 14, up to 31)
  /online           people on the site now
  /server           load, memory, disk, services, errors, the site's answer
  /help             this list

Days are Belgrade days, as in the table the team sends to analytics; the
people counted are the daily report's (ops/report.sql): devices, the team's
marked devices left out. Likes and comments also leave out the team's accounts.

Locally: BOKS_BOT_PSQL="psql -h 127.0.0.1 -p 54322 -U postgres",
BOKS_BOT_NOTIFY=echo and BOKS_BOT_COMMANDS="/stats week;/server" try it
without the relay.
"""
import html
import json
import os
import re
import shlex
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PSQL = shlex.split(os.environ.get("BOKS_BOT_PSQL", "docker compose exec -T db psql -U postgres -h localhost"))
NOTIFY = shlex.split(os.environ.get("BOKS_BOT_NOTIFY", str(ROOT / "ops" / "notify.sh")))
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
    done = subprocess.run([*PSQL, "-qAt", "-F", "|"], input=script, capture_output=True, text=True, cwd=ROOT, timeout=60)
    if done.returncode != 0:
        raise RuntimeError(done.stderr.strip()[:300])
    return [line.split("|") for line in done.stdout.splitlines() if line.strip()]


def sh(command):
    done = subprocess.run(command, shell=True, capture_output=True, text=True, cwd=ROOT, timeout=30)
    return done.stdout.strip()


def notify(text):
    """Sent, or not: the relay being unreachable is never worth more than a line in the log."""
    try:
        done = subprocess.run([*NOTIFY, text[:4000]], cwd=ROOT, timeout=60, check=False, capture_output=True, text=True)
        return done.returncode == 0
    except subprocess.TimeoutExpired:
        return False


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
  (select coalesce(round(minutes), 0) from reading where reading.d = days.d),
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
        return "Не понял период. Например: /stats, /stats week, /stats 14"
    if command in ("/server", "/status", "/сервер"):
        return server()
    if command in ("/online", "/онлайн"):
        return online()
    if command in ("/help", "/start"):
        return HELP
    return None


# --------------------------------------------------------------------- relay

def pending():
    local = os.environ.get("BOKS_BOT_COMMANDS")
    if local is not None:
        return [{"text": t} for t in local.split(";") if t.strip()]
    send_url = env("TG_RELAY_URL") or "https://boks-telegram.tryboks.workers.dev/send"
    url = send_url.rsplit("/send", 1)[0] + "/pending"
    request = urllib.request.Request(url, method="POST", headers={
        "Authorization": "Bearer " + env("TG_RELAY_KEY"),
        # Cloudflare refuses Python's default User-Agent with a 403.
        "User-Agent": "boks-ops/1 (ops/bot.py)",
    })
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode()).get("commands", [])
    except Exception as error:
        # An older relay without /pending, or the network: nothing to do this minute.
        print(f"bot: relay /pending failed: {error}", file=sys.stderr)
        return []


def main():
    for item in pending()[:5]:
        text = str(item.get("text", ""))
        try:
            reply = answer(text)
        except Exception as error:  # one failed answer must not stop the others
            reply = f"⚠️ Не получилось ответить на {html.escape(text[:40])}: {html.escape(str(error)[:200])}"
        if reply:
            sent = notify(reply)
            print(f"bot: {time.strftime('%H:%M:%S')} {text[:40]!r} -> {'sent' if sent else 'NOT sent (relay unreachable)'}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
