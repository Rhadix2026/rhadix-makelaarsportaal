#!/usr/bin/env bash
# Rolt een gebouwde versie uit naar de makelaarsportaal-server (productie of test).
#
#   deploy/uitrollen.sh <server> <omgeving> [tag]     omgeving: makelaarsportaal | makelaarsportaal-test
#
# - Staan de images al op de server (BOUW_SERVER in bouw-images.sh), dan worden die gebruikt. Anders
#   gaan ze van deze Mac naar de server (docker save | ssh docker load), na een architectuurcontrole.
#   Geen openbaar register en geen registertoken op de server.
# - Op de server: compose.yml naar /srv/<omgeving>/, MP_TAG in .env bijgewerkt, 'up -d', daarna de
#   gezondheidscontrole. Mislukt die, dan gaat de vorige tag terug (de vorige images blijven staan).
# - Raakt geen andere servers of containers. De .env met geheimen staat al op de server (zie LEESMIJ).
set -euo pipefail
cd "$(dirname "$0")/.."
SERVER="${1:?server (bijvoorbeeld portaal@<ip>)}"
OMG="${2:?omgeving: makelaarsportaal of makelaarsportaal-test}"
TAG="${3:-$(git rev-parse --short HEAD)}"
case "$OMG" in makelaarsportaal) POORT=8580 ;; makelaarsportaal-test) POORT=8581 ;; *) echo "onbekende omgeving"; exit 1 ;; esac

SERVER_ARCH=$(ssh "$SERVER" dpkg --print-architecture)
if ssh "$SERVER" docker image inspect "makelaarsportaal-app:$TAG" "makelaarsportaal-web:$TAG" >/dev/null 2>&1; then
  echo "== images $TAG staan al op $SERVER (op de server gebouwd)"
else
  docker image inspect "makelaarsportaal-app:$TAG" "makelaarsportaal-web:$TAG" >/dev/null || { echo "images $TAG ontbreken: eerst deploy/bouw-images.sh"; exit 1; }
  [ "$(docker image inspect -f '{{.Architecture}}' "makelaarsportaal-app:$TAG")" = "$SERVER_ARCH" ] || { echo "image is niet $SERVER_ARCH (architectuur van de server)"; exit 1; }
  echo "== images naar $SERVER ($TAG)"
  docker save "makelaarsportaal-app:$TAG" "makelaarsportaal-web:$TAG" | gzip -1 | ssh "$SERVER" 'gunzip | docker load'
fi
scp -q deploy/compose.yml "$SERVER:/srv/$OMG/compose.yml"

echo "== uitrollen $OMG"
ssh "$SERVER" bash -s -- "$OMG" "$TAG" "$POORT" <<'OP_SERVER'
set -euo pipefail
OMG=$1; TAG=$2; POORT=$3; cd /srv/$OMG
VORIG=$(sed -n 's/^MP_TAG=//p' .env)
sed -i "s/^MP_TAG=.*/MP_TAG=$TAG/" .env
DC="docker compose -p $OMG --env-file .env -f compose.yml"
# Vóór elke uitrol een databasedump (migraties gaan alleen vooruit; terugzetten kan hiermee).
if $DC ps --status running --services 2>/dev/null | grep -qx db; then
  install -d -m 700 /srv/$OMG/voor-uitrol
  $DC exec -T db pg_dump -U studio -d studio -Fc > "/srv/$OMG/voor-uitrol/$OMG-$(date +%Y%m%d-%H%M)-voor-$TAG.dump"
  ls -1t /srv/$OMG/voor-uitrol/$OMG-*.dump | tail -n +11 | xargs -r rm -f   # de laatste 10 bewaren
fi
$DC up -d --remove-orphans
for i in $(seq 1 45); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$POORT/api/gezond)" = 200 ] && { echo "gezond (tag $TAG)"; exit 0; }; sleep 2; done
echo "NIET gezond: terug naar $VORIG"; sed -i "s/^MP_TAG=.*/MP_TAG=$VORIG/" .env; $DC up -d; exit 1
OP_SERVER
