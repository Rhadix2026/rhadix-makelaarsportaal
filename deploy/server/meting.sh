#!/usr/bin/env bash
# Capaciteitsmeting (elke 5 minuten via systemd; ook voor de nulmeting en de praktijkmeting).
# Schrijft alleen regels in CSV-bestanden onder /var/log/makelaarsportaal; leest geen inhoud.
#   systeem.csv:    tijd;load1;cpu_pct;geheugen_gebruikt_mb;geheugen_beschikbaar_mb;swap_mb;schijf_pct;
#                   db_mb;opslag_mb;docker_images_mb;docker_volumes_mb;gezond_prod;gezond_test
#   containers.csv: tijd;container;cpu_pct;geheugen_mb;geheugengrens_mb
# Met MP_MEETINTERVAL=<s> en een aantal herhalingen als argument ook als fijne meting te gebruiken:
#   MP_MEETINTERVAL=2 meting.sh 300     (10 minuten elke 2 s, bijvoorbeeld tijdens een import)
set -uo pipefail
UIT=/var/log/makelaarsportaal
# Omgeving waarvan database en opslag worden gemeten (standaard productie; tijdens de demo: test).
OMG="${MP_OMG:-/srv/makelaarsportaal}"
N="${1:-1}"
mkdir -p "$UIT"
[ -f "$UIT/systeem.csv" ] || echo "tijd;load1;cpu_pct;geheugen_gebruikt_mb;geheugen_beschikbaar_mb;swap_mb;schijf_pct;db_mb;opslag_mb;docker_images_mb;docker_volumes_mb;gezond_prod;gezond_test" > "$UIT/systeem.csv"
[ -f "$UIT/containers.csv" ] || echo "tijd;container;cpu_pct;geheugen_mb;geheugengrens_mb" > "$UIT/containers.csv"
mb() { du -sm "$1" 2>/dev/null | cut -f1; }
cpu() { read -r _ a b c d e f g _ < /proc/stat; t1=$((a+b+c+d+e+f+g)); i1=$((d+e)); sleep 1
        read -r _ a b c d e f g _ < /proc/stat; t2=$((a+b+c+d+e+f+g)); i2=$((d+e)); echo $(( (100*((t2-t1)-(i2-i1)))/(t2-t1) )); }
gezond() { local c; c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$1/api/gezond" 2>/dev/null) || true; echo "${c:-000}"; }
dfmb() { docker system df --format '{{.Type}};{{.Size}}' 2>/dev/null | awk -F';' -v t="$1" '$1==t{s=$2; if (s~/GB/) {sub(/GB/,"",s); s*=1024} else if (s~/MB/) {sub(/MB/,"",s)} else if (s~/kB/) {sub(/kB/,"",s); s/=1024} else {s=0}; printf "%.0f", s}'; }

for ((k = 1; k <= N; k++)); do
  T=$(date -Is)
  read -r L1 _ < /proc/loadavg
  read -r GEBR BESCH < <(free -m | awk '/^Mem:/{print $3, $7}')
  SWAP=$(free -m | awk '/^Swap:/{print $3}')
  SCHIJF=$(df --output=pcent / | tail -1 | tr -dc 0-9)
  echo "$T;$L1;$(cpu);$GEBR;$BESCH;$SWAP;$SCHIJF;$(mb "$OMG/db");$(mb "$OMG/opslag");$(dfmb Images);$(dfmb 'Local Volumes');$(gezond 8580);$(gezond 8581)" >> "$UIT/systeem.csv"
  docker stats --no-stream --format '{{.Name}};{{.CPUPerc}};{{.MemUsage}}' 2>/dev/null | while IFS=';' read -r NAAM CPU MEM; do
    echo "$T;$NAAM;${CPU%\%};$(echo "$MEM" | awk '{v=$1; u=$1; gsub(/[0-9.]/,"",u); gsub(/[^0-9.]/,"",v); if (u=="GiB") v*=1024; else if (u=="KiB") v/=1024; printf "%.0f", v}');$(echo "$MEM" | awk '{v=$3; u=$3; gsub(/[0-9.]/,"",u); gsub(/[^0-9.]/,"",v); if (u=="GiB") v*=1024; printf "%.0f", v}')" >> "$UIT/containers.csv"
  done
  if [ "$k" -lt "$N" ]; then sleep "${MP_MEETINTERVAL:-2}"; fi
done
exit 0
