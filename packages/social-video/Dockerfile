# The render image of the T-1931 measurement (D-454): Node 22 on Debian
# bookworm, the shared libraries Chrome Headless Shell needs, the headless
# shell itself and the prebuilt Remotion bundle. It follows Remotion's own
# Docker page (https://www.remotion.dev/docs/docker, read 2026-11-19): the base
# image and the apt list are theirs, unpinned as they advise. Remotion 4 brings
# its own FFmpeg in `@remotion/compositor-*`, so none is installed here.
#
# Not deployed and not a compose service: the product's worker is T-1932's
# `apps/renderer`. Built from the repository root so the lockfile is in context:
#
#     docker build -f packages/social-video/Dockerfile -t fmip-social-video:t1931 .
#
# and run under the worker's limits (D-454 point 3):
#
#     docker run --rm --cpus=1 --memory=1280m -v <dir>:/out fmip-social-video:t1931 \
#       node scripts/render.mjs --aspect 9x16 --concurrency 1 --out /out/clip.mp4
#
# Docker Hub answers 403 from the maintainer's network, so the measurement
# built from Docker's own mirror of the same official image:
#     --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

# Chrome Headless Shell's dependencies, as Remotion's page lists them. A basic
# face arrives with libpango and libcairo; the clips load their own faces.
RUN apt-get update
RUN apt install -y \
  libnss3 \
  libdbus-1-3 \
  libatk1.0-0 \
  libgbm-dev \
  libasound2 \
  libxrandr2 \
  libxkbcommon-dev \
  libxfixes3 \
  libxcomposite1 \
  libxdamage1 \
  libatk-bridge2.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Production dependencies of this package alone, from the workspace lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY packages/config/package.json ./packages/config/
COPY packages/social-video/package.json ./packages/social-video/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

WORKDIR /app/packages/social-video

# Chrome Headless Shell, at the version this Remotion release is tested with
# (`ensureBrowser()` is the API behind `npx remotion browser ensure`).
RUN node -e "import('@remotion/renderer').then((r) => r.ensureBrowser())"

# The card's faces (one copy in git, under apps/web) and the package.
COPY apps/web/public/fonts/card /app/apps/web/public/fonts/card
COPY packages/social-video/ ./
RUN node scripts/prepare-assets.mjs && node scripts/bundle.mjs

CMD ["node", "scripts/render.mjs"]
