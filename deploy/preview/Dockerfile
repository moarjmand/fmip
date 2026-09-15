# The preview image (T-086, D-064).
#
# One container, because the free plan of every host worth using gives one. It
# runs the API and the web app together and exposes only the web app's port:
# nothing in the browser talks to the API directly — the Next.js route handlers
# proxy `/api/scores/stream` and `/api/fixtures/:id/stream` server-side — so a
# single public port carries the whole product, server-sent events included.
# That is the point of choosing a platform over the quick tunnel of T-085.
#
# What is deliberately absent: the Python model service (forecasts report
# `unavailable`, honestly), Redis (only the ingestion scheduler needs it, and a
# container that scales to zero cannot poll anyway), and the recorded ingestion
# fixtures (they live under `src/`, which no built package ships).
#
# Built from the repository root:
#   docker build -f deploy/preview/Dockerfile -t fmip-preview .

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Dependencies from the manifests alone, so editing source does not invalidate
# the install layer. Every workspace package either app depends on must appear
# here, or the install silently omits it.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/ingestion/package.json ./packages/ingestion/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Through Turbo, so @fmip/contracts and @fmip/ingestion are built first.
RUN pnpm exec turbo run build --filter=@fmip/api --filter=@fmip/web --filter=@fmip/db
# `--legacy` for the same reason as `apps/api/Dockerfile`: pnpm 10 refuses to
# deploy from a workspace that does not inject its packages, and injecting would
# change how every workspace links locally for the sake of one image.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @fmip/api --prod deploy --legacy /tmp/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @fmip/db --prod deploy --legacy /tmp/db
# `pnpm deploy` installs production dependencies only, and the migrations need
# node-pg-migrate, which is a dev dependency — `packages/db/Dockerfile` keeps dev
# dependencies for exactly this reason. Rather than carry the whole workspace
# tree here, the migration tool is installed flat at the version the package
# asks for, and kept beside the migrations rather than merged into them, so
# nothing in the runtime depends on pnpm's layout.
RUN MIGRATOR="node-pg-migrate@$(node -p "require('/app/packages/db/package.json').devDependencies['node-pg-migrate']")" \
 && npm install --no-save --no-audit --no-fund --prefix /tmp/migrator "$MIGRATOR" \
 && test -f /tmp/migrator/node_modules/node-pg-migrate/bin/node-pg-migrate.js

FROM base AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# The API is reached over the loopback only; the web app is what is published.
ENV API_PORT=3001
ENV API_BASE_URL=http://127.0.0.1:3001
ENV PORT=8000
# No Python model service fits beside two Node processes in 512 MB, so this
# deployment declares that it has none: every forecast is recorded as
# `model_unreachable` with that reason, which the pages already know how to
# show. Forgetting the variable still refuses to boot.
ENV MODEL_SERVICE_URL=off
USER node

# The API, with its production dependencies.
COPY --from=build --chown=node:node /tmp/api/node_modules ./api/node_modules
COPY --from=build --chown=node:node /tmp/api/package.json ./api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./api/dist

# The web app. The standalone bundle carries its own node_modules; `static` and
# `public` are not part of it and must land where the server looks for them.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./web/
COPY --from=build --chown=node:node /app/apps/web/.next/static ./web/apps/web/.next/static

# Migrations and the development seed, so a fresh database can be brought up to
# the current schema at start without a second service.
COPY --from=build --chown=node:node /tmp/db/node_modules ./db/node_modules
COPY --from=build --chown=node:node /tmp/db/package.json ./db/package.json
COPY --from=build --chown=node:node /app/packages/db/dist ./db/dist
COPY --from=build --chown=node:node /app/packages/db/migrations ./db/migrations
COPY --from=build --chown=node:node /tmp/migrator/node_modules ./db/migrator/node_modules
COPY --from=build --chown=node:node /app/packages/db/seed ./db/seed

COPY --chown=node:node deploy/preview/start.mjs ./start.mjs

EXPOSE 8000
CMD ["node", "start.mjs"]
