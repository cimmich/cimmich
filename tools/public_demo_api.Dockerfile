FROM postgres:17.9-bookworm@sha256:47f917f7409eacd22fc5dfb1dee634e1b55cf0c01d1a7eb701be2227a03e0641 AS postgres-client

FROM node:22-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl postgresql-client python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY --from=postgres-client /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres-client /usr/lib/postgresql/17/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=postgres-client /usr/lib/postgresql/17/bin/psql /usr/local/bin/psql

COPY providers/opencv-sface/requirements.txt /tmp/cimmich-opencv-requirements.txt
COPY providers/insightface-user-supplied/requirements.txt /tmp/cimmich-insightface-requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir \
  -r /tmp/cimmich-opencv-requirements.txt \
  -r /tmp/cimmich-insightface-requirements.txt \
  && python3 -m pip uninstall --break-system-packages --yes opencv-python \
  && python3 -m pip install --break-system-packages --no-cache-dir \
    --force-reinstall --no-deps opencv-python-headless==4.11.0.86 \
  && rm /tmp/cimmich-opencv-requirements.txt /tmp/cimmich-insightface-requirements.txt

WORKDIR /app/service
COPY service/package.json service/package-lock.json ./
RUN npm ci --omit=dev

COPY service/src ./src
COPY service/bin ./bin
COPY service/enhanced ./enhanced
COPY providers/opencv-sface /app/providers/opencv-sface
COPY providers/insightface-user-supplied /app/providers/insightface-user-supplied
COPY migrations /app/migrations

ENV HOST=0.0.0.0
ENV PORT=3101
EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3101/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node
CMD ["node", "bin/start.mjs"]

FROM runtime AS production
