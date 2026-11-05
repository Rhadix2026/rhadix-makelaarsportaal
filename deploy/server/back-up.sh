#!/usr/bin/env bash
# Dagelijkse externe back-up van het makelaarsportaal (productie), versleuteld met restic.
#   - database: pg_dump (custom-formaat) uit de db-container
#   - bestandsopslag: /srv/makelaarsportaal/opslag (brochures, foto's, imports, concepten)
#   - configuratie: /srv/makelaarsportaal/.env (versleuteld in de back-up)
#   - tellingen: rijen per tabel en sha256 van de opslag, voor de hersteltest
# Doel en sleutels in /root/.config/makelaarsportaal/restic.env (chmod 600; zie LEESMIJ).
# Bewaartermijn: 7 dagelijks, 4 wekelijks, 6 maandelijks.
set -euo pipefail
# Paden zijn instelbaar (voor een proef elders); de standaard is de productieserver.
. "${MP_RESTIC_ENV:-/root/.config/makelaarsportaal/restic.env}"
export RESTIC_REPOSITORY RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
OMG="${MP_OMG:-/srv/makelaarsportaal}"
PROJECT="${MP_PROJECT:-makelaarsportaal}"
COMPOSE="${MP_COMPOSE:-$OMG/compose.yml}"
WERK="${MP_BACKUP_WERK:-/srv/back-up}/actueel"
LOGMAP="${MP_LOG:-/var/log/makelaarsportaal}"
LOG="$LOGMAP/back-up.log"; mkdir -p "$LOGMAP"
log() { echo "$(date -Is) $*" | tee -a "$LOG"; }

rm -rf "$WERK" && install -d -m 700 "$WERK"
cd "$OMG"
DC="docker compose -p $PROJECT --env-file $OMG/.env -f $COMPOSE"
$DC exec -T db pg_dump -U studio -d studio -Fc > "$WERK/studio.dump"
$DC exec -T db psql -U studio -d studio -Atc \
  "SELECT relname || ' ' || n_live_tup FROM pg_stat_user_tables ORDER BY 1" > "$WERK/tellingen-db.txt"
# Exacte tellingen van de kerntabellen (pg_stat is een schatting).
for t in kantoor project bestand gegeven besluit concept verwerking gebruiker; do
  echo "$t $($DC exec -T db psql -U studio -d studio -Atc "SELECT count(*) FROM $t")"
done > "$WERK/tellingen-exact.txt"
(cd "$OMG/opslag" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum) > "$WERK/opslag.sha256"
cp "$OMG/.env" "$WERK/env" && chmod 600 "$WERK/env"

restic snapshots >/dev/null 2>&1 || { log "restic-repository niet bereikbaar of niet geïnitialiseerd"; exit 1; }
restic backup --quiet --tag dagelijks --host "$PROJECT" "$WERK" "$OMG/opslag"
restic forget --quiet --tag dagelijks --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
log "back-up gereed: $(wc -l < "$WERK/opslag.sha256") bestanden, dump $(du -h "$WERK/studio.dump" | cut -f1)"
date -Is > "$LOGMAP/back-up.laatst-geslaagd"
