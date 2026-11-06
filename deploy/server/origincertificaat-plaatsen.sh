#!/usr/bin/env bash
# Plaatst het Cloudflare-origincertificaat en de privésleutel op de server en zet nginx aan.
# Interactief, als root, door de beheerder zelf:
#
#   ssh -t root@<ip> 'bash /root/mp-server/origincertificaat-plaatsen.sh'
#
# Het certificaat is niet geheim (wordt zichtbaar geplakt); de privésleutel wordt verborgen
# geplakt (geen echo) en alleen naar /etc/ssl/makelaarsportaal/origin.key geschreven (chmod 600).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "als root uitvoeren"; exit 1; }
D=/etc/ssl/makelaarsportaal; install -d -m 700 "$D"
lees_pem() { local regel uit=""; while IFS= read -r regel; do uit+="$regel"$'\n'; [[ "$regel" == "-----END "* ]] && break; done; printf '%s' "$uit"; }

echo "Plak het Origin Certificate (van -----BEGIN CERTIFICATE----- t/m -----END CERTIFICATE-----):"
CERT=$(lees_pem)
echo "Plak nu de Private key (verborgen; eindigt na de regel -----END PRIVATE KEY-----):"
stty -echo; trap 'stty echo' EXIT; KEY=$(lees_pem); stty echo; echo
printf '%s\n' "$CERT" | openssl x509 -noout 2>/dev/null || { echo "certificaat is niet geldig"; exit 1; }
printf '%s\n' "$KEY" | openssl pkey -noout 2>/dev/null || { echo "privésleutel is niet geldig"; exit 1; }
[ "$(printf '%s\n' "$CERT" | openssl x509 -noout -pubkey | sha256sum)" = "$(printf '%s\n' "$KEY" | openssl pkey -pubout | sha256sum)" ] \
  || { echo "certificaat en sleutel horen niet bij elkaar"; exit 1; }
umask 077
printf '%s\n' "$CERT" > "$D/origin.pem"; printf '%s\n' "$KEY" > "$D/origin.key"; unset KEY
chmod 644 "$D/origin.pem"; chmod 600 "$D/origin.key"
printf '%s\n' "$CERT" | openssl x509 -noout -subject -enddate -ext subjectAltName

bash "$(dirname "$0")/cloudflare-ips.sh" > /etc/nginx/conf.d/cloudflare-ips.conf
ln -sf /etc/nginx/sites-available/makelaarsportaal /etc/nginx/sites-enabled/makelaarsportaal
nginx -t && systemctl reload nginx && echo "nginx actief met het origincertificaat"
