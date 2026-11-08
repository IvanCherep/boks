#!/usr/bin/env bash
# The country database the app looks visitors up in (lib/boks/geoip.ts):
# DB-IP "IP to Country Lite", CC BY 4.0, https://db-ip.com - attribution in
# /privacy. Published monthly; cron runs this on the 3rd (/etc/cron.d/boks-ops).
# The app re-reads the file within an hour; nothing restarts.
set -euo pipefail
cd "$(dirname "$0")/.."
notify() { ops/notify.sh "$1" || true; }
mkdir -p geoip
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

for month in "$(date +%Y-%m)" "$(date -d 'last month' +%Y-%m)"; do
  if curl -sfL --max-time 120 -o "$tmp/db.mmdb.gz" "https://download.db-ip.com/free/dbip-country-lite-$month.mmdb.gz"; then
    gunzip -f "$tmp/db.mmdb.gz"
    size=$(stat -c %s "$tmp/db.mmdb")
    [ "$size" -gt 1000000 ] || { notify "🔴 <b>База стран не обновилась</b>: файл за $month слишком мал ($size байт)."; exit 1; }
    mv "$tmp/db.mmdb" geoip/country.mmdb
    chmod 644 geoip/country.mmdb
    echo "$(date '+%F %T') geoip: country database $month, $size bytes"
    exit 0
  fi
done
notify "🔴 <b>База стран не обновилась</b>: DB-IP не отдал файл ни за этот, ни за прошлый месяц. Страна у новых визитов может перестать определяться, когда старый файл устареет."
exit 1
