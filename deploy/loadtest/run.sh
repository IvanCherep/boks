#!/usr/bin/env bash
set -a; . ~/boks-secrets/stack.env; set +a
K="docker run --rm -v $PWD:/lt -w /lt -e ANON_KEY=$ANON_KEY -e SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY -e JWT_SECRET=$JWT_SECRET grafana/k6:0.54.0 run --quiet boks.js"
calm() { until [ "$(ssh -n boks-app 'test -f /opt/boks/flags/busy.on && echo busy; awk "{print \$2}" /tmp/lt2.log | tail -3 | sort -n | tail -1' 2>/dev/null | tr '\n' ' ')" -lt 30 ] 2>/dev/null; do sleep 15; done; }
for r in 60 300 900 1800; do
  calm; s=$(date +%s)
  out=$(eval "$K -e RATE=$r -e DURATION=7m -e CAP=300" 2>/dev/null | tail -1); e=$(date +%s)
  echo "$out"; echo "  server: $(ssh -n boks-app "bash /tmp/winstats.sh $s $e" 2>/dev/null)"; echo "$s $e rate $r" >> windows2.txt
done
calm; sleep 60; s=$(date +%s)
out=$(eval "$K -e SPIKE=1 -e SPIKE_N=300 -e CAP=180" 2>/dev/null | tail -1); e=$(date +%s)
echo "$out"; echo "  server: $(ssh -n boks-app "bash /tmp/winstats.sh $s $e" 2>/dev/null)"; echo "$s $e spike 300" >> windows2.txt
