#!/usr/bin/env bash
# ts cpu% mem_avail_mb net_tx_bytes | per-container cpu%
while true; do
  read -r _ a b c d e f g h _ < /proc/stat; t1=$((a+b+c+d+e+f+g+h)); i1=$((d+e)); sleep 1
  read -r _ a b c d e f g h _ < /proc/stat; t2=$((a+b+c+d+e+f+g+h)); i2=$((d+e))
  cpu=$(( 100 * ( (t2-t1) - (i2-i1) ) / (t2-t1) ))
  mem=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  tx=$(awk '/eth0|ens|enp/{print $10; exit}' /proc/net/dev)
  ctr=$(docker stats --no-stream --format '{{.Name}}={{.CPUPerc}}' | sed 's/boks-//;s/-1=/=/' | paste -sd' ' -)
  echo "$(date +%s) $cpu $mem $tx | $ctr"
  sleep 3
done
