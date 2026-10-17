# Independent Owner context: docker build owner-licensing/backend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN mkdir -p /var/lib/vardena-owner/audit-archive && chown -R node:node /var/lib/vardena-owner
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
