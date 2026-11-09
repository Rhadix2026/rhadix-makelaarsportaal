#!/usr/bin/env bash
# Eenmalige inrichting van de makelaarsportaal-server (Hetzner CPX32 x86 of CAX arm64, Ubuntu 24.04 LTS).
# Uitvoeren als root op de NIEUWE server, direct na het aanmaken. Raakt geen andere servers.
#
#   scp -r deploy/server root@<nieuw-ip>:/root/mp-server && ssh root@<nieuw-ip> 'bash /root/mp-server/inrichten.sh'
#
# Doet: updates, automatische beveiligingsupdates, Docker Engine + Compose (officiële repo),
# nginx, restic, swap 4 GB, deploygebruiker 'portaal' (alleen sleutel-login), mappen onder /srv,
# logrotatie, systemd-timers voor back-up, hersteltest en meting (pas actief na 'enable').
# Vraagt of toont geen wachtwoorden. Geheimen (database, restic, Cloudflare-certificaat) zet je
# daarna zelf, zie deploy/server/LEESMIJ.md.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "als root uitvoeren"; exit 1; }
ARCH=$(dpkg --print-architecture)
HIER=$(cd "$(dirname "$0")" && pwd)

export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get -y upgrade
apt-get install -y --no-install-recommends ca-certificates curl gnupg nginx restic unattended-upgrades ufw jq
dpkg-reconfigure -f noninteractive unattended-upgrades

# Docker Engine (officiële repository).
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# Docker-logs standaard met rotatie (ook voor containers buiten compose).
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
systemctl restart docker

# Swap als buffer naast de geheugengrenzen per container.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-swap.conf
fi

# Deploygebruiker (lid van docker), met dezelfde publieke sleutel als root nu heeft.
id portaal >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker portaal
install -d -m 700 -o portaal -g portaal /home/portaal/.ssh
install -m 600 -o portaal -g portaal /root/.ssh/authorized_keys /home/portaal/.ssh/authorized_keys

# Mappen. opslag: uid 1000 (gebruiker 'node' in de app-container). db: beheerd door de postgres-container.
for omg in makelaarsportaal makelaarsportaal-test; do
  install -d -m 750 -o portaal -g portaal /srv/$omg
  install -d -m 750 -o 1000 -g 1000 /srv/$omg/opslag
done
install -d -m 755 -o portaal -g portaal /srv/makelaarsportaal-modellen /srv/makelaarsportaal-modellen/hf
install -d -m 700 /srv/back-up /var/log/makelaarsportaal

# SSH: alleen sleutels; root alleen met sleutel (na de eerste geslaagde deploy als 'portaal' op 'no' zetten).
cat > /etc/ssh/sshd_config.d/90-makelaarsportaal.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSH
sshd -t && systemctl reload ssh

# Host-firewall (aanvullend op de Hetzner Cloud Firewall, die 443 alleen voor Cloudflare opent).
ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp comment ssh && ufw --force enable
bash "$HIER"/cloudflare-ufw.sh   # 443 alleen voor Cloudflare

# Scripts en systemd-timers (worden pas actief na 'systemctl enable --now …', zie LEESMIJ).
install -m 750 "$HIER"/back-up.sh "$HIER"/hersteltest.sh "$HIER"/meting.sh "$HIER"/meting-fijn.sh "$HIER"/fijnmeting-rapport.py /usr/local/sbin/
for f in "$HIER"/systemd/*; do install -m 644 "$f" /etc/systemd/system/; done
systemctl daemon-reload

# nginx: alleen de portaalconfiguratie; de standaardsite uit.
rm -f /etc/nginx/sites-enabled/default
install -m 644 "$HIER"/nginx-makelaarsportaal.conf /etc/nginx/sites-available/makelaarsportaal
echo "Klaar. Volgende stappen: deploy/server/LEESMIJ.md (certificaat, .env, model, images, timers)."
