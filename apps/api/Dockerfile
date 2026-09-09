# Built from the repository root so the lockfile and workspace packages are in
# context:  docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Dependencies are installed from the manifests alone, so editing source does
# not invalidate the install layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json ./packages/config/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @fmip/api build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @fmip/api --prod deploy /tmp/api

FROM base AS runtime
ENV NODE_ENV=production
# Run as a non-root user; the node image ships one.
USER node
COPY --from=build --chown=node:node /tmp/api/node_modules ./node_modules
COPY --from=build --chown=node:node /tmp/api/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
EXPOSE 3001
CMD ["node", "dist/main.js"]
