# The migration tool image (T-074): node-pg-migrate plus this package's
# migrations, so the production database is migrated by
#
#     docker compose run --rm migrate
#
# without Node or pnpm installed on the VPS. The same image carries the
# operator's database tools (T-076), which is why it has `pg`:
#
#     docker compose run --rm migrate node scripts/grant-role.mjs --list
#
# Built from the repository root so the lockfile is in context:
#     docker build -f packages/db/Dockerfile .
#
# Dev dependencies are installed on purpose: node-pg-migrate is one. The seed
# is deliberately not part of the command — `assertSeedAllowed` refuses to seed
# a production database anyway; the catalog comes from ingestion.
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
# `highlightly-pairs.mjs` (T-1370) asks Highlightly through the adapter in
# `@fmip/ingestion`, a workspace dependency of this package since then.
COPY packages/ingestion/package.json ./packages/ingestion/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# The adapter, compiled: the only part of `@fmip/ingestion` the image carries.
FROM deps AS ingestion
COPY packages/config ./packages/config
COPY packages/ingestion ./packages/ingestion
RUN pnpm --filter @fmip/ingestion build

FROM deps AS runtime
ENV NODE_ENV=production
COPY --from=ingestion /app/packages/ingestion/dist ./packages/ingestion/dist
COPY packages/db/migrations ./packages/db/migrations
# The operator's tools that need the database and nothing else (T-076), run as
#     docker compose run --rm migrate node scripts/grant-role.mjs ...
COPY packages/db/scripts ./packages/db/scripts
USER node
WORKDIR /app/packages/db
# The same command as the package's `migrate` script, called directly rather
# than through pnpm: Corepack would otherwise fetch pnpm from the registry at
# run time, and a deploy must not depend on the registry answering.
CMD ["node", "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "--migrations-dir", "migrations", "--migrations-table", "schema_migration", "up"]
