FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS build

RUN corepack enable && corepack prepare pnpm@11.6.0 --activate
WORKDIR /app/ui

COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./
COPY ui/i18n ./i18n
COPY ui/packages/sdk ./packages/sdk
COPY ui/web ./web

RUN pnpm --filter @immich/sdk --filter immich-web install --frozen-lockfile --force && \
    mkdir -p /app/ui/web/node_modules/@immich && \
    ln -sfn ../../../packages/sdk /app/ui/web/node_modules/@immich/sdk && \
    pnpm --filter @immich/sdk build

ARG PUBLIC_CIMMICH_API_URL
ENV PUBLIC_CIMMICH_API_URL=${PUBLIC_CIMMICH_API_URL}
ENV IMMICH_BUILD=3.0.3-cimmich-public-demo
RUN pnpm --dir web run build

FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de

COPY tools/public_demo_nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/ui/web/build /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
