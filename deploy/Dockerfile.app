# Rhadix Makelaarsportaal: applicatie-image (API en verwerker gebruiken hetzelfde image).
# Bevat de bestaande studio en de bestaande generator op een vaste commit, met Chromium
# (Playwright) en de Python-omgeving voor de beeldclassificatie. Het SigLIP-model zelf zit er
# niet in: dat wordt alleen-lezen gekoppeld vanaf de server (/srv/makelaarsportaal/modellen/hf).
#
# Bouwen met deploy/bouw-images.sh (zet de build-contexten 'studio' en 'generator' klaar).
# Doelplatform: linux/arm64 (Hetzner CAX); bouwt ook voor linux/amd64.
FROM node:24.22.0-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    STUDIO_GENERATOR=/opt/generator \
    STUDIO_OPSLAG=/srv/opslag \
    STUDIO_HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/generator/.cache/ms-playwright \
    ASTRO_TELEMETRY_DISABLED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# git: de studio leest de generatorversie met git. python3: beeldclassificatie. curl: healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 python3-venv ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

# ── Generator (vaste commit, als git-checkout; zie bouw-images.sh) ──
COPY --from=generator --chown=node:node . /opt/generator
WORKDIR /opt/generator
# Ook de devDependencies: playwright, ajv en axe gebruikt de generator tijdens mp bouw/kwaliteit.
RUN npm ci --include=dev --no-audit --no-fund \
 # Chromium voor mp bouw/kwaliteit (Playwright-versie van de generator), met systeembibliotheken.
 && npx playwright install --with-deps chromium \
 && chown -R node:node /opt/generator/.cache

# Python-omgeving voor SigLIP, op de plek waar de generator haar verwacht (.cache/ai/venv), volgens
# tools/ai/requirements.txt (alleen wheels). Op arm64 is torch van PyPI al CPU-only; op amd64 eerst
# torch van de CPU-index, anders haalt pip de CUDA-versie (enkele GB) binnen.
ARG TARGETARCH
RUN python3 -m venv /opt/generator/.cache/ai/venv \
 && if [ "$TARGETARCH" = amd64 ]; then /opt/generator/.cache/ai/venv/bin/pip install --only-binary :all: --index-url https://download.pytorch.org/whl/cpu --no-deps torch==2.8.0; fi \
 && /opt/generator/.cache/ai/venv/bin/pip install --only-binary :all: -r /opt/generator/tools/ai/requirements.txt \
 && mkdir -p /opt/generator/.cache/ai/hf /opt/generator/metingen \
 && chown -R node:node /opt/generator/.cache /opt/generator/metingen

# ── Studio (alleen gecommitte code, zie bouw-images.sh) ──
COPY --from=studio --chown=node:node . /opt/studio
WORKDIR /opt/studio
# tsx draait de TypeScript-bron direct (zoals lokaal); daarom ook de ontwikkelpakketten.
RUN npm ci --include=dev --no-audit --no-fund \
 && mkdir -p /srv/opslag && chown node:node /srv/opslag

USER node
EXPOSE 8480
ENTRYPOINT ["/usr/bin/tini", "--"]
# API; de verwerker gebruikt hetzelfde image met: node_modules/.bin/tsx api/src/verwerker.ts
CMD ["node_modules/.bin/tsx", "api/src/server.ts"]
