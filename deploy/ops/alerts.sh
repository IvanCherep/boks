#!/usr/bin/env bash
# Runs every minute from cron. Each check reports once when it goes wrong and
# once when it recovers (state files in $STATE), never on every run.
set -uo pipefail
cd "$(dirname "$0")/.."
STATE=${BOKS_OPS_STATE:-/var/lib/boks-ops}
mkdir -p "$STATE"
notify() { ops/notify.sh "$1" || true; }

# alert <id> <is_bad 0|1> <message when bad> <message when recovered>
alert() {
  local id=$1 bad=$2 on=$3 off=$4 flag="$STATE/$1.alert"
  if [ "$bad" = 1 ] && [ ! -f "$flag" ]; then
    date +%s > "$flag"; notify "🔴 $on"
  elif [ "$bad" = 0 ] && [ -f "$flag" ]; then
    local since=$(( ( $(date +%s) - $(cat "$flag") ) / 60 ))
    rm -f "$flag"; notify "✅ $off (было ${since} мин)"
  fi
}

# 1. Every service is running. During a release (ops/switch.sh, flags/deploying,
# at most 15 minutes old) an app copy being recreated is expected, not an outage.
deploying=0
[ -f flags/deploying ] && [ $(( $(date +%s) - $(cat flags/deploying) )) -lt 900 ] && deploying=1
down=$(docker compose ps --all --format '{{.Service}} {{.State}}' | awk -v d=$deploying '$1!="mail" && $1!="embedder" && $2!="running" && !(d && $1 ~ /^app-/){print $1" ("$2")"}' | paste -sd, -)
alert services "$([ -n "$down" ] && echo 1 || echo 0)" "<b>Не работают сервисы:</b> $down" "Все сервисы снова работают"

# 2. A service keeps restarting (more than 3 restarts in total since it was created).
restarts=$(for c in $(docker compose ps -q); do docker inspect -f '{{.Name}} {{.RestartCount}}' "$c"; done | awk '$2>3{sub("/boks-","",$1); print $1" ×"$2}' | paste -sd, -)
alert restarts "$([ -n "$restarts" ] && echo 1 || echo 0)" "<b>Сервис перезапускается:</b> $restarts" "Перезапуски прекратились"

# 3. Disk and memory.
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9)
alert disk "$([ "$disk" -ge 80 ] && echo 1 || echo 0)" "<b>Диск занят на ${disk}%</b> (порог 80%)" "Диск в норме: ${disk}%"
mem=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
alert memory "$([ "$mem" -lt 300 ] && echo 1 || echo 0)" "<b>Мало свободной памяти:</b> ${mem} МБ" "Память в норме: ${mem} МБ"

# 4. Sign-in emails (deploy/mailer): a send that failed on both senders, or a fallback to .com.
mail_log=$(docker compose logs mailer --since 70s 2>/dev/null)
failed=$(grep -c '"event":"failed"' <<<"$mail_log" || true)
fallback=$(grep -c '"via":"fallback"' <<<"$mail_log" || true)
alert mail_failed "$([ "$failed" -gt 0 ] && echo 1 || echo 0)" "<b>Письма со входом не отправляются</b> ($failed за минуту). Читатели не могут войти." "Письма со входом снова отправляются"
alert mail_fallback "$([ "$fallback" -gt 0 ] && echo 1 || echo 0)" "<b>Письма уходят с запасного hello@tryboks.ru</b>: Resend отказал для tryboks.com" "Письма снова уходят с hello@tryboks.com"

# 5. Reading is being recorded: no reader event for 6 hours in the daytime means something broke.
hour=$(date +%H)
if [ "$hour" -ge 11 ] && [ "$hour" -le 23 ]; then
  quiet=$(docker compose exec -T db psql -U postgres -h localhost -At -c \
    "set statement_timeout='10s'; select not exists (select 1 from recommendation_events where created_at > now() - interval '6 hours');" 2>/dev/null | tail -1)
  alert no_events "$([ "$quiet" = t ] && echo 1 || echo 0)" "<b>6 часов нет ни одного события чтения.</b> Либо никто не читает, либо сломалась запись статистики." "События чтения снова записываются"
fi

# 6. Certificates, once an hour.
if [ "$(date +%M)" = 00 ]; then
  for host in tryboks.com tryboks.ru; do
    end=$(echo | openssl s_client -connect 127.0.0.1:443 -servername "$host" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    days=$(( ( $(date -d "$end" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
    alert "cert_$host" "$([ "$days" -lt 14 ] && echo 1 || echo 0)" "<b>Сертификат $host истекает через $days дн.</b>" "Сертификат $host продлён ($days дн.)"
  done
fi

# 7. Every new account, as it is confirmed: a reader who signed in with an
# email code for the first time (guests are anonymous and not counted). The
# address is masked; the handle is what the team knows them by. The first run
# only sets the watermark, so nobody is announced twice or all at once.
mark="$STATE/signups.since"
if [ ! -f "$mark" ]; then
  date -u +%Y-%m-%dT%H:%M:%SZ > "$mark"
else
  since=$(cat "$mark")
  rows=$(docker compose exec -T db psql -U postgres -h localhost -qAt -F $'\t' -v since="$since" 2>/dev/null <<'SQL'
set statement_timeout = '10s';
select to_char(u.email_confirmed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       coalesce('@' || p.handle, '—'),
       regexp_replace(coalesce(u.email, ''), '^(.).*(@.*)$', '\1***\2'),
       (select count(*) from auth.users t
         where coalesce(t.is_anonymous, false) = false
           and t.email_confirmed_at >= date_trunc('day', now() at time zone 'Europe/Moscow') at time zone 'Europe/Moscow')
from auth.users u
left join public.user_profiles p on p.user_id = u.id
where coalesce(u.is_anonymous, false) = false
  and u.email_confirmed_at > :'since'::timestamptz
order by u.email_confirmed_at
limit 20;
SQL
)
  if [ -n "$rows" ]; then
    while IFS=$'\t' read -r at handle email today; do
      [ -n "$at" ] || continue
      notify "🎉 <b>Новый пользователь:</b> $handle ($email). Регистраций сегодня: $today"
      echo "$at" > "$mark"
    done <<<"$rows"
  fi
fi

# 8. Resend sends at most 100 emails a day on our plan; past that, nobody can
# sign in. Counted from the mailer's own log since midnight UTC (Resend's day).
# Each threshold is announced once a day: at 60 it is time to upgrade the plan.
day=$(date -u +%Y-%m-%d)
sent_today=$(docker compose logs mailer --since "${day}T00:00:00Z" 2>/dev/null | grep -c '"event":"sent"' || true)
for threshold in 60 80 95; do
  flag="$STATE/mail_quota_${threshold}.${day}"
  if [ "$sent_today" -ge "$threshold" ] && [ ! -f "$flag" ]; then
    touch "$flag"
    notify "🚨 <b>Срочно: отправлено $sent_today из 100 писем за сутки</b> (Resend, сутки по UTC). На 100 письма со входом перестанут уходить. Обновите тариф Resend."
  fi
done
find "$STATE" -name 'mail_quota_*' -mtime +3 -delete 2>/dev/null || true
