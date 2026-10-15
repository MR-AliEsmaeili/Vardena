# Build with repository-root context: docker build -f owner-licensing/frontend/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo/owner-licensing/frontend
COPY owner-licensing/frontend/package.json owner-licensing/frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY owner-licensing/frontend/ ./
# Exact-source canonical date helpers only, never customer runtime/config/data.
COPY frontend/src/lib/datetime/calendar.ts \
  frontend/src/lib/datetime/dayjs.ts \
  frontend/src/lib/datetime/numerals.ts \
  frontend/src/lib/datetime/business-date.ts \
  frontend/src/lib/datetime/time-zone.ts \
  frontend/src/lib/datetime/instant.ts \
  frontend/src/lib/datetime/instant-range.ts \
  /repo/frontend/src/lib/datetime/
RUN npm run build
FROM nginx:stable-alpine
COPY owner-licensing/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/owner-licensing/frontend/dist /usr/share/nginx/html
EXPOSE 8080
