#!/usr/bin/env bash
# Schrijft de set_real_ip_from-regels voor de actuele Cloudflare-adressen (nginx).
#   deploy/server/cloudflare-ips.sh > /etc/nginx/conf.d/cloudflare-ips.conf && nginx -t && systemctl reload nginx
set -euo pipefail
echo "# Cloudflare-adressen, opgehaald $(date -u +%F)"
for v in v4 v6; do curl -fsS "https://www.cloudflare.com/ips-$v" | sed 's/^/set_real_ip_from /; s/$/;/'; done
