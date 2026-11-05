#!/usr/bin/env bash
# Wekelijkse hersteltest: zet de laatste externe back-up terug in een tijdelijke map en een
# tijdelijke database-container, en vergelijkt met de tellingen en checksums uit die back-up.
# Raakt de draaiende omgeving niet (eigen container zonder netwerk, eigen map; daarna opgeruimd).
set -euo pipefail
. "${MP_RESTIC_ENV:-/root/.config/makelaarsportaal/restic.env}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
OMG="${MP_OMG:-/srv/makelaarsportaal}"
DOEL="${MP_BACKUP_WERK:-/srv/back-up}/hersteltest"
LOGMAP="${MP_LOG:-/var/log/makelaarsportaal}"
LOG="$LOGMAP/hersteltest.log"; mkdir -p "$LOGMAP"
PG=postgres@sha256:0cefaabd882e42bcb2a2f3dc56d3ce4770560ba62fd7f197f1a2e008fd5731ab
NAAM=mp-hersteltest
log() { echo "$(date -Is) $*" | tee -a "$LOG"; }
opruimen() { docker rm -f "$NAAM" >/dev/null 2>&1 || true; rm -rf "$DOEL"; }
trap opruimen EXIT

opruimen; install -d -m 700 "$DOEL"
restic restore latest --tag dagelijks --target "$DOEL" --quiet
W="$DOEL${MP_BACKUP_WERK:-/srv/back-up}/actueel"; O="$DOEL$OMG/opslag"

# 1. Bestanden: elke checksum uit de back-up moet kloppen.
(cd "$O" && sha256sum --quiet -c "$W/opslag.sha256") && log "opslag: $(wc -l < "$W/opslag.sha256") bestanden, checksums gelijk"

# 2. Database: dump terugzetten in een tijdelijke container en de kerntabellen tellen.
docker run -d --name "$NAAM" --network none -e POSTGRES_USER=studio -e POSTGRES_DB=studio -e POSTGRES_PASSWORD=hersteltest "$PG" >/dev/null
for i in $(seq 1 30); do docker exec "$NAAM" pg_isready -U studio -d studio >/dev/null 2>&1 && break; sleep 2; done
docker cp "$W/studio.dump" "$NAAM:/dump" >/dev/null
docker exec "$NAAM" psql -U studio -d studio -qc "CREATE ROLE studio_app NOLOGIN" >/dev/null 2>&1 || true
docker exec "$NAAM" pg_restore -U studio -d studio --no-owner /dump
for t in kantoor project bestand gegeven besluit concept verwerking gebruiker; do
  echo "$t $(docker exec "$NAAM" psql -U studio -d studio -Atc "SELECT count(*) FROM $t")"
done > "$DOEL/tellingen-hersteld.txt"
diff "$W/tellingen-exact.txt" "$DOEL/tellingen-hersteld.txt" && log "database: tellingen gelijk ($(tr '\n' ' ' < "$DOEL/tellingen-hersteld.txt"))"
log "hersteltest GESLAAGD (snapshot $(restic snapshots latest --tag dagelijks --json | jq -r '.[0].short_id'))"
date -Is > "$LOGMAP/hersteltest.laatst-geslaagd"
