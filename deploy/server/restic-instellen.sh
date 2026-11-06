#!/usr/bin/env bash
# Zet de restic-configuratie voor de externe back-up (Hetzner Object Storage) op de server en
# initialiseert de versleutelde repository. Interactief, als root, door de beheerder zelf:
#
#   ssh -t root@<ip> 'bash /root/mp-server/restic-instellen.sh'
#
# Vraagt de bucketnaam (zichtbaar) en de S3-sleutels en het restic-wachtwoord (verborgen: niet
# zichtbaar bij het typen of plakken, niet in de uitvoer, niet in de shellgeschiedenis).
# Het restic-wachtwoord kiest u zelf in uw wachtwoordmanager: zonder dat wachtwoord is geen
# back-up terug te zetten.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "als root uitvoeren"; exit 1; }
MAP=/root/.config/makelaarsportaal
ENDPOINT="${MP_S3_ENDPOINT:-https://fsn1.your-objectstorage.com}"
install -d -m 700 "$MAP"
[ -e "$MAP/restic.env" ] && { echo "$MAP/restic.env bestaat al; eerst zelf verwijderen om opnieuw in te stellen"; exit 1; }

read -r -p "Bucketnaam: " BUCKET
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || { echo "ongeldige bucketnaam"; exit 1; }
read -r -s -p "S3 Access key (verborgen): " AK; echo
read -r -s -p "S3 Secret key (verborgen): " SK; echo
read -r -s -p "Restic-wachtwoord uit uw wachtwoordmanager (verborgen): " W1; echo
read -r -s -p "Restic-wachtwoord nogmaals (verborgen): " W2; echo
[ -n "$AK" ] && [ -n "$SK" ] || { echo "S3-sleutels ontbreken"; exit 1; }
[ "$W1" = "$W2" ] || { echo "de wachtwoorden zijn niet gelijk"; exit 1; }
[ "${#W1}" -ge 20 ] || { echo "kies een restic-wachtwoord van minstens 20 tekens"; exit 1; }

umask 077
printf '%s' "$W1" > "$MAP/restic-wachtwoord"
cat > "$MAP/restic.env" <<CONF
RESTIC_REPOSITORY=s3:$ENDPOINT/$BUCKET/makelaarsportaal
RESTIC_PASSWORD_FILE=$MAP/restic-wachtwoord
AWS_ACCESS_KEY_ID=$AK
AWS_SECRET_ACCESS_KEY=$SK
CONF
unset AK SK W1 W2
chmod 600 "$MAP/restic.env" "$MAP/restic-wachtwoord"

set -a; . "$MAP/restic.env"; set +a
if restic cat config >/dev/null 2>&1; then echo "repository bestaat al en is met dit wachtwoord te openen"
else restic init --quiet && echo "versleutelde repository aangemaakt in bucket $BUCKET"; fi
echo "Klaar. Geheimen staan alleen in $MAP (chmod 600)."
