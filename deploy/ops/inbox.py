#!/usr/bin/env python3
"""What people send us, to the team's Telegram as it arrives (from alerts.sh, every minute).

Feeds, each with its own watermark in $BOKS_OPS_STATE:
  feedback      every note in Studio -> Feedback, with the page or step it came from
  applications  every application from the page for authors (docs/author-applications.md)
  moderation    every work an author sends for review (not the team's own imports)
                a piece sent with the author's voice for a Boks Series gets its own
                message: voice length, place in the author's queue, what the editors do next
  authors       what an invited author does with their page: opens the invitation,
                accepts, writes, asks for changes, publishes, hides
  refused       a bok Yandex's content filter would not label for «Что почитать»:
                its mood is the editor's to set by hand
  shares        a link an author sends from the Workshop to their own post about a
                published Series (the contract's condition; docs/workshop-server.md)
  contracts     an author accepts the offer online, presses «Я оплатил(а)», or the
                team marks the payment (docs/author-agreements.md)

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
OFFERS = {"page": "Кабинет автора", "page_no_promotion": "Кабинет автора без продвижения", "series": "Пять Boks Series (старое)", "launch": "Совместный запуск", "unsure": "пока не знает"}

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
          'waiting', (select count(*) from public.reels w where w.status = 'pending_review'),
          'series', r.cover_requested,
          'name', (select s.name from public.author_spaces s
                    where s.owner_user_id = r.author_user_id and s.kind = 'author' and s.status <> 'merged'
                    order by (s.status = 'published') desc, s.created_at limit 1),
          'voiceMs', (select v.duration_ms from public.bok_voices v where v.bok_id = r.id),
          'voiceSource', (select v.source from public.bok_voices v where v.bok_id = r.id),
          'queuePos', (select b.queue_pos from public.bok_workshop b where b.bok_id = r.id),
          'queue', (select count(*) from public.reels q where q.author_user_id = r.author_user_id
                     and q.status = 'pending_review' and q.cover_requested),
          'seriesWaiting', (select count(*) from public.reels w where w.status = 'pending_review' and w.cover_requested))
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
    # A bok Yandex's content filter would not label (deploy/embedder/facets.mjs):
    # an editor sets its mood by hand. Told once, when the refusal is stored.
    "refused": """
        select j from (
          select l.labeled_at as at, json_build_object('at', to_char(l.labeled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'title', r.title, 'author', coalesce(nullif(btrim(r.author_name), ''), p.handle), 'id', r.id::text, 'slug', r.slug) as j
          from public.bok_facet_labels l join public.reels r on r.id = l.bok_id
          left join public.user_profiles p on p.user_id = r.author_user_id
          where l.facet = 'mood' and l.source = 'model' and l.note = 'refused: content_filter'
            and l.labeled_at > :'since'::timestamptz
          union all
          -- A byline the filter would not group (its titles): an editor sets the author group by hand.
          select l.labeled_at, json_build_object('at', to_char(l.labeled_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'byline', l.byline)
          from public.byline_facet_labels l
          where l.facet = 'author_group' and l.source = 'model' and l.note = 'refused: content_filter'
            and l.labeled_at > :'since'::timestamptz
        ) ev order by ev.at limit {limit};
    """,
}

FEEDS["shares"] = """
    select json_build_object('at', to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'url', l.url, 'title', r.title, 'handle', p.handle,
      'name', (select s.name from public.author_spaces s
                where s.owner_user_id = l.author_id and s.kind = 'author' and s.status <> 'merged'
                order by (s.status = 'published') desc, s.created_at limit 1))
    from public.bok_share_links l join public.reels r on r.id = l.bok_id
    left join public.user_profiles p on p.user_id = l.author_id
    where l.created_at > :'since'::timestamptz
    order by l.created_at limit {limit};
"""

FEEDS["contracts"] = """
    with ev as (
      select a.accepted_at as at, 'accepted' as kind, a.id from public.author_agreements a
       where a.accepted_at > :'since'::timestamptz
      union all
      select a.pay_reported_at, 'reported', a.id from public.author_agreements a
       where a.pay_reported_at > :'since'::timestamptz
      union all
      select a.paid_marked_at, 'paid', a.id from public.author_agreements a
       where a.pay_state = 'paid' and a.paid_marked_at > :'since'::timestamptz
    )
    select json_build_object('at', to_char(ev.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'kind', ev.kind, 'number', a.number, 'plan', a.plan, 'price', a.price_rub, 'legal', a.legal_name,
      'due', a.pay_due, 'amount', a.paid_amount_rub, 'handle', p.handle,
      'name', (select s.name from public.author_spaces s where s.id = a.space_id))
    from ev join public.author_agreements a on a.id = ev.id
    left join public.user_profiles p on p.user_id = a.user_id
    order by ev.at limit {limit};
"""

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
    if feed == "shares":
        name = esc(row.get("name"), 120) or "Автор"
        handle = f" (@{esc(row['handle'])})" if row.get("handle") else ""
        return (f"🔗 <b>{name}</b>{handle} поделился(ась) выпуском «{esc(row.get('title'), 160)}»: {esc(row.get('url'), 500)}\n"
                f"Studio → Авторы → Ссылки на посты: {STUDIO}")
    if feed == "contracts":
        name = esc(row.get("name"), 120) or esc(row.get("legal"), 120) or "Автор"
        handle = f" (@{esc(row['handle'])})" if row.get("handle") else ""
        plan = esc(OFFERS.get(row.get("plan"), row.get("plan")))
        price = f"{int(row.get('price') or 0):,}".replace(",", " ") + " ₽"
        if row.get("kind") == "accepted":
            pay = f"оплата до {esc(row.get('due'))}" if row.get("due") else "бесплатно"
            return (f"📄 <b>{name}</b>{handle} принял(а) оферту: договор № {esc(row.get('number'))}, «{plan}», {price}, {pay}.\n"
                    f"ФИО: {esc(row.get('legal'), 200)}. Кабинет открыт, страница закрыта до оплаты.")
        if row.get("kind") == "reported":
            return (f"💸 <b>{name}</b>{handle} сообщил(а) об оплате по договору № {esc(row.get('number'))}: {price}.\n"
                    f"Проверьте поступление и нажмите «Оплата получена»: Studio → Авторы → Договоры авторов: {STUDIO}")
        amount = f"{int(row.get('amount') or 0):,}".replace(",", " ") + " ₽"
        return f"✅ Оплата по договору № {esc(row.get('number'))} отмечена: {amount}, <b>{name}</b>{handle}. Страница может открыться читателям."
    if feed == "refused" and row.get("byline"):
        return (f"🟡 <b>Яндекс отказался определить группу автора</b>: {esc(row.get('byline'), 120)}\n"
                f"Фильтр содержания YandexGPT (обычно из-за названий работ). Работы на сайте в порядке, автора нет только в фильтре "
                f"«Что почитать» по группе (классики / современные). Нужно поставить группу вручную.")
    if feed == "refused":
        link = f"https://tryboks.com/b/{esc(row.get('slug') or row.get('id'))}"
        return (f"🟡 <b>Яндекс отказался размечать настроение</b>: «{esc(row.get('title'), 160)}» — {esc(row.get('author'), 120)}\n"
                f"Фильтр содержания YandexGPT («не могу обсуждать эту тему»). Работа на сайте в порядке, её нет только в подборках "
                f"«Что почитать» по настроению. Нужно поставить настроение вручную (грустное / весёлое / на подумать).\n"
                f"{link}\nbok id: <code>{esc(row.get('id'))}</code>")
    words = f", {row['words']} слов" if row.get("words") else ""
    if row.get("series"):
        return series_sent(row, words)
    return (f"📝 <b>На модерацию</b>: «{esc(row.get('title'), 160)}» от {who(row)}{words}\n"
            f"Ждут проверки: {row.get('waiting')}. Studio → Модерация: {STUDIO}")


def series_sent(row, words):
    """A piece sent from the Workshop or My page with the author's voice: the editors check it,
    accept it into work, and make the pictures and the Boks Series."""
    author = f"{esc(row['name'], 120)} ({who(row)})" if row.get("name") else who(row)
    lines = [f"🎙 <b>В работу на Boks Series</b>: «{esc(row.get('title'), 160)}»",
             f"от {author}{words}"]
    if row.get("voiceMs"):
        seconds = round(row["voiceMs"] / 1000)
        how = "свой файл" if row.get("voiceSource") == "upload" else "суфлёр"
        lines.append(f"Голос: {seconds // 60}:{seconds % 60:02d} ({how})")
    if row.get("queuePos"):
        lines.append(f"В очереди автора: {row['queuePos']} из {row.get('queue') or row['queuePos']}")
    lines.append("Нужно: проверить текст и запись → «Принять в работу» → картинки и сборка Boks Series.")
    lines.append(f"Ждут редакции на Series: {row.get('seriesWaiting')}. Studio → Модерация: {STUDIO}")
    return "\n".join(lines)


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
