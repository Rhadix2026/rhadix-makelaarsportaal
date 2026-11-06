#!/usr/bin/env bash
# Host-firewall: poort 443 alleen voor de actuele Cloudflare-adressen (aanvullend op de Hetzner
# Cloud Firewall). Zo kan niemand Cloudflare omzeilen door het IP van de server direct aan te spreken.
# Raakt poort 22 niet. Opnieuw uitvoeren werkt de lijst bij.
#   bash /root/mp-server/cloudflare-ufw.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "als root uitvoeren"; exit 1; }
LIJST=$(for v in v4 v6; do curl -fsS "https://www.cloudflare.com/ips-$v"; echo; done | grep -E '^[0-9a-f:.]+/[0-9]+$')
[ "$(echo "$LIJST" | wc -l)" -ge 15 ] || { echo "Cloudflare-lijst onvolledig; niets gewijzigd"; exit 1; }
# Eerst de nieuwe regels, dan pas de oude weg: 443 is nooit even helemaal dicht voor Cloudflare.
for r in $LIJST; do ufw allow proto tcp from "$r" to any port 443 comment cloudflare >/dev/null; done
ufw --force delete allow 443/tcp >/dev/null 2>&1 || true
# Verouderde Cloudflare-regels (adres niet meer in de lijst) opruimen.
ufw status | awk '/443\/tcp/ && /cloudflare/ {print $3}' | sort -u | while read -r r; do
  echo "$LIJST" | grep -qx "$r" || ufw --force delete allow proto tcp from "$r" to any port 443 >/dev/null
done
echo "443 alleen voor $(echo "$LIJST" | wc -l) Cloudflare-reeksen"
