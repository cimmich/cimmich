FROM cimmich-x1-archive-api:current-source AS cimmich_node

FROM ghcr.io/immich-app/immich-machine-learning:v3.0.3

COPY --from=cimmich_node /usr/local/bin/node /usr/local/bin/node

RUN /opt/venv/bin/python -m ensurepip && \
  /opt/venv/bin/python -m pip install --no-cache-dir --upgrade \
  insightface==1.0.1 \
  numpy==1.26.4 \
  onnxruntime==1.27.0 \
  opencv-python==4.11.0.86

WORKDIR /app
COPY service /app/service
COPY providers/insightface-user-supplied /app/providers/insightface-user-supplied

ENTRYPOINT ["node", "/app/service/bin/run-face-discovery-pilot.mjs"]
