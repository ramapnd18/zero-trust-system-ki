# syntax=docker/dockerfile:1

# Resource internal: port 3002 HANYA tersedia di network zt-network.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/service-transkrip

COPY service-transkrip/package*.json ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund \
    && npx prisma generate

COPY service-transkrip/src ./src

RUN chown -R node:node /app

USER node

EXPOSE 3002

CMD ["node", "src/index.js"]
