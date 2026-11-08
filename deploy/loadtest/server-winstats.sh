#!/usr/bin/env bash
# usage: winstats.sh <from_ts> <to_ts>  (reads /tmp/lt-samples.log) -> avg/max cpu, min mem, tx Mbps, avg cpu per container
awk -v s="$1" -v e="$2" '
  $1>=s+30 && $1<=e { n++; c+=$2; if($2>cm)cm=$2; if(!mm||$3<mm)mm=$3; if(!t0){t0=$1;x0=$4} t1=$1; x1=$4;
    for(i=6;i<=NF;i++){split($i,kv,"="); gsub("%","",kv[2]); cs[kv[1]]+=kv[2]} }
  END { if(!n){print "no samples"; exit}
    printf "cpu avg %d%% max %d%% | mem min %d MB | tx %.1f Mbps | containers:", c/n, cm, mm, (t1>t0)?(x1-x0)*8/(t1-t0)/1e6:0
    for(k in cs) printf " %s=%d%%", k, cs[k]/n; print "" }' /tmp/lt-samples.log
