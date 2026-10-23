# Vardena backend image: API + worker from one build (ADR-0001, ADR-0010).
#
# Stages:
#   base       — node:22-slim with npm 11 and npm network-resilience settings
#   deps       — installed node_modules (cached unless package files change)
#   build      — compiled dist/ + Prisma CLI (also the `migrate` image)
#   production — lean runtime (no dev deps, no CLI, no sources)
#
# The compose stack runs migrations from `target: build`
# (`npx prisma migrate deploy`) before starting API/worker from `production`.
#
# npm: node:22-slim bundles npm 10, whose resolver crashes on this dependency
# graph ("Exit handler never called!" — see README.md → Requirements), so the
# image upgrades to npm 11 before installing. Fetch retries/timeouts ride out
# slow registry links, and the `/root/.npm` BuildKit cache mount keeps
# downloaded tarballs between build attempts: a failed `npm ci` (network hiccup)
# resumes on rerun instead of re-downloading. Because the cache lives in a
# cache mount and never in an image layer, no `npm cache clean` is needed.

FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.npm npm install -g npm@11
ENV NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=15000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=900000 \
    NPM_CONFIG_PREFER_OFFLINE=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM base AS build
WORKDIR /app
ENV CHECKPOINT_DISABLE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# generate needs DATABASE_URL present (config load) but never connects here.
RUN DATABASE_URL=postgresql://build:[REDACTED]@localhost:5432/build npx prisma generate \
  && npm run build \
  && node --input-type=module -e "await import('./dist/generated/prisma/client.js'); console.log('generated Prisma Client loads OK')"

FROM base AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# API default only; Compose overrides this for the non-HTTP worker entrypoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:${PORT:-3000}/api/v1/health/ready').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
