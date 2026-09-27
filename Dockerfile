# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
# Build-time only: Vite inlines it into the client bundle (not a secret).
ARG VITE_PRIMEUI_LICENSE=""
ENV VITE_PRIMEUI_LICENSE=${VITE_PRIMEUI_LICENSE}
RUN npm run build && npm run build:scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    TZ=America/New_York
WORKDIR /app
COPY --from=build --chown=node:node /app/dist/analog ./dist/analog
COPY --from=build --chown=node:node /app/dist/migrate.cjs /app/dist/ddi-import.cjs ./dist/
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
# Migrate first; the server only starts if migrations succeed.
CMD ["sh", "-c", "node dist/migrate.cjs && exec node dist/analog/server/index.mjs"]
