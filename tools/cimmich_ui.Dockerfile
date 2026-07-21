FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder

ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.6.0 --activate

COPY ui/package.json ui/pnpm-lock.yaml ui/pnpm-workspace.yaml ./
COPY ui/packages ./packages
COPY ui/i18n ./i18n
COPY ui/web ./web

RUN pnpm --filter @immich/sdk --filter immich-web install --frozen-lockfile --force && \
    mkdir -p /workspace/web/node_modules/@immich && \
    ln -sfn ../../../packages/sdk /workspace/web/node_modules/@immich/sdk && \
    pnpm --filter @immich/sdk build

ARG PUBLIC_CIMMICH_API_URL=http://127.0.0.1:3101
ENV PUBLIC_CIMMICH_API_URL=${PUBLIC_CIMMICH_API_URL} \
    CIMMICH_NODE_RUNTIME=true

RUN pnpm --filter immich-web build && \
    pnpm --filter immich-web deploy --prod --ignore-scripts /runtime && \
    cp -R /workspace/web/build /runtime/build

FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY --from=builder /runtime ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "build"]
