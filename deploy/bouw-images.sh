#!/usr/bin/env bash
# Bouwt de images van het makelaarsportaal (app en web).
#
#   deploy/bouw-images.sh [tag]                          lokaal, voor linux/arm64 (of PLATFORM=linux/amd64)
#   BOUW_SERVER=portaal@<ip> deploy/bouw-images.sh [tag] op de server zelf, voor de eigen architectuur
#                                                        (geen emulatie, geen upload van het image van ±3,8 GB)
#   standaardtag: de korte commit van de studio
#
# - Studio: alleen gecommitte code (git archive van HEAD): nooit data/, .env of een werkmap.
# - Generator: een git-kloon van de productie-instantie op de vaste commit (VERWACHTE_COMMIT in
#   api/src/generator.ts), zonder .cache (modellen, Chromium); Chromium komt via Playwright in het
#   image, het SigLIP-model wordt op de server gekoppeld.
# Geen openbaar register: lokaal gebouwd gaat het image met docker save / load naar de server
# (deploy/uitrollen.sh); op de server gebouwd blijft het daar. Naar de server gaat alleen de
# broncode (studio en generator); de bouwmap daar wordt na afloop verwijderd.
set -euo pipefail
cd "$(dirname "$0")/.."

PLATFORM="${PLATFORM:-linux/arm64}"
GENERATOR_BRON="${STUDIO_GENERATOR:-$HOME/Developer/makelaarsplatform-productie}"
COMMIT=$(sed -n "s/^export const VERWACHTE_COMMIT = '\([0-9a-f]*\)';/\1/p" api/src/generator.ts)
TAG="${1:-$(git rev-parse --short HEAD)}"

[ -n "$COMMIT" ] || { echo "VERWACHTE_COMMIT niet gevonden"; exit 1; }
[ -z "$(git status --porcelain)" ] || echo "let op: niet-gecommitte wijzigingen in de studio gaan NIET mee in het image"
git -C "$GENERATOR_BRON" cat-file -e "$COMMIT^{commit}" || { echo "generatorcommit $COMMIT niet gevonden in $GENERATOR_BRON"; exit 1; }

WERK=$(mktemp -d "${TMPDIR:-/tmp}/mp-bouw.XXXXXX")
trap 'rm -rf "$WERK"' EXIT
mkdir -p "$WERK/studio"
git archive HEAD | tar -x -C "$WERK/studio"
git clone --quiet --no-local "$GENERATOR_BRON" "$WERK/generator"
git -C "$WERK/generator" checkout --quiet --detach "$COMMIT"
git -C "$WERK/generator" remote remove origin
echo "studio $(git rev-parse --short HEAD), generator $(git -C "$WERK/generator" rev-parse --short HEAD), ${BOUW_SERVER:+server $BOUW_SERVER, }platform ${BOUW_SERVER:+van de server}${BOUW_SERVER:-$PLATFORM}, tag $TAG"

if [ -n "${BOUW_SERVER:-}" ]; then
  echo "== bouwen op $BOUW_SERVER (eigen architectuur)"
  tar -C "$WERK" -czf - studio generator | ssh "$BOUW_SERVER" 'rm -rf ~/mp-bouw && mkdir -p ~/mp-bouw && tar -xzf - -C ~/mp-bouw'
  ssh "$BOUW_SERVER" bash -s -- "$TAG" <<'OP_SERVER'
set -euo pipefail
TAG=$1; B=~/mp-bouw; trap 'rm -rf "$B"' EXIT
docker buildx build --load --build-context studio="$B/studio" --build-context generator="$B/generator" \
  -f "$B/studio/deploy/Dockerfile.app" -t "makelaarsportaal-app:$TAG" "$B/studio"
docker buildx build --load --build-context studio="$B/studio" \
  -f "$B/studio/deploy/Dockerfile.web" -t "makelaarsportaal-web:$TAG" "$B/studio"
docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep "makelaarsportaal-.*:$TAG"
OP_SERVER
  exit 0
fi

docker buildx build --platform "$PLATFORM" --load \
  --build-context studio="$WERK/studio" --build-context generator="$WERK/generator" \
  -f deploy/Dockerfile.app -t "makelaarsportaal-app:$TAG" "$WERK/studio"
docker buildx build --platform "$PLATFORM" --load \
  --build-context studio="$WERK/studio" \
  -f deploy/Dockerfile.web -t "makelaarsportaal-web:$TAG" "$WERK/studio"

docker image ls --format '{{.Repository}}:{{.Tag}}  {{.Size}}' | grep "makelaarsportaal-.*:$TAG"
