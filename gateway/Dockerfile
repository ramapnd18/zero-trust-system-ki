# syntax=docker/dockerfile:1

# Gateway adalah satu-satunya container dengan port yang dipublikasikan ke host.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# openssl dibutuhkan Prisma; tzdata untuk pengecekan jam operasional.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/gateway

# Dependency & schema disalin lebih dulu agar layer cache efisien.
COPY gateway/package*.json ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
    && npx prisma generate

COPY gateway/src ./src
COPY gateway/docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
    && chown -R node:node /app

# Jalankan sebagai non-root.
USER node

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
