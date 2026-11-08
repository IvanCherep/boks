#!/usr/bin/env bash
# Daily or weekly numbers to the team group. Usage: report.sh daily|weekly [--print]
# Times are Moscow (the server's timezone). Daily = yesterday; weekly = the last 7 full days.
set -euo pipefail
cd "$(dirname "$0")/.."
kind=${1:-daily}
to=$(date +%Y-%m-%d)
if [ "$kind" = weekly ]; then from=$(date -d "$to -7 days" +%Y-%m-%d); title="Неделя $(date -d "$from" +%d.%m)–$(date -d "$to -1 day" +%d.%m)"; vs="предыдущей неделей"
else from=$(date -d "$to -1 day" +%Y-%m-%d); title="Сутки $(date -d "$from" +%d.%m.%Y)"; vs="днём ранее"; fi

rows=$(docker compose exec -T db psql -U postgres -h localhost -d postgres -At -F'|' \
  -v from="$from 00:00 Europe/Moscow" -v to="$to 00:00 Europe/Moscow" -f - < ops/report.sql)

val() { awk -F'|' -v k="$1" '$1==k{print $2+0}' <<<"$rows"; }
was() { awk -F'|' -v k="$1" '$1==k{print $3+0}' <<<"$rows"; }
delta() { local n; n=$(val "$1"); local b; b=$(was "$1"); local d=$((n-b)); if [ "$d" -gt 0 ]; then echo " (+$d)"; elif [ "$d" -lt 0 ]; then echo " ($d)"; fi; }
line() { echo "$2: <b>$(val "$1")</b>$(delta "$1")"; }

starts=$(val starts); completes=$(val completes)
finish=$([ "$starts" -gt 0 ] && echo "$(( completes * 100 / starts ))%" || echo "—")
top=$(awk -F'|' '$1=="#top"{printf "  %d. %s — %s\n", ++i, $2, $3}' <<<"$rows")
countries=$(awk -F'|' '$1=="#country"{printf "%s %s · ", $2, $3}' <<<"$rows" | sed 's/ · $//')
dbsize=$(awk -F'|' '$1=="#dbsize"{print $2}' <<<"$rows")
disk=$(df -h --output=pcent,avail / | tail -1 | awk '{print $1" занято, свободно "$2}')
mem=$(free -m | awk '/Mem:/{print $7" МБ свободно из "$2}')

msg="📊 <b>boks · $title</b>
<i>в скобках — изменение по сравнению с $vs; устройства команды не учитываются</i>

$(line visitors 'Посетители') · визитов $(val visits)
$(line readers 'Читали') · начато боков $(val starts)
$(line completes 'Дочитано') · доля дочитанных $finish
$(line minutes 'Минут чтения')
$(line accounts 'Новые аккаунты') · приглашений к регистрации $(val prompts)
$(line likes 'Лайки') · комментарии $(val comments) · поделились $(val shares)
${countries:+
Страны: $countries}${top:+

Топ по дочитываниям:
$top}

🖥 Сервер: диск $disk · память $mem · база $dbsize"

if [ "${2:-}" = --print ]; then echo "$msg"; else ops/notify.sh "$msg" silent; fi
