#!/usr/bin/env python3
"""What people send us, to the team's Telegram as it arrives (from alerts.sh, every minute).

Three feeds, each with its own watermark in $BOKS_OPS_STATE:
  feedback      every note in Studio -> Feedback, with the page or step it came from
  applications  every application from the page for authors (docs/author-applications.md)
  moderation    every work an author sends for review (not the team's own imports)
  authors       what an invited author does with their page: opens the invitation,
                accepts, writes, asks for changes, publishes, hides

The first run of a feed only sets its watermark, so nothing old is announced.
The watermark keeps microseconds, like the sign-ups in alerts.sh: cut to whole
seconds, the last row would stay later than it and be announced every minute.
At most ten a feed a run; the rest come next minute, and a summary says so.

Locally: BOKS_INBOX_PSQL="psql -h 127.0.0.1 -p 54322 -U postgres" and
BOKS_INBOX_NOTIFY=echo try it without the server or the bot.
"""
import html
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE = Path(os.environ.get("BOKS_OPS_STATE", "/var/lib/boks-ops"))
PSQL = shlex.split(os.environ.get("BOKS_INBOX_PSQL", "docker compose exec -T db psql -U postgres -h localhost"))
NOTIFY = shlex.split(os.environ.get("BOKS_INBOX_NOTIFY", str(ROOT / "ops" / "notify.sh")))
STUDIO = "https://tryboks.com/admin"
PER_RUN = 10

SURFACES = {
    "settings": "Настройки",
    "after_3": "после 3 боков",
    "after_10": "после 10 боков",
    "after_30": "после 30 боков",
    "series_text": "Запись Series · Текст",
    "series_record": "Запись Series · Запись",
    "series_pictures": "Запись Series · Картинки",
    "series_build": "Запись Series · Сборка",
    "author_landing": "Страница для авторов",
}
OFFERS = {"page": "Авторская страница", "series": "Пять Boks Series", "launch": "Совместный запуск", "unsure": "пока не знает"}

FEEDS = {
    "feedback": """
        select json_build_object('at', to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'surface', f.surface, 'message', f.message, 'handle', f.handle, 'guest', f.is_anonymous, 'read', f.boks_read)
        from public.boks_feedback f
        where f.created_at > :'since'::timestamptz order by f.created_at limit {limit};
    """,
    "applications": """
        select json_build_object('at', to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'offer', a.offer, 'name', a.name, 'links', a.links, 'contact', a.contact, 'audience', a.audience,
          'message', a.message, 'handle', p.handle, 'guest', a.user_id is null)
        from public.author_applications a left join public.user_profiles p on p.user_id = a.user_id
        where a.created_at > :'since'::timestamptz order by a.created_at limit {limit};
    """,
    "moderation": """
        select json_build_object('at', to_char(r.submitted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'title', r.title, 'handle', p.handle, 'words', array_length(regexp_split_to_array(btrim(coalesce(r.text, '')), '\\s+'), 1),
          'waiting', (select count(*) from public.reels w where w.status = 'pending_review'))
        from public.reels r left join public.user_profiles p on p.user_id = r.author_user_id
        where r.status = 'pending_review' and r.submitted_at > :'since'::timestamptz
          and not coalesce(public.is_boks_admin(r.author_user_id), false)
        order by r.submitted_at limit {limit};
    """,
    # What an invited author does with the page the team prepared: opens the
    # invitation, accepts it, writes, asks for changes, publishes, hides.
    "authors": """
        with ev as (
          select i.opened_at as at, 'opened' as kind, s.id as space, null::text as work, null::text as body
            from public.author_space_invites i join public.author_spaces s on s.id = i.space_id
           where i.opened_at > :'since'::timestamptz
          union all
          select i.accepted_at, 'accepted', s.id, null, null
            from public.author_space_invites i join public.author_spaces s on s.id = i.space_id
           where i.accepted_at > :'since'::timestamptz
          union all
          select m.created_at, case when m.work_id is null then 'message' else 'changes' end, m.space_id, w.title, m.body
            from public.author_space_messages m left join public.author_space_works w on w.id = m.work_id
           where m.from_author and m.created_at > :'since'::timestamptz
          union all
          select p.created_at, 'published', p.space_id,
                 (select string_agg('«' || (x ->> 'title') || '»', ', ') from jsonb_array_elements(p.result -> 'published') x), null
            from public.author_space_publications p
           where p.basis = 'owner_terms' and p.created_at > :'since'::timestamptz
          union all
          select r.withdrawn_at, 'hidden', s.id, r.title, null
            from public.reels r join public.author_spaces s on s.owner_user_id = r.author_user_id and s.status <> 'merged'
           where r.status = 'withdrawn' and r.withdrawn_from_status = 'published' and r.withdrawn_at > :'since'::timestamptz
        )
        select json_build_object('at', to_char(ev.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'kind', ev.kind, 'work', ev.work, 'body', ev.body, 'name', s.name, 'handle', public.boks_space_handle(s))
        from ev join public.author_spaces s on s.id = ev.space
        order by ev.at limit {limit};
    """,
}

AUTHOR_EVENTS = {
    "opened": "👀 {who} открыл(а) приглашение и смотрит, что подготовила редакция",
    "accepted": "✅ {who} принял(а) приглашение: страница в кабинете, идёт просмотр",
    "changes": "✍️ {who} просит правки к «{work}»",
    "message": "✉️ {who} пишет редакции",
    "published": "🎉 {who} опубликовал(а): {work}",
    "hidden": "🙈 {who} скрыл(а) с сайта «{work}»",
}


def esc(value, limit=600):
    text = str(value or "").strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return html.escape(text, quote=False)


def who(row):
    if row.get("handle"):
        return f"@{esc(row['handle'])}"
    return "гость" if row.get("guest") else "без имени"


def message(feed, row):
    if feed == "feedback":
        where = SURFACES.get(row.get("surface"), row.get("surface") or "")
        read = f", прочитал {row['read']}" if row.get("read") else ""
        return f"💬 <b>Отзыв</b> · {esc(where)}\n{esc(row.get('message'), 1200)}\n— {who(row)}{read}"
    if feed == "applications":
        lines = [f"✍️ <b>Заявка автора</b> · {esc(OFFERS.get(row.get('offer'), row.get('offer')))}",
                 f"<b>{esc(row.get('name'), 120)}</b> ({who(row)})",
                 f"Связь: {esc(row.get('contact'), 200)}",
                 f"Ссылки: {esc(row.get('links'), 600)}"]
        if row.get("audience"):
            lines.append(f"Читатели: {esc(row['audience'], 120)}")
        if row.get("message"):
            lines.append(esc(row["message"], 800))
        lines.append(f"Studio → Авторы: {STUDIO}")
        return "\n".join(lines)
    if feed == "authors":
        name = esc(row.get("name"), 120) or "Автор"
        handle = f" (@{esc(row['handle'])})" if row.get("handle") else ""
        line = AUTHOR_EVENTS.get(row.get("kind"), "{who}: " + esc(row.get("kind"))).format(
            who=f"<b>{name}</b>{handle}", work=esc(row.get("work"), 400) if row.get("kind") == "published" else esc(row.get("work"), 160))
        lines = [line]
        if row.get("body"):
            lines.append(f"<i>{esc(row['body'], 1500)}</i>")
        if row.get("kind") in ("changes", "message"):
            lines.append(f"Ответить: Studio → Авторы → {name}: {STUDIO}")
        if row.get("kind") == "published" and row.get("handle"):
            lines.append(f"Страница: https://go.tryboks.com/@{esc(row['handle'])}")
        return "\n".join(lines)
    words = f", {row['words']} слов" if row.get("words") else ""
    return (f"📝 <b>На модерацию</b>: «{esc(row.get('title'), 160)}» от {who(row)}{words}\n"
            f"Ждут проверки: {row.get('waiting')}. Studio → Модерация: {STUDIO}")


def query(sql, since):
    script = "set statement_timeout = '10s';\n" + sql
    done = subprocess.run([*PSQL, "-qAt", "-v", f"since={since}"], input=script, capture_output=True, text=True, cwd=ROOT, timeout=30)
    if done.returncode != 0:
        raise RuntimeError(done.stderr.strip()[:300])
    return [json.loads(line) for line in done.stdout.splitlines() if line.startswith("{")]


def notify(text):
    subprocess.run([*NOTIFY, text], cwd=ROOT, timeout=60, check=False)


def run(feed, sql):
    mark = STATE / f"inbox-{feed}.since"
    if not mark.exists():
        mark.write_text(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"))
        return
    rows = query(sql.format(limit=PER_RUN + 1), mark.read_text().strip())
    for row in rows[:PER_RUN]:
        notify(message(feed, row))
        mark.write_text(row["at"])
    if len(rows) > PER_RUN:
        notify(f"…и ещё в «{feed}»: придут в следующую минуту.")


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    failed = False
    for feed, sql in FEEDS.items():
        try:
            run(feed, sql)
        except Exception as error:  # One feed failing does not hold up the others.
            print(f"inbox {feed}: {error}", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
