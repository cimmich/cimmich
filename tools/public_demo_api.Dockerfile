FROM postgres:17.9-bookworm@sha256:47f917f7409eacd22fc5dfb1dee634e1b55cf0c01d1a7eb701be2227a03e0641 AS postgres-client

FROM python:3.11-slim-trixie@sha256:90744cff8f32887f075c47d747a173ff333e9e98801667af93c357fa9f5e28ff AS python-runtime

# Trixie's Mesa 25 userspace is the minimum verified RADV generation for the
# reference Radeon 780M host. Bookworm's Mesa 22 enumerates the GPU but the kernel rejects
# its command stream, so keeping the runtime generation explicit is a safety
# requirement rather than a cosmetic base-image refresh.
FROM node:22-trixie-slim@sha256:db8a96a63e5264607ada2d206758876ebbed6a12be2ada7517793cbfb0c2a29c AS runtime

ARG TARGETARCH
ARG CIMMICH_WITH_ULTRALYTICS_BODY=false
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 libvulkan1 mesa-vulkan-drivers postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# Keep the provider ABI on the same Python 3.11 generation as the accepted
# numerical wheels while allowing the OS and GPU userspace to advance together.
COPY --from=python-runtime /usr/local /usr/local
RUN ln -s /usr/local/bin/python3 /usr/bin/python3

# The private Linux/amd64 Vulkan path uses the upstream portable runtime but
# keeps model weights deployment-owned. Both downloads are pinned by digest;
# non-amd64 images retain the portable CPU/CoreML paths and install no binary.
RUN if [ "$TARGETARCH" = "amd64" ]; then \
    curl -fsSL \
      -o /tmp/realesrgan-ncnn-vulkan.zip \
      https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases/download/v0.2.0/realesrgan-ncnn-vulkan-v0.2.0-ubuntu.zip \
    && echo "d0e8e1cf954f5cde11be4745dd912cc3774bef36f71c5b1cb8f74c4112b6e919  /tmp/realesrgan-ncnn-vulkan.zip" | sha256sum -c - \
    && mkdir -p /tmp/realesrgan-ncnn-vulkan \
    && python3 -m zipfile -e /tmp/realesrgan-ncnn-vulkan.zip /tmp/realesrgan-ncnn-vulkan \
    && echo "22c2296a39b40cc43ac92615c827ab6d4b60b7142e8cee59f718e3f8e2cdbda9  /tmp/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan-v0.2.0-ubuntu/realesrgan-ncnn-vulkan" | sha256sum -c - \
    && echo "5abb941454de437b0e90d78dcb72e3688f74e14bcd4e24393273cb5cd0e9c937  /tmp/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan-v0.2.0-ubuntu/LICENSE" | sha256sum -c - \
    && install -m 0555 /tmp/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan-v0.2.0-ubuntu/realesrgan-ncnn-vulkan /usr/local/bin/realesrgan-ncnn-vulkan \
    && mkdir -p /usr/share/licenses/cimmich \
    && install -m 0444 /tmp/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan-v0.2.0-ubuntu/LICENSE /usr/share/licenses/cimmich/realesrgan-ncnn-vulkan.LICENSE \
    && rm -rf /tmp/realesrgan-ncnn-vulkan /tmp/realesrgan-ncnn-vulkan.zip; \
  fi

COPY --from=postgres-client /usr/lib/postgresql/17/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=postgres-client /usr/lib/postgresql/17/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=postgres-client /usr/lib/postgresql/17/bin/psql /usr/local/bin/psql

COPY providers/opencv-sface/requirements.txt /tmp/cimmich-opencv-requirements.txt
COPY providers/insightface-user-supplied/requirements.txt /tmp/cimmich-insightface-requirements.txt
COPY providers/perceptual-dhash/requirements.txt /tmp/cimmich-dhash-requirements.txt
COPY providers/ultralytics-yolo-body/requirements-linux-cpu.txt /tmp/cimmich-ultralytics-body-requirements.txt
RUN python3 -m pip install --break-system-packages --no-cache-dir \
  -r /tmp/cimmich-opencv-requirements.txt \
  -r /tmp/cimmich-insightface-requirements.txt \
  -r /tmp/cimmich-dhash-requirements.txt \
  && if [ "$CIMMICH_WITH_ULTRALYTICS_BODY" = "true" ]; then \
    python3 -m pip install --break-system-packages --no-cache-dir \
      -r /tmp/cimmich-ultralytics-body-requirements.txt; \
  elif [ "$CIMMICH_WITH_ULTRALYTICS_BODY" != "false" ]; then \
    echo "CIMMICH_WITH_ULTRALYTICS_BODY must be true or false" >&2; \
    exit 1; \
  fi \
  && python3 -m pip uninstall --break-system-packages --yes opencv-python \
  && python3 -m pip install --break-system-packages --no-cache-dir \
    --force-reinstall --no-deps opencv-python-headless==4.11.0.86 \
  && rm /tmp/cimmich-opencv-requirements.txt /tmp/cimmich-insightface-requirements.txt /tmp/cimmich-dhash-requirements.txt /tmp/cimmich-ultralytics-body-requirements.txt

WORKDIR /app/service
COPY service/package.json service/package-lock.json ./
RUN npm ci --omit=dev

COPY service/src ./src
COPY service/bin ./bin
COPY service/enhanced ./enhanced
COPY providers/opencv-sface /app/providers/opencv-sface
COPY providers/insightface-user-supplied /app/providers/insightface-user-supplied
COPY providers/perceptual-dhash /app/providers/perceptual-dhash
COPY providers/source-pack-numpy /app/providers/source-pack-numpy
COPY providers/xmp-sidecar-reader /app/providers/xmp-sidecar-reader
COPY providers/ultralytics-yolo-body /app/providers/ultralytics-yolo-body
COPY providers/ultralytics-yolo-pose /app/providers/ultralytics-yolo-pose
COPY tools/local-ai-photo-lab /app/tools/local-ai-photo-lab
COPY migrations /app/migrations

ENV HOST=0.0.0.0
ENV PORT=3101
EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3101/health').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node
CMD ["node", "bin/start.mjs"]

FROM runtime AS production
