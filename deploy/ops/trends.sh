#!/usr/bin/env bash
# Planning warnings from trends, not thresholds. Hourly from cron.
# Records disk, database size and the hour's CPU peak; once a day (09:xx)
# projects growth over the recorded window (up to 14 days) and warns, at most
# once a week per subject, when something will cross its limit within 30 days.
# Usage: trends.sh [--print]   (print the forecast instead of sending it)
set -uo pipefail
cd "$(dirname "$0")/.."
STATE=/var/lib/boks-ops
LOG="$STATE/metrics.log"
PRINT=0; [ "${1:-}" = --print ] && PRINT=1
mkdir -p "$STATE"; touch "$LOG"
notify() { ops/notify.sh "$1" || true; }
now=$(date +%s)

disk_used=$(df -B1 --output=used / | tail -1 | tr -d ' ')
disk_size=$(df -B1 --output=size / | tail -1 | tr -d ' ')
db_bytes=$(docker compose exec -T db psql -U postgres -h localhost -At -c "select pg_database_size('postgres')" 2>/dev/null | tail -1)
cpu_peak=$(awk -v since=$((now-3600)) '$1>=since && $2>m{m=$2} END{print m+0}' "$STATE/load.log" 2>/dev/null || echo 0)
[ "$PRINT" = 1 ] || echo "$now $disk_used $disk_size ${db_bytes:-0} $cpu_peak" >> "$LOG"
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"

[ "$PRINT" = 1 ] || [ "$(date +%H)" = 09 ] || exit 0

read -r status window disk_mb_day db_mb_day days_to_80 disk_pct db_mb cpu_peak_day < <(awk -v now="$now" '
  $1 >= now - 14*86400 { if (!first) { t0=$1; d0=$2; b0=$4; first=1 } t1=$1; d1=$2; size=$3; b1=$4;
                         if ($1 >= now - 86400 && $5 > peak) peak=$5 }
  END {
    if (!first) { print "none 0"; exit }
    days = (t1 - t0) / 86400
    if (days < 1) { printf "short %.1f\n", days; exit }
    dg = (d1 - d0) / days; bg = (b1 - b0) / days
    to80 = (dg > 0) ? (size * 0.8 - d1) / dg : -1
    printf "ok %.1f %.0f %.0f %.0f %.0f %.1f %d\n", days, dg/1048576, bg/1048576, to80, d1*100/size, b1/1048576, peak
  }' "$LOG")

if [ "$status" != ok ]; then
  [ "$PRINT" = 1 ] && echo "Для прогноза нужно хотя бы сутки наблюдений (сейчас ${window} дн.)."
  exit 0
fi

text="📈 <b>Прогноз по серверу</b> (по данным за ${window} дн.)
Диск: занято ${disk_pct}%, растёт на ${disk_mb_day} МБ/день$( [ "$days_to_80" -ge 0 ] && echo ", до 80% примерно через ${days_to_80} дн." )
База: ${db_mb} МБ, растёт на ${db_mb_day} МБ/день
Пик процессора за сутки: ${cpu_peak_day}%"
if [ "$PRINT" = 1 ]; then echo "$text"; exit 0; fi

warn_once() {  # subject, message
  local last; last=$(cat "$STATE/trend_$1.sent" 2>/dev/null || echo 0)
  if [ $((now - last)) -ge 604800 ]; then echo "$now" > "$STATE/trend_$1.sent"; notify "🟡 $2"; fi
}
if [ "$days_to_80" -ge 0 ] && [ "$days_to_80" -lt 30 ]; then
  warn_once disk "<b>Планово: диск заполнится до 80% примерно через ${days_to_80} дн.</b>
Сейчас ${disk_pct}%, рост ${disk_mb_day} МБ/день. Пора увеличить диск в Selectel или включить архив старых событий."
fi
if [ "$cpu_peak_day" -ge 70 ]; then
  warn_once cpu "<b>Планово: пик процессора за сутки ${cpu_peak_day}%.</b>
До перегрузки (85%) запас небольшой, стоит заранее подготовить следующую ступень."
fi
