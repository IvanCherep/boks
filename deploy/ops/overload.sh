#!/usr/bin/env bash
# Overload guard. Started every minute by cron; samples every 15 s for that minute.
#
# Overloaded = CPU >= 85%, or answers slower than 2 s while CPU >= 60%, in 3 samples (45 s) in a row.
# Then flags/busy.on is created: Caddy shows new visitors the waiting page
# (deploy/busy) while people already reading keep their API. Back to normal
# after 12 calm samples in a row (3 minutes: CPU < 55% and answer < 0.6 s).
# Every switch goes to Telegram. Also a planning warning at CPU >= 70% for 5 min.
set -uo pipefail
cd "$(dirname "$0")/.."
STATE=/var/lib/boks-ops
FLAG=flags/busy.on
mkdir -p "$STATE" flags
exec 9>"$STATE/overload.lock"; flock -n 9 || exit 0   # one instance at a time
notify() { ops/notify.sh "$1" || true; }

cpu_pct() {  # busy CPU over a 3-second window, all cores
  read -r _ a b c d e f g h _ < /proc/stat; local t1=$((a+b+c+d+e+f+g+h)) i1=$((d+e))
  sleep 3
  read -r _ a b c d e f g h _ < /proc/stat; local t2=$((a+b+c+d+e+f+g+h)) i2=$((d+e))
  echo $(( 100 * ( (t2-t1) - (i2-i1) ) / (t2-t1) ))
}
probe_ms() {  # one cheap page-path request through Caddy and the app
  local s; s=$(curl -s -o /dev/null -m 5 -w '%{time_total}' --resolve tryboks.com:443:127.0.0.1 https://tryboks.com/api/geo || echo 5)
  awk -v s="$s" 'BEGIN{printf "%d", s*1000}'
}

for _ in 1 2 3 4; do
  started=$(date +%s)
  cpu=$(cpu_pct); ms=$(probe_ms)
  echo "$(date +%s) $cpu $ms" >> "$STATE/load.log"
  hot=$(cat "$STATE/hot" 2>/dev/null || echo 0); calm=$(cat "$STATE/calm" 2>/dev/null || echo 0); warm=$(cat "$STATE/warm" 2>/dev/null || echo 0)

  # Slow answers count only together with a busy CPU: a restart or a crashed
  # service is not overload (alerts.sh reports those).
  if [ "$cpu" -ge 85 ] || { [ "$ms" -ge 2000 ] && [ "$cpu" -ge 60 ]; }; then hot=$((hot+1)); calm=0; else hot=0; fi
  if [ "$cpu" -lt 55 ] && [ "$ms" -lt 600 ]; then calm=$((calm+1)); else calm=0; fi
  if [ "$cpu" -ge 70 ]; then warm=$((warm+1)); else warm=0; fi

  if [ ! -f "$FLAG" ] && [ "$hot" -ge 3 ]; then
    date +%s > "$FLAG"
    notify "🟠 <b>Сервер перегружен</b>: процессор ${cpu}%, ответ ${ms} мс.
Новые посетители видят страницу ожидания со стихотворением; те, кто уже читает, продолжают.
Что делать: увеличить сервер в Selectel (раздел «Ступени» в плане) или дождаться спада."
  elif [ -f "$FLAG" ] && [ "$calm" -ge 12 ]; then
    since=$(( ( $(date +%s) - $(cat "$FLAG") ) / 60 )); rm -f "$FLAG"
    notify "✅ <b>Нагрузка спала</b>: процессор ${cpu}%, ответ ${ms} мс. Страница ожидания выключена (была ${since} мин)."
  fi

  # Planning warning: sustained 70%+ for 5 minutes, at most once in 6 hours.
  if [ "$warm" -ge 20 ] && [ ! -f "$FLAG" ]; then
    last=$(cat "$STATE/warm.sent" 2>/dev/null || echo 0)
    if [ $(( $(date +%s) - last )) -ge 21600 ]; then
      date +%s > "$STATE/warm.sent"
      notify "🟡 <b>Сервер долго работает на пределе</b>: процессор ≥70% уже 5 минут (сейчас ${cpu}%). Пора планировать следующую ступень."
    fi
  fi
  echo "$hot" > "$STATE/hot"; echo "$calm" > "$STATE/calm"; echo "$warm" > "$STATE/warm"

  sleep $(( 15 - ( $(date +%s) - started ) > 0 ? 15 - ( $(date +%s) - started ) : 0 ))
done

# Keep a week of samples.
tail -n 40320 "$STATE/load.log" > "$STATE/load.log.tmp" && mv "$STATE/load.log.tmp" "$STATE/load.log"
