#!/usr/bin/env bash
# Fijne meting tijdens verwerkingen (import, beeldclassificatie, conceptgeneratie): elke 2 seconden,
# maar alleen zolang de verwerker werkt (plus 30 s erna). Leest rechtstreeks de cgroup-tellers van de
# containers, dus vrijwel zonder eigen belasting; leest geen inhoud of gegevens.
# Draait als systemd-dienst (makelaarsportaal-meting-fijn.service); MP_PROJECT bepaalt de omgeving.
#
#   fijn.csv: tijd;bron;cpu_pct;geheugen_mb;swap_mb;anon_mb;file_mb;mem_beschikbaar_mb
#     bron = systeem of de containernaam. cpu_pct: 100 = één vCPU (container) of de hele machine (systeem).
#     anon = werkgeheugen, file = bestandscache (terug te winnen); samen ±geheugen_mb.
# Welke fase wanneer liep, volgt achteraf uit de verwerkingen in de database (fijnmeting-rapport.py).
set -uo pipefail
UIT="${MP_FIJN_UIT:-/var/log/makelaarsportaal/fijn.csv}"
PROJECT="${MP_PROJECT:-makelaarsportaal}"
INTERVAL="${MP_FIJN_INTERVAL:-2}"
DREMPEL="${MP_FIJN_DREMPEL:-10}"   # verwerker-CPU in % van één vCPU waarboven een verwerking 'loopt'
NALOOP=30
[ -s "$UIT" ] || echo "tijd;bron;cpu_pct;geheugen_mb;swap_mb;anon_mb;file_mb;mem_beschikbaar_mb" > "$UIT"

declare -A PAD VORIG
ververs() {
  PAD=()
  for c in db api verwerker web; do
    local id; id=$(docker inspect -f '{{.Id}}' "$PROJECT-$c-1" 2>/dev/null) || continue
    [ -d "/sys/fs/cgroup/system.slice/docker-$id.scope" ] && PAD[$c]="/sys/fs/cgroup/system.slice/docker-$id.scope"
  done
}
lees() { cat "$1" 2>/dev/null || echo 0; }
stat_mb() { awk -v k="$2" '$1==k {printf "%.0f", $2/1048576}' "$1/memory.stat" 2>/dev/null; }
cpu_sys() { read -r _ a b c d e f g _ < /proc/stat; echo "$((a+b+c+d+e+f+g)) $((d+e))"; }

ververs
laatst_ververst=$SECONDS; actief_tot=0
read -r T0 I0 < <(cpu_sys); T_VORIG=$EPOCHREALTIME
for c in "${!PAD[@]}"; do VORIG[$c]=$(awk '/^usage_usec/{print $2}' "${PAD[$c]}/cpu.stat"); done

while sleep "$INTERVAL"; do
  if (( SECONDS - laatst_ververst >= 30 )) || [ -z "${PAD[verwerker]:-}" ]; then ververs; laatst_ververst=$SECONDS; fi
  NU=$EPOCHREALTIME; DT=$(awk -v a="$NU" -v b="$T_VORIG" 'BEGIN{print (a-b)*1e6}'); T_VORIG=$NU
  declare -A CPU=()
  for c in "${!PAD[@]}"; do
    u=$(awk '/^usage_usec/{print $2}' "${PAD[$c]}/cpu.stat" 2>/dev/null || echo 0)
    CPU[$c]=$(awk -v u="$u" -v v="${VORIG[$c]:-$u}" -v dt="$DT" 'BEGIN{printf "%.0f", (dt > 0 ? (u-v)*100/dt : 0)}')
    VORIG[$c]=$u
  done
  read -r T1 I1 < <(cpu_sys); SYS=$(( (T1-T0) > 0 ? (100*((T1-T0)-(I1-I0)))/(T1-T0) : 0 )); T0=$T1; I0=$I1
  # Alleen vastleggen tijdens (en kort na) een verwerking.
  if (( ${CPU[verwerker]:-0} >= DREMPEL )); then actief_tot=$(( SECONDS + NALOOP )); fi
  (( SECONDS <= actief_tot )) || continue
  T=$(date -Is)
  BESCH=$(awk '/^MemAvailable/{printf "%.0f", $2/1024}' /proc/meminfo)
  SWAP=$(awk '/^SwapTotal/{t=$2} /^SwapFree/{f=$2} END{printf "%.0f", (t-f)/1024}' /proc/meminfo)
  GEBR=$(awk '/^MemTotal/{t=$2} /^MemAvailable/{a=$2} END{printf "%.0f", (t-a)/1024}' /proc/meminfo)
  {
    echo "$T;systeem;$SYS;$GEBR;$SWAP;;;$BESCH"
    for c in db api verwerker web; do
      p="${PAD[$c]:-}"; [ -n "$p" ] || continue
      echo "$T;$PROJECT-$c-1;${CPU[$c]:-0};$(( $(lees "$p/memory.current") / 1048576 ));$(( $(lees "$p/memory.swap.current") / 1048576 ));$(stat_mb "$p" anon);$(stat_mb "$p" file);"
    done
  } >> "$UIT"
done
