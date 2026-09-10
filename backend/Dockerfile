# Vardena backend image: API + worker from one build (ADR-0001, ADR-0010).
#
# Stages:
#   deps       — installed node_modules (cached unless package files change)
#   build      — compiled dist/ + Prisma CLI (also the `migrate` image)
#   production — lean runtime (no dev deps, no CLI, no sources)
#
# The compose stack runs migrations from `target: build`
# (`npx prisma migrate deploy`) before starting API/worker from `production`.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --no-audit --no-fund

FROM node:22-slim AS build
WORKDIR /app
ENV CHECKPOINT_DISABLE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# generate needs DATABASE_URL present (config load) but never connects here.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
  && npm run build \
  && node --input-type=module -e "await import('./dist/generated/prisma/client.js'); console.log('generated Prisma Client loads OK')"

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:${PORT:-3000}/api/v1/health/ready').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
