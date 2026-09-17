# Built from the repository root so the lockfile and workspace packages are in
# context:  docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Dependencies are installed from the manifests alone, so editing source does
# not invalidate the install layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/web/package.json ./apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Through Turbo, so @fmip/contracts is built first. Building apps/web alone
# bypasses the dependency graph and fails to type check.
RUN pnpm exec turbo run build --filter=@fmip/web

FROM base AS runtime
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
# Run as a non-root user; the node image ships one.
USER node
# The standalone bundle already carries its own node_modules, so nothing is
# installed here. `static` and `public` are not part of it and must be copied
# into the paths the server expects.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# The copy above is load-bearing, and it was missing until T-082 was checked on
# a deployment rather than on a laptop. `next build` does not put `public` in
# the standalone bundle, so an image without that line answers 404 for the
# service worker and every icon; the browser then stops considering the app
# installable, and no local check notices, because `next start` reads `public`
# straight from the working tree.
#
# Asserted here rather than covered by a test somewhere else: this is the only
# place it can go wrong, and a 404 for `/sw.js` is not a failure anything else
# is looking at.
RUN test -s ./apps/web/public/sw.js && test -d ./apps/web/public/icons

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
